-- ============================================================
-- Migration 009 – Automatic Cycle Rollover
--
-- Investors automatically continue from one cycle to the next
-- within the same series unless they opt out before the
-- rollover deadline.
--
--   • rollover_decisions   — investor choices during the opt-out window
--   • cycle_rollovers      — immutable record of every rollover/withdrawal
--   • submit_rollover_decision() — records (does not process) a choice
--   • process_cycle_rollover()   — idempotent batch processor
--   • submit_maturity_decision() — fixed (007 regression referenced
--     dropped columns expected_roi/roi_rate) and now delegates to
--     submit_rollover_decision()
-- ============================================================

-- ============================================================
-- 1. New maturity_decision enum value
--    Existing:  'continue' = withdraw profit, roll capital
--               'exit'     = withdraw capital and profit
--    New:       'rollover_all' = roll capital AND profit
--    (The automatic default when no decision is submitted is
--    'rollover_all', recorded with method = 'automatic'.)
-- ============================================================

ALTER TYPE maturity_decision ADD VALUE IF NOT EXISTS 'rollover_all';

-- ============================================================
-- 2. New columns
-- ============================================================

-- Opt-out window deadline; NULL means "defaults to end_date"
ALTER TABLE cycles
  ADD COLUMN IF NOT EXISTS rollover_deadline     DATE NULL,
  ADD COLUMN IF NOT EXISTS rollover_processed_at TIMESTAMPTZ NULL;

-- Portion of an investment's capital that does not form a complete
-- 0.5-slot increment (e.g. rolled-over profit). Included in capital,
-- but earns no per-slot profit share.
ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS rollover_balance NUMERIC(20,2) NOT NULL DEFAULT 0;

-- ============================================================
-- 3. rollover_decisions — investor choice during opt-out window
--    One row per investment. Written only via SECURITY DEFINER
--    functions; investors may read their own rows.
-- ============================================================

CREATE TABLE IF NOT EXISTS rollover_decisions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_id   UUID NOT NULL UNIQUE REFERENCES investments(id) ON DELETE CASCADE,
  investor_id     UUID NOT NULL REFERENCES investors(id),
  source_cycle_id UUID NOT NULL REFERENCES cycles(id),
  decision        maturity_decision NOT NULL,
  bank_name       TEXT,
  account_name    TEXT,
  account_number  TEXT,
  notes           TEXT,
  deadline        DATE,
  locked          BOOLEAN NOT NULL DEFAULT FALSE,
  decided_by      UUID REFERENCES profiles(id),
  via             TEXT NOT NULL DEFAULT 'investor',   -- 'investor' | 'admin_exception'
  submitted_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_rollover_decisions_cycle
  ON rollover_decisions(source_cycle_id);
CREATE INDEX IF NOT EXISTS idx_rollover_decisions_investor
  ON rollover_decisions(investor_id);

ALTER TABLE rollover_decisions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage rollover decisions"
  ON rollover_decisions FOR ALL
  USING (is_admin());

CREATE POLICY "Investors view own rollover decisions"
  ON rollover_decisions FOR SELECT
  USING (investor_id = get_my_investor_id());

-- ============================================================
-- 4. cycle_rollovers — permanent record of each rollover
--    UNIQUE (previous_investment_id): a source allocation can be
--    rolled over exactly once, guaranteeing the same investor +
--    source cycle + destination cycle can never be duplicated
--    no matter how many times processing runs.
-- ============================================================

CREATE TABLE IF NOT EXISTS cycle_rollovers (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_id              UUID NOT NULL REFERENCES investors(id),
  previous_investment_id   UUID NOT NULL UNIQUE REFERENCES investments(id),
  new_investment_id        UUID REFERENCES investments(id),
  source_cycle_id          UUID NOT NULL REFERENCES cycles(id),
  destination_cycle_id     UUID REFERENCES cycles(id),
  series_id                UUID NOT NULL REFERENCES series(id),
  units                    NUMERIC(12,2),
  capital_rolled_over      NUMERIC(20,2) NOT NULL DEFAULT 0,
  profit_rolled_over       NUMERIC(20,2) NOT NULL DEFAULT 0,
  total_rollover_amount    NUMERIC(20,2) NOT NULL DEFAULT 0,
  rollover_balance         NUMERIC(20,2) NOT NULL DEFAULT 0,
  withdrawal_amount        NUMERIC(20,2) NOT NULL DEFAULT 0,
  decision                 maturity_decision NOT NULL,
  method                   TEXT NOT NULL,               -- 'automatic' | 'investor_choice' | 'admin_exception'
  status                   TEXT NOT NULL DEFAULT 'completed',  -- 'completed' | 'withdrawn' | 'failed'
  error                    TEXT,
  email_sent               BOOLEAN NOT NULL DEFAULT FALSE,
  email_error              TEXT,
  rollover_date            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_by             UUID REFERENCES profiles(id)
);

CREATE INDEX IF NOT EXISTS idx_cycle_rollovers_source
  ON cycle_rollovers(source_cycle_id);
CREATE INDEX IF NOT EXISTS idx_cycle_rollovers_destination
  ON cycle_rollovers(destination_cycle_id);
CREATE INDEX IF NOT EXISTS idx_cycle_rollovers_investor
  ON cycle_rollovers(investor_id);

ALTER TABLE cycle_rollovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins manage cycle rollovers"
  ON cycle_rollovers FOR ALL
  USING (is_admin());

CREATE POLICY "Investors view own cycle rollovers"
  ON cycle_rollovers FOR SELECT
  USING (investor_id = get_my_investor_id());

-- ============================================================
-- 5. submit_rollover_decision()
--    Records the investor's choice during the opt-out window.
--    Does NOT process the rollover — processing happens in batch
--    via process_cycle_rollover() after profit declaration.
-- ============================================================

CREATE OR REPLACE FUNCTION submit_rollover_decision(
  p_investment_id  UUID,
  p_decision       maturity_decision,
  p_bank_name      TEXT DEFAULT NULL,
  p_account_name   TEXT DEFAULT NULL,
  p_account_number TEXT DEFAULT NULL,
  p_notes          TEXT DEFAULT NULL,
  p_admin_override BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
  v_investment investments%ROWTYPE;
  v_investor   investors%ROWTYPE;
  v_cycle      cycles%ROWTYPE;
  v_deadline   DATE;
  v_existing   rollover_decisions%ROWTYPE;
  v_is_admin   BOOLEAN;
  v_via        TEXT;
BEGIN
  SELECT * INTO v_investment FROM investments WHERE id = p_investment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment not found';
  END IF;

  IF v_investment.status NOT IN ('active', 'matured') THEN
    RAISE EXCEPTION 'This investment has already been finalised';
  END IF;

  IF v_investment.next_investment_id IS NOT NULL THEN
    RAISE EXCEPTION 'This investment has already been rolled over';
  END IF;

  SELECT * INTO v_investor FROM investors WHERE id = v_investment.investor_id;
  v_is_admin := is_admin();

  IF v_investor.profile_id != auth.uid() AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_cycle FROM cycles WHERE id = v_investment.cycle_id;
  v_deadline := COALESCE(v_cycle.rollover_deadline, v_cycle.end_date);

  -- After the deadline the decision is locked unless a super admin
  -- explicitly approves the exception.
  IF CURRENT_DATE > v_deadline AND NOT (v_is_admin AND p_admin_override) THEN
    RAISE EXCEPTION 'The rollover decision deadline (%) has passed. Please contact support to request a change.', v_deadline;
  END IF;

  SELECT * INTO v_existing FROM rollover_decisions WHERE investment_id = p_investment_id;
  IF FOUND AND v_existing.locked AND NOT (v_is_admin AND p_admin_override) THEN
    RAISE EXCEPTION 'This rollover decision has been locked and can only be changed by a super admin';
  END IF;

  -- Withdrawing anything requires bank details
  IF p_decision IN ('continue', 'exit') THEN
    IF COALESCE(p_bank_name, v_investor.bank_name) IS NULL
       OR COALESCE(p_account_name, v_investor.account_name) IS NULL
       OR COALESCE(p_account_number, v_investor.account_number) IS NULL THEN
      RAISE EXCEPTION 'Bank details are required to withdraw funds';
    END IF;
  END IF;

  v_via := CASE WHEN v_is_admin AND v_investor.profile_id != auth.uid()
                THEN 'admin_exception' ELSE 'investor' END;

  INSERT INTO rollover_decisions (
    investment_id, investor_id, source_cycle_id, decision,
    bank_name, account_name, account_number, notes,
    deadline, decided_by, via
  ) VALUES (
    p_investment_id, v_investment.investor_id, v_investment.cycle_id, p_decision,
    COALESCE(p_bank_name, v_investor.bank_name),
    COALESCE(p_account_name, v_investor.account_name),
    COALESCE(p_account_number, v_investor.account_number),
    p_notes, v_deadline, auth.uid(), v_via
  )
  ON CONFLICT (investment_id) DO UPDATE SET
    decision       = EXCLUDED.decision,
    bank_name      = EXCLUDED.bank_name,
    account_name   = EXCLUDED.account_name,
    account_number = EXCLUDED.account_number,
    notes          = EXCLUDED.notes,
    decided_by     = EXCLUDED.decided_by,
    via            = EXCLUDED.via,
    updated_at     = NOW();

  -- Also stamp the choice on the investment for existing UI reads
  UPDATE investments SET
    maturity_decision   = p_decision,
    maturity_decided_at = NOW(),
    updated_at          = NOW()
  WHERE id = p_investment_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'decision', p_decision,
    'deadline', v_deadline
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 6. submit_maturity_decision() — FIXED
--    Migration 007 regressed this function to a version that
--    references investments.expected_roi and series.roi_rate,
--    both dropped in migration 005, so every call failed at
--    runtime. It now simply records the decision; settlement
--    happens in process_cycle_rollover().
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
BEGIN
  RETURN submit_rollover_decision(
    p_investment_id, p_decision,
    p_bank_name, p_account_name, p_account_number, p_notes
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 7. process_cycle_rollover()
--    Idempotent batch processor. For every matured, undecided-
--    or-decided investment in the source cycle:
--      exit          → payment requests, no new allocation
--      continue      → profit payment request, capital rolls
--      rollover_all  → capital + profit roll (the automatic default)
--    Profit is NOT converted into slots unless
--    p_convert_profit_to_slots is TRUE; any amount that does not
--    form a complete 0.5-slot increment is carried as
--    rollover_balance on the new allocation.
-- ============================================================

CREATE OR REPLACE FUNCTION process_cycle_rollover(
  p_source_cycle_id         UUID,
  p_destination_cycle_id    UUID DEFAULT NULL,
  p_convert_profit_to_slots BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
  v_source        cycles%ROWTYPE;
  v_dest          cycles%ROWTYPE;
  v_series        series%ROWTYPE;
  v_inv           investments%ROWTYPE;
  v_investor      investors%ROWTYPE;
  v_decision_row  rollover_decisions%ROWTYPE;
  v_decision      maturity_decision;
  v_method        TEXT;
  v_existing      cycle_rollovers%ROWTYPE;
  v_capital_roll  NUMERIC(20,2);
  v_profit_roll   NUMERIC(20,2);
  v_total_roll    NUMERIC(20,2);
  v_withdrawal    NUMERIC(20,2);
  v_new_units     NUMERIC(12,2);
  v_half_slot     NUMERIC(20,2);
  v_balance       NUMERIC(20,2);
  v_new_inv_id    UUID;
  v_new_inv_code  TEXT;
  v_code_suffix   INTEGER;
  v_bank_name     TEXT;
  v_account_name  TEXT;
  v_account_num   TEXT;
  v_results       JSONB := '[]'::JSONB;
  v_processed     INTEGER := 0;
  v_withdrawn     INTEGER := 0;
  v_failed        INTEGER := 0;
  v_skipped       INTEGER := 0;
  v_err           TEXT;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_source FROM cycles WHERE id = p_source_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source cycle not found';
  END IF;

  SELECT * INTO v_series FROM series WHERE id = v_source.series_id;

  -- Profit must be declared before rollover can run
  IF NOT EXISTS (SELECT 1 FROM cycle_profit_declarations WHERE cycle_id = p_source_cycle_id) THEN
    RAISE EXCEPTION 'Profit has not been declared for this cycle. Declare the final Mudarabah profit first.';
  END IF;

  -- Resolve destination cycle
  IF p_destination_cycle_id IS NOT NULL THEN
    SELECT * INTO v_dest FROM cycles WHERE id = p_destination_cycle_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Destination cycle not found';
    END IF;
  ELSE
    SELECT * INTO v_dest FROM cycles
    WHERE series_id = v_source.series_id
      AND start_date = v_source.end_date
    LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'NEXT_CYCLE_MISSING: The next cycle for Series % does not exist. Create and confirm it before processing the rollover.', v_series.name;
    END IF;
  END IF;

  IF v_dest.series_id != v_source.series_id THEN
    RAISE EXCEPTION 'Destination cycle belongs to a different series';
  END IF;
  IF v_dest.id = v_source.id THEN
    RAISE EXCEPTION 'Destination cycle must differ from the source cycle';
  END IF;
  IF v_dest.status IN ('completed', 'cancelled', 'matured', 'awaiting_profit_declaration') THEN
    RAISE EXCEPTION 'Destination cycle % is not open for new allocations (status: %)', v_dest.cycle_label, v_dest.status;
  END IF;

  -- Activate the destination cycle when its start date has arrived
  IF v_dest.status IN ('upcoming', 'draft', 'subscription_open', 'subscription_closed')
     AND v_dest.start_date <= CURRENT_DATE THEN
    UPDATE cycles SET status = 'active', updated_at = NOW() WHERE id = v_dest.id;
    v_dest.status := 'active';
  END IF;

  v_half_slot := v_series.price_per_unit / 2;

  FOR v_inv IN
    SELECT * FROM investments
    WHERE cycle_id = p_source_cycle_id
      AND status = 'matured'
      AND next_investment_id IS NULL
    ORDER BY created_at ASC
  LOOP
    BEGIN
      -- Reset per-iteration state so a failure can never report values
      -- from a previous investor's iteration
      v_decision     := NULL;
      v_method       := NULL;
      v_new_inv_id   := NULL;
      v_new_units    := NULL;
      v_capital_roll := 0;
      v_profit_roll  := 0;
      v_withdrawal   := 0;
      v_balance      := 0;

      -- Idempotency: an existing completed/withdrawn record means this
      -- allocation was already processed — skip it. Failed records are
      -- retried.
      SELECT * INTO v_existing FROM cycle_rollovers
      WHERE previous_investment_id = v_inv.id;
      IF FOUND AND v_existing.status IN ('completed', 'withdrawn') THEN
        v_skipped := v_skipped + 1;
        CONTINUE;
      END IF;

      IF v_inv.declared_profit IS NULL THEN
        RAISE EXCEPTION 'Investment % has no declared profit', v_inv.investment_code;
      END IF;

      SELECT * INTO v_investor FROM investors WHERE id = v_inv.investor_id;

      -- Resolve the decision; no decision = automatic continuation
      SELECT * INTO v_decision_row FROM rollover_decisions
      WHERE investment_id = v_inv.id;
      IF FOUND THEN
        v_decision := v_decision_row.decision;
        v_method   := CASE WHEN v_decision_row.via = 'admin_exception'
                           THEN 'admin_exception' ELSE 'investor_choice' END;
        v_bank_name    := v_decision_row.bank_name;
        v_account_name := v_decision_row.account_name;
        v_account_num  := v_decision_row.account_number;
      ELSE
        v_decision := 'rollover_all';
        v_method   := 'automatic';
        v_bank_name    := v_investor.bank_name;
        v_account_name := v_investor.account_name;
        v_account_num  := v_investor.account_number;
      END IF;

      -- Payouts require bank details
      IF v_decision IN ('continue', 'exit')
         AND (v_bank_name IS NULL OR v_account_name IS NULL OR v_account_num IS NULL) THEN
        RAISE EXCEPTION 'Missing bank details for payout (investor %)', v_investor.investor_code;
      END IF;

      -- Create payment requests for withdrawn amounts
      IF v_decision IN ('continue', 'exit') THEN
        INSERT INTO payment_requests (
          request_code, investor_id, investment_id, type, amount,
          bank_name, account_name, account_number, notes
        ) VALUES (
          generate_payment_code('roi'), v_inv.investor_id, v_inv.id, 'roi',
          v_inv.declared_profit, v_bank_name, v_account_name, v_account_num,
          'Cycle rollover — profit payout'
        );
      END IF;
      IF v_decision = 'exit' THEN
        INSERT INTO payment_requests (
          request_code, investor_id, investment_id, type, amount,
          bank_name, account_name, account_number, notes
        ) VALUES (
          generate_payment_code('capital'), v_inv.investor_id, v_inv.id, 'capital',
          v_inv.capital, v_bank_name, v_account_name, v_account_num,
          'Cycle rollover — capital withdrawal'
        );
      END IF;

      IF v_decision = 'exit' THEN
        -- Full withdrawal: no new allocation
        v_withdrawal := v_inv.capital + v_inv.declared_profit;

        UPDATE investments SET
          status = 'completed',
          maturity_decision = 'exit',
          maturity_decided_at = COALESCE(v_inv.maturity_decided_at, NOW()),
          updated_at = NOW()
        WHERE id = v_inv.id;

        INSERT INTO cycle_rollovers (
          investor_id, previous_investment_id, source_cycle_id,
          destination_cycle_id, series_id, decision, method, status,
          withdrawal_amount, processed_by
        ) VALUES (
          v_inv.investor_id, v_inv.id, p_source_cycle_id,
          NULL, v_source.series_id, 'exit', v_method, 'withdrawn',
          v_withdrawal, auth.uid()
        )
        ON CONFLICT (previous_investment_id) DO UPDATE SET
          decision = EXCLUDED.decision, method = EXCLUDED.method,
          status = 'withdrawn', withdrawal_amount = EXCLUDED.withdrawal_amount,
          error = NULL, rollover_date = NOW(), processed_by = EXCLUDED.processed_by;

        PERFORM create_notification(
          v_investor.profile_id,
          'Withdrawal Processed',
          FORMAT('Your withdrawal of capital and profit for %s (Series %s) has been submitted. Payment requests are pending approval.',
            v_source.cycle_label, v_series.name),
          'payment', '/payment-requests'
        );

        v_withdrawn := v_withdrawn + 1;
      ELSE
        -- Roll capital (always) and profit (rollover_all only)
        v_capital_roll := v_inv.capital;
        v_profit_roll  := CASE WHEN v_decision = 'rollover_all'
                               THEN v_inv.declared_profit ELSE 0 END;
        v_withdrawal   := CASE WHEN v_decision = 'continue'
                               THEN v_inv.declared_profit ELSE 0 END;
        v_total_roll   := v_capital_roll + v_profit_roll;

        IF p_convert_profit_to_slots THEN
          -- Convert the total into complete 0.5-slot increments
          v_new_units := FLOOR(v_total_roll / v_half_slot) / 2;
          v_new_units := GREATEST(v_new_units, v_inv.units);
        ELSE
          -- Business rule default: never silently convert profit to slots
          v_new_units := v_inv.units;
        END IF;

        v_balance := v_total_roll - (v_new_units * v_series.price_per_unit);
        IF v_balance < 0 THEN
          -- Capital short of full slot value (shouldn't happen, but never
          -- inflate slots): carry as-is with zero balance.
          v_balance := 0;
        END IF;

        -- Unique investment code (an investor may hold several allocations)
        v_new_inv_code := generate_investment_code(
          v_series.name::TEXT, v_dest.cycle_number, v_investor.investor_code
        );
        v_code_suffix := 2;
        WHILE EXISTS (SELECT 1 FROM investments WHERE investment_code = v_new_inv_code) LOOP
          v_new_inv_code := generate_investment_code(
            v_series.name::TEXT, v_dest.cycle_number, v_investor.investor_code
          ) || '-' || v_code_suffix;
          v_code_suffix := v_code_suffix + 1;
        END LOOP;

        INSERT INTO investments (
          investment_code, investor_id, series_id, cycle_id,
          units, price_per_unit, capital, rollover_balance,
          investment_date, maturity_date, status,
          parent_investment_id, created_by, notes
        ) VALUES (
          v_new_inv_code, v_inv.investor_id, v_source.series_id, v_dest.id,
          v_new_units, v_series.price_per_unit, v_total_roll, v_balance,
          v_dest.start_date, v_dest.end_date, 'active',
          v_inv.id, auth.uid(),
          FORMAT('Rolled over from %s', v_inv.investment_code)
        ) RETURNING id INTO v_new_inv_id;

        UPDATE investments SET
          status = 'completed',
          maturity_decision = v_decision,
          maturity_decided_at = COALESCE(v_inv.maturity_decided_at, NOW()),
          next_investment_id = v_new_inv_id,
          updated_at = NOW()
        WHERE id = v_inv.id;

        INSERT INTO cycle_rollovers (
          investor_id, previous_investment_id, new_investment_id,
          source_cycle_id, destination_cycle_id, series_id,
          units, capital_rolled_over, profit_rolled_over,
          total_rollover_amount, rollover_balance, withdrawal_amount,
          decision, method, status, processed_by
        ) VALUES (
          v_inv.investor_id, v_inv.id, v_new_inv_id,
          p_source_cycle_id, v_dest.id, v_source.series_id,
          v_new_units, v_capital_roll, v_profit_roll,
          v_total_roll, v_balance, v_withdrawal,
          v_decision, v_method, 'completed', auth.uid()
        )
        ON CONFLICT (previous_investment_id) DO UPDATE SET
          new_investment_id = EXCLUDED.new_investment_id,
          destination_cycle_id = EXCLUDED.destination_cycle_id,
          units = EXCLUDED.units,
          capital_rolled_over = EXCLUDED.capital_rolled_over,
          profit_rolled_over = EXCLUDED.profit_rolled_over,
          total_rollover_amount = EXCLUDED.total_rollover_amount,
          rollover_balance = EXCLUDED.rollover_balance,
          withdrawal_amount = EXCLUDED.withdrawal_amount,
          decision = EXCLUDED.decision, method = EXCLUDED.method,
          status = 'completed', error = NULL,
          rollover_date = NOW(), processed_by = EXCLUDED.processed_by;

        PERFORM create_notification(
          v_investor.profile_id,
          'Investment Rolled Into Next Cycle',
          FORMAT('Your Series %s investment has been rolled over from %s into %s. Log in to view your updated timeline.',
            v_series.name, v_source.cycle_label, v_dest.cycle_label),
          'investment', FORMAT('/investments/%s', v_new_inv_id)
        );

        v_processed := v_processed + 1;
      END IF;

      -- Lock the decision so it can no longer be changed
      UPDATE rollover_decisions SET locked = TRUE, updated_at = NOW()
      WHERE investment_id = v_inv.id;

      v_results := v_results || jsonb_build_object(
        'previous_investment_id', v_inv.id,
        'investor_id', v_inv.investor_id,
        'investor_code', v_investor.investor_code,
        'full_name', v_investor.full_name,
        'email', v_investor.email,
        'decision', v_decision,
        'method', v_method,
        'units', COALESCE(v_new_units, v_inv.units),
        'capital_rolled_over', CASE WHEN v_decision = 'exit' THEN 0 ELSE v_capital_roll END,
        'profit_rolled_over',  CASE WHEN v_decision = 'exit' THEN 0 ELSE v_profit_roll END,
        'declared_profit', v_inv.declared_profit,
        'withdrawal_amount', v_withdrawal,
        'new_investment_id', v_new_inv_id,
        'status', CASE WHEN v_decision = 'exit' THEN 'withdrawn' ELSE 'completed' END
      );
      v_new_inv_id := NULL;

    EXCEPTION WHEN OTHERS THEN
      v_err := SQLERRM;
      v_failed := v_failed + 1;

      INSERT INTO cycle_rollovers (
        investor_id, previous_investment_id, source_cycle_id,
        destination_cycle_id, series_id, decision, method,
        status, error, processed_by
      ) VALUES (
        v_inv.investor_id, v_inv.id, p_source_cycle_id,
        v_dest.id, v_source.series_id,
        COALESCE(v_decision, 'rollover_all'), COALESCE(v_method, 'automatic'),
        'failed', v_err, auth.uid()
      )
      ON CONFLICT (previous_investment_id) DO UPDATE SET
        status = 'failed', error = v_err, rollover_date = NOW();

      v_results := v_results || jsonb_build_object(
        'previous_investment_id', v_inv.id,
        'investor_id', v_inv.investor_id,
        'status', 'failed',
        'error', v_err
      );
    END;
  END LOOP;

  -- Mark the source cycle as fully processed (historical)
  UPDATE cycles SET
    rollover_processed_at = NOW(),
    updated_at = NOW()
  WHERE id = p_source_cycle_id
    AND NOT EXISTS (
      SELECT 1 FROM investments
      WHERE cycle_id = p_source_cycle_id
        AND status = 'matured'
        AND next_investment_id IS NULL
    );

  PERFORM create_audit_log(
    'process_cycle_rollover', 'cycle', p_source_cycle_id::TEXT,
    NULL,
    jsonb_build_object(
      'destination_cycle_id', v_dest.id,
      'rolled', v_processed, 'withdrawn', v_withdrawn,
      'failed', v_failed, 'skipped', v_skipped
    )
  );

  RETURN jsonb_build_object(
    'success', TRUE,
    'source_cycle_id', p_source_cycle_id,
    'destination_cycle_id', v_dest.id,
    'destination_cycle_label', v_dest.cycle_label,
    'source_cycle_label', v_source.cycle_label,
    'series_name', v_series.name,
    'rolled', v_processed,
    'withdrawn', v_withdrawn,
    'failed', v_failed,
    'skipped', v_skipped,
    'results', v_results
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- 8. declare_cycle_profit() — add rollover notification
--    Same logic as migration 005, plus: after declaration the
--    super admins are prompted to process the cycle rollover.
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
  SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;

  IF v_cycle.status NOT IN ('awaiting_profit_declaration', 'active') THEN
    RAISE EXCEPTION 'Cycle is not awaiting profit declaration (status: %)', v_cycle.status;
  END IF;

  IF EXISTS (SELECT 1 FROM cycle_profit_declarations WHERE cycle_id = p_cycle_id) THEN
    RAISE EXCEPTION 'Profit has already been declared for this cycle';
  END IF;

  SELECT * INTO v_series FROM series WHERE id = v_cycle.series_id;

  SELECT COALESCE(SUM(units), 0)
  INTO v_total_slots
  FROM investments
  WHERE cycle_id = p_cycle_id AND status = 'active';

  IF v_total_slots = 0 THEN
    RAISE EXCEPTION 'No active investments found in this cycle';
  END IF;

  v_net_profit      := p_total_revenue - p_total_expenses;
  v_inv_share       := ROUND(v_net_profit * v_series.mudarabah_investor_ratio, 2);
  v_co_share        := v_net_profit - v_inv_share;
  v_profit_per_slot := v_inv_share / v_total_slots;

  INSERT INTO cycle_profit_declarations (
    cycle_id, total_revenue, total_expenses, net_profit,
    investor_profit_share, company_profit_share,
    profit_per_slot, total_slots, notes, declared_by
  ) VALUES (
    p_cycle_id, p_total_revenue, p_total_expenses, v_net_profit,
    v_inv_share, v_co_share,
    v_profit_per_slot, v_total_slots, p_notes, auth.uid()
  ) RETURNING id INTO v_decl_id;

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

    INSERT INTO notifications (user_id, title, message, type, action_url)
    SELECT inv_profile.profile_id,
      'Profit Declared for Your Investment',
      FORMAT(
        'The profit for cycle %s has been declared. Your share is ₦%s. You will be rolled into the next cycle automatically unless you submitted a different choice.',
        v_cycle.cycle_label,
        TO_CHAR(v_inv_profit, 'FM999,999,999,999.00')
      ),
      'maturity',
      FORMAT('/investments/%s', v_inv.id)
    FROM investors inv_profile
    WHERE inv_profile.id = v_inv.investor_id;

    v_inv_count := v_inv_count + 1;
  END LOOP;

  UPDATE cycles SET
    status     = 'completed',
    updated_at = NOW()
  WHERE id = p_cycle_id;

  -- Prompt super admins to run the rollover
  INSERT INTO notifications (user_id, title, message, type, action_url)
  SELECT p.id,
    FORMAT('Rollover Ready — Series %s: %s', v_series.name, v_cycle.cycle_label),
    FORMAT('Profit for %s has been declared. Review and process the automatic rollover into the next cycle.', v_cycle.cycle_label),
    'maturity',
    FORMAT('/admin/cycles/%s/rollover', p_cycle_id)
  FROM profiles p
  WHERE p.role = 'super_admin' AND p.is_active = TRUE;

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
