-- ============================================================
-- MaalRise 052 — PART 2 OF 3
-- Read policies, notifications and payment reminders
--
-- The three parts together are exactly the body of
-- supabase/migrations/052_maalrise_distributions.sql, split so each
-- can be pasted and run on its own in the Supabase SQL Editor.
--
-- Run the parts IN ORDER, 1 to 3, each in its own Run.
-- Each part is its own transaction: if it fails, it leaves nothing
-- behind, and the earlier parts stay as they were. It refuses to run
-- out of order, or twice.
--
-- Success = the final result row reads "Part 2 of 3 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT (to_regclass('public.maalrise_email_outbox') IS NOT NULL) THEN
    RAISE EXCEPTION 'STOP: run part 1 of 3 first (it creates maalrise_email_outbox).';
  END IF;
  IF to_regprocedure('public.maalrise_sync_reminders()') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: part 2 of 3 has already been applied (maalrise_sync_reminders exists). Do not run it again.';
  END IF;
END $$;

-- >>> 052 BODY START (part 2)
-- ------------------------------------------------------------
-- 5. Who reads what. No write policies: writes go through the
--    functions below. payment_officer is not in is_admin(); it reads
--    only payment lines that are approved, and their history.
-- ------------------------------------------------------------
ALTER TABLE maalrise_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_distributions ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_distribution_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_payment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_email_outbox ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read receipts" ON maalrise_receipts FOR SELECT USING (is_admin());
CREATE POLICY "Staff read distributions" ON maalrise_distributions FOR SELECT USING (is_admin());
-- The payment officer sees an approved distribution's Cycle and month, nothing earlier.
CREATE POLICY "Payment officer reads approved distributions" ON maalrise_distributions
  FOR SELECT USING (status = 'approved' AND maalrise_caller_role() = 'payment_officer');
CREATE POLICY "Staff read payment lines" ON maalrise_distribution_lines FOR SELECT USING (is_admin());
CREATE POLICY "Payment officer reads approved payment lines" ON maalrise_distribution_lines
  FOR SELECT USING (status IN ('payable', 'paid') AND maalrise_caller_role() = 'payment_officer');
-- Phase 6 reads this: an investor sees their own approved lines, and
-- "paid" only once a person recorded the transfer.
CREATE POLICY "Investor reads own approved payment lines" ON maalrise_distribution_lines
  FOR SELECT USING (status IN ('payable', 'paid') AND maalrise_investor_id = get_my_maalrise_investor_id());
CREATE POLICY "Staff read payment history" ON maalrise_payment_events FOR SELECT USING (is_admin());
CREATE POLICY "Payment officer reads payment history" ON maalrise_payment_events
  FOR SELECT USING (maalrise_caller_role() = 'payment_officer');
CREATE POLICY "Each person reads own notifications" ON maalrise_notifications FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "Staff read email drafts" ON maalrise_email_outbox FOR SELECT USING (is_admin());

-- ------------------------------------------------------------
-- 6. Notifying
-- ------------------------------------------------------------
/**
 * One in-app notification per person holding any of p_roles, and —
 * when p_subject is given — an email DRAFT for each. Never sends.
 * Idempotent per (person, p_dedupe).
 */
CREATE OR REPLACE FUNCTION maalrise_notify_roles(
  p_roles TEXT[], p_kind TEXT, p_title TEXT, p_message TEXT, p_link TEXT,
  p_dedupe TEXT, p_subject TEXT)
RETURNS INTEGER AS $$
DECLARE
  v_n INTEGER;
BEGIN
  INSERT INTO maalrise_notifications (user_id, kind, title, message, link, dedupe_key)
  SELECT p.id, p_kind, p_title, p_message, p_link, p_dedupe
    FROM profiles p WHERE p.role::TEXT = ANY (p_roles)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  IF p_subject IS NOT NULL THEN
    INSERT INTO maalrise_email_outbox (kind, to_user_id, to_email, subject, body, dedupe_key)
    SELECT p_kind, p.id, lower(trim(p.email)), p_subject, p_message, p_dedupe
      FROM profiles p
     WHERE p.role::TEXT = ANY (p_roles) AND NULLIF(trim(p.email), '') IS NOT NULL
    ON CONFLICT (to_email, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** The investor's own notification (shown in the portal from Phase 6) and an email draft. */
CREATE OR REPLACE FUNCTION maalrise_notify_investor(
  p_investor UUID, p_kind TEXT, p_title TEXT, p_message TEXT, p_dedupe TEXT, p_subject TEXT)
RETURNS VOID AS $$
DECLARE
  v_inv maalrise_investors%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM maalrise_investors WHERE id = p_investor;
  IF NOT FOUND THEN RETURN; END IF;
  INSERT INTO maalrise_notifications (user_id, kind, title, message, link, dedupe_key)
  VALUES (v_inv.profile_id, p_kind, p_title, p_message, NULL, p_dedupe)
  ON CONFLICT (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  IF p_subject IS NOT NULL AND NULLIF(trim(v_inv.email), '') IS NOT NULL THEN
    INSERT INTO maalrise_email_outbox (kind, to_user_id, to_email, subject, body, dedupe_key)
    VALUES (p_kind, v_inv.profile_id, lower(trim(v_inv.email)), p_subject, p_message, p_dedupe)
    ON CONFLICT (to_email, dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_naira(p_kobo NUMERIC)
RETURNS TEXT AS $$
  SELECT '₦' || to_char(p_kobo / 100.0, 'FM999,999,999,999,990.00');
$$ LANGUAGE sql IMMUTABLE;

-- ------------------------------------------------------------
-- 7. Payment reminders
--
--    Derived from the approved schedule of every ACTIVE Cycle: on the
--    scheduled date (and until a full payment is recorded) a reminder;
--    five days after it, a follow-up flag. Each is created once per
--    person. Nothing is recorded or distributed by a reminder.
--    Called when staff open the portal (maalrise_my_notifications).
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_sync_reminders()
RETURNS INTEGER AS $$
DECLARE
  v_today DATE := maalrise_today();
  r       RECORD;
  v_n     INTEGER := 0;
  v_link  TEXT;
BEGIN
  FOR r IN
    SELECT c.id AS cycle_id, c.name AS cycle_name, cp.name AS cp_name, l.id AS line_id, l.period, l.due_date,
           l.counterparty_gross_kobo AS gross,
           COALESCE((SELECT SUM(amount_kobo) FROM maalrise_receipts x
                      WHERE x.schedule_line_id = l.id AND x.status <> 'rejected'), 0) AS recorded
      FROM maalrise_cycles c
      JOIN maalrise_counterparties cp ON cp.id = c.counterparty_id
      JOIN maalrise_schedule_lines l ON l.terms_id = c.approved_terms_id
     WHERE c.status = 'active' AND l.due_date <= v_today AND l.counterparty_gross_kobo > 0
  LOOP
    CONTINUE WHEN r.recorded >= r.gross;
    v_link := '/admin/maalrise/cycles/' || r.cycle_id || '#receipts';
    IF v_today - r.due_date >= 5 THEN
      v_n := v_n + maalrise_notify_roles(ARRAY['super_admin', 'administrator', 'finance'], 'payment_followup',
        'Follow up: ' || r.cp_name || ' payment overdue',
        CASE WHEN r.recorded = 0
             THEN 'No payment has been recorded for ' || r.cp_name || ' (' || r.cycle_name || ', month ' || r.period
                  || ') — it was scheduled for ' || to_char(r.due_date, 'DD Mon YYYY') || '. Please follow up.'
             ELSE 'Only ' || maalrise_naira(r.recorded) || ' of ' || maalrise_naira(r.gross) || ' has been recorded for '
                  || r.cp_name || ' (' || r.cycle_name || ', month ' || r.period || '), scheduled for '
                  || to_char(r.due_date, 'DD Mon YYYY') || '. Please follow up.' END,
        v_link, 'followup:' || r.line_id, 'MaalRise: follow up ' || r.cp_name || ' payment');
    END IF;
    v_n := v_n + maalrise_notify_roles(ARRAY['super_admin', 'administrator', 'finance'], 'payment_due',
      'Scheduled payment: ' || r.cp_name,
      CASE WHEN r.due_date = v_today
           THEN 'Today is the scheduled payment date for ' || r.cp_name || '. Please record the payment received when available.'
           ELSE 'The scheduled payment date for ' || r.cp_name || ' was ' || to_char(r.due_date, 'DD Mon YYYY')
                || '. Please record the payment received when available.' END
        || ' (' || r.cycle_name || ', month ' || r.period || ', ' || maalrise_naira(r.gross) || ')',
      v_link, 'due:' || r.line_id, 'MaalRise: scheduled payment from ' || r.cp_name);
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Unread count for the caller, after bringing reminders up to date. */
CREATE OR REPLACE FUNCTION maalrise_my_notifications()
RETURNS JSONB AS $$
DECLARE
  v_role TEXT := maalrise_caller_role();
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_role IN ('super_admin', 'administrator', 'finance') THEN
    PERFORM maalrise_sync_reminders();
  END IF;
  RETURN jsonb_build_object('unread',
    (SELECT COUNT(*) FROM maalrise_notifications WHERE user_id = auth.uid() AND read_at IS NULL));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_mark_notifications_read(p_ids UUID[])
RETURNS INTEGER AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  UPDATE maalrise_notifications SET read_at = NOW()
   WHERE user_id = auth.uid() AND read_at IS NULL AND (p_ids IS NULL OR id = ANY (p_ids));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- <<< 052 BODY END (part 2)

COMMIT;

SELECT 'Part 2 of 3 applied' AS result;
