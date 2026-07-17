-- ============================================================
-- Migration 007 – Investor Onboarding System
-- ============================================================
-- Adds invitation_status tracking on investors,
-- total_slots + amount_received on cycles, updated trigger
-- functions, and fixes the double-counting bug in
-- submit_maturity_decision.
-- ============================================================

-- ============================================================
-- 1. Invitation Status Enum
-- ============================================================

DO $$ BEGIN
  CREATE TYPE invitation_status AS ENUM (
    'not_sent',
    'sent',
    'activated',
    'expired',
    'failed'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================
-- 2. Add invitation columns to investors
-- ============================================================

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS invitation_status invitation_status NOT NULL DEFAULT 'not_sent',
  ADD COLUMN IF NOT EXISTS invitation_sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invitation_expires_at TIMESTAMPTZ;

-- ============================================================
-- 3. Add total_slots and amount_received to cycles
-- ============================================================

ALTER TABLE cycles
  ADD COLUMN IF NOT EXISTS total_slots NUMERIC(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS amount_received NUMERIC(20,2) NOT NULL DEFAULT 0;

-- Backfill total_slots from existing investments
UPDATE cycles c
SET total_slots = COALESCE((
  SELECT SUM(i.units)
  FROM investments i
  WHERE i.cycle_id = c.id
), 0);

-- Backfill amount_received from existing investment_payments
UPDATE cycles c
SET amount_received = COALESCE((
  SELECT SUM(ip.amount)
  FROM investment_payments ip
  JOIN investments i ON i.id = ip.investment_id
  WHERE i.cycle_id = c.id
), 0);

-- ============================================================
-- 4. Update cycle totals trigger to include total_slots
-- ============================================================

CREATE OR REPLACE FUNCTION update_cycle_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE cycles SET
      total_capital = total_capital + NEW.capital,
      total_slots = total_slots + NEW.units,
      total_investors = total_investors + 1,
      updated_at = NOW()
    WHERE id = NEW.cycle_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE cycles SET
      total_capital = GREATEST(total_capital - OLD.capital, 0),
      total_slots = GREATEST(total_slots - OLD.units, 0),
      total_investors = GREATEST(total_investors - 1, 0),
      updated_at = NOW()
    WHERE id = OLD.cycle_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Trigger on investment_payments to track amount_received
-- ============================================================

CREATE OR REPLACE FUNCTION update_cycle_amount_received()
RETURNS TRIGGER AS $$
DECLARE
  v_cycle_id UUID;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT cycle_id INTO v_cycle_id FROM investments WHERE id = NEW.investment_id;
    IF FOUND AND v_cycle_id IS NOT NULL THEN
      UPDATE cycles SET
        amount_received = amount_received + NEW.amount,
        updated_at = NOW()
      WHERE id = v_cycle_id;
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT cycle_id INTO v_cycle_id FROM investments WHERE id = OLD.investment_id;
    IF FOUND AND v_cycle_id IS NOT NULL THEN
      UPDATE cycles SET
        amount_received = GREATEST(amount_received - OLD.amount, 0),
        updated_at = NOW()
      WHERE id = v_cycle_id;
    END IF;
    RETURN OLD;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT cycle_id INTO v_cycle_id FROM investments WHERE id = NEW.investment_id;
    IF FOUND AND v_cycle_id IS NOT NULL THEN
      UPDATE cycles SET
        amount_received = GREATEST(amount_received - OLD.amount + NEW.amount, 0),
        updated_at = NOW()
      WHERE id = v_cycle_id;
    END IF;
    RETURN NEW;
  END IF;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_cycle_amount_received_on_payment ON investment_payments;
CREATE TRIGGER update_cycle_amount_received_on_payment
  AFTER INSERT OR UPDATE OR DELETE ON investment_payments
  FOR EACH ROW EXECUTE FUNCTION update_cycle_amount_received();

-- ============================================================
-- 6. Fix double-counting bug in submit_maturity_decision
--    The 'continue' branch manually updated cycle totals, but
--    the update_cycle_totals trigger also fires on INSERT into
--    investments. Removing the manual UPDATE eliminates the
--    double-count. The trigger now handles total_slots too.
-- ============================================================

CREATE OR REPLACE FUNCTION submit_maturity_decision(
  p_investment_id  UUID,
  p_decision       maturity_decision,
  p_bank_name      TEXT,
  p_account_name   TEXT,
  p_account_number TEXT,
  p_notes          TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_investment        investments%ROWTYPE;
  v_series            series%ROWTYPE;
  v_current_cycle     cycles%ROWTYPE;
  v_next_cycle        cycles%ROWTYPE;
  v_investor          investors%ROWTYPE;
  v_roi_request_id    UUID;
  v_cap_request_id    UUID;
  v_new_investment_id UUID;
  v_next_cycle_id     UUID;
  v_new_inv_code      TEXT;
  v_roi_pay_code      TEXT;
  v_cap_pay_code      TEXT;
BEGIN
  SELECT * INTO v_investment FROM investments WHERE id = p_investment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment not found';
  END IF;

  IF v_investment.status != 'matured' THEN
    RAISE EXCEPTION 'Investment is not in matured status';
  END IF;

  IF v_investment.maturity_decision IS NOT NULL THEN
    RAISE EXCEPTION 'Maturity decision already submitted';
  END IF;

  SELECT * INTO v_investor FROM investors WHERE id = v_investment.investor_id;
  IF v_investor.profile_id != auth.uid() AND NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_series FROM series WHERE id = v_investment.series_id;
  SELECT * INTO v_current_cycle FROM cycles WHERE id = v_investment.cycle_id;

  v_roi_pay_code := generate_payment_code('roi');

  INSERT INTO payment_requests (
    request_code, investor_id, investment_id, type, amount,
    bank_name, account_name, account_number, notes
  ) VALUES (
    v_roi_pay_code, v_investment.investor_id, v_investment.id, 'roi',
    v_investment.expected_roi, p_bank_name, p_account_name, p_account_number, p_notes
  ) RETURNING id INTO v_roi_request_id;

  IF p_decision = 'exit' THEN
    v_cap_pay_code := generate_payment_code('capital');
    INSERT INTO payment_requests (
      request_code, investor_id, investment_id, type, amount,
      bank_name, account_name, account_number, notes
    ) VALUES (
      v_cap_pay_code, v_investment.investor_id, v_investment.id, 'capital',
      v_investment.capital, p_bank_name, p_account_name, p_account_number, p_notes
    ) RETURNING id INTO v_cap_request_id;

    UPDATE investments SET
      status = 'completed',
      maturity_decision = 'exit',
      maturity_decided_at = NOW(),
      updated_at = NOW()
    WHERE id = p_investment_id;

    PERFORM create_notification(
      v_investor.profile_id,
      'Exit Decision Submitted',
      FORMAT('Your exit decision for %s has been submitted. ROI and capital payment requests are pending approval.', v_investment.investment_code),
      'payment',
      '/payment-requests'
    );

  ELSIF p_decision = 'continue' THEN
    SELECT * INTO v_next_cycle
    FROM cycles
    WHERE series_id = v_investment.series_id
      AND start_date = v_current_cycle.end_date
    LIMIT 1;

    IF NOT FOUND THEN
      v_next_cycle_id := create_next_cycle(v_investment.series_id);
      SELECT * INTO v_next_cycle FROM cycles WHERE id = v_next_cycle_id;
    END IF;

    IF v_next_cycle.status = 'upcoming' THEN
      UPDATE cycles SET status = 'active', updated_at = NOW()
      WHERE id = v_next_cycle.id;
    END IF;

    v_new_inv_code := generate_investment_code(
      v_series.name::TEXT,
      v_next_cycle.cycle_number,
      v_investor.investor_code
    );

    -- The update_cycle_totals trigger fires on this INSERT and updates
    -- total_capital, total_slots, and total_investors automatically.
    -- Do NOT manually update cycle totals here.
    INSERT INTO investments (
      investment_code, investor_id, series_id, cycle_id,
      units, price_per_unit, capital, roi_rate, expected_roi,
      investment_date, maturity_date, status,
      parent_investment_id, created_by
    ) VALUES (
      v_new_inv_code, v_investment.investor_id, v_investment.series_id, v_next_cycle.id,
      v_investment.units, v_series.price_per_unit, v_investment.capital,
      v_series.roi_rate, v_investment.capital * v_series.roi_rate,
      v_next_cycle.start_date, v_next_cycle.end_date, 'active',
      p_investment_id, auth.uid()
    ) RETURNING id INTO v_new_investment_id;

    UPDATE investments SET
      status = 'completed',
      maturity_decision = 'continue',
      maturity_decided_at = NOW(),
      next_investment_id = v_new_investment_id,
      updated_at = NOW()
    WHERE id = p_investment_id;

    PERFORM create_notification(
      v_investor.profile_id,
      'Capital Rolled Into Next Cycle',
      FORMAT('Your capital has been rolled into %s (Series %s). ROI payment is pending approval.',
        v_next_cycle.cycle_label, v_series.name),
      'investment',
      FORMAT('/investments/%s', v_new_investment_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'decision', p_decision,
    'roi_request_id', v_roi_request_id,
    'capital_request_id', v_cap_request_id,
    'new_investment_id', v_new_investment_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
