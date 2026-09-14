-- ============================================================
-- 048 — one rollover engine
--
-- SUPERSEDES 046. Migration 046 (rollover_carry_forward) is in the
-- repository but WAS NEVER APPLIED to production, and must not be:
-- it recorded the carry-forward payment as the batch's whole carried
-- amount, which for a rollover_all is capital PLUS profit — so it
-- would have closed the funding gap on an inflated figure. 046 stays
-- on disk, unrun, as history. This migration replaces the function
-- 046 would have replaced, with the correct amount.
--
-- ── THE PROBLEM ──────────────────────────────────────────────
--
-- Two functions moved an investor into the next cycle, and each was
-- right about something the other got wrong. Measured on the same
-- rollover_all investor, N500,000 capital + N125,000 net profit:
--
--                         new investment capital   cycle_rollovers.capital_rolled_over
--   mudarabah_enrol_next_cycle    500,000  correct      625,000  WRONG (profit counted twice)
--   process_cycle_rollover        625,000  WRONG        500,000  correct
--
-- The batch also recorded no carry-forward payment, so every investor
-- it moved read as unfunded; the individual path left the old
-- enrolment at 'matured' for ever, so it read as still awaiting
-- rollover. Mirror-image defects. Promoting either function to "the
-- engine" would have imported its own bug.
--
-- ── THE SHAPE ────────────────────────────────────────────────
--
--   submit_rollover_decision ─┐                 ┌─ process_cycle_rollover
--     (validates, persists,   │                 │   (admin gate, loop,
--      decision = submitted)  │                 │    decision = submitted
--                             │                 │    OR 'continue' default,
--   mudarabah_enrol_next_cycle│                 │    tallies, report)
--     (thin wrapper, keeps    │                 │
--      its refusals)          ▼                 ▼
--                        mudarabah_roll_one()  ← the only place that
--                                                 creates a successor,
--                                                 funds it, closes the
--                                                 old one, and writes
--                                                 cycle_rollovers
--
-- p_decision is a PARAMETER. Resolving "what did the investor choose"
-- is exactly where the two callers legitimately differ — no
-- instruction means "not yet" to the individual path and "apply the
-- default" to the batch, because of WHEN each runs — so that stays
-- with them. Everything after it is identical, so it lives here once.
--
-- ── WHAT IS DELIBERATELY UNCHANGED ───────────────────────────
--
--   * Bank-details validation. Required before a decision can be
--     submitted (submit_rollover_decision) and re-checked by the
--     batch before it processes anyone. Neither check moves.
--   * No instruction → 'continue', method 'automatic'. As documented
--     in 030/035/036. Flagged, not altered.
--   * Half-slot withdrawal granularity.
--   * declare_cycle_profit (032/047).
--   * sync_maturity_payment_requests (035) — in every respect but
--     one, described under section 5.
--   * All date rules. Those are 049's concern.
--   * Existing data. Not one row is corrected here.
--
-- ── THE BALANCE, AND WHAT IT IS NOT ──────────────────────────
--
-- There is no accumulated or unpaid profit in this portal. Every
-- cycle's profit is settled once, for that cycle, and either paid
-- out or — on rollover_all — reinvested there and then.
-- rollover_balance is not a profit account. It is carried economic
-- value from a prior rollover that did not become slot-backed
-- capital, and investments.capital is slot-backed capital only.
-- The engine keeps those apart, carries the balance on every later
-- rollover, counts it once, and pays it out on exit.
--
-- cycle_rollovers.capital_rolled_over therefore means ALL non-profit
-- value carried (slot-backed capital plus any balance that arrived
-- with it); profit_rolled_over is the current cycle's profit on a
-- rollover_all; the two always sum to total_rollover_amount. Its
-- three readers — the CSV export, the rollover page's "capital
-- continuing" figure, and the rollover email — all treat it as
-- "what continued", which it now is exactly.
--
-- Re-runnable: every statement is CREATE OR REPLACE.
-- ============================================================


-- ------------------------------------------------------------
-- 1. THE ENGINE.
--
--    Given an investment and an ALREADY-RESOLVED decision, do exactly
--    what that decision means and nothing else. Returns JSONB with
--    'outcome' ∈ rolled | withdrawn | skipped, plus 'enrolled' for
--    callers that read the older shape.
--
--    Internal. Revoked from anon and authenticated; reached only
--    through the two SECURITY DEFINER callers below.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_roll_one(
  p_investment_id        UUID,
  p_decision             maturity_decision,
  p_slots_to_withdraw    NUMERIC DEFAULT 0,
  p_destination_cycle_id UUID    DEFAULT NULL,
  p_method               TEXT    DEFAULT 'investor_choice'
)
RETURNS JSONB AS $$
DECLARE
  v_inv           investments%ROWTYPE;
  v_investor      investors%ROWTYPE;
  v_series        series%ROWTYPE;
  v_source        cycles%ROWTYPE;
  v_dest          cycles%ROWTYPE;
  v_dest_id       UUID;
  v_slots_out     NUMERIC(12,2) := 0;
  v_new_units     NUMERIC(12,2);
  v_price         NUMERIC(20,2);   -- destination slot value
  v_src_price     NUMERIC(20,2);   -- source slot value, for the withdrawn part
  v_profit_net    NUMERIC(20,2);
  v_slot_value    NUMERIC(20,2);   -- what the OLD enrolment's slots are worth
  v_balance_in    NUMERIC(20,2);   -- balance arriving from an earlier rollover, counted once
  v_cap_withdrawn NUMERIC(20,2) := 0;
  v_capital_roll  NUMERIC(20,2);   -- old capital that continues
  v_profit_roll   NUMERIC(20,2) := 0;
  v_carried       NUMERIC(20,2);   -- total economic value carried
  v_capital       NUMERIC(20,2);   -- new investment capital = units x price
  v_funded        NUMERIC(20,2);   -- the carry-forward payment
  v_balance       NUMERIC(20,2);   -- carried value not represented by units
  v_withdrawal    NUMERIC(20,2);
  v_new_inv_id    UUID;
  v_new_inv_code  TEXT;
  v_code_suffix   INTEGER;
BEGIN
  IF p_method NOT IN ('investor_choice', 'automatic', 'admin_exception') THEN
    RAISE EXCEPTION 'Unknown rollover method: %', p_method;
  END IF;

  -- ROW LOCK. The individual path and the batch can race on the same
  -- investment; whichever arrives second waits here and then sees
  -- next_investment_id already set. This, not the status, is the
  -- idempotency guard, because it is the one thing both paths write.
  SELECT * INTO v_inv FROM investments WHERE id = p_investment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'outcome', 'skipped', 'reason', 'no such enrolment');
  END IF;
  IF v_inv.next_investment_id IS NOT NULL THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'outcome', 'skipped', 'reason', 'already enrolled',
                              'investmentId', v_inv.next_investment_id);
  END IF;
  IF v_inv.status::TEXT = 'cancelled' THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'outcome', 'skipped', 'reason', 'enrolment cancelled');
  END IF;
  -- 'completed' with no successor is an exit already recorded (or a
  -- legacy row). Either way its capital has been dealt with.
  IF v_inv.status::TEXT = 'completed' THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'outcome', 'skipped', 'reason', 'already closed');
  END IF;
  -- Before settlement there is no profit and no next cycle to join.
  -- Not an error: the instruction is on record, and this runs again
  -- when the administrator processes the cycle.
  IF v_inv.declared_profit IS NULL THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'outcome', 'skipped', 'reason', 'cycle not settled yet');
  END IF;

  SELECT * INTO v_investor FROM investors WHERE id = v_inv.investor_id;
  SELECT * INTO v_series   FROM series    WHERE id = v_inv.series_id;
  SELECT * INTO v_source   FROM cycles    WHERE id = v_inv.cycle_id;

  v_profit_net := COALESCE(v_inv.declared_profit_net, v_inv.declared_profit, 0);
  v_src_price  := COALESCE(v_source.unit_value, v_series.price_per_unit);

  -- ── THE BALANCE ARRIVING FROM AN EARLIER ROLLOVER ─────────────
  --
  -- An enrolment that came out of a rollover_all carries a
  -- rollover_balance: value that continued but did not buy a slot.
  -- It is the investor's money and must travel with them on EVERY
  -- later rollover, and be paid to them on exit. Neither previous
  -- implementation carried it past the first rollover: the individual
  -- path read investments.capital alone, so a second rollover_all
  -- silently dropped it.
  --
  -- Counted ONCE. Rows written by the old batch have the balance
  -- already inside capital (capital = slot value + balance) AND in
  -- rollover_balance. Rows written by the individual path, and by
  -- this engine, keep them apart (capital = slot value). The excess
  -- of capital over the slots' value is therefore exactly the part
  -- of the balance that is already counted, and is not added again.
  -- A correct row has no excess and carries its full balance; a
  -- legacy row has excess = balance and carries none twice.
  v_slot_value := ROUND(v_inv.units * v_src_price, 2);
  v_balance_in := COALESCE(v_inv.rollover_balance, 0);
  v_balance_in := v_balance_in - LEAST(v_balance_in, GREATEST(v_inv.capital - v_slot_value, 0));

  -- ============================================================
  -- EXIT. Mutually exclusive with everything below: this branch
  -- RETURNS. No destination is resolved, no successor is created,
  -- next_investment_id stays NULL. The capital and profit are paid
  -- through the payment-request flow the caller has already run.
  -- ============================================================
  IF p_decision = 'exit' THEN
    -- Everything the investor has here leaves: slot-backed capital,
    -- any balance carried from earlier cycles, and this cycle's net
    -- profit. This is the audit figure; the payment requests are
    -- raised by sync_maturity_payment_requests, not here.
    v_withdrawal := v_inv.capital + v_balance_in + v_profit_net;

    UPDATE investments SET
      status              = 'completed',
      maturity_decision   = 'exit',
      maturity_decided_at = COALESCE(v_inv.maturity_decided_at, NOW()),
      updated_at          = NOW()
    WHERE id = p_investment_id;

    INSERT INTO cycle_rollovers (
      investor_id, previous_investment_id, source_cycle_id,
      destination_cycle_id, series_id, units,
      capital_rolled_over, profit_rolled_over, total_rollover_amount,
      rollover_balance, withdrawal_amount, slots_withdrawn,
      decision, method, status, processed_by
    ) VALUES (
      v_inv.investor_id, p_investment_id, v_inv.cycle_id,
      NULL, v_inv.series_id, v_inv.units,
      0, 0, 0,
      0, v_withdrawal, v_inv.units,
      'exit', p_method, 'withdrawn', auth.uid()
    )
    ON CONFLICT (previous_investment_id) DO UPDATE SET
      new_investment_id     = NULL,
      destination_cycle_id  = NULL,
      units                 = EXCLUDED.units,
      capital_rolled_over   = 0,
      profit_rolled_over    = 0,
      total_rollover_amount = 0,
      rollover_balance      = 0,
      withdrawal_amount     = EXCLUDED.withdrawal_amount,
      slots_withdrawn       = EXCLUDED.slots_withdrawn,
      decision              = 'exit',
      method                = EXCLUDED.method,
      status                = 'withdrawn',
      error                 = NULL,
      rollover_date         = NOW(),
      processed_by          = EXCLUDED.processed_by;

    RETURN jsonb_build_object(
      'enrolled',          FALSE,
      'outcome',           'withdrawn',
      'units',             v_inv.units,
      'capitalRolledOver', 0,
      'profitRolledOver',  0,
      'totalRolledOver',   0,
      'rolloverBalance',   0,
      'withdrawalAmount',  v_withdrawal,
      'slotsWithdrawn',    v_inv.units
    );
  END IF;

  -- ============================================================
  -- CONTINUE / PARTIAL_EXIT / ROLLOVER_ALL — a successor is created.
  -- ============================================================
  IF p_decision = 'partial_exit' THEN
    v_slots_out := COALESCE(p_slots_to_withdraw, 0);
    IF v_slots_out <= 0 OR v_slots_out >= v_inv.units THEN
      RAISE EXCEPTION 'Invalid partial withdrawal of % slots for investment %',
        v_slots_out, v_inv.investment_code;
    END IF;
  END IF;

  v_new_units := v_inv.units - v_slots_out;
  IF v_new_units <= 0 THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'outcome', 'skipped', 'reason', 'no slots continue');
  END IF;

  IF p_destination_cycle_id IS NOT NULL THEN
    SELECT * INTO v_dest FROM cycles WHERE id = p_destination_cycle_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Destination cycle not found';
    END IF;
  ELSE
    v_dest_id := mudarabah_ensure_next_cycle(v_inv.cycle_id);
    SELECT * INTO v_dest FROM cycles WHERE id = v_dest_id;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('enrolled', FALSE, 'outcome', 'skipped', 'reason', 'no next cycle');
    END IF;
  END IF;

  IF v_dest.series_id <> v_inv.series_id THEN
    RAISE EXCEPTION 'Destination cycle belongs to a different series';
  END IF;
  IF v_dest.id = v_inv.cycle_id THEN
    RAISE EXCEPTION 'Destination cycle must differ from the source cycle';
  END IF;
  IF v_dest.status::TEXT IN ('completed', 'cancelled', 'matured', 'awaiting_profit_declaration') THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'outcome', 'skipped', 'reason',
      FORMAT('next cycle %s is closed to new allocations', v_dest.cycle_label));
  END IF;

  -- ── THE CAPITAL, ONCE ────────────────────────────────────────
  --
  --   capital_roll  slot-backed capital that continues from the old
  --                 enrolment (less any slots withdrawn)
  --   balance_in    balance carried from earlier cycles, counted once
  --   profit_roll   this cycle's net profit, but only for rollover_all
  --   carried       the total economic value that moves
  --   capital       what the continuing slots are WORTH at the
  --                 destination — this and only this is the new
  --                 investment's capital
  --   balance       carried value the slots do not represent.
  --                 It lives in rollover_balance and NOWHERE ELSE.
  --
  -- First rollover_all, N500,000 + N125,000 net, one N500,000 slot:
  --   capital 500,000 / balance 125,000 / carried 625,000.
  -- Second rollover_all, another N100,000 net:
  --   capital 500,000 / balance 225,000 / carried 725,000.
  -- Never capital 625,000 AND balance 125,000, and never a balance
  -- that quietly stops travelling.
  v_price         := COALESCE(v_dest.unit_value, v_series.price_per_unit);
  v_cap_withdrawn := CASE WHEN p_decision = 'partial_exit'
                          THEN ROUND(v_slots_out * v_src_price, 2) ELSE 0 END;
  v_profit_roll   := CASE WHEN p_decision = 'rollover_all' THEN v_profit_net ELSE 0 END;
  v_capital_roll  := v_inv.capital - v_cap_withdrawn;
  v_carried       := v_capital_roll + v_balance_in + v_profit_roll;
  v_capital       := ROUND(v_new_units * v_price, 2);
  v_funded        := LEAST(v_carried, v_capital);
  v_balance       := GREATEST(v_carried - v_capital, 0);
  v_withdrawal    := v_cap_withdrawn
                   + CASE WHEN p_decision = 'rollover_all' THEN 0 ELSE v_profit_net END;

  -- Belt and braces. The exit branch returned above; if control ever
  -- reaches a successor with an exit decision, that is a bug in this
  -- function and it must fail loudly rather than create one.
  IF p_decision = 'exit' THEN
    RAISE EXCEPTION 'mudarabah_roll_one: exit reached successor creation';
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
    v_new_inv_code, v_inv.investor_id, v_inv.series_id, v_dest.id,
    v_new_units, v_price, v_capital, v_balance,
    v_dest.start_date, v_dest.end_date, 'active',
    p_investment_id, auth.uid(),
    FORMAT('Continued from %s', v_inv.investment_code)
  ) RETURNING id INTO v_new_inv_id;

  -- THE CARRY-FORWARD RECORD. Funded by what carried, never by more:
  -- LEAST(carried, required), so if a slot's value ever rises the
  -- shortfall stays visible in investment_funding_gaps() instead of
  -- being invented here. Idempotent by way of the lock and
  -- next_investment_id above, not by a unique reference.
  IF v_funded > 0 THEN
    INSERT INTO investment_payments (
      investment_id, investor_id, series_id, cycle_id,
      amount, units, payment_date, status, method,
      reference, notes, created_by
    ) VALUES (
      v_new_inv_id, v_inv.investor_id, v_inv.series_id, v_dest.id,
      v_funded, v_new_units, v_dest.start_date, 'confirmed', 'rollover',
      FORMAT('ROLL-%s', v_inv.investment_code),
      FORMAT('Capital carried forward from %s', v_source.cycle_label),
      auth.uid()
    );
  END IF;

  -- The old enrolment is CLOSED and linked. Previously the individual
  -- path left it 'matured' with the reasoning that changing the
  -- status would take the investor out of the cycle they earned their
  -- profit in — but settlement holders are a snapshot taken at
  -- settlement, and the batch had set 'completed' all along, so the
  -- two paths disagreed and an individually-rolled investor read as
  -- still awaiting rollover. mudarabah_unenrol_next_cycle restores
  -- 'matured' on reversal.
  UPDATE investments SET
    status              = 'completed',
    maturity_decision   = p_decision,
    maturity_decided_at = COALESCE(v_inv.maturity_decided_at, NOW()),
    next_investment_id  = v_new_inv_id,
    updated_at          = NOW()
  WHERE id = p_investment_id;

  -- One writer for cycle_rollovers, and the columns reconcile:
  -- capital_rolled_over (all non-profit value carried: slot-backed
  -- capital plus the balance that arrived with it) + profit_rolled_over
  -- (this cycle's profit, rollover_all only) = total_rollover_amount.
  INSERT INTO cycle_rollovers (
    investor_id, previous_investment_id, new_investment_id,
    source_cycle_id, destination_cycle_id, series_id,
    units, capital_rolled_over, profit_rolled_over,
    total_rollover_amount, rollover_balance, withdrawal_amount,
    slots_withdrawn, decision, method, status, processed_by
  ) VALUES (
    v_inv.investor_id, p_investment_id, v_new_inv_id,
    v_inv.cycle_id, v_dest.id, v_inv.series_id,
    v_new_units, v_capital_roll + v_balance_in, v_profit_roll,
    v_carried, v_balance, v_withdrawal,
    v_slots_out, p_decision, p_method, 'completed', auth.uid()
  )
  ON CONFLICT (previous_investment_id) DO UPDATE SET
    new_investment_id     = EXCLUDED.new_investment_id,
    destination_cycle_id  = EXCLUDED.destination_cycle_id,
    units                 = EXCLUDED.units,
    capital_rolled_over   = EXCLUDED.capital_rolled_over,
    profit_rolled_over    = EXCLUDED.profit_rolled_over,
    total_rollover_amount = EXCLUDED.total_rollover_amount,
    rollover_balance      = EXCLUDED.rollover_balance,
    withdrawal_amount     = EXCLUDED.withdrawal_amount,
    slots_withdrawn       = EXCLUDED.slots_withdrawn,
    decision              = EXCLUDED.decision,
    method                = EXCLUDED.method,
    status                = 'completed',
    error                 = NULL,
    rollover_date         = NOW(),
    processed_by          = EXCLUDED.processed_by;

  RETURN jsonb_build_object(
    'enrolled',          TRUE,
    'outcome',           'rolled',
    'investmentId',      v_new_inv_id,
    'investmentCode',    v_new_inv_code,
    'cycleId',           v_dest.id,
    'cycleLabel',        v_dest.cycle_label,
    'units',             v_new_units,
    'capital',           v_capital,
    'carriedForward',    v_funded,
    'rolloverBalance',   v_balance,
    'capitalRolledOver', v_capital_roll + v_balance_in,
    'balanceCarriedIn',  v_balance_in,
    'profitRolledOver',  v_profit_roll,
    'totalRolledOver',   v_carried,
    'withdrawalAmount',  v_withdrawal,
    'slotsWithdrawn',    v_slots_out
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ------------------------------------------------------------
-- 2. THE INDIVIDUAL PATH — now a thin wrapper.
--
--    Same name, same signature, same refusals, same notification,
--    same result shape (a superset). submit_rollover_decision and
--    037's backfill call it exactly as before. The two refusals that
--    made it unsuitable as the engine — "no instruction on record"
--    and "capital withdrawn" — are kept HERE, where they are right:
--    an investor who has not answered must not be moved, and an exit
--    is recorded by the batch, as today.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_enrol_next_cycle(p_investment_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_inv       investments%ROWTYPE;
  v_investor  investors%ROWTYPE;
  v_series    series%ROWTYPE;
  v_decision  TEXT;
  v_slots_out NUMERIC(12,2) := 0;
  v_via       TEXT;
  v_res       JSONB;
BEGIN
  SELECT * INTO v_inv FROM investments WHERE id = p_investment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'no such enrolment');
  END IF;

  IF v_inv.next_investment_id IS NOT NULL THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'already enrolled',
                              'investmentId', v_inv.next_investment_id);
  END IF;

  IF v_inv.declared_profit IS NULL THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'cycle not settled yet');
  END IF;

  SELECT rd.decision::TEXT, COALESCE(rd.slots_to_withdraw, 0), rd.via
    INTO v_decision, v_slots_out, v_via
  FROM rollover_decisions rd WHERE rd.investment_id = p_investment_id;

  IF v_decision IS NULL THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'no instruction on record');
  END IF;

  IF v_decision = 'exit' THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'capital withdrawn');
  END IF;

  v_res := mudarabah_roll_one(
    p_investment_id,
    v_decision::maturity_decision,
    v_slots_out,
    NULL,
    CASE WHEN v_via = 'admin_exception' THEN 'admin_exception' ELSE 'investor_choice' END
  );

  IF COALESCE((v_res->>'enrolled')::BOOLEAN, FALSE) THEN
    SELECT * INTO v_investor FROM investors WHERE id = v_inv.investor_id;
    SELECT * INTO v_series   FROM series    WHERE id = v_inv.series_id;
    PERFORM create_notification(
      v_investor.profile_id,
      'Your Slots Continue Into the Next Cycle',
      FORMAT('%s slot(s) have been carried into %s (%s). Your new investment code is %s.',
        TRIM(TO_CHAR((v_res->>'units')::NUMERIC, 'FM999990.09')),
        v_res->>'cycleLabel', v_series.name, v_res->>'investmentCode'),
      'investment',
      FORMAT('/investments/%s', v_res->>'investmentId')
    );
  END IF;

  RETURN v_res;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ------------------------------------------------------------
-- 3. REVERSAL — restore 'matured' as well as clearing the link.
--
--    Byte-for-byte the 036 function but for the two UPDATEs. Now that
--    the engine closes the old enrolment, a super admin correcting a
--    decision must get it back to the state it was in, or the engine
--    would refuse the corrected re-enrolment as 'already closed'.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_unenrol_next_cycle(p_investment_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_inv investments%ROWTYPE;
  v_new investments%ROWTYPE;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_inv FROM investments WHERE id = p_investment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment not found';
  END IF;

  IF v_inv.next_investment_id IS NULL THEN
    RETURN jsonb_build_object('reversed', FALSE, 'reason', 'nothing to reverse');
  END IF;

  SELECT * INTO v_new FROM investments WHERE id = v_inv.next_investment_id;
  IF NOT FOUND THEN
    UPDATE investments SET next_investment_id = NULL, status = 'matured', updated_at = NOW()
    WHERE id = p_investment_id;
    RETURN jsonb_build_object('reversed', TRUE, 'reason', 'dangling reference cleared');
  END IF;

  IF v_new.declared_profit IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot undo: % has already been settled in its own cycle', v_new.investment_code;
  END IF;
  IF v_new.next_investment_id IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot undo: % has itself already rolled over', v_new.investment_code;
  END IF;
  IF EXISTS (SELECT 1 FROM payment_requests WHERE investment_id = v_new.id) THEN
    RAISE EXCEPTION 'Cannot undo: money has been requested against %', v_new.investment_code;
  END IF;
  IF EXISTS (
    SELECT 1 FROM investment_payments
    WHERE investment_id = v_new.id AND COALESCE(method, '') <> 'rollover'
  ) THEN
    RAISE EXCEPTION 'Cannot undo: fresh money has been paid into %', v_new.investment_code;
  END IF;

  -- The reference first, so nothing points at a row about to go.
  UPDATE investments SET next_investment_id = NULL, status = 'matured', updated_at = NOW()
  WHERE id = p_investment_id;

  DELETE FROM cycle_rollovers     WHERE previous_investment_id = p_investment_id;
  DELETE FROM investment_payments WHERE investment_id = v_new.id;
  DELETE FROM investments         WHERE id = v_new.id;

  RETURN jsonb_build_object(
    'reversed', TRUE,
    'removedInvestment', v_new.investment_code,
    'removedFromCycle',  (SELECT cycle_label FROM cycles WHERE id = v_new.cycle_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ------------------------------------------------------------
-- 4. THE BATCH — orchestration and reporting only.
--
--    Everything before the loop is the 036 text unchanged: the admin
--    gate, the profit-declared gate, destination resolution and
--    validation, activating a destination whose day has come. Inside
--    the loop the decision is resolved exactly as before — including
--    the 'continue' default and the bank-details check — and then
--    the move is delegated. The batch no longer computes capital.
--
--    p_convert_profit_to_slots is kept for signature compatibility.
--    Nothing in the portal sends it; the engine does not implement
--    it, so TRUE is refused rather than silently ignored.
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
  v_slots_out     NUMERIC(12,2);
  v_bank_name     TEXT;
  v_account_name  TEXT;
  v_account_num   TEXT;
  v_res           JSONB;
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

  IF p_convert_profit_to_slots THEN
    RAISE EXCEPTION 'Converting profit into slots is not supported by this rollover';
  END IF;

  -- One batch per cycle at a time. Released at commit or rollback.
  PERFORM pg_advisory_xact_lock(hashtext('process_cycle_rollover:' || p_source_cycle_id::TEXT));

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

  FOR v_inv IN
    SELECT * FROM investments
    WHERE cycle_id = p_source_cycle_id
      AND status = 'matured'
      AND next_investment_id IS NULL
    ORDER BY created_at ASC
  LOOP
    BEGIN
      v_decision  := NULL;
      v_method    := NULL;
      v_slots_out := 0;
      v_res       := NULL;

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

      -- 035: the payment requests, reconciled rather than inserted.
      PERFORM sync_maturity_payment_requests(v_inv.id);

      -- THE MOVE. One engine, whatever the decision.
      v_res := mudarabah_roll_one(v_inv.id, v_decision, v_slots_out, v_dest.id, v_method);

      IF v_res->>'outcome' = 'withdrawn' THEN
        PERFORM create_notification(
          v_investor.profile_id,
          'Withdrawal Processed',
          FORMAT('Your profit and capital withdrawal for %s (Series %s) has been submitted. Payment requests are pending approval.',
            v_source.cycle_label, v_series.name),
          'payment', '/payment-requests'
        );
        v_withdrawn := v_withdrawn + 1;

      ELSIF v_res->>'outcome' = 'rolled' THEN
        PERFORM create_notification(
          v_investor.profile_id,
          'Investment Continued Into Next Cycle',
          FORMAT('Your Series %s investment has been rolled from %s into %s. Log in to view your updated timeline.',
            v_series.name, v_source.cycle_label, v_dest.cycle_label),
          'investment', FORMAT('/investments/%s', v_res->>'investmentId')
        );
        v_processed := v_processed + 1;

      ELSE
        -- The engine declined (already enrolled, no slots continue,
        -- destination closed). Reported, not hidden.
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_object(
          'previous_investment_id', v_inv.id,
          'investor_id', v_inv.investor_id,
          'investor_code', v_investor.investor_code,
          'full_name', v_investor.full_name,
          'status', 'skipped',
          'reason', v_res->>'reason'
        );
        CONTINUE;
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
        'units', (v_res->>'units')::NUMERIC,
        'capital_rolled_over', (v_res->>'capitalRolledOver')::NUMERIC,
        'profit_rolled_over',  (v_res->>'profitRolledOver')::NUMERIC,
        'rollover_balance',    (v_res->>'rolloverBalance')::NUMERIC,
        'declared_profit', v_inv.declared_profit,
        'withdrawal_amount', (v_res->>'withdrawalAmount')::NUMERIC,
        'slots_withdrawn', (v_res->>'slotsWithdrawn')::NUMERIC,
        'new_investment_id', v_res->>'investmentId',
        'status', CASE WHEN v_res->>'outcome' = 'withdrawn' THEN 'withdrawn' ELSE 'completed' END
      );

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
-- 5. EXIT ENTITLEMENT — the one change to the payment requests.
--
--    Byte-for-byte the 035 function but for the exit amount: 11
--    lines added, one replaced, checked by diff rather than retyped.
--
--    035 requested v_inv.capital on exit. An investor who had chosen
--    rollover_all in an earlier cycle also holds a rollover_balance,
--    and that was never requested — measured: a 725,000 entitlement
--    produced 600,000 of requests. The balance is now included, with
--    the same count-once rule the engine uses for rows the old batch
--    wrote. The profit half is untouched: this cycle's net profit,
--    once. Everything else in the function — the reconciliation, the
--    partial_exit amount, the bank-details skip — is as it was.
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
  v_balance   NUMERIC(20,2) := 0;   -- 048
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
    -- 048: everything the investor holds leaves, so the carried
    -- rollover_balance is owed as well as the slot-backed capital.
    -- Counted once: rows the old batch wrote hold the balance inside
    -- capital too, and that excess is not added again. Same rule as
    -- mudarabah_roll_one. Not profit — this cycle's profit is
    -- v_profit below, settled exactly once as it always was.
    v_balance := COALESCE(v_inv.rollover_balance, 0);
    v_balance := v_balance - LEAST(v_balance, GREATEST(
      v_inv.capital - ROUND(v_inv.units * COALESCE(v_cycle.unit_value, v_series.price_per_unit), 2), 0));
    v_capital := v_inv.capital + v_balance;
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


-- ------------------------------------------------------------
-- 6. Grants. The engine is internal. The three callers keep exactly
--    the grants 036 left them: enrol/unenrol revoked from anon and
--    authenticated, process_cycle_rollover on its default ACL (it is
--    gated by is_admin() inside).
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION mudarabah_roll_one(UUID, maturity_decision, NUMERIC, UUID, TEXT)
      FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION mudarabah_enrol_next_cycle(UUID)   FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION mudarabah_unenrol_next_cycle(UUID) FROM anon, authenticated;
  END IF;
END $$;
