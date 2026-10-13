-- ============================================================
-- MaalRise 053 — PART 2 OF 3
-- Helpers; monthly entries refused above what is owed; entry reversal; empty-distribution and closed-Cycle rules; reminders
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
-- Success = the final result row reads "Part 2 of 3 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT (to_regclass('public.maalrise_capital_receipts') IS NOT NULL) THEN
    RAISE EXCEPTION 'STOP: run part 1 of 3 first (it creates maalrise_capital_receipts).';
  END IF;
  IF to_regprocedure('public.maalrise_reverse_receipt(uuid,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: part 2 of 3 has already been applied (maalrise_reverse_receipt exists). Do not run it again.';
  END IF;
END $$;

-- >>> 053 BODY START (part 2)
-- ------------------------------------------------------------
-- 5. Helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_maturity_date(p_cycle UUID)
RETURNS DATE AS $$
  SELECT (start_date + make_interval(months => duration_months))::DATE FROM maalrise_cycles WHERE id = p_cycle;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

/** The capital the counterparty repays: the approved terms' cost. */
CREATE OR REPLACE FUNCTION maalrise_capital_due(p_cycle UUID)
RETURNS BIGINT AS $$
  SELECT t.cost_kobo FROM maalrise_cycles c JOIN maalrise_cycle_terms t ON t.id = c.approved_terms_id WHERE c.id = p_cycle;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 6. Monthly entries: refuse more than is owed; reversal; reminders
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_record_receipt(p_cycle UUID, p JSONB)
RETURNS UUID AS $$
DECLARE
  v_cycle    maalrise_cycles%ROWTYPE;
  v_line     maalrise_schedule_lines%ROWTYPE;
  v_amount   BIGINT;
  v_date     DATE;
  v_ref      TEXT := NULLIF(trim(COALESCE(p->>'reference', '')), '');
  v_id       UUID;
  v_cp       TEXT;
  v_recorded BIGINT;
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status <> 'active' THEN
    RAISE EXCEPTION 'Payments can be recorded only for an active Cycle (this one is %)', v_cycle.status;
  END IF;
  -- Locked so two people cannot both record the last of a month at once.
  SELECT * INTO v_line FROM maalrise_schedule_lines
   WHERE terms_id = v_cycle.approved_terms_id AND period = (p->>'period')::INTEGER FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'That month is not in the approved schedule'; END IF;

  v_amount := (p->>'amount_kobo')::BIGINT;
  IF v_amount IS NULL OR v_amount <= 0 THEN RAISE EXCEPTION 'The amount received must be greater than zero'; END IF;
  v_date := (p->>'received_on')::DATE;
  IF v_date IS NULL THEN RAISE EXCEPTION 'The date the payment was received is required'; END IF;
  IF v_date > maalrise_today() THEN RAISE EXCEPTION 'A payment cannot be dated in the future'; END IF;
  IF v_date < v_cycle.start_date THEN RAISE EXCEPTION 'A payment cannot be dated before the Cycle started'; END IF;

  -- Payments are made outside the system and recorded here, so an entry
  -- above what is still owed is an entry error, not an overpayment.
  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_recorded FROM maalrise_receipts
   WHERE schedule_line_id = v_line.id AND status IN ('recorded', 'confirmed');
  IF v_recorded >= v_line.counterparty_gross_kobo THEN
    RAISE EXCEPTION 'Month % is already fully recorded (% of %). Check the month.',
      v_line.period, maalrise_naira(v_recorded), maalrise_naira(v_line.counterparty_gross_kobo);
  END IF;
  IF v_amount > v_line.counterparty_gross_kobo - v_recorded THEN
    RAISE EXCEPTION '% is more than the % still owed for month %. Check the amount.',
      maalrise_naira(v_amount), maalrise_naira(v_line.counterparty_gross_kobo - v_recorded), v_line.period;
  END IF;

  IF v_ref IS NOT NULL AND EXISTS (SELECT 1 FROM maalrise_receipts WHERE cycle_id = p_cycle AND status IN ('recorded', 'confirmed')
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

/**
 * A super admin reverses a CONFIRMED monthly entry made by mistake,
 * with a reason, while its distribution is still unapproved. The entry
 * is kept (status 'reversed'); the distribution's fee and net are
 * recalculated from the entries that remain, on the same running-total
 * rule, so the figures stay exact to the kobo.
 */
CREATE OR REPLACE FUNCTION maalrise_reverse_receipt(p_receipt UUID, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_r      maalrise_receipts%ROWTYPE;
  v_line   maalrise_schedule_lines%ROWTYPE;
  v_d      maalrise_distributions%ROWTYPE;
  v_run    BIGINT;
  v_fee    BIGINT;
  v_tfee   BIGINT := 0;
  v_tapp   BIGINT := 0;
  x        RECORD;
BEGIN
  IF COALESCE(maalrise_caller_role(), '') <> 'super_admin' THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required to reverse an entry'; END IF;
  SELECT * INTO v_r FROM maalrise_receipts WHERE id = p_receipt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Entry not found'; END IF;
  IF v_r.status <> 'confirmed' THEN RAISE EXCEPTION 'Only a confirmed entry can be reversed (reject an unconfirmed one)'; END IF;
  SELECT * INTO v_line FROM maalrise_schedule_lines WHERE id = v_r.schedule_line_id FOR UPDATE;
  IF v_r.distribution_id IS NOT NULL THEN
    SELECT * INTO v_d FROM maalrise_distributions WHERE id = v_r.distribution_id FOR UPDATE;
    IF v_d.status <> 'prepared' THEN
      RAISE EXCEPTION 'This entry''s distribution is already approved, so the entry cannot be reversed';
    END IF;
  END IF;

  UPDATE maalrise_receipts
     SET status = 'reversed', reversed_by = auth.uid(), reversed_at = NOW(), reverse_reason = trim(p_reason)
   WHERE id = p_receipt;

  IF v_r.distribution_id IS NOT NULL THEN
    -- Money already in earlier, approved distributions of this month.
    SELECT COALESCE(SUM(applied_kobo), 0) INTO v_run FROM maalrise_receipts
     WHERE schedule_line_id = v_line.id AND status = 'confirmed' AND distribution_id IS DISTINCT FROM v_d.id;
    FOR x IN SELECT id, applied_kobo FROM maalrise_receipts
              WHERE distribution_id = v_d.id AND status = 'confirmed' ORDER BY confirmed_at, id LOOP
      v_fee := CASE WHEN v_line.counterparty_gross_kobo = 0 THEN 0
                    ELSE ROUND((v_run + x.applied_kobo)::NUMERIC * v_line.fee_kobo / v_line.counterparty_gross_kobo)::BIGINT
                       - ROUND(v_run::NUMERIC * v_line.fee_kobo / v_line.counterparty_gross_kobo)::BIGINT END;
      UPDATE maalrise_receipts SET fee_kobo = v_fee, net_kobo = x.applied_kobo - v_fee WHERE id = x.id;
      v_run := v_run + x.applied_kobo;
      v_tfee := v_tfee + v_fee;
      v_tapp := v_tapp + x.applied_kobo;
    END LOOP;
    UPDATE maalrise_distributions
       SET applied_kobo = v_tapp, fee_kobo = v_tfee, net_kobo = v_tapp - v_tfee,
           allocated_kobo = 0, unallocated_kobo = v_tapp - v_tfee
     WHERE id = v_d.id;
    PERFORM maalrise_build_distribution_lines(v_d.id);
  END IF;

  PERFORM create_audit_log('maalrise_reverse_receipt', 'maalrise_receipt', p_receipt::TEXT,
    jsonb_build_object('status', 'confirmed', 'amount_kobo', v_r.amount_kobo),
    jsonb_build_object('status', 'reversed', 'reason', trim(p_reason)));
  PERFORM maalrise_notify_roles(ARRAY['super_admin', 'administrator'], 'receipt_reversed',
    'Payment entry reversed',
    'A confirmed entry of ' || maalrise_naira(v_r.amount_kobo) || ' for month ' || v_r.period
      || ' was reversed by a super admin: ' || trim(p_reason) || '. Its distribution was recalculated.',
    '/admin/maalrise/cycles/' || v_r.cycle_id || '#receipts', 'receipt_reversed:' || p_receipt, NULL);
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
  IF v_d.net_kobo = 0 OR NOT EXISTS (SELECT 1 FROM maalrise_distribution_lines WHERE distribution_id = p_dist) THEN
    RAISE EXCEPTION 'Nothing to approve: this distribution has no confirmed money';
  END IF;

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

CREATE OR REPLACE FUNCTION maalrise_sync_reminders()
RETURNS INTEGER AS $$
DECLARE
  v_today DATE := maalrise_today();
  r       RECORD;
  v_n     INTEGER := 0;
  v_link  TEXT;
BEGIN
  -- Monthly payments
  FOR r IN
    SELECT c.id AS cycle_id, c.name AS cycle_name, cp.name AS cp_name, l.id AS line_id, l.period, l.due_date,
           l.counterparty_gross_kobo AS gross,
           COALESCE((SELECT SUM(amount_kobo) FROM maalrise_receipts x
                      WHERE x.schedule_line_id = l.id AND x.status IN ('recorded', 'confirmed')), 0) AS recorded
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

  -- Capital at maturity
  FOR r IN
    SELECT c.id AS cycle_id, c.name AS cycle_name, cp.name AS cp_name,
           maalrise_maturity_date(c.id) AS due_date, maalrise_capital_due(c.id) AS capital,
           COALESCE((SELECT SUM(amount_kobo) FROM maalrise_capital_receipts x
                      WHERE x.cycle_id = c.id AND x.status IN ('recorded', 'confirmed')), 0) AS recorded
      FROM maalrise_cycles c JOIN maalrise_counterparties cp ON cp.id = c.counterparty_id
     WHERE c.status = 'active' AND maalrise_maturity_date(c.id) <= v_today
  LOOP
    CONTINUE WHEN r.recorded >= r.capital;
    v_link := '/admin/maalrise/cycles/' || r.cycle_id || '#capital';
    IF v_today - r.due_date >= 5 THEN
      v_n := v_n + maalrise_notify_roles(ARRAY['super_admin', 'administrator', 'finance'], 'capital_followup',
        'Follow up: ' || r.cp_name || ' capital overdue',
        'The capital of ' || maalrise_naira(r.capital) || ' for ' || r.cycle_name || ' was due on '
          || to_char(r.due_date, 'DD Mon YYYY') || '; ' || maalrise_naira(r.recorded) || ' has been recorded. Please follow up.',
        v_link, 'capital_followup:' || r.cycle_id, 'MaalRise: follow up ' || r.cp_name || ' capital');
    END IF;
    v_n := v_n + maalrise_notify_roles(ARRAY['super_admin', 'administrator', 'finance'], 'capital_due',
      'Capital repayment due: ' || r.cp_name,
      CASE WHEN r.due_date = v_today
           THEN 'Today is the maturity date for ' || r.cycle_name || '. ' || r.cp_name || ' repays the capital of '
                || maalrise_naira(r.capital) || '. Please record it when received.'
           ELSE r.cycle_name || ' matured on ' || to_char(r.due_date, 'DD Mon YYYY') || '. Please record the capital of '
                || maalrise_naira(r.capital) || ' from ' || r.cp_name || ' when received.' END,
      v_link, 'capital_due:' || r.cycle_id, 'MaalRise: capital repayment due from ' || r.cp_name);
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Unchanged from 052 except: a closed Cycle's payments are final. */
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
  IF (SELECT status FROM maalrise_cycles WHERE id = v_l.cycle_id) = 'closed' THEN
    RAISE EXCEPTION 'The Cycle is closed; its payments are final';
  END IF;

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

-- <<< 053 BODY END (part 2)

COMMIT;

SELECT 'Part 2 of 3 applied' AS result;
