-- ============================================================
-- Database Functions and Automation
-- ============================================================

-- ============================================================
-- NOTIFICATION CREATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION create_notification(
  p_user_id     UUID,
  p_title       TEXT,
  p_message     TEXT,
  p_type        notification_type,
  p_action_url  TEXT DEFAULT NULL,
  p_metadata    JSONB DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
  VALUES (p_user_id, p_title, p_message, p_type, p_action_url, p_metadata)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- AUDIT LOG FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION create_audit_log(
  p_action       TEXT,
  p_entity_type  TEXT,
  p_entity_id    TEXT DEFAULT NULL,
  p_old_values   JSONB DEFAULT NULL,
  p_new_values   JSONB DEFAULT NULL,
  p_ip_address   INET DEFAULT NULL,
  p_user_agent   TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_values, new_values, ip_address, user_agent)
  VALUES (auth.uid(), p_action, p_entity_type, p_entity_id, p_old_values, p_new_values, p_ip_address, p_user_agent)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- GENERATE INVESTMENT CODE
-- ============================================================

CREATE OR REPLACE FUNCTION generate_investment_code(
  p_series_name      TEXT,
  p_cycle_number     INTEGER,
  p_investor_code    TEXT
)
RETURNS TEXT AS $$
BEGIN
  RETURN FORMAT('MG-%s-%s-%s',
    p_series_name,
    LPAD(p_cycle_number::TEXT, 3, '0'),
    p_investor_code
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- GENERATE PAYMENT REQUEST CODE
-- ============================================================

CREATE OR REPLACE FUNCTION generate_payment_code(p_type TEXT)
RETURNS TEXT AS $$
BEGIN
  RETURN FORMAT('PAY-%s-%s',
    UPPER(p_type),
    TO_CHAR(NOW(), 'YYYYMMDD') || '-' || SUBSTR(gen_random_uuid()::TEXT, 1, 6)
  );
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- GENERATE INVESTOR CODE
-- ============================================================

CREATE OR REPLACE FUNCTION generate_investor_code()
RETURNS TEXT AS $$
DECLARE
  v_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_count FROM investors;
  RETURN FORMAT('MV-%s', LPAD((v_count + 1)::TEXT, 5, '0'));
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- CREATE NEXT CYCLE FOR A SERIES
-- ============================================================

CREATE OR REPLACE FUNCTION create_next_cycle(p_series_id UUID)
RETURNS UUID AS $$
DECLARE
  v_series        series%ROWTYPE;
  v_last_cycle    cycles%ROWTYPE;
  v_new_start     DATE;
  v_new_end       DATE;
  v_cycle_number  INTEGER;
  v_cycle_label   TEXT;
  v_new_cycle_id  UUID;
BEGIN
  -- Get series info
  SELECT * INTO v_series FROM series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series not found: %', p_series_id;
  END IF;

  -- Get last cycle for this series
  SELECT * INTO v_last_cycle
  FROM cycles
  WHERE series_id = p_series_id
  ORDER BY cycle_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existing cycle found for series %', v_series.name;
  END IF;

  -- Calculate next cycle dates
  v_new_start := v_last_cycle.end_date;
  v_new_end := v_new_start + INTERVAL '3 months';
  v_cycle_number := v_last_cycle.cycle_number + 1;
  v_cycle_label := TO_CHAR(v_new_start, 'Mon YYYY') || ' – ' || TO_CHAR(v_new_end - INTERVAL '1 day', 'Mon YYYY');

  -- Create new cycle
  INSERT INTO cycles (series_id, cycle_number, cycle_label, start_date, end_date, status)
  VALUES (p_series_id, v_cycle_number, v_cycle_label, v_new_start, v_new_end, 'upcoming')
  RETURNING id INTO v_new_cycle_id;

  RETURN v_new_cycle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- PROCESS MATURITY: Called by cron or manually
-- Marks mature investments and opens maturity windows
-- ============================================================

CREATE OR REPLACE FUNCTION process_matured_investments()
RETURNS INTEGER AS $$
DECLARE
  v_investment  investments%ROWTYPE;
  v_investor    investors%ROWTYPE;
  v_profile     profiles%ROWTYPE;
  v_count       INTEGER := 0;
BEGIN
  -- Find all active investments whose maturity_date has passed
  FOR v_investment IN
    SELECT * FROM investments
    WHERE status = 'active'
      AND maturity_date <= CURRENT_DATE
    ORDER BY maturity_date ASC
  LOOP
    -- Update investment status to matured
    UPDATE investments
    SET status = 'matured', updated_at = NOW()
    WHERE id = v_investment.id;

    -- Get investor profile for notification
    SELECT i.*, p.id as pid INTO v_investor
    FROM investors i
    JOIN profiles p ON p.id = i.profile_id
    WHERE i.id = v_investment.investor_id;

    IF FOUND THEN
      -- Create maturity notification
      PERFORM create_notification(
        v_investor.profile_id,
        'Investment Matured - Action Required',
        FORMAT(
          'Your investment %s in Series %s has matured. Please log in to submit your maturity decision.',
          v_investment.investment_code,
          (SELECT name FROM series WHERE id = v_investment.series_id)
        ),
        'maturity',
        FORMAT('/investments/%s', v_investment.id)
      );
    END IF;

    -- Update cycle status if all investments in cycle have matured
    UPDATE cycles
    SET status = 'matured', updated_at = NOW()
    WHERE id = v_investment.cycle_id
      AND status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM investments
        WHERE cycle_id = v_investment.cycle_id
          AND status = 'active'
      );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- SUBMIT MATURITY DECISION
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
  v_investment       investments%ROWTYPE;
  v_series           series%ROWTYPE;
  v_current_cycle    cycles%ROWTYPE;
  v_next_cycle       cycles%ROWTYPE;
  v_investor         investors%ROWTYPE;
  v_roi_request_id   UUID;
  v_cap_request_id   UUID;
  v_new_investment_id UUID;
  v_next_cycle_id    UUID;
  v_new_inv_code     TEXT;
  v_roi_pay_code     TEXT;
  v_cap_pay_code     TEXT;
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

  -- Verify this investor owns this investment
  SELECT * INTO v_investor FROM investors WHERE id = v_investment.investor_id;
  IF v_investor.profile_id != auth.uid() AND NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  -- Get series and cycle
  SELECT * INTO v_series FROM series WHERE id = v_investment.series_id;
  SELECT * INTO v_current_cycle FROM cycles WHERE id = v_investment.cycle_id;

  -- Generate payment codes
  v_roi_pay_code := generate_payment_code('roi');

  -- Create ROI payment request (always)
  INSERT INTO payment_requests (
    request_code, investor_id, investment_id, type, amount,
    bank_name, account_name, account_number, notes
  ) VALUES (
    v_roi_pay_code, v_investment.investor_id, v_investment.id, 'roi',
    v_investment.expected_roi, p_bank_name, p_account_name, p_account_number, p_notes
  ) RETURNING id INTO v_roi_request_id;

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

    -- Notify investor
    PERFORM create_notification(
      v_investor.profile_id,
      'Exit Decision Submitted',
      FORMAT('Your exit decision for %s has been submitted. ROI and capital payment requests are pending approval.', v_investment.investment_code),
      'payment',
      FORMAT('/payment-requests')
    );

  ELSIF p_decision = 'continue' THEN
    -- Find or create next cycle
    SELECT * INTO v_next_cycle
    FROM cycles
    WHERE series_id = v_investment.series_id
      AND start_date = v_current_cycle.end_date
    LIMIT 1;

    IF NOT FOUND THEN
      -- Create next cycle
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

    -- Create new investment in next cycle
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

    -- Update parent investment to reference new
    UPDATE investments SET
      status = 'completed',
      maturity_decision = 'continue',
      maturity_decided_at = NOW(),
      next_investment_id = v_new_investment_id,
      updated_at = NOW()
    WHERE id = p_investment_id;

    -- Update cycle totals
    UPDATE cycles SET
      total_capital = total_capital + v_investment.capital,
      total_investors = total_investors + 1,
      updated_at = NOW()
    WHERE id = v_next_cycle.id;

    -- Notify investor
    PERFORM create_notification(
      v_investor.profile_id,
      'Capital Rolled Into Next Cycle',
      FORMAT('Your capital of %s has been rolled into %s (Series %s). ROI payment is pending approval.',
        v_investment.capital, v_next_cycle.cycle_label, v_series.name),
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

-- ============================================================
-- UPDATE CYCLE TOTALS TRIGGER
-- ============================================================

CREATE OR REPLACE FUNCTION update_cycle_totals()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE cycles SET
      total_capital = total_capital + NEW.capital,
      total_investors = total_investors + 1,
      updated_at = NOW()
    WHERE id = NEW.cycle_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE cycles SET
      total_capital = total_capital - OLD.capital,
      total_investors = GREATEST(total_investors - 1, 0),
      updated_at = NOW()
    WHERE id = OLD.cycle_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_cycle_totals_on_investment
  AFTER INSERT OR DELETE ON investments
  FOR EACH ROW EXECUTE FUNCTION update_cycle_totals();

-- ============================================================
-- VIEWS
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
  i.expected_roi,
  i.investment_date,
  i.maturity_date,
  i.status
FROM investments i
JOIN investors inv ON inv.id = i.investor_id
JOIN series s ON s.id = i.series_id
JOIN cycles c ON c.id = i.cycle_id;

-- ============================================================
-- SEED INITIAL DATA
-- ============================================================

-- Insert default series
INSERT INTO series (name, description, start_month_offset, roi_rate, price_per_unit, min_units) VALUES
  ('A', 'MaalGrow Series A - Cycles: Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec', 0, 0.15, 100000.00, 1),
  ('B', 'MaalGrow Series B - Cycles: Feb-Apr, May-Jul, Aug-Oct, Nov-Jan', 1, 0.15, 100000.00, 1),
  ('C', 'MaalGrow Series C - Cycles: Mar-May, Jun-Aug, Sep-Nov, Dec-Feb', 2, 0.15, 100000.00, 1)
ON CONFLICT (name) DO NOTHING;
