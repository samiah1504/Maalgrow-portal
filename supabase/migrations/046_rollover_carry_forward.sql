-- ============================================================
-- 046 — the carry-forward the batch rollover never recorded
--
-- THE REPORT. Series C, May–Aug 2026: 32 investors, 67.5 slots,
-- ₦33,750,000 of capital — and a warning that ₦16,500,000 of it has
-- no confirmed payment behind it. Thirty-three slots. Half the cycle,
-- flagged as money nobody had paid.
--
-- THE CAUSE. There are TWO paths that continue an investor's capital
-- into the next cycle, and only one of them recorded the money.
--
--   mudarabah_enrol_next_cycle    per investor, when they submit
--                                 their maturity instruction.
--                                 Writes a confirmed 'rollover'
--                                 payment. Correct.
--
--   process_cycle_rollover        the batch, when an administrator
--                                 processes a whole cycle. Creates
--                                 the new investment with its capital
--                                 and NO payment row at all.
--
-- investment_confirmed_paid() sums confirmed payments, so every
-- investor moved by the batch path read as entirely unfunded. The
-- money is real: it arrived in the previous cycle and was never
-- withdrawn. Nothing was lost and nobody owes anything — the ledger
-- simply had no row saying where it came from.
--
-- This is the same fault migration 036 fixed for the per-investor
-- path, in the one place 036 did not look. 036 even says why it
-- matters: "a rolled-over enrolment has capital but no payment
-- record, so investment_funding_gaps would report the ENTIRE new
-- cycle as unfunded." That is precisely what happened here.
--
-- ── TWO PARTS ────────────────────────────────────────────────
--
-- 1. process_cycle_rollover records the carry-forward from now on.
--    Byte-for-byte the 036 function but for that INSERT — the text
--    was copied programmatically and diffed, 29 lines added and none
--    removed, rather than retyped.
--
-- 2. The enrolments already sitting there are backfilled. Only where
--    a payment is genuinely ABSENT, only for investments that came
--    from a rollover (parent_investment_id), and only for the amount
--    actually missing. It reports what it did rather than doing it
--    silently.
--
-- WHAT THIS DOES NOT DO. It does not invent money. An investor who
-- genuinely has not paid has no parent investment, so nothing here
-- touches them and they stay on the funding-gap report — which is
-- where a real unpaid slot belongs.
--
-- Re-runnable: the second run finds nothing to backfill.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The batch path, now recording what it moves.
-- ------------------------------------------------------------
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
    -- 036: resolved by mudarabah_next_cycle. This matched
    -- start_date = v_source.end_date exactly, which held only while
    -- a cycle began on the day the previous one ended. Cycles now
    -- begin the day after, and both conventions resolve through
    -- that function, so nothing had to be backfilled.
    SELECT * INTO v_dest FROM cycles
    WHERE id = mudarabah_next_cycle(p_source_cycle_id);
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

      -- 035: capital owed, then the SHARED helper for the requests.
      -- These used to be two blind INSERTs paying v_inv.declared_profit
      -- — the GROSS, before withholding tax. And now that submitting
      -- an instruction raises the request itself, inserting here
      -- unconditionally would raise every one of them a second time.
      -- sync_maturity_payment_requests reconciles instead: it pays the
      -- net, creates only what is missing, and leaves anything already
      -- approved or paid alone.
      IF v_decision = 'exit' THEN
        v_cap_withdrawn := v_inv.capital;
      ELSIF v_decision = 'partial_exit' THEN
        v_cap_withdrawn := ROUND(v_slots_out * v_series.price_per_unit, 2);
      END IF;

      PERFORM sync_maturity_payment_requests(v_inv.id);

      IF v_decision = 'exit' THEN
        -- 035: net. The withheld tax is not the investor's to receive.
        v_withdrawal := v_inv.capital + COALESCE(v_inv.declared_profit_net, v_inv.declared_profit);

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
                               THEN COALESCE(v_inv.declared_profit_net, v_inv.declared_profit) ELSE 0 END;
        v_withdrawal   := v_cap_withdrawn +
                          CASE WHEN v_decision = 'rollover_all' THEN 0
                               ELSE COALESCE(v_inv.declared_profit_net, v_inv.declared_profit) END;
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

        /*
         * 046 — THE CARRY-FORWARD, WHICH THIS PATH NEVER RECORDED.
         *
         * The new enrolment has capital but, until now, no payment
         * behind it. investment_confirmed_paid() therefore returned
         * zero and every rolled-over investor read as unfunded — on
         * Series C that was 33 slots, half the cycle, flagged as
         * money nobody had paid.
         *
         * The money is real. It arrived in the previous cycle and was
         * never withdrawn. mudarabah_enrol_next_cycle records exactly
         * this for the per-investor path; this is the same row, for
         * the batch path, so the two agree.
         */
        IF v_total_roll > 0 THEN
          INSERT INTO investment_payments (
            investment_id, investor_id, series_id, cycle_id,
            amount, units, payment_date, status, method,
            reference, notes, created_by
          ) VALUES (
            v_new_inv_id, v_inv.investor_id, v_source.series_id, v_dest.id,
            v_total_roll, v_new_units, v_dest.start_date, 'confirmed', 'rollover',
            FORMAT('ROLL-%s', v_inv.investment_code),
            FORMAT('Capital carried forward from %s', v_source.cycle_label),
            auth.uid()
          )
          ON CONFLICT DO NOTHING;
        END IF;

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


-- ------------------------------------------------------------
-- 2. The enrolments already on the books.
--
--    Reports rather than assumes. If this returns rows you did not
--    expect, that is a question about the data and not something to
--    have happened quietly during a migration.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION backfill_rollover_carry_forward(
  p_cycle_id UUID DEFAULT NULL,
  p_apply    BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  investment_code TEXT,
  investor_name   TEXT,
  cycle_label     TEXT,
  capital         NUMERIC,
  already_paid    NUMERIC,
  carried_forward NUMERIC,
  applied         BOOLEAN
) AS $$
DECLARE
  v_row     RECORD;
  v_missing NUMERIC;
BEGIN
  PERFORM mudarabah_assert_admin();

  FOR v_row IN
    SELECT i.id, i.investment_code, i.investor_id, i.series_id, i.cycle_id,
           i.units, i.capital, i.parent_investment_id,
           inv.full_name, c.cycle_label, c.start_date,
           p.investment_code AS parent_code,
           pc.cycle_label    AS parent_cycle_label,
           investment_confirmed_paid(i.id) AS paid
    FROM investments i
    JOIN investors inv ON inv.id = i.investor_id
    JOIN cycles c      ON c.id = i.cycle_id
    JOIN investments p ON p.id = i.parent_investment_id
    LEFT JOIN cycles pc ON pc.id = p.cycle_id
    WHERE i.parent_investment_id IS NOT NULL
      AND i.status::TEXT = 'active'
      AND (p_cycle_id IS NULL OR i.cycle_id = p_cycle_id)
      AND i.capital > investment_confirmed_paid(i.id)
    ORDER BY inv.full_name
  LOOP
    -- Exactly what is missing, never the whole capital. A partial
    -- top-up already recorded must not be counted twice.
    v_missing := v_row.capital - v_row.paid;

    IF p_apply AND v_missing > 0 THEN
      INSERT INTO investment_payments (
        investment_id, investor_id, series_id, cycle_id,
        amount, units, payment_date, status, method,
        reference, notes, created_by
      ) VALUES (
        v_row.id, v_row.investor_id, v_row.series_id, v_row.cycle_id,
        v_missing, v_row.units, v_row.start_date, 'confirmed', 'rollover',
        FORMAT('ROLL-%s', v_row.parent_code),
        FORMAT('Capital carried forward from %s (recorded by migration 046)',
               COALESCE(v_row.parent_cycle_label, 'the previous cycle')),
        auth.uid()
      );
    END IF;

    investment_code := v_row.investment_code;
    investor_name   := v_row.full_name;
    cycle_label     := v_row.cycle_label;
    capital         := v_row.capital;
    already_paid    := v_row.paid;
    carried_forward := v_missing;
    applied         := p_apply;
    RETURN NEXT;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION backfill_rollover_carry_forward(UUID, BOOLEAN)
      FROM anon, authenticated;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Run it, here, as the migration itself.
--
--    Deliberately NOT through the function above. That one is gated
--    on mudarabah_assert_admin() for later manual use, and a
--    migration has no signed-in user — it would refuse itself. This
--    is the same rows as one statement, which is also easier to read
--    than a loop.
--
--    The NOTICE is the point: a migration that writes money rows
--    should never do it silently.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_n     INTEGER := 0;
  v_total NUMERIC := 0;
BEGIN
  WITH missing AS (
    SELECT i.id, i.investor_id, i.series_id, i.cycle_id, i.units,
           i.capital - investment_confirmed_paid(i.id) AS shortfall,
           c.start_date,
           p.investment_code AS parent_code,
           pc.cycle_label    AS parent_cycle
    FROM investments i
    JOIN cycles c       ON c.id = i.cycle_id
    JOIN investments p  ON p.id = i.parent_investment_id
    LEFT JOIN cycles pc ON pc.id = p.cycle_id
    WHERE i.parent_investment_id IS NOT NULL
      AND i.status::TEXT = 'active'
      AND i.capital > investment_confirmed_paid(i.id)
  ),
  inserted AS (
    INSERT INTO investment_payments (
      investment_id, investor_id, series_id, cycle_id,
      amount, units, payment_date, status, method, reference, notes
    )
    SELECT m.id, m.investor_id, m.series_id, m.cycle_id,
           m.shortfall, m.units, m.start_date, 'confirmed', 'rollover',
           FORMAT('ROLL-%s', m.parent_code),
           FORMAT('Capital carried forward from %s (recorded by migration 046)',
                  COALESCE(m.parent_cycle, 'the previous cycle'))
    FROM missing m
    WHERE m.shortfall > 0
    RETURNING amount
  )
  SELECT COUNT(*), COALESCE(SUM(amount), 0) INTO v_n, v_total FROM inserted;

  RAISE NOTICE '046: % rolled-over enrolment(s) backfilled, % carried forward in total',
    v_n, v_total;
  IF v_n = 0 THEN
    RAISE NOTICE '046: nothing to backfill — every rolled-over enrolment already had its carry-forward recorded.';
  END IF;
END $$;
