-- ============================================================
-- 053 — MaalRise capital settlement and closing a Cycle (Phase 5)
--
-- APPLY ONLY AFTER supabase/checks/maalrise_053_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_053_postapply.sql.
-- To undo: supabase/checks/maalrise_053_rollback.sql (refuses if any
-- capital record or reversed entry exists). Rehearsed by
-- supabase/tests/run_maalrise_tests.sh.
--
-- WHAT THIS ADDS (agreed 13 Oct 2026)
--
--   * Capital (the transaction cost) is repaid by the counterparty as
--     one sum at maturity, recorded like a monthly payment: amount,
--     ACTUAL date, optional reference. Several entries are allowed (a
--     split bank transfer), but investors are paid out only when the
--     FULL capital is confirmed — capital is never paid out in part.
--     No entry may take the total above the capital owed.
--   * Capital settlement: each investor gets back exactly the capital
--     they funded, to the confirmed bank account (snapshot). No fee and
--     no tax is taken from capital. Prepared automatically, approved by
--     an administrator or super admin, transferred outside the system
--     and marked paid by the payment officer (or an admin). Super admin
--     reversal with a reason; history is append-only.
--   * Closing a Cycle: allowed only when every month and the capital
--     have been received in full, distributed, approved and marked
--     paid. No write-offs. No rollover: every investor is paid out.
--   * Reminders on the maturity date, and a follow-up five days later,
--     while the capital is not fully recorded.
--
-- WHAT IT CHANGES IN PHASE 4 (MaalRise only)
--
--   * Monthly entries above what is still owed are REFUSED as entry
--     errors (payments arrive outside the system and are recorded, so
--     there is no overpayment to hold).
--   * A super admin can reverse a CONFIRMED monthly entry, with a
--     reason, as long as its distribution has not been approved. The
--     distribution is recalculated exactly; the entry keeps its history.
--   * An empty distribution cannot be approved.
--   Five MaalRise functions are replaced for this (record_receipt,
--   receipt_guard, sync_reminders, approve_distribution, and
--   reverse_line_payment, which now refuses once a Cycle is closed) and
--   maalrise_receipts gains a 'reversed' status. Nothing in MaalGrow
--   is altered.
--
-- Every UPDATE or DELETE here has a WHERE (Supabase's safeupdate).
-- ============================================================

BEGIN;

-- ------------------------------------------------------------
-- 1. Monthly entries: reversal by a super admin
-- ------------------------------------------------------------
ALTER TABLE maalrise_receipts DROP CONSTRAINT maalrise_receipts_status_check;
ALTER TABLE maalrise_receipts ADD CONSTRAINT maalrise_receipts_status_check
  CHECK (status IN ('recorded', 'confirmed', 'rejected', 'reversed'));
ALTER TABLE maalrise_receipts
  ADD COLUMN reversed_by    UUID REFERENCES profiles(id),
  ADD COLUMN reversed_at    TIMESTAMPTZ,
  ADD COLUMN reverse_reason TEXT;
ALTER TABLE maalrise_receipts ADD CONSTRAINT maalrise_receipts_reverse_reason_check
  CHECK (status <> 'reversed' OR length(trim(COALESCE(reverse_reason, ''))) > 0);
-- A reference stays unique among live entries; a rejected or reversed
-- entry's reference may be used again.
DROP INDEX maalrise_receipts_reference_uq;
CREATE UNIQUE INDEX maalrise_receipts_reference_uq
  ON maalrise_receipts (cycle_id, lower(trim(reference)))
  WHERE status IN ('recorded', 'confirmed') AND reference IS NOT NULL AND length(trim(reference)) > 0;

CREATE OR REPLACE FUNCTION maalrise_receipt_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Receipts cannot be deleted; reject a wrong entry instead'; END IF;
  IF OLD.status <> 'recorded' THEN
    IF NEW.amount_kobo <> OLD.amount_kobo OR NEW.applied_kobo IS DISTINCT FROM OLD.applied_kobo
       OR NEW.received_on <> OLD.received_on THEN
      RAISE EXCEPTION 'A confirmed, rejected or reversed entry cannot be changed';
    END IF;
    -- The only status change after confirmation is a super admin's reversal.
    IF NEW.status <> OLD.status AND NOT (OLD.status = 'confirmed' AND NEW.status = 'reversed') THEN
      RAISE EXCEPTION 'A confirmed, rejected or reversed entry cannot be changed';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 2. Capital: receipts, settlement, payments, history
-- ------------------------------------------------------------
CREATE TABLE maalrise_capital_receipts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id        UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  amount_kobo     BIGINT NOT NULL CHECK (amount_kobo > 0),
  received_on     DATE NOT NULL,
  reference       TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'confirmed', 'rejected', 'reversed')),
  recorded_by     UUID NOT NULL REFERENCES profiles(id),
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by    UUID REFERENCES profiles(id),
  confirmed_at    TIMESTAMPTZ,
  rejected_by     UUID REFERENCES profiles(id),
  rejected_at     TIMESTAMPTZ,
  reject_reason   TEXT,
  reversed_by     UUID REFERENCES profiles(id),
  reversed_at     TIMESTAMPTZ,
  reverse_reason  TEXT,
  CHECK (status <> 'rejected' OR length(trim(COALESCE(reject_reason, ''))) > 0),
  CHECK (status <> 'reversed' OR length(trim(COALESCE(reverse_reason, ''))) > 0)
);
CREATE INDEX maalrise_capital_receipts_cycle ON maalrise_capital_receipts (cycle_id);
CREATE UNIQUE INDEX maalrise_capital_receipts_reference_uq
  ON maalrise_capital_receipts (cycle_id, lower(trim(reference)))
  WHERE status IN ('recorded', 'confirmed') AND reference IS NOT NULL AND length(trim(reference)) > 0;

CREATE TABLE maalrise_capital_settlements (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id           UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  cycle_name         TEXT NOT NULL,
  counterparty_name  TEXT NOT NULL,
  maturity_date      DATE NOT NULL,
  capital_kobo       BIGINT NOT NULL CHECK (capital_kobo > 0),
  status             TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'approved', 'cancelled')),
  prepared_by        UUID NOT NULL REFERENCES profiles(id),
  prepared_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by        UUID REFERENCES profiles(id),
  approved_at        TIMESTAMPTZ,
  cancelled_by       UUID REFERENCES profiles(id),
  cancelled_at       TIMESTAMPTZ,
  cancel_reason      TEXT,
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  CHECK (status <> 'cancelled' OR length(trim(COALESCE(cancel_reason, ''))) > 0)
);
-- One live settlement per Cycle.
CREATE UNIQUE INDEX maalrise_capital_settlements_one_live
  ON maalrise_capital_settlements (cycle_id) WHERE status <> 'cancelled';

CREATE TABLE maalrise_capital_payments (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id         UUID NOT NULL REFERENCES maalrise_capital_settlements(id) ON DELETE RESTRICT,
  cycle_id              UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  maalrise_investor_id  UUID NOT NULL REFERENCES maalrise_investors(id) ON DELETE RESTRICT,
  investor_name         TEXT NOT NULL,
  investor_code         TEXT NOT NULL,
  units                 INTEGER NOT NULL CHECK (units > 0),
  amount_kobo           BIGINT NOT NULL CHECK (amount_kobo > 0),
  bank_name             TEXT,
  account_name          TEXT,
  account_number        TEXT,
  -- THE capital payment status, read by every screen (and Phase 6).
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
  UNIQUE (settlement_id, maalrise_investor_id)
);
CREATE INDEX maalrise_capital_payments_status ON maalrise_capital_payments (status);
CREATE INDEX maalrise_capital_payments_investor ON maalrise_capital_payments (maalrise_investor_id);

CREATE TABLE maalrise_capital_payment_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id         UUID NOT NULL REFERENCES maalrise_capital_payments(id) ON DELETE RESTRICT,
  event           TEXT NOT NULL CHECK (event IN ('marked_paid', 'reversed')),
  amount_kobo     BIGINT NOT NULL,
  paid_on         DATE,
  reference       TEXT,
  bank_name       TEXT,
  account_name    TEXT,
  account_number  TEXT,
  reason          TEXT,
  actor           UUID NOT NULL REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (event <> 'reversed' OR length(trim(COALESCE(reason, ''))) > 0)
);

-- ------------------------------------------------------------
-- 3. Guards
-- ------------------------------------------------------------
CREATE TRIGGER maalrise_capital_payment_events_append_only
  BEFORE UPDATE OR DELETE ON maalrise_capital_payment_events
  FOR EACH ROW EXECUTE FUNCTION maalrise_payment_events_append_only();

CREATE OR REPLACE FUNCTION maalrise_capital_receipt_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Capital entries cannot be deleted; reject a wrong entry instead'; END IF;
  IF OLD.status <> 'recorded' AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.received_on <> OLD.received_on
      OR (NEW.status <> OLD.status AND NOT (OLD.status = 'confirmed' AND NEW.status = 'reversed'))) THEN
    RAISE EXCEPTION 'A confirmed, rejected or reversed capital entry cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_capital_receipt_guard
  BEFORE UPDATE OR DELETE ON maalrise_capital_receipts
  FOR EACH ROW EXECUTE FUNCTION maalrise_capital_receipt_guard();

CREATE OR REPLACE FUNCTION maalrise_capital_settlement_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Capital settlements cannot be deleted'; END IF;
  IF OLD.status IN ('approved', 'cancelled') AND (NEW.status <> OLD.status OR NEW.capital_kobo <> OLD.capital_kobo) THEN
    RAISE EXCEPTION 'An approved or cancelled capital settlement is final';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_capital_settlement_guard
  BEFORE UPDATE OR DELETE ON maalrise_capital_settlements
  FOR EACH ROW EXECUTE FUNCTION maalrise_capital_settlement_guard();

CREATE OR REPLACE FUNCTION maalrise_capital_payments_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM maalrise_capital_settlements WHERE id = OLD.settlement_id;
  IF TG_OP = 'DELETE' AND v_status <> 'prepared' THEN
    RAISE EXCEPTION 'Payments of an approved capital settlement cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'approved'
     AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id
          OR NEW.account_number IS DISTINCT FROM OLD.account_number) THEN
    RAISE EXCEPTION 'An approved capital payment''s amount and account are frozen';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_capital_payments_guard
  BEFORE UPDATE OR DELETE ON maalrise_capital_payments
  FOR EACH ROW EXECUTE FUNCTION maalrise_capital_payments_guard();

-- ------------------------------------------------------------
-- 4. Who reads what (no write policies; functions write)
-- ------------------------------------------------------------
ALTER TABLE maalrise_capital_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_capital_settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_capital_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_capital_payment_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Staff read capital receipts" ON maalrise_capital_receipts FOR SELECT USING (is_admin());
CREATE POLICY "Staff read capital settlements" ON maalrise_capital_settlements FOR SELECT USING (is_admin());
CREATE POLICY "Payment officer reads approved capital settlements" ON maalrise_capital_settlements
  FOR SELECT USING (status = 'approved' AND maalrise_caller_role() = 'payment_officer');
CREATE POLICY "Staff read capital payments" ON maalrise_capital_payments FOR SELECT USING (is_admin());
CREATE POLICY "Payment officer reads approved capital payments" ON maalrise_capital_payments
  FOR SELECT USING (status IN ('payable', 'paid') AND maalrise_caller_role() = 'payment_officer');
CREATE POLICY "Investor reads own approved capital payments" ON maalrise_capital_payments
  FOR SELECT USING (status IN ('payable', 'paid') AND maalrise_investor_id = get_my_maalrise_investor_id());
CREATE POLICY "Staff read capital payment history" ON maalrise_capital_payment_events FOR SELECT USING (is_admin());
CREATE POLICY "Payment officer reads capital payment history" ON maalrise_capital_payment_events
  FOR SELECT USING (maalrise_caller_role() = 'payment_officer');

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

COMMIT;
