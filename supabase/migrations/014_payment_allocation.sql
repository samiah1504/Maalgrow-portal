-- ============================================================
-- Migration 014 – Investor Payment Allocation
--
-- Root cause fix: "Add Payment" used to insert a bare row into
-- investment_payments without ever touching the enrolment
-- (investments.units / capital) or the cycle totals, so the
-- payment never appeared on the investor's portal.
--
-- This migration makes every investor payment a first-class
-- allocation:
--   • payments carry series_id, cycle_id, units (slots bought)
--     and a status (pending / confirmed / rejected / reversed)
--   • transactional SECURITY DEFINER functions create the
--     payment AND create/update the enrolment, cycle totals and
--     audit log together — all-or-nothing
--   • editing / moving / reversing a payment recalculates the
--     old and new allocations
--
-- Apply AFTER migration 013.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New investment status for fully-reversed enrolments
-- ------------------------------------------------------------
ALTER TYPE investment_status ADD VALUE IF NOT EXISTS 'cancelled';

-- ------------------------------------------------------------
-- 2. investment_payments — allocation columns
-- ------------------------------------------------------------
ALTER TABLE investment_payments
  ADD COLUMN IF NOT EXISTS series_id       UUID REFERENCES series(id),
  ADD COLUMN IF NOT EXISTS cycle_id        UUID REFERENCES cycles(id),
  -- Slots purchased by this payment. 0 = instalment toward the
  -- outstanding balance of an existing enrolment (legacy flow).
  ADD COLUMN IF NOT EXISTS units           NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status          TEXT NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS method          TEXT,
  ADD COLUMN IF NOT EXISTS notes           TEXT,
  ADD COLUMN IF NOT EXISTS reversed_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reversed_by     UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT,
  ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$ BEGIN
  ALTER TABLE investment_payments
    ADD CONSTRAINT investment_payments_status_check
    CHECK (status IN ('pending', 'confirmed', 'rejected', 'reversed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE investment_payments
    ADD CONSTRAINT investment_payments_units_check
    CHECK (units >= 0 AND FLOOR(units * 2) = units * 2);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Pending / rejected payments may exist before the enrolment does;
-- confirmed and reversed payments must always be allocated.
ALTER TABLE investment_payments ALTER COLUMN investment_id DROP NOT NULL;

DO $$ BEGIN
  ALTER TABLE investment_payments
    ADD CONSTRAINT investment_payments_allocated_check
    CHECK (status NOT IN ('confirmed', 'reversed') OR investment_id IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Backfill series/cycle from the linked enrolment
UPDATE investment_payments ip
SET series_id = i.series_id,
    cycle_id  = i.cycle_id
FROM investments i
WHERE i.id = ip.investment_id
  AND (ip.series_id IS NULL OR ip.cycle_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_investment_payments_cycle_id
  ON investment_payments(cycle_id);
CREATE INDEX IF NOT EXISTS idx_investment_payments_status
  ON investment_payments(status);

-- Duplicate payment references are rejected (case-insensitive) for
-- live payments. Wrapped so pre-existing duplicate data cannot make
-- the migration fail — the functions below also check explicitly.
DO $$ BEGIN
  CREATE UNIQUE INDEX uq_investment_payments_reference
    ON investment_payments (LOWER(TRIM(reference)))
    WHERE reference IS NOT NULL
      AND TRIM(reference) <> ''
      AND status IN ('pending', 'confirmed');
EXCEPTION
  WHEN unique_violation THEN
    RAISE NOTICE 'uq_investment_payments_reference skipped: duplicate references already exist';
  WHEN duplicate_table THEN NULL;
END $$;

-- ------------------------------------------------------------
-- 3. Allow units = 0 on cancelled (fully reversed) enrolments
-- ------------------------------------------------------------
ALTER TABLE investments DROP CONSTRAINT IF EXISTS investments_units_check;
ALTER TABLE investments
  ADD CONSTRAINT investments_units_check
  CHECK (
    (units >= 0.5 AND FLOOR(units * 2) = units * 2)
    OR (units = 0 AND status::text = 'cancelled')
  );

-- ------------------------------------------------------------
-- 4. Cycle totals trigger: handle UPDATE (top-ups, moves,
--    reversals, cancellation) — previously INSERT/DELETE only,
--    so a capital change on an existing enrolment never reached
--    the cycle totals.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_cycle_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text <> 'cancelled' THEN
      UPDATE cycles SET
        total_capital   = total_capital + NEW.capital,
        total_slots     = total_slots + NEW.units,
        total_investors = total_investors + 1,
        updated_at      = NOW()
      WHERE id = NEW.cycle_id;
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    IF OLD.status::text <> 'cancelled' THEN
      UPDATE cycles SET
        total_capital   = GREATEST(total_capital - OLD.capital, 0),
        total_slots     = GREATEST(total_slots - OLD.units, 0),
        total_investors = GREATEST(total_investors - 1, 0),
        updated_at      = NOW()
      WHERE id = OLD.cycle_id;
    END IF;
    RETURN OLD;

  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.cycle_id = NEW.cycle_id
       AND OLD.status::text <> 'cancelled'
       AND NEW.status::text <> 'cancelled' THEN
      IF OLD.capital <> NEW.capital OR OLD.units <> NEW.units THEN
        UPDATE cycles SET
          total_capital = GREATEST(total_capital - OLD.capital + NEW.capital, 0),
          total_slots   = GREATEST(total_slots - OLD.units + NEW.units, 0),
          updated_at    = NOW()
        WHERE id = NEW.cycle_id;
      END IF;
    ELSE
      -- Cycle move and/or cancellation: subtract from the old
      -- placement, add to the new one.
      IF OLD.status::text <> 'cancelled' THEN
        UPDATE cycles SET
          total_capital   = GREATEST(total_capital - OLD.capital, 0),
          total_slots     = GREATEST(total_slots - OLD.units, 0),
          total_investors = GREATEST(total_investors - 1, 0),
          updated_at      = NOW()
        WHERE id = OLD.cycle_id;
      END IF;
      IF NEW.status::text <> 'cancelled' THEN
        UPDATE cycles SET
          total_capital   = total_capital + NEW.capital,
          total_slots     = total_slots + NEW.units,
          total_investors = total_investors + 1,
          updated_at      = NOW()
        WHERE id = NEW.cycle_id;
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_cycle_totals_on_investment ON investments;
CREATE TRIGGER update_cycle_totals_on_investment
  AFTER INSERT OR UPDATE OR DELETE ON investments
  FOR EACH ROW EXECUTE FUNCTION update_cycle_totals();

-- ------------------------------------------------------------
-- 5. amount_received trigger: only CONFIRMED payments count,
--    and the payment's own cycle_id is authoritative.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION update_cycle_amount_received()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF OLD.status = 'confirmed' AND OLD.cycle_id IS NOT NULL THEN
      UPDATE cycles SET
        amount_received = GREATEST(amount_received - OLD.amount, 0),
        updated_at      = NOW()
      WHERE id = OLD.cycle_id;
    END IF;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    IF NEW.status = 'confirmed' AND NEW.cycle_id IS NOT NULL THEN
      UPDATE cycles SET
        amount_received = amount_received + NEW.amount,
        updated_at      = NOW()
      WHERE id = NEW.cycle_id;
    END IF;
    RETURN NEW;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_cycle_amount_received_on_payment ON investment_payments;
CREATE TRIGGER update_cycle_amount_received_on_payment
  AFTER INSERT OR UPDATE OR DELETE ON investment_payments
  FOR EACH ROW EXECUTE FUNCTION update_cycle_amount_received();

-- ------------------------------------------------------------
-- 6. Internal helpers
-- ------------------------------------------------------------

-- Admins allowed to manage investor payments
CREATE OR REPLACE FUNCTION assert_payment_admin()
RETURNS UUID AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT role::text INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator', 'finance') THEN
    RAISE EXCEPTION 'You do not have permission to manage investor payments';
  END IF;
  RETURN v_uid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Case-insensitive duplicate reference guard
CREATE OR REPLACE FUNCTION assert_reference_available(
  p_reference  TEXT,
  p_exclude_id UUID DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  IF p_reference IS NULL OR TRIM(p_reference) = '' THEN
    RETURN;
  END IF;
  IF EXISTS (
    SELECT 1 FROM investment_payments
    WHERE LOWER(TRIM(reference)) = LOWER(TRIM(p_reference))
      AND status IN ('pending', 'confirmed')
      AND (p_exclude_id IS NULL OR id <> p_exclude_id)
  ) THEN
    RAISE EXCEPTION 'A payment with reference "%" already exists', TRIM(p_reference);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Find (locked) or create the investor's enrolment in a cycle and
-- apply an allocation delta to it. Returns the investment id.
CREATE OR REPLACE FUNCTION apply_payment_allocation(
  p_investor_id  UUID,
  p_series_id    UUID,
  p_cycle_id     UUID,
  p_amount       NUMERIC,
  p_units        NUMERIC,
  p_payment_date DATE,
  p_actor        UUID
)
RETURNS UUID AS $$
DECLARE
  v_series   series%ROWTYPE;
  v_cycle    cycles%ROWTYPE;
  v_investor investors%ROWTYPE;
  v_inv      investments%ROWTYPE;
  v_code     TEXT;
  v_count    INTEGER;
BEGIN
  SELECT * INTO v_series FROM series WHERE id = p_series_id;
  SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id;
  SELECT * INTO v_investor FROM investors WHERE id = p_investor_id;

  SELECT * INTO v_inv
  FROM investments
  WHERE investor_id = p_investor_id
    AND cycle_id = p_cycle_id
    AND status::text = 'active'
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    -- Existing enrolment: never duplicate — top it up.
    IF p_units > 0 THEN
      UPDATE investments SET
        units      = units + p_units,
        capital    = capital + p_amount,
        updated_at = NOW()
      WHERE id = v_inv.id;
    END IF;
    RETURN v_inv.id;
  END IF;

  IF p_units < 0.5 THEN
    RAISE EXCEPTION 'This investor has no active enrolment in the selected cycle. An instalment payment (0 slots) needs an existing enrolment.';
  END IF;

  -- New enrolment for this investor + series + cycle
  v_code := generate_investment_code(
    v_series.name::text, v_cycle.cycle_number, v_investor.investor_code
  );
  SELECT COUNT(*) INTO v_count
  FROM investments WHERE investment_code LIKE v_code || '%';
  IF v_count > 0 THEN
    v_code := v_code || '-' || (v_count + 1);
  END IF;

  INSERT INTO investments (
    investment_code, investor_id, series_id, cycle_id,
    units, price_per_unit, capital,
    investment_date, maturity_date, status, created_by
  ) VALUES (
    v_code, p_investor_id, p_series_id, p_cycle_id,
    p_units, v_series.price_per_unit, p_amount,
    p_payment_date, v_cycle.end_date, 'active', p_actor
  )
  RETURNING * INTO v_inv;

  RETURN v_inv.id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Undo an allocation (reversal, or the "remove" half of an edit).
CREATE OR REPLACE FUNCTION remove_payment_allocation(
  p_investment_id UUID,
  p_amount        NUMERIC,
  p_units         NUMERIC
)
RETURNS VOID AS $$
DECLARE
  v_inv investments%ROWTYPE;
BEGIN
  IF p_units <= 0 THEN
    RETURN; -- instalments never changed the enrolment
  END IF;

  SELECT * INTO v_inv FROM investments WHERE id = p_investment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment for this payment no longer exists';
  END IF;

  IF v_inv.units - p_units < 0 OR v_inv.capital - p_amount < -0.005 THEN
    RAISE EXCEPTION 'Cannot remove this payment: the enrolment only has % slots / ₦% left (slots may have been withdrawn already)',
      v_inv.units, v_inv.capital;
  END IF;

  IF v_inv.units - p_units = 0 THEN
    IF ROUND(v_inv.capital - p_amount, 2) <> 0 THEN
      RAISE EXCEPTION 'Cannot remove this payment: it would leave ₦% of capital with 0 slots. Adjust the enrolment first.',
        ROUND(v_inv.capital - p_amount, 2);
    END IF;
    UPDATE investments SET
      units      = 0,
      capital    = 0,
      status     = 'cancelled',
      updated_at = NOW()
    WHERE id = p_investment_id;
  ELSE
    UPDATE investments SET
      units      = units - p_units,
      capital    = capital - p_amount,
      updated_at = NOW()
    WHERE id = p_investment_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Shared validation for a payment targeting a series/cycle
CREATE OR REPLACE FUNCTION validate_payment_target(
  p_investor_id UUID,
  p_series_id   UUID,
  p_cycle_id    UUID,
  p_amount      NUMERIC,
  p_units       NUMERIC,
  p_new_allocation BOOLEAN
)
RETURNS VOID AS $$
DECLARE
  v_series series%ROWTYPE;
  v_cycle  cycles%ROWTYPE;
BEGIN
  IF p_investor_id IS NULL THEN
    RAISE EXCEPTION 'Investor is required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM investors WHERE id = p_investor_id) THEN
    RAISE EXCEPTION 'Investor not found';
  END IF;
  IF p_series_id IS NULL THEN
    RAISE EXCEPTION 'Select a series for this payment';
  END IF;
  IF p_cycle_id IS NULL THEN
    RAISE EXCEPTION 'Select a cycle for this payment';
  END IF;

  SELECT * INTO v_series FROM series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series not found';
  END IF;

  SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;
  IF v_cycle.series_id <> p_series_id THEN
    RAISE EXCEPTION 'The selected cycle does not belong to the selected series';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Payment amount must be greater than 0';
  END IF;

  IF p_new_allocation THEN
    IF NOT v_series.is_active THEN
      RAISE EXCEPTION 'Series % is inactive and cannot receive new allocations', v_series.name;
    END IF;
    IF v_cycle.status::text NOT IN ('upcoming', 'active', 'subscription_open') THEN
      RAISE EXCEPTION 'Cycle % is % and cannot receive new allocations', v_cycle.cycle_label, v_cycle.status;
    END IF;
    IF p_units IS NULL OR p_units < 0.5 OR FLOOR(p_units * 2) <> p_units * 2 THEN
      RAISE EXCEPTION 'Slots must be at least 0.5, in steps of 0.5';
    END IF;
    IF ROUND(p_units * v_series.price_per_unit, 2) <> ROUND(p_amount, 2) THEN
      RAISE EXCEPTION 'Amount ₦% does not match % slot(s) at ₦% per slot (expected ₦%)',
        TO_CHAR(p_amount, 'FM999,999,999,990.00'),
        p_units,
        TO_CHAR(v_series.price_per_unit, 'FM999,999,999,990.00'),
        TO_CHAR(p_units * v_series.price_per_unit, 'FM999,999,999,990.00');
    END IF;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Summary returned to the UI after every mutation
CREATE OR REPLACE FUNCTION investor_payment_summary(
  p_investor_id UUID,
  p_payment_id  UUID
)
RETURNS JSONB AS $$
DECLARE
  v_pay     investment_payments%ROWTYPE;
  v_inv     investments%ROWTYPE;
  v_totals  RECORD;
BEGIN
  SELECT * INTO v_pay FROM investment_payments WHERE id = p_payment_id;
  IF v_pay.investment_id IS NOT NULL THEN
    SELECT * INTO v_inv FROM investments WHERE id = v_pay.investment_id;
  END IF;

  SELECT
    COALESCE(SUM(capital) FILTER (WHERE status::text = 'active'), 0) AS active_capital,
    COALESCE(SUM(units)   FILTER (WHERE status::text = 'active'), 0) AS active_units
  INTO v_totals
  FROM investments
  WHERE investor_id = p_investor_id;

  RETURN jsonb_build_object(
    'payment_id',       v_pay.id,
    'payment_status',   v_pay.status,
    'amount',           v_pay.amount,
    'units',            v_pay.units,
    'investment_id',    v_pay.investment_id,
    'investment_code',  v_inv.investment_code,
    'enrolment_units',  v_inv.units,
    'enrolment_capital', v_inv.capital,
    'investor_active_capital', v_totals.active_capital,
    'investor_active_units',   v_totals.active_units
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 7. record_investor_payment — the single entry point for
--    "Add New Payment". One transaction: payment + enrolment +
--    cycle totals + audit log.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_investor_payment(
  p_investor_id  UUID,
  p_series_id    UUID,
  p_cycle_id     UUID,
  p_amount       NUMERIC,
  p_units        NUMERIC,
  p_payment_date DATE,
  p_method       TEXT DEFAULT NULL,
  p_reference    TEXT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL,
  p_status       TEXT DEFAULT 'confirmed',
  p_apply_to_outstanding BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
  v_actor         UUID;
  v_units         NUMERIC := COALESCE(p_units, 0);
  v_investment_id UUID;
  v_inv           investments%ROWTYPE;
  v_outstanding   NUMERIC;
  v_payment_id    UUID;
BEGIN
  v_actor := assert_payment_admin();

  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;
  IF p_status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'A new payment can only be saved as pending or confirmed';
  END IF;

  PERFORM assert_reference_available(p_reference);

  IF p_apply_to_outstanding THEN
    -- Instalment toward the outstanding balance of an existing
    -- enrolment: adds no slots and no capital.
    v_units := 0;
    PERFORM validate_payment_target(
      p_investor_id, p_series_id, p_cycle_id, p_amount, NULL, FALSE
    );

    SELECT * INTO v_inv
    FROM investments
    WHERE investor_id = p_investor_id
      AND cycle_id = p_cycle_id
      AND status::text IN ('active', 'matured')
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This investor has no enrolment in the selected cycle to apply an instalment to';
    END IF;

    SELECT v_inv.capital - COALESCE(SUM(amount), 0) INTO v_outstanding
    FROM investment_payments
    WHERE investment_id = v_inv.id AND status = 'confirmed';

    IF ROUND(p_amount, 2) > ROUND(v_outstanding, 2) THEN
      RAISE EXCEPTION 'Instalment ₦% exceeds the outstanding balance of ₦%',
        TO_CHAR(p_amount, 'FM999,999,999,990.00'),
        TO_CHAR(GREATEST(v_outstanding, 0), 'FM999,999,999,990.00');
    END IF;

    v_investment_id := v_inv.id;
  ELSE
    PERFORM validate_payment_target(
      p_investor_id, p_series_id, p_cycle_id, p_amount, v_units, TRUE
    );

    IF p_status = 'confirmed' THEN
      v_investment_id := apply_payment_allocation(
        p_investor_id, p_series_id, p_cycle_id,
        p_amount, v_units, p_payment_date, v_actor
      );
    ELSE
      -- Pending: no allocation yet; link the enrolment if one exists
      SELECT id INTO v_investment_id
      FROM investments
      WHERE investor_id = p_investor_id
        AND cycle_id = p_cycle_id
        AND status::text = 'active'
      ORDER BY created_at
      LIMIT 1;
    END IF;
  END IF;

  INSERT INTO investment_payments (
    investment_id, investor_id, series_id, cycle_id,
    amount, units, payment_date, method, reference, notes,
    status, created_by
  ) VALUES (
    v_investment_id, p_investor_id, p_series_id, p_cycle_id,
    p_amount, v_units, p_payment_date,
    NULLIF(TRIM(COALESCE(p_method, '')), ''),
    NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    p_status, v_actor
  )
  RETURNING id INTO v_payment_id;

  PERFORM create_audit_log(
    'payment_recorded',
    'investment_payment',
    v_payment_id::text,
    NULL,
    jsonb_build_object(
      'investor_id', p_investor_id,
      'series_id', p_series_id,
      'cycle_id', p_cycle_id,
      'amount', p_amount,
      'units', v_units,
      'status', p_status,
      'payment_date', p_payment_date,
      'reference', p_reference,
      'apply_to_outstanding', p_apply_to_outstanding,
      'investment_id', v_investment_id
    )
  );

  RETURN investor_payment_summary(p_investor_id, v_payment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 8. confirm / reject a pending payment
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION confirm_investor_payment(p_payment_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_actor UUID;
  v_pay   investment_payments%ROWTYPE;
  v_investment_id UUID;
BEGIN
  v_actor := assert_payment_admin();

  SELECT * INTO v_pay FROM investment_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_pay.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending payments can be confirmed (this one is %)', v_pay.status;
  END IF;

  IF v_pay.units > 0 THEN
    PERFORM validate_payment_target(
      v_pay.investor_id, v_pay.series_id, v_pay.cycle_id,
      v_pay.amount, v_pay.units, TRUE
    );
    v_investment_id := apply_payment_allocation(
      v_pay.investor_id, v_pay.series_id, v_pay.cycle_id,
      v_pay.amount, v_pay.units, v_pay.payment_date, v_actor
    );
  ELSE
    v_investment_id := v_pay.investment_id;
    IF v_investment_id IS NULL THEN
      RAISE EXCEPTION 'This instalment payment has no enrolment to apply to';
    END IF;
  END IF;

  UPDATE investment_payments SET
    status        = 'confirmed',
    investment_id = v_investment_id,
    updated_at    = NOW()
  WHERE id = p_payment_id;

  PERFORM create_audit_log(
    'payment_confirmed', 'investment_payment', p_payment_id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'confirmed', 'investment_id', v_investment_id)
  );

  RETURN investor_payment_summary(v_pay.investor_id, p_payment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION reject_investor_payment(
  p_payment_id UUID,
  p_reason     TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_pay investment_payments%ROWTYPE;
BEGIN
  PERFORM assert_payment_admin();

  SELECT * INTO v_pay FROM investment_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_pay.status <> 'pending' THEN
    RAISE EXCEPTION 'Only pending payments can be rejected (this one is %)', v_pay.status;
  END IF;

  UPDATE investment_payments SET
    status          = 'rejected',
    reversal_reason = NULLIF(TRIM(COALESCE(p_reason, '')), ''),
    updated_at      = NOW()
  WHERE id = p_payment_id;

  PERFORM create_audit_log(
    'payment_rejected', 'investment_payment', p_payment_id::text,
    jsonb_build_object('status', 'pending'),
    jsonb_build_object('status', 'rejected', 'reason', p_reason)
  );

  RETURN investor_payment_summary(v_pay.investor_id, p_payment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 9. reverse_investor_payment — undo a confirmed payment.
--    The payment row is kept (audit trail); the allocation is
--    removed and totals recalculated. Never deletes records.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reverse_investor_payment(
  p_payment_id UUID,
  p_reason     TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_actor UUID;
  v_pay   investment_payments%ROWTYPE;
BEGIN
  v_actor := assert_payment_admin();

  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to reverse a payment';
  END IF;

  SELECT * INTO v_pay FROM investment_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_pay.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed payments can be reversed (this one is %)', v_pay.status;
  END IF;

  PERFORM remove_payment_allocation(v_pay.investment_id, v_pay.amount, v_pay.units);

  UPDATE investment_payments SET
    status          = 'reversed',
    reversed_at     = NOW(),
    reversed_by     = v_actor,
    reversal_reason = TRIM(p_reason),
    updated_at      = NOW()
  WHERE id = p_payment_id;

  PERFORM create_audit_log(
    'payment_reversed', 'investment_payment', p_payment_id::text,
    jsonb_build_object('status', 'confirmed', 'amount', v_pay.amount, 'units', v_pay.units),
    jsonb_build_object('status', 'reversed', 'reason', TRIM(p_reason))
  );

  RETURN investor_payment_summary(v_pay.investor_id, p_payment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 10. edit_investor_payment — change amount / slots / dates /
--     series / cycle. For confirmed payments the old allocation
--     is removed and the new one applied, both sides' totals
--     recalculated, in one transaction.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION edit_investor_payment(
  p_payment_id   UUID,
  p_series_id    UUID,
  p_cycle_id     UUID,
  p_amount       NUMERIC,
  p_units        NUMERIC,
  p_payment_date DATE,
  p_method       TEXT DEFAULT NULL,
  p_reference    TEXT DEFAULT NULL,
  p_notes        TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_actor         UUID;
  v_pay           investment_payments%ROWTYPE;
  v_units         NUMERIC := COALESCE(p_units, 0);
  v_investment_id UUID;
BEGIN
  v_actor := assert_payment_admin();

  SELECT * INTO v_pay FROM investment_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF v_pay.status NOT IN ('pending', 'confirmed') THEN
    RAISE EXCEPTION 'Only pending or confirmed payments can be edited (this one is %)', v_pay.status;
  END IF;
  IF p_payment_date IS NULL THEN
    RAISE EXCEPTION 'Payment date is required';
  END IF;

  PERFORM assert_reference_available(p_reference, p_payment_id);

  IF v_pay.units = 0 THEN
    -- Instalment: amount/date/method/reference/notes only.
    IF p_series_id IS DISTINCT FROM v_pay.series_id
       OR p_cycle_id IS DISTINCT FROM v_pay.cycle_id THEN
      RAISE EXCEPTION 'An instalment payment cannot be moved to another series or cycle';
    END IF;
    IF v_units <> 0 THEN
      RAISE EXCEPTION 'An instalment payment has no slots; record a new allocation payment instead';
    END IF;
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'Payment amount must be greater than 0';
    END IF;
    v_investment_id := v_pay.investment_id;
  ELSE
    PERFORM validate_payment_target(
      v_pay.investor_id, p_series_id, p_cycle_id, p_amount, v_units, TRUE
    );

    IF v_pay.status = 'confirmed' THEN
      -- Remove from the old enrolment, apply to the (possibly
      -- different) new one.
      PERFORM remove_payment_allocation(v_pay.investment_id, v_pay.amount, v_pay.units);
      v_investment_id := apply_payment_allocation(
        v_pay.investor_id, p_series_id, p_cycle_id,
        p_amount, v_units, p_payment_date, v_actor
      );
    ELSE
      SELECT id INTO v_investment_id
      FROM investments
      WHERE investor_id = v_pay.investor_id
        AND cycle_id = p_cycle_id
        AND status::text = 'active'
      ORDER BY created_at
      LIMIT 1;
    END IF;
  END IF;

  UPDATE investment_payments SET
    series_id     = p_series_id,
    cycle_id      = p_cycle_id,
    investment_id = v_investment_id,
    amount        = p_amount,
    units         = v_units,
    payment_date  = p_payment_date,
    method        = NULLIF(TRIM(COALESCE(p_method, '')), ''),
    reference     = NULLIF(TRIM(COALESCE(p_reference, '')), ''),
    notes         = NULLIF(TRIM(COALESCE(p_notes, '')), ''),
    updated_at    = NOW()
  WHERE id = p_payment_id;

  PERFORM create_audit_log(
    'payment_edited', 'investment_payment', p_payment_id::text,
    jsonb_build_object(
      'series_id', v_pay.series_id, 'cycle_id', v_pay.cycle_id,
      'amount', v_pay.amount, 'units', v_pay.units,
      'payment_date', v_pay.payment_date, 'reference', v_pay.reference
    ),
    jsonb_build_object(
      'series_id', p_series_id, 'cycle_id', p_cycle_id,
      'amount', p_amount, 'units', v_units,
      'payment_date', p_payment_date, 'reference', p_reference
    )
  );

  RETURN investor_payment_summary(v_pay.investor_id, p_payment_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 11. Lock down direct function access: the role check inside
--     each function is the gate; anon gets nothing extra.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION apply_payment_allocation(UUID, UUID, UUID, NUMERIC, NUMERIC, DATE, UUID) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION remove_payment_allocation(UUID, NUMERIC, NUMERIC) FROM anon, authenticated;
  END IF;
END $$;
