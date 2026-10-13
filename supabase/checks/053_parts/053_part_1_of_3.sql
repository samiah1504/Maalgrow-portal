-- ============================================================
-- MaalRise 053 — PART 1 OF 3
-- Monthly-entry reversal, capital tables, guards, read policies
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
-- Success = the final result row reads "Part 1 of 3 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT (to_regclass('public.maalrise_distribution_lines') IS NOT NULL) THEN
    RAISE EXCEPTION 'STOP: run migration 052 first (MaalRise distributions are missing).';
  END IF;
  IF to_regclass('public.maalrise_capital_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: part 1 of 3 has already been applied (maalrise_capital_receipts exists). Do not run it again.';
  END IF;
END $$;

-- >>> 053 BODY START (part 1)

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

-- <<< 053 BODY END (part 1)

COMMIT;

SELECT 'Part 1 of 3 applied' AS result;
