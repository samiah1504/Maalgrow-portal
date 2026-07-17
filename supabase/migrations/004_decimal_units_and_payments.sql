-- ============================================================
-- Migration 004 – Decimal slot units & investment payment tracking
-- ============================================================

-- 1. Allow fractional slot quantities (0.5 increments)
-- The inline check constraint created in 001 gets the auto-name
-- investments_units_check; drop it before altering the column type.

ALTER TABLE investments DROP CONSTRAINT IF EXISTS investments_units_check;

ALTER TABLE investments
  ALTER COLUMN units TYPE NUMERIC(12,2)
  USING units::NUMERIC(12,2);

-- Minimum 0.5 slot; must be a multiple of 0.5
-- FLOOR(units * 2) = units * 2  ↔  units is an exact half-integer
ALTER TABLE investments
  ADD CONSTRAINT investments_units_check
  CHECK (units >= 0.5 AND FLOOR(units * 2) = units * 2);

-- ============================================================
-- 2. Investment payments table
--    Tracks inbound capital contributions FROM investors TO MaalVest.
--    (Distinct from payment_requests, which are outgoing ROI/capital
--    payments FROM MaalVest TO investors.)
-- ============================================================

CREATE TABLE IF NOT EXISTS investment_payments (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_id UUID NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  investor_id   UUID NOT NULL REFERENCES investors(id),
  amount        NUMERIC(20,2) NOT NULL CHECK (amount > 0),
  payment_date  DATE NOT NULL,
  reference     TEXT,
  created_by    UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_investment_payments_investment_id
  ON investment_payments(investment_id);

CREATE INDEX IF NOT EXISTS idx_investment_payments_investor_id
  ON investment_payments(investor_id);

CREATE INDEX IF NOT EXISTS idx_investment_payments_created_at
  ON investment_payments(created_at DESC);

-- ============================================================
-- 3. Row-Level Security for investment_payments
-- ============================================================

ALTER TABLE investment_payments ENABLE ROW LEVEL SECURITY;

-- Admins can read and write all payment records
CREATE POLICY "Admins manage investment payments"
  ON investment_payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN (
          'super_admin', 'administrator', 'finance',
          'operations', 'customer_support'
        )
    )
  );

-- Investors can view only their own investment payments
CREATE POLICY "Investors view own investment payments"
  ON investment_payments FOR SELECT
  USING (
    investor_id IN (
      SELECT id FROM investors WHERE profile_id = auth.uid()
    )
  );
