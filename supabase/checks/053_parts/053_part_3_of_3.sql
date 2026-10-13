-- ============================================================
-- MaalRise 053 — PART 3 OF 3
-- Capital: record, confirm, reverse; settlement, approval, payments; closing a Cycle; grants
--
-- The three parts together are exactly the body of
-- supabase/migrations/053_maalrise_capital_settlement.sql, split so
-- each can be pasted and run on its own in the Supabase SQL Editor.
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
  IF NOT (to_regprocedure('public.maalrise_reverse_receipt(uuid,text)') IS NOT NULL) THEN
    RAISE EXCEPTION 'STOP: run part 2 of 3 first (it creates maalrise_reverse_receipt).';
  END IF;
  IF to_regprocedure('public.maalrise_close_cycle(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: part 3 of 3 has already been applied (maalrise_close_cycle exists). Do not run it again.';
  END IF;
END $$;

-- >>> 053 BODY START (part 3)
-- ------------------------------------------------------------
-- 7. Capital: record, confirm, reject, reverse
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_record_capital(p_cycle UUID, p JSONB)
RETURNS UUID AS $$
DECLARE
  v_cycle    maalrise_cycles%ROWTYPE;
  v_amount   BIGINT := (p->>'amount_kobo')::BIGINT;
  v_date     DATE := (p->>'received_on')::DATE;
  v_ref      TEXT := NULLIF(trim(COALESCE(p->>'reference', '')), '');
  v_due      BIGINT;
  v_recorded BIGINT;
  v_id       UUID;
  v_cp       TEXT;
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status <> 'active' THEN RAISE EXCEPTION 'Capital can be recorded only for an active Cycle (this one is %)', v_cycle.status; END IF;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'The amount received must be greater than zero'; END IF;
  IF v_date IS NULL THEN RAISE EXCEPTION 'The date the capital was received is required'; END IF;
  IF v_date > maalrise_today() THEN RAISE EXCEPTION 'A payment cannot be dated in the future'; END IF;
  IF v_date < v_cycle.start_date THEN RAISE EXCEPTION 'A payment cannot be dated before the Cycle started'; END IF;

  v_due := maalrise_capital_due(p_cycle);
  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_recorded FROM maalrise_capital_receipts
   WHERE cycle_id = p_cycle AND status IN ('recorded', 'confirmed');
  IF v_recorded >= v_due THEN
    RAISE EXCEPTION 'The capital of % is already fully recorded. Check the entry.', maalrise_naira(v_due);
  END IF;
  IF v_amount > v_due - v_recorded THEN
    RAISE EXCEPTION '% is more than the % of capital still owed. Check the amount.',
      maalrise_naira(v_amount), maalrise_naira(v_due - v_recorded);
  END IF;
  IF v_ref IS NOT NULL AND EXISTS (SELECT 1 FROM maalrise_capital_receipts WHERE cycle_id = p_cycle
                                    AND status IN ('recorded', 'confirmed') AND lower(trim(reference)) = lower(v_ref)) THEN
    RAISE EXCEPTION 'A capital payment with reference % is already recorded for this Cycle', v_ref;
  END IF;

  INSERT INTO maalrise_capital_receipts (cycle_id, amount_kobo, received_on, reference, notes, recorded_by)
  VALUES (p_cycle, v_amount, v_date, v_ref, NULLIF(trim(COALESCE(p->>'notes', '')), ''), auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_record_capital', 'maalrise_capital_receipt', v_id::TEXT, NULL,
    jsonb_build_object('cycle_id', p_cycle, 'amount_kobo', v_amount, 'received_on', v_date, 'reference', v_ref));
  SELECT name INTO v_cp FROM maalrise_counterparties WHERE id = v_cycle.counterparty_id;
  PERFORM maalrise_notify_roles(ARRAY['super_admin', 'administrator'], 'capital_recorded',
    'Capital recorded: ' || v_cp,
    maalrise_naira(v_amount) || ' of capital received on ' || to_char(v_date, 'DD Mon YYYY') || ' for ' || v_cycle.name
      || ' — awaiting confirmation.',
    '/admin/maalrise/cycles/' || p_cycle || '#capital', 'capital_recorded:' || v_id, NULL);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_reject_capital(p_receipt UUID, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_r maalrise_capital_receipts%ROWTYPE;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO v_r FROM maalrise_capital_receipts WHERE id = p_receipt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF v_r.status <> 'recorded' THEN RAISE EXCEPTION 'Only an unconfirmed entry can be rejected'; END IF;
  UPDATE maalrise_capital_receipts SET status = 'rejected', rejected_by = auth.uid(), rejected_at = NOW(), reject_reason = trim(p_reason)
   WHERE id = p_receipt;
  PERFORM create_audit_log('maalrise_reject_capital', 'maalrise_capital_receipt', p_receipt::TEXT,
    jsonb_build_object('status', 'recorded'), jsonb_build_object('status', 'rejected', 'reason', trim(p_reason)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * Every investor gets back exactly the capital they funded, to their
 * confirmed account as it stands now. Internal — not granted.
 */
CREATE OR REPLACE FUNCTION maalrise_build_capital_payments(p_settlement UUID)
RETURNS VOID AS $$
DECLARE
  v_s     maalrise_capital_settlements%ROWTYPE;
  v_total BIGINT;
BEGIN
  SELECT * INTO v_s FROM maalrise_capital_settlements WHERE id = p_settlement FOR UPDATE;
  IF v_s.status <> 'prepared' THEN RAISE EXCEPTION 'Only a prepared capital settlement can be recalculated'; END IF;
  DELETE FROM maalrise_capital_payments WHERE settlement_id = p_settlement;
  INSERT INTO maalrise_capital_payments (settlement_id, cycle_id, maalrise_investor_id, investor_name, investor_code,
                                         units, amount_kobo, bank_name, account_name, account_number)
  SELECT p_settlement, a.cycle_id, a.maalrise_investor_id, i.full_name, i.investor_code, a.units, a.capital_kobo,
         CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.bank_name END,
         CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.account_name END,
         CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.account_number END
    FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
   WHERE a.cycle_id = v_s.cycle_id;
  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_total FROM maalrise_capital_payments WHERE settlement_id = p_settlement;
  IF v_total <> v_s.capital_kobo THEN
    RAISE EXCEPTION 'Investors'' capital (%) does not equal the capital received (%)', maalrise_naira(v_total), maalrise_naira(v_s.capital_kobo);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * Confirm a capital entry. When the confirmed capital reaches the full
 * amount owed, the settlement is prepared for review — never before.
 */
CREATE OR REPLACE FUNCTION maalrise_confirm_capital(p_receipt UUID)
RETURNS UUID AS $$
DECLARE
  v_r      maalrise_capital_receipts%ROWTYPE;
  v_cycle  maalrise_cycles%ROWTYPE;
  v_due    BIGINT;
  v_conf   BIGINT;
  v_s      UUID;
  v_cp     TEXT;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_r FROM maalrise_capital_receipts WHERE id = p_receipt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF v_r.status <> 'recorded' THEN RAISE EXCEPTION 'This entry is already %', v_r.status; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = v_r.cycle_id FOR UPDATE;
  IF v_cycle.status <> 'active' THEN RAISE EXCEPTION 'The Cycle is not active'; END IF;

  UPDATE maalrise_capital_receipts SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = NOW() WHERE id = p_receipt;
  v_due := maalrise_capital_due(v_r.cycle_id);
  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_conf FROM maalrise_capital_receipts WHERE cycle_id = v_r.cycle_id AND status = 'confirmed';
  IF v_conf > v_due THEN RAISE EXCEPTION 'Confirmed capital would exceed the capital owed'; END IF;

  IF v_conf = v_due AND NOT EXISTS (SELECT 1 FROM maalrise_capital_settlements WHERE cycle_id = v_r.cycle_id AND status <> 'cancelled') THEN
    SELECT name INTO v_cp FROM maalrise_counterparties WHERE id = v_cycle.counterparty_id;
    INSERT INTO maalrise_capital_settlements (cycle_id, cycle_name, counterparty_name, maturity_date, capital_kobo, prepared_by)
    VALUES (v_cycle.id, v_cycle.name, v_cp, maalrise_maturity_date(v_cycle.id), v_due, auth.uid())
    RETURNING id INTO v_s;
    PERFORM maalrise_build_capital_payments(v_s);
    PERFORM maalrise_notify_roles(ARRAY['super_admin', 'administrator'], 'capital_settlement_prepared',
      'Capital settlement ready for approval: ' || v_cycle.name,
      'The full capital of ' || maalrise_naira(v_due) || ' is confirmed. Each investor''s capital repayment is ready for review and approval.',
      '/admin/maalrise/cycles/' || v_cycle.id || '#capital', 'capital_settlement_prepared:' || v_s,
      'MaalRise: capital settlement ready for approval');
  END IF;

  PERFORM create_audit_log('maalrise_confirm_capital', 'maalrise_capital_receipt', p_receipt::TEXT,
    jsonb_build_object('status', 'recorded'),
    jsonb_build_object('status', 'confirmed', 'confirmed_total_kobo', v_conf, 'capital_due_kobo', v_due, 'settlement_id', v_s));
  RETURN v_s;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** A super admin reverses a confirmed capital entry, before the settlement is approved. */
CREATE OR REPLACE FUNCTION maalrise_reverse_capital(p_receipt UUID, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_r maalrise_capital_receipts%ROWTYPE;
  v_s maalrise_capital_settlements%ROWTYPE;
BEGIN
  IF COALESCE(maalrise_caller_role(), '') <> 'super_admin' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required to reverse an entry'; END IF;
  SELECT * INTO v_r FROM maalrise_capital_receipts WHERE id = p_receipt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF v_r.status <> 'confirmed' THEN RAISE EXCEPTION 'Only a confirmed entry can be reversed (reject an unconfirmed one)'; END IF;
  SELECT * INTO v_s FROM maalrise_capital_settlements WHERE cycle_id = v_r.cycle_id AND status <> 'cancelled' FOR UPDATE;
  IF FOUND AND v_s.status = 'approved' THEN
    RAISE EXCEPTION 'The capital settlement is already approved, so this entry cannot be reversed';
  END IF;
  IF FOUND THEN
    DELETE FROM maalrise_capital_payments WHERE settlement_id = v_s.id;
    UPDATE maalrise_capital_settlements
       SET status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = NOW(),
           cancel_reason = 'Capital entry reversed: ' || trim(p_reason)
     WHERE id = v_s.id;
  END IF;
  UPDATE maalrise_capital_receipts SET status = 'reversed', reversed_by = auth.uid(), reversed_at = NOW(), reverse_reason = trim(p_reason)
   WHERE id = p_receipt;
  PERFORM create_audit_log('maalrise_reverse_capital', 'maalrise_capital_receipt', p_receipt::TEXT,
    jsonb_build_object('status', 'confirmed', 'amount_kobo', v_r.amount_kobo),
    jsonb_build_object('status', 'reversed', 'reason', trim(p_reason), 'settlement_cancelled', v_s.id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 8. Capital settlement: refresh, approve, pay, reverse payment
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_refresh_capital_settlement(p_settlement UUID)
RETURNS VOID AS $$
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  PERFORM maalrise_build_capital_payments(p_settlement);
  PERFORM create_audit_log('maalrise_refresh_capital_settlement', 'maalrise_capital_settlement', p_settlement::TEXT, NULL, NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_approve_capital_settlement(p_settlement UUID)
RETURNS VOID AS $$
DECLARE
  v_s   maalrise_capital_settlements%ROWTYPE;
  v_bad TEXT;
  v_n   INTEGER;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_s FROM maalrise_capital_settlements WHERE id = p_settlement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Capital settlement not found'; END IF;
  IF v_s.status <> 'prepared' THEN RAISE EXCEPTION 'This capital settlement is already %', v_s.status; END IF;
  SELECT string_agg(l.investor_name, ', ') INTO v_bad
    FROM maalrise_capital_payments l JOIN maalrise_investors i ON i.id = l.maalrise_investor_id
   WHERE l.settlement_id = p_settlement
     AND (l.account_number IS NULL OR i.bank_confirmed_at IS NULL
          OR i.account_number IS DISTINCT FROM l.account_number
          OR i.bank_name IS DISTINCT FROM l.bank_name OR i.account_name IS DISTINCT FROM l.account_name);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Bank details are unconfirmed or have changed for: %. Confirm them, then refresh the settlement.', v_bad;
  END IF;

  UPDATE maalrise_capital_settlements SET status = 'approved', approved_by = auth.uid(), approved_at = NOW() WHERE id = p_settlement;
  UPDATE maalrise_capital_payments SET status = 'payable', updated_at = NOW() WHERE settlement_id = p_settlement;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM create_audit_log('maalrise_approve_capital_settlement', 'maalrise_capital_settlement', p_settlement::TEXT,
    jsonb_build_object('status', 'prepared'), jsonb_build_object('status', 'approved', 'capital_kobo', v_s.capital_kobo, 'payments', v_n));
  PERFORM maalrise_notify_roles(ARRAY['payment_officer', 'super_admin', 'administrator'], 'capital_settlement_approved',
    'Capital repayments approved: ' || v_s.cycle_name,
    v_n || ' capital repayment(s) totalling ' || maalrise_naira(v_s.capital_kobo)
      || ' are approved. Make the bank transfers, then mark each one paid.',
    '/admin/payment-requests/maalrise', 'capital_settlement_approved:' || p_settlement, 'MaalRise: capital repayments approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_mark_capital_paid(p_line UUID, p_paid_on DATE, p_reference TEXT)
RETURNS VOID AS $$
DECLARE
  v_l   maalrise_capital_payments%ROWTYPE;
  v_s   maalrise_capital_settlements%ROWTYPE;
  v_ref TEXT := NULLIF(trim(COALESCE(p_reference, '')), '');
BEGIN
  IF NOT maalrise_can_pay() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_l FROM maalrise_capital_payments WHERE id = p_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_l.status = 'paid' THEN RAISE EXCEPTION 'This payment is already marked paid'; END IF;
  IF v_l.status <> 'payable' THEN RAISE EXCEPTION 'This payment has not been approved'; END IF;
  SELECT * INTO v_s FROM maalrise_capital_settlements WHERE id = v_l.settlement_id;
  IF p_paid_on IS NULL THEN RAISE EXCEPTION 'The transfer date is required'; END IF;
  IF p_paid_on > maalrise_today() THEN RAISE EXCEPTION 'A transfer cannot be dated in the future'; END IF;
  IF p_paid_on < (v_s.approved_at AT TIME ZONE 'Africa/Lagos')::DATE THEN
    RAISE EXCEPTION 'A transfer cannot be dated before the payment was approved';
  END IF;
  UPDATE maalrise_capital_payments
     SET status = 'paid', paid_on = p_paid_on, paid_reference = v_ref, paid_by = auth.uid(), paid_at = NOW(), updated_at = NOW()
   WHERE id = p_line;
  INSERT INTO maalrise_capital_payment_events (line_id, event, amount_kobo, paid_on, reference, bank_name, account_name, account_number, actor)
  VALUES (p_line, 'marked_paid', v_l.amount_kobo, p_paid_on, v_ref, v_l.bank_name, v_l.account_name, v_l.account_number, auth.uid());
  PERFORM create_audit_log('maalrise_mark_capital_paid', 'maalrise_capital_payment', p_line::TEXT,
    jsonb_build_object('status', 'payable'),
    jsonb_build_object('status', 'paid', 'paid_on', p_paid_on, 'reference', v_ref, 'amount_kobo', v_l.amount_kobo));
  PERFORM maalrise_notify_investor(v_l.maalrise_investor_id, 'capital_paid',
    'Capital repaid',
    'Your MaalRise capital of ' || maalrise_naira(v_l.amount_kobo) || ' for ' || v_s.cycle_name || ' was repaid on '
      || to_char(p_paid_on, 'DD Mon YYYY') || COALESCE(' (transfer reference ' || v_ref || ')', '')
      || ' to account ending ' || right(COALESCE(v_l.account_number, ''), 4) || '.',
    'capital_paid:' || p_line || ':' || (SELECT COUNT(*) FROM maalrise_capital_payment_events WHERE line_id = p_line),
    'MaalRise capital repaid');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_reverse_capital_payment(p_line UUID, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_l maalrise_capital_payments%ROWTYPE;
BEGIN
  IF COALESCE(maalrise_caller_role(), '') <> 'super_admin' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required to reverse a payment'; END IF;
  SELECT * INTO v_l FROM maalrise_capital_payments WHERE id = p_line FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_l.status <> 'paid' THEN RAISE EXCEPTION 'Only a payment marked paid can be reversed'; END IF;
  IF (SELECT status FROM maalrise_cycles WHERE id = v_l.cycle_id) = 'closed' THEN
    RAISE EXCEPTION 'The Cycle is closed; its payments are final';
  END IF;
  INSERT INTO maalrise_capital_payment_events (line_id, event, amount_kobo, paid_on, reference, bank_name, account_name,
                                               account_number, reason, actor)
  VALUES (p_line, 'reversed', v_l.amount_kobo, v_l.paid_on, v_l.paid_reference, v_l.bank_name, v_l.account_name,
          v_l.account_number, trim(p_reason), auth.uid());
  UPDATE maalrise_capital_payments
     SET status = 'payable', paid_on = NULL, paid_reference = NULL, paid_by = NULL, paid_at = NULL, updated_at = NOW()
   WHERE id = p_line;
  PERFORM create_audit_log('maalrise_reverse_capital_payment', 'maalrise_capital_payment', p_line::TEXT,
    jsonb_build_object('status', 'paid', 'paid_on', v_l.paid_on, 'reference', v_l.paid_reference),
    jsonb_build_object('status', 'payable', 'reason', trim(p_reason)));
  PERFORM maalrise_notify_roles(ARRAY['payment_officer', 'super_admin', 'administrator'], 'capital_payment_reversed',
    'Capital payment reversed: ' || v_l.investor_name,
    'The ' || maalrise_naira(v_l.amount_kobo) || ' capital repayment was reversed by a super admin: '
      || trim(p_reason) || '. It is payable again.',
    '/admin/payment-requests/maalrise',
    'capital_reversed:' || p_line || ':' || (SELECT COUNT(*) FROM maalrise_capital_payment_events WHERE line_id = p_line), NULL);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 9. Closing a Cycle — only when everything is received and paid
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_close_checks(p_cycle UUID)
RETURNS JSONB AS $$
DECLARE
  v_cycle   maalrise_cycles%ROWTYPE;
  v_mat     DATE;
  v_checks  JSONB := '[]'::JSONB;
  v_n       INTEGER;
  v_due     BIGINT;
  v_conf    BIGINT;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  v_mat := maalrise_maturity_date(p_cycle);

  v_checks := v_checks || jsonb_build_object('key', 'active', 'ok', v_cycle.status = 'active',
    'detail', 'The Cycle is active (it is ' || v_cycle.status || ')');
  v_checks := v_checks || jsonb_build_object('key', 'matured', 'ok', maalrise_today() >= v_mat,
    'detail', 'Maturity date reached (' || to_char(v_mat, 'DD Mon YYYY') || ')');

  SELECT COUNT(*) INTO v_n FROM maalrise_schedule_lines l
   WHERE l.terms_id = v_cycle.approved_terms_id
     AND COALESCE((SELECT SUM(applied_kobo) FROM maalrise_receipts r WHERE r.schedule_line_id = l.id AND r.status = 'confirmed'), 0)
         < l.counterparty_gross_kobo;
  v_checks := v_checks || jsonb_build_object('key', 'profit_received', 'ok', v_n = 0,
    'detail', CASE WHEN v_n = 0 THEN 'Every monthly payment received and confirmed' ELSE v_n || ' month(s) not fully received and confirmed' END);

  SELECT (SELECT COUNT(*) FROM maalrise_receipts WHERE cycle_id = p_cycle AND status = 'recorded')
       + (SELECT COUNT(*) FROM maalrise_capital_receipts WHERE cycle_id = p_cycle AND status = 'recorded') INTO v_n;
  v_checks := v_checks || jsonb_build_object('key', 'nothing_unconfirmed', 'ok', v_n = 0,
    'detail', CASE WHEN v_n = 0 THEN 'No entries awaiting confirmation' ELSE v_n || ' entr(ies) awaiting confirmation' END);

  SELECT COUNT(*) INTO v_n FROM maalrise_distributions WHERE cycle_id = p_cycle AND status = 'prepared' AND net_kobo > 0;
  v_checks := v_checks || jsonb_build_object('key', 'distributions_approved', 'ok', v_n = 0,
    'detail', CASE WHEN v_n = 0 THEN 'Every profit distribution approved' ELSE v_n || ' distribution(s) awaiting approval' END);

  SELECT COUNT(*) INTO v_n FROM maalrise_distribution_lines WHERE cycle_id = p_cycle AND status <> 'paid';
  v_checks := v_checks || jsonb_build_object('key', 'profit_paid', 'ok', v_n = 0,
    'detail', CASE WHEN v_n = 0 THEN 'Every investor profit payment marked paid' ELSE v_n || ' profit payment(s) not yet marked paid' END);

  v_due := maalrise_capital_due(p_cycle);
  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_conf FROM maalrise_capital_receipts WHERE cycle_id = p_cycle AND status = 'confirmed';
  v_checks := v_checks || jsonb_build_object('key', 'capital_received', 'ok', v_due IS NOT NULL AND v_conf = v_due,
    'detail', 'Capital received and confirmed: ' || maalrise_naira(v_conf) || ' of ' || maalrise_naira(COALESCE(v_due, 0)));

  v_checks := v_checks || jsonb_build_object('key', 'capital_approved',
    'ok', EXISTS (SELECT 1 FROM maalrise_capital_settlements WHERE cycle_id = p_cycle AND status = 'approved'),
    'detail', 'Capital settlement approved');

  SELECT COUNT(*) INTO v_n FROM maalrise_capital_payments p JOIN maalrise_capital_settlements s ON s.id = p.settlement_id
   WHERE s.cycle_id = p_cycle AND s.status <> 'cancelled' AND p.status <> 'paid';
  v_checks := v_checks || jsonb_build_object('key', 'capital_paid',
    'ok', v_n = 0 AND EXISTS (SELECT 1 FROM maalrise_capital_settlements WHERE cycle_id = p_cycle AND status = 'approved'),
    'detail', CASE WHEN v_n = 0 THEN 'Every investor capital repayment marked paid' ELSE v_n || ' capital repayment(s) not yet marked paid' END);

  RETURN jsonb_build_object('cycle_id', p_cycle,
    'all_ok', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checks) c WHERE NOT (c->>'ok')::BOOLEAN),
    'checks', v_checks);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_close_cycle(p_cycle UUID)
RETURNS JSONB AS $$
DECLARE
  v_result JSONB;
  v_name   TEXT;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  PERFORM 1 FROM maalrise_cycles WHERE id = p_cycle FOR UPDATE;
  v_result := maalrise_close_checks(p_cycle);
  IF NOT (v_result->>'all_ok')::BOOLEAN THEN
    RAISE EXCEPTION 'The Cycle cannot be closed yet: %',
      (SELECT string_agg(c->>'detail', '; ') FROM jsonb_array_elements(v_result->'checks') c WHERE NOT (c->>'ok')::BOOLEAN);
  END IF;
  UPDATE maalrise_cycles SET status = 'closed', updated_at = NOW() WHERE id = p_cycle RETURNING name INTO v_name;
  PERFORM create_audit_log('maalrise_close_cycle', 'maalrise_cycle', p_cycle::TEXT,
    jsonb_build_object('status', 'active'), jsonb_build_object('status', 'closed', 'checks', v_result->'checks'));
  PERFORM maalrise_notify_roles(ARRAY['super_admin', 'administrator', 'finance'], 'cycle_closed',
    'Cycle closed: ' || v_name, v_name || ' is closed: all profit and capital has been received and paid.',
    '/admin/maalrise/cycles/' || p_cycle, 'cycle_closed:' || p_cycle, NULL);
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 10. Grants. Internal helpers are not callable from the API.
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION maalrise_build_capital_payments(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_capital_receipt_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_capital_settlement_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_capital_payments_guard() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION maalrise_build_capital_payments(UUID) FROM anon, authenticated;
  END IF;
END $$;

-- <<< 053 BODY END (part 3)

COMMIT;

SELECT 'Part 3 of 3 applied' AS result;
