-- ============================================================
-- Migration 012 – Maturity Instructions
--
-- Replaces the "Automatic Rollover" investor flow with Maturity
-- Instructions that reflect the actual MaalGrow process:
--
--   • Declared profit is ALWAYS paid to the investor at maturity.
--   • The investor instructs only what happens to their CAPITAL:
--       continue      → all capital continues into the next cycle
--       exit          → all capital withdrawn
--       partial_exit  → withdraw N slots (× ₦ slot value), the
--                       remainder continues (NEW)
--   • No instruction = default: profit paid, capital continues.
--   • Instructions are editable until maturity, then locked
--     (super admin exception override remains available).
-- ============================================================

-- 1. New decision value + partial withdrawal fields
ALTER TYPE maturity_decision ADD VALUE IF NOT EXISTS 'partial_exit';

ALTER TABLE rollover_decisions
  ADD COLUMN IF NOT EXISTS slots_to_withdraw NUMERIC(12,2) NULL;

ALTER TABLE cycle_rollovers
  ADD COLUMN IF NOT EXISTS slots_withdrawn NUMERIC(12,2) NOT NULL DEFAULT 0;

-- 2. submit_rollover_decision — new signature (adds
--    p_slots_to_withdraw). Drop the old signature first so we do
--    not create an ambiguous overload.
DROP FUNCTION IF EXISTS submit_rollover_decision(UUID, maturity_decision, TEXT, TEXT, TEXT, TEXT, BOOLEAN);

CREATE OR REPLACE FUNCTION submit_rollover_decision(
  p_investment_id     UUID,
  p_decision          maturity_decision,
  p_bank_name         TEXT DEFAULT NULL,
  p_account_name      TEXT DEFAULT NULL,
  p_account_number    TEXT DEFAULT NULL,
  p_notes             TEXT DEFAULT NULL,
  p_admin_override    BOOLEAN DEFAULT FALSE,
  p_slots_to_withdraw NUMERIC DEFAULT NULL
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

  -- Instructions lock automatically at maturity / once processing
  -- begins. Only a super admin exception can change them afterwards.
  IF (v_investment.status != 'active' OR CURRENT_DATE > v_deadline)
     AND NOT (v_is_admin AND p_admin_override) THEN
    RAISE EXCEPTION 'Maturity instructions are locked once the investment reaches maturity. Please contact support to request a change.';
  END IF;

  SELECT * INTO v_existing FROM rollover_decisions WHERE investment_id = p_investment_id;
  IF FOUND AND v_existing.locked AND NOT (v_is_admin AND p_admin_override) THEN
    RAISE EXCEPTION 'This instruction has been locked and can only be changed by a super admin';
  END IF;

  -- Profit is always paid at maturity, so bank details are required
  -- for every instruction (except the legacy rollover_all, which
  -- pays nothing out).
  IF p_decision != 'rollover_all'
     AND (COALESCE(p_bank_name, v_investor.bank_name) IS NULL
       OR COALESCE(p_account_name, v_investor.account_name) IS NULL
       OR COALESCE(p_account_number, v_investor.account_number) IS NULL) THEN
    RAISE EXCEPTION 'Bank details are required — your declared profit is paid to your registered account at maturity';
  END IF;

  -- Partial withdrawal validation
  IF p_decision = 'partial_exit' THEN
    IF p_slots_to_withdraw IS NULL OR p_slots_to_withdraw <= 0 THEN
      RAISE EXCEPTION 'Enter the number of slots to withdraw (more than zero)';
    END IF;
    IF FLOOR(p_slots_to_withdraw * 2) != p_slots_to_withdraw * 2 THEN
      RAISE EXCEPTION 'Slots to withdraw must be in 0.5 increments';
    END IF;
    IF p_slots_to_withdraw > v_investment.units THEN
      RAISE EXCEPTION 'You cannot withdraw more slots than your current investment.';
    END IF;
    IF p_slots_to_withdraw = v_investment.units THEN
      RAISE EXCEPTION 'You are withdrawing all your slots — please choose "Receive My Profit and Withdraw All My Capital" instead.';
    END IF;
  END IF;

  v_via := CASE WHEN v_is_admin AND v_investor.profile_id != auth.uid()
                THEN 'admin_exception' ELSE 'investor' END;

  INSERT INTO rollover_decisions (
    investment_id, investor_id, source_cycle_id, decision,
    slots_to_withdraw,
    bank_name, account_name, account_number, notes,
    deadline, decided_by, via
  ) VALUES (
    p_investment_id, v_investment.investor_id, v_investment.cycle_id, p_decision,
    CASE WHEN p_decision = 'partial_exit' THEN p_slots_to_withdraw ELSE NULL END,
    COALESCE(p_bank_name, v_investor.bank_name),
    COALESCE(p_account_name, v_investor.account_name),
    COALESCE(p_account_number, v_investor.account_number),
    p_notes, v_deadline, auth.uid(), v_via
  )
  ON CONFLICT (investment_id) DO UPDATE SET
    decision          = EXCLUDED.decision,
    slots_to_withdraw = EXCLUDED.slots_to_withdraw,
    bank_name         = EXCLUDED.bank_name,
    account_name      = EXCLUDED.account_name,
    account_number    = EXCLUDED.account_number,
    notes             = EXCLUDED.notes,
    decided_by        = EXCLUDED.decided_by,
    via               = EXCLUDED.via,
    updated_at        = NOW();

  UPDATE investments SET
    maturity_decision   = p_decision,
    maturity_decided_at = NOW(),
    updated_at          = NOW()
  WHERE id = p_investment_id;

  RETURN jsonb_build_object(
    'success', TRUE,
    'decision', p_decision,
    'slots_to_withdraw', p_slots_to_withdraw,
    'deadline', v_deadline
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Keep the legacy wrapper working
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

-- 3. process_cycle_rollover — profit is always paid out; the default
--    for investors with no instruction is now capital-continues (not
--    capital+profit rollover); partial_exit supported.
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
  v_cap_withdrawn NUMERIC(20,2);
  v_slots_out     NUMERIC(12,2);
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

  IF NOT EXISTS (SELECT 1 FROM cycle_profit_declarations WHERE cycle_id = p_source_cycle_id) THEN
    RAISE EXCEPTION 'Profit has not been declared for this cycle. Declare the final Mudarabah profit first.';
  END IF;

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
      v_decision      := NULL;
      v_method        := NULL;
      v_new_inv_id    := NULL;
      v_new_units     := NULL;
      v_capital_roll  := 0;
      v_profit_roll   := 0;
      v_withdrawal    := 0;
      v_cap_withdrawn := 0;
      v_slots_out     := 0;
      v_balance       := 0;

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

      -- Resolve instruction. Default (no instruction): profit is paid,
      -- capital continues into the next cycle.
      SELECT * INTO v_decision_row FROM rollover_decisions
      WHERE investment_id = v_inv.id;
      IF FOUND THEN
        v_decision  := v_decision_row.decision;
        v_method    := CASE WHEN v_decision_row.via = 'admin_exception'
                            THEN 'admin_exception' ELSE 'investor_choice' END;
        v_slots_out := COALESCE(v_decision_row.slots_to_withdraw, 0);
        v_bank_name    := v_decision_row.bank_name;
        v_account_name := v_decision_row.account_name;
        v_account_num  := v_decision_row.account_number;
      ELSE
        v_decision := 'continue';
        v_method   := 'automatic';
        v_bank_name    := v_investor.bank_name;
        v_account_name := v_investor.account_name;
        v_account_num  := v_investor.account_number;
      END IF;

      -- Profit is paid for every decision except the legacy
      -- rollover_all, so bank details are required.
      IF v_decision != 'rollover_all'
         AND (v_bank_name IS NULL OR v_account_name IS NULL OR v_account_num IS NULL) THEN
        RAISE EXCEPTION 'Missing bank details for payout (investor %)', v_investor.investor_code;
      END IF;

      IF v_decision = 'partial_exit'
         AND (v_slots_out <= 0 OR v_slots_out >= v_inv.units) THEN
        RAISE EXCEPTION 'Invalid partial withdrawal of % slots for investment %', v_slots_out, v_inv.investment_code;
      END IF;

      -- Profit payout request (all decisions except rollover_all)
      IF v_decision != 'rollover_all' THEN
        INSERT INTO payment_requests (
          request_code, investor_id, investment_id, type, amount,
          bank_name, account_name, account_number, notes
        ) VALUES (
          generate_payment_code('roi'), v_inv.investor_id, v_inv.id, 'roi',
          v_inv.declared_profit, v_bank_name, v_account_name, v_account_num,
          'Cycle maturity — profit payout'
        );
      END IF;

      -- Capital payout request (full or partial withdrawal)
      IF v_decision = 'exit' THEN
        v_cap_withdrawn := v_inv.capital;
      ELSIF v_decision = 'partial_exit' THEN
        v_cap_withdrawn := ROUND(v_slots_out * v_series.price_per_unit, 2);
      END IF;
      IF v_cap_withdrawn > 0 THEN
        INSERT INTO payment_requests (
          request_code, investor_id, investment_id, type, amount,
          bank_name, account_name, account_number, notes
        ) VALUES (
          generate_payment_code('capital'), v_inv.investor_id, v_inv.id, 'capital',
          v_cap_withdrawn, v_bank_name, v_account_name, v_account_num,
          CASE WHEN v_decision = 'exit'
               THEN 'Cycle maturity — capital withdrawal'
               ELSE FORMAT('Cycle maturity — partial withdrawal of %s slot(s)', v_slots_out) END
        );
      END IF;

      IF v_decision = 'exit' THEN
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
          withdrawal_amount, slots_withdrawn, processed_by
        ) VALUES (
          v_inv.investor_id, v_inv.id, p_source_cycle_id,
          NULL, v_source.series_id, 'exit', v_method, 'withdrawn',
          v_withdrawal, v_inv.units, auth.uid()
        )
        ON CONFLICT (previous_investment_id) DO UPDATE SET
          decision = EXCLUDED.decision, method = EXCLUDED.method,
          status = 'withdrawn', withdrawal_amount = EXCLUDED.withdrawal_amount,
          slots_withdrawn = EXCLUDED.slots_withdrawn,
          error = NULL, rollover_date = NOW(), processed_by = EXCLUDED.processed_by;

        PERFORM create_notification(
          v_investor.profile_id,
          'Withdrawal Processed',
          FORMAT('Your profit and capital withdrawal for %s (Series %s) has been submitted. Payment requests are pending approval.',
            v_source.cycle_label, v_series.name),
          'payment', '/payment-requests'
        );

        v_withdrawn := v_withdrawn + 1;
      ELSE
        -- Continuing (all or remaining) capital
        v_capital_roll := v_inv.capital - v_cap_withdrawn;
        v_profit_roll  := CASE WHEN v_decision = 'rollover_all'
                               THEN v_inv.declared_profit ELSE 0 END;
        v_withdrawal   := v_cap_withdrawn +
                          CASE WHEN v_decision = 'rollover_all' THEN 0
                               ELSE v_inv.declared_profit END;
        v_total_roll   := v_capital_roll + v_profit_roll;

        IF p_convert_profit_to_slots THEN
          v_new_units := FLOOR(v_total_roll / v_half_slot) / 2;
          v_new_units := GREATEST(v_new_units, v_inv.units - v_slots_out);
        ELSE
          v_new_units := v_inv.units - v_slots_out;
        END IF;

        v_balance := v_total_roll - (v_new_units * v_series.price_per_unit);
        IF v_balance < 0 THEN
          v_balance := 0;
        END IF;

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
          slots_withdrawn, decision, method, status, processed_by
        ) VALUES (
          v_inv.investor_id, v_inv.id, v_new_inv_id,
          p_source_cycle_id, v_dest.id, v_source.series_id,
          v_new_units, v_capital_roll, v_profit_roll,
          v_total_roll, v_balance, v_withdrawal,
          v_slots_out, v_decision, v_method, 'completed', auth.uid()
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
          slots_withdrawn = EXCLUDED.slots_withdrawn,
          decision = EXCLUDED.decision, method = EXCLUDED.method,
          status = 'completed', error = NULL,
          rollover_date = NOW(), processed_by = EXCLUDED.processed_by;

        PERFORM create_notification(
          v_investor.profile_id,
          'Investment Continued Into Next Cycle',
          FORMAT('Your Series %s investment has been rolled from %s into %s. Log in to view your updated timeline.',
            v_series.name, v_source.cycle_label, v_dest.cycle_label),
          'investment', FORMAT('/investments/%s', v_new_inv_id)
        );

        v_processed := v_processed + 1;
      END IF;

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
        'slots_withdrawn', v_slots_out,
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
        COALESCE(v_decision, 'continue'), COALESCE(v_method, 'automatic'),
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
