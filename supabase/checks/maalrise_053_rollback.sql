-- ============================================================
-- MaalRise 053 — ROLLBACK. Removes exactly what 053 added and puts the
-- five replaced 052 functions back as they were.
--
-- WRITES. Run only if 053 must be undone. 051, the rest of 052 and
-- MaalGrow are not touched; afterwards maalrise_053_preflight.sql must
-- print the original fingerprint.
--
-- REFUSES if any capital record exists, or any monthly entry has been
-- reversed: those are financial records. Export them first.
-- ============================================================
BEGIN;

DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT (SELECT COUNT(*) FROM maalrise_capital_receipts) + (SELECT COUNT(*) FROM maalrise_capital_settlements)
       + (SELECT COUNT(*) FROM maalrise_receipts WHERE status = 'reversed') INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Rollback refused: % capital or reversed-entry row(s) exist. Export them first.', v_n;
  END IF;
END $$;

DROP TABLE IF EXISTS maalrise_capital_payment_events, maalrise_capital_payments, maalrise_capital_settlements,
  maalrise_capital_receipts CASCADE;
DROP FUNCTION IF EXISTS
  maalrise_close_cycle(UUID), maalrise_close_checks(UUID), maalrise_reverse_capital_payment(UUID, TEXT),
  maalrise_mark_capital_paid(UUID, DATE, TEXT), maalrise_approve_capital_settlement(UUID),
  maalrise_refresh_capital_settlement(UUID), maalrise_reverse_capital(UUID, TEXT), maalrise_confirm_capital(UUID),
  maalrise_build_capital_payments(UUID), maalrise_reject_capital(UUID, TEXT), maalrise_record_capital(UUID, JSONB),
  maalrise_reverse_receipt(UUID, TEXT), maalrise_capital_due(UUID), maalrise_maturity_date(UUID),
  maalrise_capital_receipt_guard(), maalrise_capital_settlement_guard(), maalrise_capital_payments_guard();

DROP INDEX maalrise_receipts_reference_uq;
CREATE UNIQUE INDEX maalrise_receipts_reference_uq
  ON maalrise_receipts (cycle_id, lower(trim(reference)))
  WHERE status <> 'rejected' AND reference IS NOT NULL AND length(trim(reference)) > 0;
ALTER TABLE maalrise_receipts DROP CONSTRAINT maalrise_receipts_reverse_reason_check;
ALTER TABLE maalrise_receipts DROP COLUMN reversed_by, DROP COLUMN reversed_at, DROP COLUMN reverse_reason;
ALTER TABLE maalrise_receipts DROP CONSTRAINT maalrise_receipts_status_check;
ALTER TABLE maalrise_receipts ADD CONSTRAINT maalrise_receipts_status_check
  CHECK (status IN ('recorded', 'confirmed', 'rejected'));

-- The five functions exactly as migration 052 defined them
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

COMMIT;
