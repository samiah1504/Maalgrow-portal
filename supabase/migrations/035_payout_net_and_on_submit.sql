-- ============================================================
-- 035 — pay the NET, and raise the request when the investor asks
--
-- ── THE SERIOUS ONE ──────────────────────────────────────────
--
-- process_cycle_rollover raises each investor's profit payment
-- request for v_inv.declared_profit. That is the GROSS. Settlement
-- writes both figures — declared_profit is before tax,
-- declared_profit_net is after — and the investor receives the net;
-- the difference is withheld and owed to the tax authority.
--
-- On the Series B cycle just settled that is ₦10,938,055 requested
-- against ₦9,844,249 actually due: ₦1,093,806 too much, which is
-- precisely the withholding tax. Paying it out would hand investors
-- money already earmarked for FIRS and leave nothing to remit — and
-- the credit notes issued afterwards would certify tax that had been
-- given away.
--
-- The bug predates withholding tax: 012 was written when
-- declared_profit was the only figure there was, and 018 added the
-- net column without revisiting the payout. Every money-bearing use
-- now reads the net.
--
-- ── AND WHAT WAS ASKED FOR ───────────────────────────────────
--
-- Payment requests were only ever raised in bulk, when an
-- administrator processed the whole cycle's rollover. So an investor
-- who submitted an instruction saw nothing happen and could not be
-- paid until everybody else had decided too.
--
-- Submitting an instruction now raises the request itself. The
-- instruction IS the request: it says whether the investor wants
-- their profit, or their profit and their capital.
--
-- NOTHING IS RAISED TWICE. sync_maturity_payment_requests is
-- idempotent — it reconciles what should exist against what does,
-- and process_cycle_rollover calls the same helper instead of
-- inserting blindly. An investor who changes their mind has their
-- PENDING requests corrected; one that has been approved or paid is
-- never touched, because that money has already moved.
--
-- NOTHING IS RAISED EARLY. Before settlement there is no declared
-- profit, so there is no amount to request and the helper does
-- nothing. Settle first, then they decide, then they are paid — the
-- order migration 030 established.
--
-- Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. What this investor should be owed, given their instruction.
--
--    Reconciles rather than inserts. Called on every submission and
--    by the rollover, so the two can never disagree or duplicate.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_maturity_payment_requests(p_investment_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_inv       investments%ROWTYPE;
  v_investor  investors%ROWTYPE;
  v_series    series%ROWTYPE;
  v_cycle     cycles%ROWTYPE;
  v_decision  TEXT;
  v_slots_out NUMERIC(12,2) := 0;
  v_profit    NUMERIC(20,2);
  v_capital   NUMERIC(20,2) := 0;
  v_bank      TEXT;
  v_acct_name TEXT;
  v_acct_num  TEXT;
  v_created   INTEGER := 0;
  v_removed   INTEGER := 0;
BEGIN
  SELECT * INTO v_inv FROM investments WHERE id = p_investment_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('skipped', 'no such enrolment'); END IF;

  -- Nothing to ask for until the profit exists. Before settlement
  -- this is the normal case, not an error.
  IF v_inv.declared_profit IS NULL THEN
    RETURN jsonb_build_object('skipped', 'profit not declared yet');
  END IF;

  SELECT * INTO v_investor FROM investors WHERE id = v_inv.investor_id;
  SELECT * INTO v_series   FROM series    WHERE id = v_inv.series_id;
  SELECT * INTO v_cycle    FROM cycles    WHERE id = v_inv.cycle_id;

  SELECT rd.decision::TEXT, COALESCE(rd.slots_to_withdraw, 0),
         rd.bank_name, rd.account_name, rd.account_number
    INTO v_decision, v_slots_out, v_bank, v_acct_name, v_acct_num
  FROM rollover_decisions rd WHERE rd.investment_id = p_investment_id;

  -- No instruction yet: the capital question is open, so only the
  -- profit is owed. Consistent with migration 030.
  v_decision  := COALESCE(v_decision, 'continue');
  v_bank      := COALESCE(v_bank, v_investor.bank_name);
  v_acct_name := COALESCE(v_acct_name, v_investor.account_name);
  v_acct_num  := COALESCE(v_acct_num, v_investor.account_number);

  -- THE NET. What the investor receives; the rest is withheld.
  v_profit := COALESCE(v_inv.declared_profit_net, v_inv.declared_profit);

  IF v_decision = 'exit' THEN
    v_capital := v_inv.capital;
  ELSIF v_decision = 'partial_exit' THEN
    v_capital := ROUND(v_slots_out * COALESCE(v_cycle.unit_value, v_series.price_per_unit), 2);
  END IF;

  -- The legacy rollover_all pays nothing out at all.
  IF v_decision = 'rollover_all' THEN
    v_profit := 0;
  END IF;

  IF v_bank IS NULL OR v_acct_name IS NULL OR v_acct_num IS NULL THEN
    RETURN jsonb_build_object('skipped', 'no bank details on record');
  END IF;

  -- Clear PENDING requests that no longer match. Anything approved,
  -- processing or paid is left exactly as it is: that money has
  -- moved, or is moving, and a change of mind cannot unmake it.
  WITH gone AS (
    DELETE FROM payment_requests pr
    WHERE pr.investment_id = p_investment_id
      AND pr.status = 'pending'
      AND (
        (pr.type = 'roi'     AND (v_profit  <= 0 OR pr.amount <> v_profit))
        OR (pr.type = 'capital' AND (v_capital <= 0 OR pr.amount <> v_capital))
      )
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_removed FROM gone;

  IF v_profit > 0 AND NOT EXISTS (
    SELECT 1 FROM payment_requests
    WHERE investment_id = p_investment_id AND type = 'roi'
      AND status <> 'rejected'
  ) THEN
    INSERT INTO payment_requests (
      request_code, investor_id, investment_id, type, amount,
      bank_name, account_name, account_number, notes
    ) VALUES (
      generate_payment_code('roi'), v_inv.investor_id, p_investment_id, 'roi',
      v_profit, v_bank, v_acct_name, v_acct_num,
      FORMAT('%s — profit payout, net of withholding tax', v_cycle.cycle_label)
    );
    v_created := v_created + 1;
  END IF;

  IF v_capital > 0 AND NOT EXISTS (
    SELECT 1 FROM payment_requests
    WHERE investment_id = p_investment_id AND type = 'capital'
      AND status <> 'rejected'
  ) THEN
    INSERT INTO payment_requests (
      request_code, investor_id, investment_id, type, amount,
      bank_name, account_name, account_number, notes
    ) VALUES (
      generate_payment_code('capital'), v_inv.investor_id, p_investment_id, 'capital',
      v_capital, v_bank, v_acct_name, v_acct_num,
      CASE WHEN v_decision = 'exit'
           THEN FORMAT('%s — capital withdrawal', v_cycle.cycle_label)
           ELSE FORMAT('%s — partial withdrawal of %s slot(s)', v_cycle.cycle_label, v_slots_out) END
    );
    v_created := v_created + 1;
  END IF;

  RETURN jsonb_build_object(
    'created', v_created, 'removedPending', v_removed,
    'profit', v_profit, 'capital', v_capital, 'decision', v_decision
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION sync_maturity_payment_requests(UUID) FROM anon, authenticated;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. submit_rollover_decision raises the request.
--
--    Byte-for-byte the 034 version but for the added call —
--    verified by diff.
-- ------------------------------------------------------------
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
  v_sync       JSONB;
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
  -- 027: the window, so a prompt is never shown for something that
  -- would then be refused.
  v_deadline := rollover_decision_deadline(v_investment.cycle_id);

  -- 034: instructions stay open until the CAPITAL moves, not until
  -- the profit is declared. Settling matures every investment in the
  -- cycle, and this used to read status != 'active' — so the moment a
  -- cycle settled, every investor was refused, including the ones the
  -- portal was still actively asking. Rolling over is the capital
  -- event, and next_investment_id above already refuses that case.
  IF (v_investment.status NOT IN ('active', 'matured') OR CURRENT_DATE > v_deadline)
     AND NOT (v_is_admin AND p_admin_override) THEN
    RAISE EXCEPTION 'Maturity instructions are closed for this investment — its capital has already been processed.';
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

  -- 035: the instruction IS the request. Raising it here means an
  -- investor who has decided can be paid without waiting for
  -- everybody else. Idempotent, and a no-op before the profit is
  -- declared, so nothing is raised twice or early.
  --
  -- Called ONCE and kept. It is idempotent, but a second call would
  -- report zero created — which is true of the call, and misleading
  -- about the submission.
  v_sync := sync_maturity_payment_requests(p_investment_id);

  RETURN jsonb_build_object(
    'success', TRUE,
    'decision', p_decision,
    'slots_to_withdraw', p_slots_to_withdraw,
    'deadline', v_deadline,
    'paymentRequests', v_sync
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. process_cycle_rollover pays the net, through the helper.
--
--    Byte-for-byte the 012 version but for the two blind
--    INSERTs, now one call, and three arithmetic uses of the
--    gross figure — verified by diff.
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
