-- ============================================================
-- Migration 005 – Mudarabah Profit Declaration
-- Removes fixed ROI and adds cycle-level profit declaration
-- ============================================================

-- ============================================================
-- 1. Add awaiting_profit_declaration to cycle_status enum
-- ============================================================

ALTER TYPE cycle_status ADD VALUE IF NOT EXISTS 'awaiting_profit_declaration';

-- ============================================================
-- 2. Drop the view that depends on investments.expected_roi
--    (also recreated in migration 004 — safe to drop again)
-- ============================================================

DROP VIEW IF EXISTS investment_summary;

-- ============================================================
-- 3. Rewrite process_matured_investments() — now cycle-based
--    Sets cycles to awaiting_profit_declaration when end_date
--    has passed; does NOT touch individual investments.
-- ============================================================

CREATE OR REPLACE FUNCTION process_matured_investments()
RETURNS INTEGER AS $$
DECLARE
  v_cycle   cycles%ROWTYPE;
  v_count   INTEGER := 0;
BEGIN
  FOR v_cycle IN
    SELECT * FROM cycles
    WHERE status = 'active'
      AND end_date <= CURRENT_DATE
    ORDER BY end_date ASC
  LOOP
    UPDATE cycles
    SET status = 'awaiting_profit_declaration', updated_at = NOW()
    WHERE id = v_cycle.id;

    -- Notify all admin users
    INSERT INTO notifications (user_id, title, message, type, action_url)
    SELECT p.id,
      'Cycle Matured — Profit Declaration Required',
      FORMAT(
        'Cycle %s has reached maturity. Please declare the final profit before investor reports can be generated.',
        v_cycle.cycle_label
      ),
      'maturity',
      FORMAT('/admin/cycles/%s/declare-profit', v_cycle.id)
    FROM profiles p
    WHERE p.role IN ('super_admin', 'administrator', 'finance')
      AND p.is_active = TRUE;

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 4. Update submit_maturity_decision() — uses declared_profit
--    instead of expected_roi; new investments created without
--    roi_rate or expected_roi columns.
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
  v_profit_request_id UUID;
  v_cap_request_id    UUID;
  v_new_investment_id UUID;
  v_next_cycle_id     UUID;
  v_new_inv_code      TEXT;
  v_profit_pay_code   TEXT;
  v_cap_pay_code      TEXT;
BEGIN
  -- Validate investment
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

  IF v_investment.declared_profit IS NULL THEN
    RAISE EXCEPTION 'Profit has not yet been declared for this investment. Please wait for the cycle profit declaration.';
  END IF;

  -- Verify this investor owns this investment
  SELECT * INTO v_investor FROM investors WHERE id = v_investment.investor_id;
  IF v_investor.profile_id != auth.uid() AND NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get series and cycle
  SELECT * INTO v_series FROM series WHERE id = v_investment.series_id;
  SELECT * INTO v_current_cycle FROM cycles WHERE id = v_investment.cycle_id;

  -- Generate profit payment code
  v_profit_pay_code := generate_payment_code('roi');

  -- Create profit payment request (always created)
  INSERT INTO payment_requests (
    request_code, investor_id, investment_id, type, amount,
    bank_name, account_name, account_number, notes
  ) VALUES (
    v_profit_pay_code, v_investment.investor_id, v_investment.id, 'roi',
    v_investment.declared_profit, p_bank_name, p_account_name, p_account_number, p_notes
  ) RETURNING id INTO v_profit_request_id;

  IF p_decision = 'exit' THEN
    -- Create capital payment request
    v_cap_pay_code := generate_payment_code('capital');
    INSERT INTO payment_requests (
      request_code, investor_id, investment_id, type, amount,
      bank_name, account_name, account_number, notes
    ) VALUES (
      v_cap_pay_code, v_investment.investor_id, v_investment.id, 'capital',
      v_investment.capital, p_bank_name, p_account_name, p_account_number, p_notes
    ) RETURNING id INTO v_cap_request_id;

    -- Update investment
    UPDATE investments SET
      status = 'completed',
      maturity_decision = 'exit',
      maturity_decided_at = NOW(),
      updated_at = NOW()
    WHERE id = p_investment_id;

    PERFORM create_notification(
      v_investor.profile_id,
      'Exit Decision Submitted',
      FORMAT(
        'Your exit decision for %s has been submitted. Profit and capital payment requests are pending approval.',
        v_investment.investment_code
      ),
      'payment',
      '/payment-requests'
    );

  ELSIF p_decision = 'continue' THEN
    -- Find or create next cycle
    SELECT * INTO v_next_cycle
    FROM cycles
    WHERE series_id = v_investment.series_id
      AND start_date = v_current_cycle.end_date
    LIMIT 1;

    IF NOT FOUND THEN
      v_next_cycle_id := create_next_cycle(v_investment.series_id);
      SELECT * INTO v_next_cycle FROM cycles WHERE id = v_next_cycle_id;
    END IF;

    -- Activate next cycle if upcoming
    IF v_next_cycle.status = 'upcoming' THEN
      UPDATE cycles SET status = 'active', updated_at = NOW()
      WHERE id = v_next_cycle.id;
    END IF;

    -- Generate new investment code
    v_new_inv_code := generate_investment_code(
      v_series.name::TEXT,
      v_next_cycle.cycle_number,
      v_investor.investor_code
    );

    -- Create new investment in next cycle (no declared_profit yet — declared at cycle end)
    INSERT INTO investments (
      investment_code, investor_id, series_id, cycle_id,
      units, price_per_unit, capital,
      investment_date, maturity_date, status,
      parent_investment_id, created_by
    ) VALUES (
      v_new_inv_code, v_investment.investor_id, v_investment.series_id, v_next_cycle.id,
      v_investment.units, v_series.price_per_unit, v_investment.capital,
      v_next_cycle.start_date, v_next_cycle.end_date, 'active',
      p_investment_id, auth.uid()
    ) RETURNING id INTO v_new_investment_id;

    -- Update parent investment
    UPDATE investments SET
      status = 'completed',
      maturity_decision = 'continue',
      maturity_decided_at = NOW(),
      next_investment_id = v_new_investment_id,
      updated_at = NOW()
    WHERE id = p_investment_id;

    -- Update next cycle totals
    UPDATE cycles SET
      total_capital = total_capital + v_investment.capital,
      total_investors = total_investors + 1,
      updated_at = NOW()
    WHERE id = v_next_cycle.id;

    PERFORM create_notification(
      v_investor.profile_id,
      'Capital Rolled Into Next Cycle',
      FORMAT(
        'Your capital of ₦%s has been rolled into %s (Series %s). Your profit payment is pending approval.',
        v_investment.capital::TEXT, v_next_cycle.cycle_label, v_series.name
      ),
      'investment',
      FORMAT('/investments/%s', v_new_investment_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'decision', p_decision,
    'profit_request_id', v_profit_request_id,
    'capital_request_id', v_cap_request_id,
    'new_investment_id', v_new_investment_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 5. Alter investments table
--    Remove roi_rate and expected_roi; add declared_profit
-- ============================================================

ALTER TABLE investments DROP COLUMN IF EXISTS roi_rate;
ALTER TABLE investments DROP COLUMN IF EXISTS expected_roi;
ALTER TABLE investments ADD COLUMN IF NOT EXISTS declared_profit NUMERIC(20,2) NULL;

-- ============================================================
-- 6. Alter series table
--    Replace roi_rate with mudarabah_investor_ratio
--    (the fraction of profit allocated to all investors)
--    Default 0.70 = 70% to investors, 30% to company
-- ============================================================

ALTER TABLE series
  ADD COLUMN IF NOT EXISTS mudarabah_investor_ratio NUMERIC(5,4)
  NOT NULL DEFAULT 0.70;

ALTER TABLE series
  ADD CONSTRAINT series_mudarabah_ratio_check
  CHECK (mudarabah_investor_ratio > 0 AND mudarabah_investor_ratio < 1)
  NOT VALID;

ALTER TABLE series DROP COLUMN IF EXISTS roi_rate;

-- ============================================================
-- 7. Create cycle_profit_declarations table
--    Stores the admin-entered profit data per cycle
-- ============================================================

CREATE TABLE IF NOT EXISTS cycle_profit_declarations (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id              UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  total_revenue         NUMERIC(20,2) NOT NULL CHECK (total_revenue >= 0),
  total_expenses        NUMERIC(20,2) NOT NULL CHECK (total_expenses >= 0),
  net_profit            NUMERIC(20,2) NOT NULL,
  investor_profit_share NUMERIC(20,2) NOT NULL CHECK (investor_profit_share >= 0),
  company_profit_share  NUMERIC(20,2) NOT NULL,
  profit_per_slot       NUMERIC(20,6) NOT NULL,
  total_slots           NUMERIC(12,2) NOT NULL,
  notes                 TEXT,
  declared_by           UUID REFERENCES profiles(id),
  declared_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id)
);

CREATE INDEX IF NOT EXISTS idx_cycle_profit_declarations_cycle_id
  ON cycle_profit_declarations(cycle_id);

-- RLS for cycle_profit_declarations
ALTER TABLE cycle_profit_declarations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage cycle profit declarations"
  ON cycle_profit_declarations FOR ALL
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

CREATE POLICY "Investors view cycle profit declarations"
  ON cycle_profit_declarations FOR SELECT
  USING (
    cycle_id IN (
      SELECT i.cycle_id FROM investments i
      JOIN investors inv ON inv.id = i.investor_id
      WHERE inv.profile_id = auth.uid()
    )
  );

-- ============================================================
-- 8. Recreate investment_summary view without expected_roi,
--    add declared_profit instead
-- ============================================================

CREATE OR REPLACE VIEW investment_summary AS
SELECT
  i.id,
  i.investment_code,
  inv.full_name AS investor_name,
  inv.investor_code,
  s.name AS series_name,
  c.cycle_label,
  i.units,
  i.capital,
  i.declared_profit,
  i.investment_date,
  i.maturity_date,
  i.status
FROM investments i
JOIN investors inv ON inv.id = i.investor_id
JOIN series s ON s.id = i.series_id
JOIN cycles c ON c.id = i.cycle_id;

-- ============================================================
-- 9. declare_cycle_profit() — Admin function to declare profit
--    for a matured cycle. Calculates per-investment profit,
--    marks investments as matured, cycle as completed.
-- ============================================================

CREATE OR REPLACE FUNCTION declare_cycle_profit(
  p_cycle_id       UUID,
  p_total_revenue  NUMERIC,
  p_total_expenses NUMERIC,
  p_notes          TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_cycle          cycles%ROWTYPE;
  v_series         series%ROWTYPE;
  v_total_slots    NUMERIC(12,2);
  v_net_profit     NUMERIC(20,2);
  v_inv_share      NUMERIC(20,2);
  v_co_share       NUMERIC(20,2);
  v_profit_per_slot NUMERIC(20,6);
  v_decl_id        UUID;
  v_inv            investments%ROWTYPE;
  v_inv_profit     NUMERIC(20,2);
  v_inv_count      INTEGER := 0;
BEGIN
  -- Validate cycle
  SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;

  IF v_cycle.status NOT IN ('awaiting_profit_declaration', 'active') THEN
    RAISE EXCEPTION 'Cycle is not awaiting profit declaration (status: %)', v_cycle.status;
  END IF;

  -- Check no existing declaration
  IF EXISTS (SELECT 1 FROM cycle_profit_declarations WHERE cycle_id = p_cycle_id) THEN
    RAISE EXCEPTION 'Profit has already been declared for this cycle';
  END IF;

  -- Fetch series for mudarabah ratio
  SELECT * INTO v_series FROM series WHERE id = v_cycle.series_id;

  -- Sum all active investment units in this cycle
  SELECT COALESCE(SUM(units), 0)
  INTO v_total_slots
  FROM investments
  WHERE cycle_id = p_cycle_id AND status = 'active';

  IF v_total_slots = 0 THEN
    RAISE EXCEPTION 'No active investments found in this cycle';
  END IF;

  -- Calculate profit figures
  v_net_profit      := p_total_revenue - p_total_expenses;
  v_inv_share       := ROUND(v_net_profit * v_series.mudarabah_investor_ratio, 2);
  v_co_share        := v_net_profit - v_inv_share;
  v_profit_per_slot := v_inv_share / v_total_slots;

  -- Insert declaration record
  INSERT INTO cycle_profit_declarations (
    cycle_id, total_revenue, total_expenses, net_profit,
    investor_profit_share, company_profit_share,
    profit_per_slot, total_slots, notes, declared_by
  ) VALUES (
    p_cycle_id, p_total_revenue, p_total_expenses, v_net_profit,
    v_inv_share, v_co_share,
    v_profit_per_slot, v_total_slots, p_notes, auth.uid()
  ) RETURNING id INTO v_decl_id;

  -- Update each active investment: set declared_profit and mark matured
  FOR v_inv IN
    SELECT * FROM investments
    WHERE cycle_id = p_cycle_id AND status = 'active'
  LOOP
    v_inv_profit := ROUND(v_profit_per_slot * v_inv.units, 2);

    UPDATE investments SET
      declared_profit = v_inv_profit,
      status          = 'matured',
      updated_at      = NOW()
    WHERE id = v_inv.id;

    -- Notify investor
    INSERT INTO notifications (user_id, title, message, type, action_url)
    SELECT inv_profile.profile_id,
      'Profit Declared for Your Investment',
      FORMAT(
        'The profit for cycle %s has been declared. Your share is ₦%s. Please log in to submit your maturity decision.',
        v_cycle.cycle_label,
        TO_CHAR(v_inv_profit, 'FM999,999,999,999.00')
      ),
      'maturity',
      FORMAT('/investments/%s', v_inv.id)
    FROM investors inv_profile
    WHERE inv_profile.id = v_inv.investor_id;

    v_inv_count := v_inv_count + 1;
  END LOOP;

  -- Mark cycle completed
  UPDATE cycles SET
    status     = 'completed',
    updated_at = NOW()
  WHERE id = p_cycle_id;

  RETURN jsonb_build_object(
    'success',              true,
    'declaration_id',       v_decl_id,
    'net_profit',           v_net_profit,
    'investor_profit_share', v_inv_share,
    'company_profit_share', v_co_share,
    'profit_per_slot',      v_profit_per_slot,
    'total_slots',          v_total_slots,
    'investments_updated',  v_inv_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
