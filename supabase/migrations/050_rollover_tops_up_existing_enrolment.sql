-- ============================================================
-- 050 — the rollover tops up an enrolment the investor already holds
--
-- Two functions from 048 change, nothing else: mudarabah_roll_one()
-- and mudarabah_unenrol_next_cycle(). Every other line of each is the
-- 048 text; the additions are marked "050".
--
-- ── THE PROBLEM ──────────────────────────────────────────────
--
-- The portal has two ways of putting an investor into a cycle and
-- only one of them merged. A payment recorded by hand goes through
-- migration 014, which finds the investor's active enrolment in that
-- cycle and tops it up ("Existing enrolment: never duplicate — top it
-- up"). The rollover engine never looked: it inserted a fresh row for
-- the successor every time. So an investor enrolled by hand in the
-- successor cycle BEFORE the rollover ran ended up as two rows in one
-- cycle — one holding of 5 slots, one of 4.5 — and therefore two
-- acknowledgements, two lines on every statement, two maturity
-- instructions to submit and two profit requests to approve, for what
-- is one holding. Whether it happened depended on which was recorded
-- first, which is why it looked random.
--
-- ── THE RULE ─────────────────────────────────────────────────
--
-- When the engine has resolved the destination and computed what
-- continues (units, capital, balance — none of that changes), it
-- looks for an ACTIVE enrolment of the same investor in the
-- destination cycle that has not been settled and is priced the same
-- as this rollover. If there is one, the continuing slots, capital
-- and balance are ADDED to it; the carry-forward payment, the
-- forward link from the matured enrolment and the cycle_rollovers
-- record all point at it; and it gains the matured enrolment as its
-- parent if it had none. If there is none — or the prices differ,
-- which the engine will not paper over — a fresh row is created as
-- before. The money is identical either way: the carry-forward
-- payment funds exactly the capital added, so the funding invariant
-- holds on a merged row as it does on a fresh one.
--
-- The same rule covers an investor with two matured enrolments in
-- the source cycle: the second to roll lands on the row the first
-- created, and the cycle counts that investor once.
--
-- ── REVERSAL ─────────────────────────────────────────────────
--
-- Undoing a rollover deleted the successor row. A merged row cannot
-- be deleted — it holds other money — so reversal now asks whether
-- the successor is SHARED: any payment into it that is not a
-- carry-forward, or any other rollover that landed on it. A shared
-- row is reduced by exactly what this rollover added (the units and
-- balance recorded in cycle_rollovers, the capital those units are
-- worth at the row's price) and this rollover's carry-forward payment
-- alone is removed. An unshared row is deleted, as before. The 048
-- refusal "fresh money has been paid into" is retired: that case is
-- now the shared case, and it is handled rather than refused.
--
-- Re-runnable. Grants unchanged: CREATE OR REPLACE keeps them.
-- Existing rows are not touched; the two already-split holdings were
-- folded by hand before this ran.
-- ============================================================

-- ------------------------------------------------------------
-- 1. THE ENGINE — 048 text, plus the top-up.
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
  v_existing      investments%ROWTYPE;   -- 050: the row already held in the destination
  v_merged        BOOLEAN := FALSE;      -- 050
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

  -- ── 050: TOP UP, NEVER DUPLICATE ──────────────────────────────
  --
  -- The same rule migration 014 applies to a payment recorded by
  -- hand. An active, unsettled enrolment the investor already holds
  -- in the destination — added by hand before this rollover, or made
  -- a moment ago by another of their matured enrolments — receives
  -- the continuing slots. Locked, because the batch may be rolling
  -- this investor's other enrolment in the same transaction.
  --
  -- Priced the same, or not merged: capital on a row is units times
  -- its price, and a row cannot carry two prices. A mismatch (a hand
  -- row at an old series price, say) gets a fresh row, as before.
  SELECT * INTO v_existing
  FROM investments
  WHERE investor_id = v_inv.investor_id
    AND cycle_id = v_dest.id
    AND status::TEXT = 'active'
    AND declared_profit IS NULL
    AND price_per_unit = v_price
  ORDER BY created_at
  LIMIT 1
  FOR UPDATE;

  IF FOUND THEN
    v_merged       := TRUE;
    v_new_inv_id   := v_existing.id;
    v_new_inv_code := v_existing.investment_code;

    UPDATE investments SET
      units                = units + v_new_units,
      capital              = capital + v_capital,
      rollover_balance     = COALESCE(rollover_balance, 0) + v_balance,
      parent_investment_id = COALESCE(parent_investment_id, p_investment_id),
      notes                = CONCAT_WS(E'\n', notes,
                               FORMAT('Continued from %s (%s slot(s))', v_inv.investment_code,
                                      TRIM(TO_CHAR(v_new_units, 'FM999990.09')))),
      updated_at           = NOW()
    WHERE id = v_existing.id;
  ELSE
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
  END IF;

  -- THE CARRY-FORWARD RECORD. Funded by what carried, never by more:
  -- LEAST(carried, required), so if a slot's value ever rises the
  -- shortfall stays visible in investment_funding_gaps() instead of
  -- being invented here. Idempotent by way of the lock and
  -- next_investment_id above, not by a unique reference. On a merged
  -- row it funds exactly the capital just added, so the row stays as
  -- funded as it was.
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
    'merged',            v_merged,          -- 050: topped up an existing row
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
-- 2. REVERSAL — reduce a shared row, delete an unshared one.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_unenrol_next_cycle(p_investment_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_inv       investments%ROWTYPE;
  v_new       investments%ROWTYPE;
  v_cr        cycle_rollovers%ROWTYPE;   -- 050: what this rollover added
  v_shared    BOOLEAN;                   -- 050
  v_units     NUMERIC(12,2);             -- 050
  v_capital   NUMERIC(20,2);             -- 050
  v_balance   NUMERIC(20,2);             -- 050
  v_other     UUID;                      -- 050: another rollover still on the row
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

  SELECT * INTO v_new FROM investments WHERE id = v_inv.next_investment_id FOR UPDATE;
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

  -- 050: is the successor SHARED? Money in it that this rollover did
  -- not carry, or another rollover that landed on it. The 048 refusal
  -- for "fresh money" is this case, handled instead of refused.
  v_shared := EXISTS (
      SELECT 1 FROM investment_payments
      WHERE investment_id = v_new.id
        AND NOT (COALESCE(method, '') = 'rollover'
                 AND reference = FORMAT('ROLL-%s', v_inv.investment_code))
    ) OR EXISTS (
      SELECT 1 FROM cycle_rollovers
      WHERE new_investment_id = v_new.id
        AND previous_investment_id <> p_investment_id
    );

  -- The reference first, so nothing points at a row about to go.
  UPDATE investments SET next_investment_id = NULL, status = 'matured', updated_at = NOW()
  WHERE id = p_investment_id;

  IF NOT v_shared THEN
    DELETE FROM cycle_rollovers     WHERE previous_investment_id = p_investment_id;
    DELETE FROM investment_payments WHERE investment_id = v_new.id;
    DELETE FROM investments         WHERE id = v_new.id;

    RETURN jsonb_build_object(
      'reversed', TRUE,
      'removedInvestment', v_new.investment_code,
      'removedFromCycle',  (SELECT cycle_label FROM cycles WHERE id = v_new.cycle_id)
    );
  END IF;

  -- 050: shared. Take back exactly what this rollover put in — the
  -- units and balance it recorded, the capital those units are worth
  -- at the row's price — and its own carry-forward payment. The rest
  -- of the row is other people's money and other rollovers' slots,
  -- and stays.
  SELECT * INTO v_cr FROM cycle_rollovers WHERE previous_investment_id = p_investment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot undo: no rollover record for %, so what it added to % is unknown',
      v_inv.investment_code, v_new.investment_code;
  END IF;
  v_units   := COALESCE(v_cr.units, 0);
  v_capital := ROUND(v_units * v_new.price_per_unit, 2);
  v_balance := COALESCE(v_cr.rollover_balance, 0);

  IF v_units <= 0 OR v_new.units - v_units <= 0 THEN
    RAISE EXCEPTION 'Cannot undo: removing % slot(s) would leave % with % slot(s)',
      v_units, v_new.investment_code, v_new.units - v_units;
  END IF;

  DELETE FROM investment_payments
  WHERE investment_id = v_new.id
    AND COALESCE(method, '') = 'rollover'
    AND reference = FORMAT('ROLL-%s', v_inv.investment_code);

  DELETE FROM cycle_rollovers WHERE previous_investment_id = p_investment_id;

  -- If the row's parent was this enrolment, hand parenthood to another
  -- rollover still on the row, or clear it.
  SELECT previous_investment_id INTO v_other
  FROM cycle_rollovers WHERE new_investment_id = v_new.id
  ORDER BY rollover_date LIMIT 1;

  UPDATE investments SET
    units                = units - v_units,
    capital              = GREATEST(capital - v_capital, 0),
    rollover_balance     = GREATEST(COALESCE(rollover_balance, 0) - v_balance, 0),
    parent_investment_id = CASE WHEN parent_investment_id = p_investment_id
                                THEN v_other ELSE parent_investment_id END,
    notes                = CONCAT_WS(E'\n', notes,
                             FORMAT('Rollover from %s reversed (%s slot(s) removed)', v_inv.investment_code,
                                    TRIM(TO_CHAR(v_units, 'FM999990.09')))),
    updated_at           = NOW()
  WHERE id = v_new.id;

  RETURN jsonb_build_object(
    'reversed',           TRUE,
    'reducedInvestment',  v_new.investment_code,
    'slotsRemoved',       v_units,
    'capitalRemoved',     v_capital,
    'balanceRemoved',     v_balance,
    'removedFromCycle',   (SELECT cycle_label FROM cycles WHERE id = v_new.cycle_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
