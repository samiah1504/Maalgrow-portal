-- ============================================================
-- 052 — MaalRise monthly profit distribution (Phase 4)
--
-- APPLY ONLY AFTER supabase/checks/maalrise_052_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_052_postapply.sql.
-- To undo: supabase/checks/maalrise_052_rollback.sql (refuses if any
-- receipt, distribution or payment exists). Rehearsed by
-- supabase/tests/run_maalrise_tests.sh.
--
-- WHAT THIS ADDS
--
--   Counterparty receipts, monthly profit distributions, investor
--   payment lines with a central paid status, the payment history,
--   in-app notifications and an email outbox that only holds DRAFTS.
--   Every object is new and prefixed maalrise_. Nothing existing is
--   altered: no ALTER on a MaalGrow table, no CREATE OR REPLACE of a
--   MaalGrow or 051 function. It reads profiles and the 051 tables,
--   and writes to the existing audit_logs through create_audit_log().
--
-- WHAT IT NEVER DOES
--
--   Move money or send anything. A distribution is a calculation; a
--   payment line becomes "paid" only when a person records that the
--   bank transfer was made. The outbox has no sender: rows stay
--   'draft' until email sending is approved and built.
--
-- RULES (agreed for Phase 4)
--
--   * Receipts: finance, administrator or super admin RECORD; an
--     administrator or super admin CONFIRMS — including an entry they
--     recorded themselves. Only confirmed money is distributed.
--   * The scheduled date and the date money actually arrived are kept
--     apart. Nothing is assumed: no zero receipt, no distribution, is
--     ever created because a date passed.
--   * A receipt is applied to one month of the approved schedule. What
--     exceeds that month's outstanding amount is HELD, not distributed
--     (D6). Several part-payments for one month are each applied once.
--   * The service fee is taken from each receipt in proportion to the
--     month's scheduled fee; it is computed on the running total so the
--     parts add up to the scheduled fee exactly (A7).
--   * Investors share the net by units of the WHOLE Cycle, largest
--     remainder to the kobo; the unsubscribed units' share stays
--     unallocated. Tax: none (not configured, A12).
--   * At most one OPEN distribution per Cycle and month; a part-payment
--     confirmed after that month's distribution was approved makes a
--     follow-on distribution for the new money only.
--   * An administrator or super admin prepares and approves (the same
--     person may do both). Each line keeps a snapshot of the investor's
--     confirmed bank account.
--   * The payment officer (or an administrator/super admin) marks a
--     line paid after making the transfer outside the system. Only a
--     super admin reverses, with a reason; history is append-only.
--
-- Every UPDATE or DELETE here has a WHERE (Supabase's safeupdate).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 0. Roles and dates
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_can_pay()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(maalrise_caller_role() IN ('payment_officer', 'super_admin', 'administrator'), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

/** "Today" for due dates is the business's day in Lagos, not the server's UTC day. */
CREATE OR REPLACE FUNCTION maalrise_today()
RETURNS DATE AS $$
  SELECT (NOW() AT TIME ZONE 'Africa/Lagos')::DATE;
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 1. Receipts from the counterparty
-- ------------------------------------------------------------
CREATE TABLE maalrise_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id          UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  schedule_line_id  UUID NOT NULL REFERENCES maalrise_schedule_lines(id) ON DELETE RESTRICT,
  period            INTEGER NOT NULL CHECK (period >= 1),
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo > 0),
  received_on       DATE NOT NULL,
  reference         TEXT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'confirmed', 'rejected')),
  -- Set when confirmed: how the money was used.
  applied_kobo      BIGINT CHECK (applied_kobo >= 0),
  held_kobo         BIGINT CHECK (held_kobo >= 0),
  fee_kobo          BIGINT CHECK (fee_kobo >= 0),
  net_kobo          BIGINT CHECK (net_kobo >= 0),
  distribution_id   UUID,
  recorded_by       UUID NOT NULL REFERENCES profiles(id),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by      UUID REFERENCES profiles(id),
  confirmed_at      TIMESTAMPTZ,
  rejected_by       UUID REFERENCES profiles(id),
  rejected_at       TIMESTAMPTZ,
  reject_reason     TEXT,
  CHECK (status <> 'confirmed' OR (applied_kobo IS NOT NULL AND held_kobo IS NOT NULL AND fee_kobo IS NOT NULL
                                   AND net_kobo IS NOT NULL AND applied_kobo + held_kobo = amount_kobo
                                   AND fee_kobo + net_kobo = applied_kobo)),
  CHECK (status <> 'rejected' OR length(trim(COALESCE(reject_reason, ''))) > 0)
);
CREATE INDEX maalrise_receipts_cycle_period ON maalrise_receipts (cycle_id, period);
-- A reference, when given, identifies one transfer: it cannot be entered twice.
CREATE UNIQUE INDEX maalrise_receipts_reference_uq
  ON maalrise_receipts (cycle_id, lower(trim(reference)))
  WHERE status <> 'rejected' AND reference IS NOT NULL AND length(trim(reference)) > 0;

-- ------------------------------------------------------------
-- 2. Distributions and investor payment lines
-- ------------------------------------------------------------
CREATE TABLE maalrise_distributions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id            UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  terms_id            UUID NOT NULL REFERENCES maalrise_cycle_terms(id) ON DELETE RESTRICT,
  schedule_line_id    UUID NOT NULL REFERENCES maalrise_schedule_lines(id) ON DELETE RESTRICT,
  period              INTEGER NOT NULL CHECK (period >= 1),
  sequence            INTEGER NOT NULL DEFAULT 1 CHECK (sequence >= 1),
  due_date            DATE NOT NULL,
  -- Snapshots, so a payment screen needs no other table.
  cycle_name          TEXT NOT NULL,
  counterparty_name   TEXT NOT NULL,
  -- Money: received and applied to this month, the fee taken from it,
  -- tax (none until configured), what investors share, and the
  -- unsubscribed units' share that stays unallocated.
  applied_kobo        BIGINT NOT NULL DEFAULT 0 CHECK (applied_kobo >= 0),
  fee_kobo            BIGINT NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  tax_kobo            BIGINT NOT NULL DEFAULT 0 CHECK (tax_kobo = 0),
  net_kobo            BIGINT NOT NULL DEFAULT 0 CHECK (net_kobo >= 0),
  allocated_kobo      BIGINT NOT NULL DEFAULT 0 CHECK (allocated_kobo >= 0),
  unallocated_kobo    BIGINT NOT NULL DEFAULT 0 CHECK (unallocated_kobo >= 0),
  status              TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'approved')),
  prepared_by         UUID NOT NULL REFERENCES profiles(id),
  prepared_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by         UUID REFERENCES profiles(id),
  approved_at         TIMESTAMPTZ,
  CHECK (applied_kobo = fee_kobo + tax_kobo + net_kobo),
  CHECK (net_kobo = allocated_kobo + unallocated_kobo),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  UNIQUE (cycle_id, period, sequence)
);
-- No two open distributions for the same Cycle and month.
CREATE UNIQUE INDEX maalrise_distributions_one_open
  ON maalrise_distributions (cycle_id, period) WHERE status = 'prepared';

ALTER TABLE maalrise_receipts
  ADD CONSTRAINT maalrise_receipts_distribution_fk
  FOREIGN KEY (distribution_id) REFERENCES maalrise_distributions(id);

CREATE TABLE maalrise_distribution_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id       UUID NOT NULL REFERENCES maalrise_distributions(id) ON DELETE RESTRICT,
  cycle_id              UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  period                INTEGER NOT NULL,
  maalrise_investor_id  UUID NOT NULL REFERENCES maalrise_investors(id) ON DELETE RESTRICT,
  investor_name         TEXT NOT NULL,
  investor_code         TEXT NOT NULL,
  units                 INTEGER NOT NULL CHECK (units > 0),
  amount_kobo           BIGINT NOT NULL CHECK (amount_kobo > 0),
  tax_kobo              BIGINT NOT NULL DEFAULT 0 CHECK (tax_kobo = 0),
  -- The confirmed account this payment is for, as it stood when the
  -- line was (re)built. NULL when the investor had none confirmed —
  -- approval is refused until it is.
  bank_name             TEXT,
  account_name          TEXT,
  account_number        TEXT,
  -- THE payment status. Admin screens, the payment officer and (Phase 6)
  -- the investor portal all read this one column.
  status                TEXT NOT NULL DEFAULT 'pending_approval'
                          CHECK (status IN ('pending_approval', 'payable', 'paid')),
  paid_on               DATE,
  paid_reference        TEXT,
  paid_by               UUID REFERENCES profiles(id),
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'paid' OR (paid_on IS NOT NULL AND paid_by IS NOT NULL AND paid_at IS NOT NULL)),
  CHECK (status = 'paid' OR (paid_on IS NULL AND paid_by IS NULL AND paid_at IS NULL)),
  UNIQUE (distribution_id, maalrise_investor_id)
);
CREATE INDEX maalrise_lines_status ON maalrise_distribution_lines (status);
CREATE INDEX maalrise_lines_investor ON maalrise_distribution_lines (maalrise_investor_id);

-- Append-only history of every paid / reversed event.
CREATE TABLE maalrise_payment_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id           UUID NOT NULL REFERENCES maalrise_distribution_lines(id) ON DELETE RESTRICT,
  event             TEXT NOT NULL CHECK (event IN ('marked_paid', 'reversed')),
  amount_kobo       BIGINT NOT NULL,
  paid_on           DATE,
  reference         TEXT,
  bank_name         TEXT,
  account_name      TEXT,
  account_number    TEXT,
  reason            TEXT,
  actor             UUID NOT NULL REFERENCES profiles(id),
  -- Wall-clock time, so events keep their exact order.
  created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (event <> 'reversed' OR length(trim(COALESCE(reason, ''))) > 0)
);

-- ------------------------------------------------------------
-- 3. Notifications (in-app) and the email outbox (drafts only)
-- ------------------------------------------------------------
CREATE TABLE maalrise_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  link        TEXT,
  dedupe_key  TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX maalrise_notifications_dedupe ON maalrise_notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX maalrise_notifications_user ON maalrise_notifications (user_id, created_at DESC);

CREATE TABLE maalrise_email_outbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL,
  to_user_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  dedupe_key  TEXT,
  -- 'draft' until sending is approved. A failed send stays retryable
  -- and never touches the payment it is about.
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sent', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX maalrise_outbox_dedupe ON maalrise_email_outbox (to_email, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Guards
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_payment_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Payment history cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_payment_events_append_only
  BEFORE UPDATE OR DELETE ON maalrise_payment_events
  FOR EACH ROW EXECUTE FUNCTION maalrise_payment_events_append_only();

-- Lines are rebuilt only while their distribution is still open.
CREATE OR REPLACE FUNCTION maalrise_lines_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM maalrise_distributions WHERE id = OLD.distribution_id;
  IF TG_OP = 'DELETE' AND v_status <> 'prepared' THEN
    RAISE EXCEPTION 'Lines of an approved distribution cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'approved'
     AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.units <> OLD.units
          OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id
          OR NEW.account_number IS DISTINCT FROM OLD.account_number) THEN
    RAISE EXCEPTION 'An approved payment line''s amount and account are frozen';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_lines_guard
  BEFORE UPDATE OR DELETE ON maalrise_distribution_lines
  FOR EACH ROW EXECUTE FUNCTION maalrise_lines_guard();

CREATE OR REPLACE FUNCTION maalrise_distribution_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Distributions cannot be deleted'; END IF;
  IF OLD.status = 'approved' AND (NEW.status <> 'approved' OR NEW.net_kobo <> OLD.net_kobo
                                  OR NEW.applied_kobo <> OLD.applied_kobo) THEN
    RAISE EXCEPTION 'An approved distribution is frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_distribution_guard
  BEFORE UPDATE OR DELETE ON maalrise_distributions
  FOR EACH ROW EXECUTE FUNCTION maalrise_distribution_guard();

CREATE OR REPLACE FUNCTION maalrise_receipt_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Receipts cannot be deleted; reject a wrong entry instead'; END IF;
  IF OLD.status <> 'recorded' AND (NEW.status <> OLD.status OR NEW.amount_kobo <> OLD.amount_kobo
                                   OR NEW.applied_kobo IS DISTINCT FROM OLD.applied_kobo) THEN
    RAISE EXCEPTION 'A confirmed or rejected receipt cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_receipt_guard
  BEFORE UPDATE OR DELETE ON maalrise_receipts
  FOR EACH ROW EXECUTE FUNCTION maalrise_receipt_guard();

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

-- ------------------------------------------------------------
-- 8. Recording and confirming receipts
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_record_receipt(p_cycle UUID, p JSONB)
RETURNS UUID AS $$
DECLARE
  v_cycle   maalrise_cycles%ROWTYPE;
  v_line    maalrise_schedule_lines%ROWTYPE;
  v_amount  BIGINT;
  v_date    DATE;
  v_ref     TEXT := NULLIF(trim(COALESCE(p->>'reference', '')), '');
  v_id      UUID;
  v_cp      TEXT;
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status <> 'active' THEN
    RAISE EXCEPTION 'Payments can be recorded only for an active Cycle (this one is %)', v_cycle.status;
  END IF;
  SELECT * INTO v_line FROM maalrise_schedule_lines
   WHERE terms_id = v_cycle.approved_terms_id AND period = (p->>'period')::INTEGER;
  IF NOT FOUND THEN RAISE EXCEPTION 'That month is not in the approved schedule'; END IF;

  v_amount := (p->>'amount_kobo')::BIGINT;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'The amount received must be greater than zero'; END IF;
  v_date := (p->>'received_on')::DATE;
  IF v_date IS NULL THEN RAISE EXCEPTION 'The date the payment was received is required'; END IF;
  IF v_date > maalrise_today() THEN RAISE EXCEPTION 'A payment cannot be dated in the future'; END IF;
  IF v_date < v_cycle.start_date THEN RAISE EXCEPTION 'A payment cannot be dated before the Cycle started'; END IF;
  IF v_ref IS NOT NULL AND EXISTS (SELECT 1 FROM maalrise_receipts WHERE cycle_id = p_cycle AND status <> 'rejected'
                                    AND lower(trim(reference)) = lower(v_ref)) THEN
    RAISE EXCEPTION 'A payment with reference % is already recorded for this Cycle', v_ref;
  END IF;

  INSERT INTO maalrise_receipts (cycle_id, schedule_line_id, period, amount_kobo, received_on, reference, notes, recorded_by)
  VALUES (p_cycle, v_line.id, v_line.period, v_amount, v_date, v_ref, NULLIF(trim(COALESCE(p->>'notes', '')), ''), auth.uid())
  RETURNING id INTO v_id;

  PERFORM create_audit_log('maalrise_record_receipt', 'maalrise_receipt', v_id::TEXT, NULL,
    jsonb_build_object('cycle_id', p_cycle, 'period', v_line.period, 'amount_kobo', v_amount,
                       'received_on', v_date, 'reference', v_ref));
  SELECT name INTO v_cp FROM maalrise_counterparties WHERE id = v_cycle.counterparty_id;
  PERFORM maalrise_notify_roles(ARRAY['super_admin', 'administrator'], 'receipt_recorded',
    'Payment recorded: ' || v_cp,
    maalrise_naira(v_amount) || ' received on ' || to_char(v_date, 'DD Mon YYYY') || ' for ' || v_cycle.name
      || ', month ' || v_line.period || ' — awaiting confirmation.',
    '/admin/maalrise/cycles/' || p_cycle || '#receipts', 'receipt_recorded:' || v_id, NULL);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_reject_receipt(p_receipt UUID, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_r maalrise_receipts%ROWTYPE;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO v_r FROM maalrise_receipts WHERE id = p_receipt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  IF v_r.status <> 'recorded' THEN RAISE EXCEPTION 'Only an unconfirmed entry can be rejected'; END IF;
  UPDATE maalrise_receipts SET status = 'rejected', rejected_by = auth.uid(), rejected_at = NOW(), reject_reason = trim(p_reason)
   WHERE id = p_receipt;
  PERFORM create_audit_log('maalrise_reject_receipt', 'maalrise_receipt', p_receipt::TEXT,
    jsonb_build_object('status', 'recorded'), jsonb_build_object('status', 'rejected', 'reason', trim(p_reason)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * (Re)build a prepared distribution's lines from its net amount:
 * investors share by units of the whole Cycle, largest remainder to
 * the kobo (ties to the earlier holding), the unsubscribed units' share
 * left unallocated. Snapshots each investor's CONFIRMED bank account.
 * Internal — not granted to callers.
 */
CREATE OR REPLACE FUNCTION maalrise_build_distribution_lines(p_dist UUID)
RETURNS VOID AS $$
DECLARE
  v_d      maalrise_distributions%ROWTYPE;
  v_terms  maalrise_cycle_terms%ROWTYPE;
  v_cycle  maalrise_cycles%ROWTYPE;
  v_total  BIGINT;
  v_held   BIGINT;
  v_unsub  BIGINT;
  v_alloc  BIGINT;
BEGIN
  SELECT * INTO v_d FROM maalrise_distributions WHERE id = p_dist FOR UPDATE;
  IF v_d.status <> 'prepared' THEN RAISE EXCEPTION 'Only a prepared distribution can be recalculated'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = v_d.cycle_id;
  SELECT * INTO v_terms FROM maalrise_cycle_terms WHERE id = v_d.terms_id;

  -- Units of the whole Cycle (A11: whole units at a fixed price).
  v_total := CEIL(v_terms.cost_kobo::NUMERIC / v_cycle.unit_price_kobo)::BIGINT;
  SELECT COALESCE(SUM(units), 0) INTO v_held FROM maalrise_allocations WHERE cycle_id = v_d.cycle_id;
  IF v_held > v_total THEN RAISE EXCEPTION 'Allocations exceed the Cycle''s units'; END IF;
  v_unsub := v_total - v_held;

  DELETE FROM maalrise_distribution_lines WHERE distribution_id = p_dist;

  WITH holders AS (
    SELECT row_number() OVER (ORDER BY a.created_at, a.id) AS idx, a.maalrise_investor_id AS inv, a.units::BIGINT AS units
      FROM maalrise_allocations a WHERE a.cycle_id = v_d.cycle_id
    UNION ALL
    SELECT 1000000000, NULL, v_unsub WHERE v_unsub > 0
  ), exact AS (
    SELECT idx, inv, units,
           (v_d.net_kobo::NUMERIC * units) / v_total AS q
      FROM holders
  ), base AS (
    SELECT idx, inv, units, FLOOR(q)::BIGINT AS part, q - FLOOR(q) AS frac FROM exact
  ), ranked AS (
    SELECT *, row_number() OVER (ORDER BY frac DESC, idx ASC) AS rk,
           v_d.net_kobo - SUM(part) OVER () AS leftover
      FROM base
  ), shares AS (
    SELECT inv, units, part + CASE WHEN rk <= leftover THEN 1 ELSE 0 END AS amount FROM ranked
  )
  INSERT INTO maalrise_distribution_lines (distribution_id, cycle_id, period, maalrise_investor_id, investor_name,
                                           investor_code, units, amount_kobo, bank_name, account_name, account_number)
  SELECT p_dist, v_d.cycle_id, v_d.period, s.inv, i.full_name, i.investor_code, s.units, s.amount,
         CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.bank_name END,
         CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.account_name END,
         CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.account_number END
    FROM shares s JOIN maalrise_investors i ON i.id = s.inv
   WHERE s.inv IS NOT NULL AND s.amount > 0;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_alloc FROM maalrise_distribution_lines WHERE distribution_id = p_dist;
  UPDATE maalrise_distributions SET allocated_kobo = v_alloc, unallocated_kobo = net_kobo - v_alloc
   WHERE id = p_dist;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * Confirm a receipt and turn it into distributable profit.
 *
 * The amount is applied to its month up to what is still outstanding;
 * the rest is HELD. The fee is the month's scheduled fee in proportion
 * to the money received so far, so part-payments add up exactly. The
 * net goes into the month's open distribution — created if there is
 * none — which is recalculated for review and approval.
 */
CREATE OR REPLACE FUNCTION maalrise_confirm_receipt(p_receipt UUID)
RETURNS UUID AS $$
DECLARE
  v_r        maalrise_receipts%ROWTYPE;
  v_cycle    maalrise_cycles%ROWTYPE;
  v_line     maalrise_schedule_lines%ROWTYPE;
  v_before   BIGINT;
  v_applied  BIGINT;
  v_fee      BIGINT;
  v_dist     UUID;
  v_cp       TEXT;
  v_seq      INTEGER;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_r FROM maalrise_receipts WHERE id = p_receipt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receipt not found'; END IF;
  IF v_r.status <> 'recorded' THEN RAISE EXCEPTION 'This entry is already %', v_r.status; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = v_r.cycle_id;
  IF v_cycle.status <> 'active' THEN RAISE EXCEPTION 'The Cycle is not active'; END IF;
  -- One confirmation at a time per month: the running totals below depend on it.
  SELECT * INTO v_line FROM maalrise_schedule_lines WHERE id = v_r.schedule_line_id FOR UPDATE;

  SELECT COALESCE(SUM(applied_kobo), 0) INTO v_before
    FROM maalrise_receipts WHERE schedule_line_id = v_line.id AND status = 'confirmed';
  v_applied := LEAST(v_r.amount_kobo, GREATEST(v_line.counterparty_gross_kobo - v_before, 0));
  -- Fee on the running total, rounded half-up once: the parts sum to the scheduled fee.
  v_fee := CASE WHEN v_line.counterparty_gross_kobo = 0 THEN 0
                ELSE ROUND((v_before + v_applied)::NUMERIC * v_line.fee_kobo / v_line.counterparty_gross_kobo)::BIGINT
                   - ROUND(v_before::NUMERIC * v_line.fee_kobo / v_line.counterparty_gross_kobo)::BIGINT END;

  IF v_applied > 0 THEN
    SELECT id INTO v_dist FROM maalrise_distributions
     WHERE cycle_id = v_r.cycle_id AND period = v_r.period AND status = 'prepared' FOR UPDATE;
    IF v_dist IS NULL THEN
      SELECT name INTO v_cp FROM maalrise_counterparties WHERE id = v_cycle.counterparty_id;
      SELECT COALESCE(MAX(sequence), 0) + 1 INTO v_seq FROM maalrise_distributions
       WHERE cycle_id = v_r.cycle_id AND period = v_r.period;
      INSERT INTO maalrise_distributions (cycle_id, terms_id, schedule_line_id, period, sequence, due_date,
                                          cycle_name, counterparty_name, prepared_by)
      VALUES (v_r.cycle_id, v_line.terms_id, v_line.id, v_r.period, v_seq, v_line.due_date,
              v_cycle.name, v_cp, auth.uid())
      RETURNING id INTO v_dist;
    END IF;
    UPDATE maalrise_distributions
       SET applied_kobo = applied_kobo + v_applied, fee_kobo = fee_kobo + v_fee,
           net_kobo = net_kobo + (v_applied - v_fee),
           -- unallocated until the lines are rebuilt just below
           unallocated_kobo = unallocated_kobo + (v_applied - v_fee),
           prepared_by = auth.uid(), prepared_at = NOW()
     WHERE id = v_dist;
  END IF;

  UPDATE maalrise_receipts
     SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = NOW(),
         applied_kobo = v_applied, held_kobo = v_r.amount_kobo - v_applied,
         fee_kobo = v_fee, net_kobo = v_applied - v_fee, distribution_id = v_dist
   WHERE id = p_receipt;

  IF v_dist IS NOT NULL THEN
    PERFORM maalrise_build_distribution_lines(v_dist);
    -- Never more than the month's scheduled investor share.
    IF (SELECT COALESCE(SUM(net_kobo), 0) FROM maalrise_distributions WHERE schedule_line_id = v_line.id)
       > v_line.investor_net_kobo THEN
      RAISE EXCEPTION 'Distributions would exceed the scheduled investor share for this month';
    END IF;
  END IF;

  PERFORM create_audit_log('maalrise_confirm_receipt', 'maalrise_receipt', p_receipt::TEXT,
    jsonb_build_object('status', 'recorded'),
    jsonb_build_object('status', 'confirmed', 'applied_kobo', v_applied, 'held_kobo', v_r.amount_kobo - v_applied,
                       'fee_kobo', v_fee, 'net_kobo', v_applied - v_fee, 'distribution_id', v_dist));
  IF v_dist IS NOT NULL THEN
    PERFORM maalrise_notify_roles(ARRAY['super_admin', 'administrator'], 'distribution_prepared',
      'Distribution ready for approval: ' || v_cycle.name || ', month ' || v_r.period,
      'A confirmed payment of ' || maalrise_naira(v_r.amount_kobo) || ' produced a profit distribution for review and approval.',
      '/admin/maalrise/cycles/' || v_r.cycle_id || '#distributions', 'distribution_prepared:' || p_receipt,
      'MaalRise: distribution ready for approval');
  END IF;
  RETURN v_dist;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Re-snapshot bank details (e.g. after one was confirmed) and recalculate. */
CREATE OR REPLACE FUNCTION maalrise_refresh_distribution(p_dist UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  PERFORM maalrise_build_distribution_lines(p_dist);
  PERFORM create_audit_log('maalrise_refresh_distribution', 'maalrise_distribution', p_dist::TEXT, NULL, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_approve_distribution(p_dist UUID)
RETURNS VOID AS $$
DECLARE
  v_d   maalrise_distributions%ROWTYPE;
  v_bad TEXT;
  v_n   INTEGER;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_d FROM maalrise_distributions WHERE id = p_dist FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribution not found'; END IF;
  IF v_d.status <> 'prepared' THEN RAISE EXCEPTION 'This distribution is already approved'; END IF;

  -- Every payment must go to the investor's CURRENT confirmed account.
  SELECT string_agg(l.investor_name, ', ') INTO v_bad
    FROM maalrise_distribution_lines l JOIN maalrise_investors i ON i.id = l.maalrise_investor_id
   WHERE l.distribution_id = p_dist
     AND (l.account_number IS NULL OR i.bank_confirmed_at IS NULL
          OR i.account_number IS DISTINCT FROM l.account_number
          OR i.bank_name IS DISTINCT FROM l.bank_name OR i.account_name IS DISTINCT FROM l.account_name);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Bank details are unconfirmed or have changed for: %. Confirm them, then refresh the distribution.', v_bad;
  END IF;

  UPDATE maalrise_distributions SET status = 'approved', approved_by = auth.uid(), approved_at = NOW() WHERE id = p_dist;
  UPDATE maalrise_distribution_lines SET status = 'payable', updated_at = NOW() WHERE distribution_id = p_dist;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM create_audit_log('maalrise_approve_distribution', 'maalrise_distribution', p_dist::TEXT,
    jsonb_build_object('status', 'prepared'),
    jsonb_build_object('status', 'approved', 'net_kobo', v_d.net_kobo, 'lines', v_n));
  PERFORM maalrise_notify_roles(ARRAY['payment_officer', 'super_admin', 'administrator'], 'distribution_approved',
    'Investor payments approved: ' || v_d.cycle_name || ', month ' || v_d.period,
    v_n || ' investor payment(s) totalling ' || maalrise_naira(v_d.allocated_kobo)
      || ' are approved. Make the bank transfers, then mark each one paid.',
    '/admin/payment-requests/maalrise', 'distribution_approved:' || p_dist, 'MaalRise: investor payments approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 9. Paying investors (recording a transfer made outside the system)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_mark_line_paid(p_line UUID, p_paid_on DATE, p_reference TEXT)
RETURNS VOID AS $$
DECLARE
  v_l  maalrise_distribution_lines%ROWTYPE;
  v_d  maalrise_distributions%ROWTYPE;
  v_ref TEXT := NULLIF(trim(COALESCE(p_reference, '')), '');
BEGIN
  IF NOT maalrise_can_pay() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_l FROM maalrise_distribution_lines WHERE id = p_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_l.status = 'paid' THEN RAISE EXCEPTION 'This payment is already marked paid'; END IF;
  IF v_l.status <> 'payable' THEN RAISE EXCEPTION 'This payment has not been approved'; END IF;
  SELECT * INTO v_d FROM maalrise_distributions WHERE id = v_l.distribution_id;
  IF p_paid_on IS NULL THEN RAISE EXCEPTION 'The transfer date is required'; END IF;
  IF p_paid_on > maalrise_today() THEN RAISE EXCEPTION 'A transfer cannot be dated in the future'; END IF;
  IF p_paid_on < (v_d.approved_at AT TIME ZONE 'Africa/Lagos')::DATE THEN
    RAISE EXCEPTION 'A transfer cannot be dated before the payment was approved';
  END IF;

  UPDATE maalrise_distribution_lines
     SET status = 'paid', paid_on = p_paid_on, paid_reference = v_ref, paid_by = auth.uid(), paid_at = NOW(), updated_at = NOW()
   WHERE id = p_line;
  INSERT INTO maalrise_payment_events (line_id, event, amount_kobo, paid_on, reference, bank_name, account_name, account_number, actor)
  VALUES (p_line, 'marked_paid', v_l.amount_kobo, p_paid_on, v_ref, v_l.bank_name, v_l.account_name, v_l.account_number, auth.uid());

  PERFORM create_audit_log('maalrise_mark_line_paid', 'maalrise_distribution_line', p_line::TEXT,
    jsonb_build_object('status', 'payable'),
    jsonb_build_object('status', 'paid', 'paid_on', p_paid_on, 'reference', v_ref, 'amount_kobo', v_l.amount_kobo));
  PERFORM maalrise_notify_investor(v_l.maalrise_investor_id, 'payment_paid',
    'Profit payment sent',
    'Your MaalRise profit payment of ' || maalrise_naira(v_l.amount_kobo) || ' for ' || v_d.cycle_name || ', month '
      || v_l.period || ' was paid on ' || to_char(p_paid_on, 'DD Mon YYYY')
      || COALESCE(' (transfer reference ' || v_ref || ')', '') || ' to account ending '
      || right(COALESCE(v_l.account_number, ''), 4) || '.',
    'paid:' || p_line || ':' || (SELECT COUNT(*) FROM maalrise_payment_events WHERE line_id = p_line),
    'MaalRise profit payment sent');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_reverse_line_payment(p_line UUID, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_l maalrise_distribution_lines%ROWTYPE;
BEGIN
  IF COALESCE(maalrise_caller_role(), '') <> 'super_admin' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required to reverse a payment'; END IF;
  SELECT * INTO v_l FROM maalrise_distribution_lines WHERE id = p_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_l.status <> 'paid' THEN RAISE EXCEPTION 'Only a payment marked paid can be reversed'; END IF;

  INSERT INTO maalrise_payment_events (line_id, event, amount_kobo, paid_on, reference, bank_name, account_name,
                                       account_number, reason, actor)
  VALUES (p_line, 'reversed', v_l.amount_kobo, v_l.paid_on, v_l.paid_reference, v_l.bank_name, v_l.account_name,
          v_l.account_number, trim(p_reason), auth.uid());
  UPDATE maalrise_distribution_lines
     SET status = 'payable', paid_on = NULL, paid_reference = NULL, paid_by = NULL, paid_at = NULL, updated_at = NOW()
   WHERE id = p_line;

  PERFORM create_audit_log('maalrise_reverse_line_payment', 'maalrise_distribution_line', p_line::TEXT,
    jsonb_build_object('status', 'paid', 'paid_on', v_l.paid_on, 'reference', v_l.paid_reference),
    jsonb_build_object('status', 'payable', 'reason', trim(p_reason)));
  PERFORM maalrise_notify_roles(ARRAY['payment_officer', 'super_admin', 'administrator'], 'payment_reversed',
    'Payment reversed: ' || v_l.investor_name,
    'The ' || maalrise_naira(v_l.amount_kobo) || ' payment for month ' || v_l.period || ' was reversed by a super admin: '
      || trim(p_reason) || '. It is payable again.',
    '/admin/payment-requests/maalrise', 'reversed:' || p_line || ':' || (SELECT COUNT(*) FROM maalrise_payment_events WHERE line_id = p_line),
    NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 10. Grants. Internal helpers are not callable from the API.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION maalrise_build_distribution_lines(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_notify_roles(TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_notify_investor(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_sync_reminders() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_payment_events_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_lines_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_distribution_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_receipt_guard() FROM PUBLIC;
-- Supabase grants EXECUTE on new functions to its API roles directly,
-- so revoking from PUBLIC alone would leave these callable. The
-- helpers have no role check of their own: they must stay internal.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION maalrise_build_distribution_lines(UUID) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION maalrise_notify_roles(TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION maalrise_notify_investor(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION maalrise_sync_reminders() FROM anon, authenticated;
  END IF;
END $$;

-- The private bucket for Cycle contracts and supporting documents.
-- Guarded: the local test harness has no storage schema. No storage
-- policies are added — only the server, after checking the person's
-- role, reads or writes these files.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('maalrise-documents', 'maalrise-documents', FALSE)
    ON CONFLICT (id) DO UPDATE SET public = FALSE;
  END IF;
END $$;

COMMIT;
