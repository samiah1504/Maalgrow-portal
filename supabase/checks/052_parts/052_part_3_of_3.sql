-- ============================================================
-- MaalRise 052 — PART 3 OF 3
-- Recording and confirming receipts, distributions, paying investors, grants, documents bucket
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
-- Success = the final result row reads "Part 3 of 3 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT (to_regprocedure('public.maalrise_sync_reminders()') IS NOT NULL) THEN
    RAISE EXCEPTION 'STOP: run part 2 of 3 first (it creates maalrise_sync_reminders).';
  END IF;
  IF to_regprocedure('public.maalrise_record_receipt(uuid,jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: part 3 of 3 has already been applied (maalrise_record_receipt exists). Do not run it again.';
  END IF;
END $$;

-- >>> 052 BODY START (part 3)
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

-- <<< 052 BODY END (part 3)

COMMIT;

SELECT 'Part 3 of 3 applied' AS result;
