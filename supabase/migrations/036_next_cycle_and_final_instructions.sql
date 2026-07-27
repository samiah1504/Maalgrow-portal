-- ============================================================
-- 036 — the next cycle exists, and a decision is final
--
-- TWO THINGS WERE ASKED FOR, AND THEY DEPEND ON EACH OTHER.
--
--   1. Once a cycle is settled, the next one should already exist,
--      starting the day after this one ends — the 31st, not the 30th.
--   2. An investor who chooses to continue should be put into that
--      cycle there and then, and their choice is final.
--
-- ── WHY (1) COULD NOT SIMPLY BE DONE ─────────────────────────
--
-- create_next_cycle set the new cycle's start to the OLD cycle's
-- end_date — the same calendar day, not the day after. Two other
-- places then found the successor by matching that exactly:
--
--   * the idempotency check behind the "create next cycle" button
--   * process_cycle_rollover's destination lookup, which raises
--     NEXT_CYCLE_MISSING when it finds nothing
--
-- Moving the start to the 31st on its own would have made both stop
-- matching: the button would create a duplicate cycle on every press,
-- and the rollover would refuse to run at all.
--
-- So the matching rule moves too, into ONE function. mudarabah_next_cycle
-- takes the earliest later cycle in the same series rather than an exact
-- date equality, which resolves cycles created under the old same-day
-- convention AND under the new day-after one. Nothing has to be
-- backfilled and no existing cycle stops resolving.
--
-- ── WHY (2) LOCKS ────────────────────────────────────────────
--
-- Enrolling on submission means writing next_investment_id, and
-- submit_rollover_decision already refuses any investment that has one.
-- The instruction therefore becomes unchangeable the moment it is
-- given. That is deliberate and was asked for: once a decision is
-- picked it is final. The decision row is marked locked in the same
-- breath so that an "exit" — which creates no new enrolment, and so
-- sets no next_investment_id — is just as final as a "continue".
--
-- A super admin can still correct one, through p_admin_override.
--
-- ── THE PART THAT IS EASY TO MISS ────────────────────────────
--
-- A rolled-over enrolment has capital but no payment record, so
-- investment_funding_gaps() — which reports every active enrolment
-- whose slots and money disagree — would report the ENTIRE new cycle
-- as unfunded on its first day. The money is real; it simply arrived
-- in a previous cycle.
--
-- So enrolment records a confirmed carry-forward payment for the
-- capital that continued. The funding invariant then holds for the new
-- cycle exactly as it does for one funded by fresh transfers, and
-- cycles.amount_received — maintained by the trigger on that table —
-- counts the carried money without anyone keying it in.
--
-- It is deliberately LEAST(carried, required). If a cycle's slot value
-- ever rises, the shortfall stays visible as a funding gap instead of
-- being papered over.
--
-- ── WHAT IS NOT TOUCHED ──────────────────────────────────────
--
-- declare_cycle_profit. Settlement is the one thing that must not
-- acquire new ways to fail, so the next cycle is created OUTSIDE it —
-- by the daily maturities cron, and lazily by the first enrolment that
-- needs it. Both go through the same idempotent function.
--
-- Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The successor of a cycle.
--
--    The earliest cycle in the same series that begins on or after
--    this one ends. Tolerant by design: cycles created before this
--    migration start on the source's end_date, cycles created after
--    it start the day after, and both resolve through this.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_next_cycle(p_source_cycle_id UUID)
RETURNS UUID AS $$
  SELECT c.id
  FROM cycles c
  JOIN cycles src ON src.id = p_source_cycle_id
  WHERE c.series_id = src.series_id
    AND c.id <> src.id
    AND c.start_date >= src.end_date
  ORDER BY c.start_date, c.cycle_number
  LIMIT 1;
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 2. create_next_cycle — starting the day AFTER the last one ends.
--
--    Byte-for-byte the 003 version but for the start date and the
--    label that is derived from it — verified by diff.
-- ------------------------------------------------------------
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
  SELECT * INTO v_series FROM series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series not found: %', p_series_id;
  END IF;

  SELECT * INTO v_last_cycle
  FROM cycles
  WHERE series_id = p_series_id
  ORDER BY cycle_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existing cycle found for series %', v_series.name;
  END IF;

  -- 036: the day AFTER. A cycle ending on the 30th is followed by one
  -- beginning on the 31st; the two no longer share a calendar day.
  v_new_start := v_last_cycle.end_date + 1;
  v_new_end := v_new_start + INTERVAL '3 months' - INTERVAL '1 day';
  v_cycle_number := v_last_cycle.cycle_number + 1;
  v_cycle_label := TO_CHAR(v_new_start, 'Mon YYYY') || ' – ' || TO_CHAR(v_new_end, 'Mon YYYY');

  INSERT INTO cycles (series_id, cycle_number, cycle_label, start_date, end_date, status)
  VALUES (p_series_id, v_cycle_number, v_cycle_label, v_new_start, v_new_end, 'upcoming')
  RETURNING id INTO v_new_cycle_id;

  RETURN v_new_cycle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. Make sure the successor exists.
--
--    Idempotent. Safe to call from a cron every night, from an
--    enrolment, and from the admin button, in any order.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_ensure_next_cycle(p_source_cycle_id UUID)
RETURNS UUID AS $$
DECLARE
  v_src cycles%ROWTYPE;
  v_id  UUID;
BEGIN
  SELECT * INTO v_src FROM cycles WHERE id = p_source_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;

  v_id := mudarabah_next_cycle(p_source_cycle_id);
  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  RETURN create_next_cycle(v_src.series_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Create the successor for every cycle whose profit is declared,
--    and start any cycle whose day has come.
--
--    What the nightly cron calls. Returns what it did, so the run is
--    reportable rather than silent.
--
--    THE ACTIVATION HALF MATTERS MORE THAN IT LOOKS. A successor is
--    created 'upcoming' and dated in the future — the day after the
--    old cycle ends. Until 036 the only thing that ever flipped a
--    cycle to 'active' was an administrator running the bulk
--    rollover, and it did so only if the cycle had already started.
--    A cycle created in advance would have sat 'upcoming' for ever.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_open_next_cycles()
RETURNS JSONB AS $$
DECLARE
  v_cycle   RECORD;
  v_new_id  UUID;
  v_created JSONB := '[]'::JSONB;
  v_started INTEGER := 0;
BEGIN
  FOR v_cycle IN
    SELECT c.id, c.cycle_label, c.series_id
    FROM cycles c
    WHERE EXISTS (
            SELECT 1 FROM cycle_profit_declarations d WHERE d.cycle_id = c.id
          )
      AND mudarabah_next_cycle(c.id) IS NULL
    ORDER BY c.start_date
  LOOP
    v_new_id := create_next_cycle(v_cycle.series_id);
    v_created := v_created || jsonb_build_object(
      'afterCycle', v_cycle.cycle_label,
      'cycleId',    v_new_id,
      'label',      (SELECT cycle_label FROM cycles WHERE id = v_new_id),
      'startDate',  (SELECT to_char(start_date, 'YYYY-MM-DD') FROM cycles WHERE id = v_new_id)
    );
  END LOOP;

  WITH started AS (
    UPDATE cycles SET status = 'active', updated_at = NOW()
    WHERE status = 'upcoming'
      AND start_date <= CURRENT_DATE
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_started FROM started;

  RETURN jsonb_build_object(
    'created', jsonb_array_length(v_created),
    'cycles',  v_created,
    'started', v_started
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. Put one investor into the next cycle.
--
--    Called the moment an instruction is submitted. Idempotent, and a
--    no-op in every case where enrolling would be wrong:
--
--      * profit not declared yet     — the cycle has not settled
--      * no instruction on record    — nothing has been chosen
--      * the instruction is "exit"   — the capital is leaving
--      * already has a successor     — this ran before
--
--    Mirrors what process_cycle_rollover does for the whole cycle at
--    once, for a single enrolment, so the two produce the same rows.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_enrol_next_cycle(p_investment_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_inv          investments%ROWTYPE;
  v_investor     investors%ROWTYPE;
  v_series       series%ROWTYPE;
  v_source       cycles%ROWTYPE;
  v_dest         cycles%ROWTYPE;
  v_dest_id      UUID;
  v_decision     TEXT;
  v_slots_out    NUMERIC(12,2) := 0;
  v_new_units    NUMERIC(12,2);
  v_price        NUMERIC(20,2);
  v_carried      NUMERIC(20,2);
  v_capital      NUMERIC(20,2);
  v_funded       NUMERIC(20,2);
  v_balance      NUMERIC(20,2);
  v_new_inv_id   UUID;
  v_new_inv_code TEXT;
  v_code_suffix  INTEGER;
BEGIN
  SELECT * INTO v_inv FROM investments WHERE id = p_investment_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'no such enrolment');
  END IF;

  IF v_inv.next_investment_id IS NOT NULL THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'already enrolled',
                              'investmentId', v_inv.next_investment_id);
  END IF;

  -- Before settlement there is no next cycle to join yet. Not an
  -- error: the instruction is recorded, and the enrolment happens
  -- when the administrator processes the rollover.
  IF v_inv.declared_profit IS NULL THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'cycle not settled yet');
  END IF;

  SELECT rd.decision::TEXT, COALESCE(rd.slots_to_withdraw, 0)
    INTO v_decision, v_slots_out
  FROM rollover_decisions rd WHERE rd.investment_id = p_investment_id;

  IF v_decision IS NULL THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'no instruction on record');
  END IF;

  IF v_decision = 'exit' THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'capital withdrawn');
  END IF;

  SELECT * INTO v_investor FROM investors WHERE id = v_inv.investor_id;
  SELECT * INTO v_series   FROM series    WHERE id = v_inv.series_id;
  SELECT * INTO v_source   FROM cycles    WHERE id = v_inv.cycle_id;

  v_dest_id := mudarabah_ensure_next_cycle(v_inv.cycle_id);
  SELECT * INTO v_dest FROM cycles WHERE id = v_dest_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'no next cycle');
  END IF;

  IF v_dest.status IN ('completed', 'matured') THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason',
      FORMAT('next cycle %s is closed to new allocations', v_dest.cycle_label));
  END IF;

  v_new_units := v_inv.units - v_slots_out;
  IF v_new_units <= 0 THEN
    RETURN jsonb_build_object('enrolled', FALSE, 'reason', 'no slots continue');
  END IF;

  -- The cycle's own slot value if it has one, else the series price —
  -- the same COALESCE mudarabah_effective_unit_value() applies, so a
  -- slot cannot be worth one thing here and another in the ledger.
  v_price   := COALESCE(v_dest.unit_value, v_series.price_per_unit);
  v_capital := ROUND(v_new_units * v_price, 2);

  -- Money that actually continues. The legacy rollover_all carries the
  -- profit in as well; every other instruction pays the profit out.
  v_carried := v_inv.capital
             - CASE WHEN v_decision = 'partial_exit'
                    THEN ROUND(v_slots_out * COALESCE(v_source.unit_value, v_series.price_per_unit), 2)
                    ELSE 0 END
             + CASE WHEN v_decision = 'rollover_all'
                    THEN COALESCE(v_inv.declared_profit_net, v_inv.declared_profit, 0)
                    ELSE 0 END;

  -- Funded by what carried, never by more. A shortfall stays visible
  -- in investment_funding_gaps() instead of being invented here.
  v_funded  := LEAST(v_carried, v_capital);
  v_balance := GREATEST(v_carried - v_capital, 0);

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
    v_inv.id, auth.uid(),
    FORMAT('Continued from %s', v_inv.investment_code)
  ) RETURNING id INTO v_new_inv_id;

  -- THE CARRY-FORWARD RECORD. Without this the new enrolment has
  -- capital and no money behind it, and every rolled-over investor
  -- would be reported as unfunded. The money is real; it arrived last
  -- cycle. The reference is derived from the old enrolment's code, so
  -- a second attempt cannot create a second record.
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

  -- The old enrolment stays 'matured'. next_investment_id is what
  -- records that its capital has moved on, and it is what stops this
  -- running twice; changing the status would take the investor out of
  -- the cycle they actually earned their profit in.
  UPDATE investments SET
    next_investment_id  = v_new_inv_id,
    maturity_decision   = v_decision::maturity_decision,
    maturity_decided_at = COALESCE(v_inv.maturity_decided_at, NOW()),
    updated_at          = NOW()
  WHERE id = p_investment_id;

  INSERT INTO cycle_rollovers (
    investor_id, previous_investment_id, new_investment_id,
    source_cycle_id, destination_cycle_id, series_id,
    units, capital_rolled_over, profit_rolled_over,
    total_rollover_amount, rollover_balance, withdrawal_amount,
    slots_withdrawn, decision, method, status, processed_by
  ) VALUES (
    v_inv.investor_id, p_investment_id, v_new_inv_id,
    v_inv.cycle_id, v_dest.id, v_inv.series_id,
    v_new_units, v_carried,
    CASE WHEN v_decision = 'rollover_all'
         THEN COALESCE(v_inv.declared_profit_net, v_inv.declared_profit, 0) ELSE 0 END,
    v_carried, v_balance,
    CASE WHEN v_decision = 'rollover_all' THEN 0
         ELSE COALESCE(v_inv.declared_profit_net, v_inv.declared_profit, 0) END
      + CASE WHEN v_decision = 'partial_exit'
             THEN ROUND(v_slots_out * COALESCE(v_source.unit_value, v_series.price_per_unit), 2)
             ELSE 0 END,
    v_slots_out, v_decision::maturity_decision, 'investor_choice', 'completed', auth.uid()
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

  PERFORM create_notification(
    v_investor.profile_id,
    'Your Slots Continue Into the Next Cycle',
    FORMAT('%s slot(s) have been carried into %s (%s). Your new investment code is %s.',
      TRIM(TO_CHAR(v_new_units, 'FM999990.09')), v_dest.cycle_label,
      v_series.name, v_new_inv_code),
    'investment',
    FORMAT('/investments/%s', v_new_inv_id)
  );

  RETURN jsonb_build_object(
    'enrolled',        TRUE,
    'investmentId',    v_new_inv_id,
    'investmentCode',  v_new_inv_code,
    'cycleId',         v_dest.id,
    'cycleLabel',      v_dest.cycle_label,
    'units',           v_new_units,
    'capital',         v_capital,
    'carriedForward',  v_funded,
    'rolloverBalance', v_balance
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 6. Undo an enrolment — the super admin's recourse.
--
--    Final means final for the INVESTOR. Somebody still has to be
--    able to fix a mistake, and once next_investment_id is written
--    submit_rollover_decision refuses outright — so without this a
--    misclick would be unfixable from inside the portal.
--
--    It refuses the moment the continuation has a life of its own:
--    money requested against it, fresh money paid into it, a profit
--    declared on it, or a rollover of its own. Undoing any of those
--    would destroy a record rather than correct one.
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
    UPDATE investments SET next_investment_id = NULL, updated_at = NOW()
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
  UPDATE investments SET next_investment_id = NULL, updated_at = NOW()
  WHERE id = p_investment_id;

  DELETE FROM cycle_rollovers  WHERE previous_investment_id = p_investment_id;
  DELETE FROM investment_payments WHERE investment_id = v_new.id;
  DELETE FROM investments      WHERE id = v_new.id;

  RETURN jsonb_build_object(
    'reversed', TRUE,
    'removedInvestment', v_new.investment_code,
    'removedFromCycle',  (SELECT cycle_label FROM cycles WHERE id = v_new.cycle_id)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Investors reach these only through submit_rollover_decision, which
-- checks that the enrolment is theirs. None is callable directly.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION mudarabah_ensure_next_cycle(UUID) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION mudarabah_enrol_next_cycle(UUID)  FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION mudarabah_unenrol_next_cycle(UUID) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION mudarabah_open_next_cycles()      FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION create_next_cycle(UUID)           FROM anon, authenticated;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 8. submit_rollover_decision — final, and enrolling.
--
--    Byte-for-byte the 035 version but for the locked flag, the
--    super-admin reversal and the enrolment call — verified by diff.
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
  v_enrol      JSONB;
BEGIN
  SELECT * INTO v_investment FROM investments WHERE id = p_investment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Investment not found';
  END IF;

  IF v_investment.next_investment_id IS NOT NULL THEN
    -- 036: this is what makes an instruction final. The investor's
    -- slots are already sitting in the next cycle, so there is
    -- nothing left to decide. A super admin correcting a mistake
    -- takes them back out first, which refuses if that enrolment
    -- has acquired money or a profit of its own.
    IF is_admin() AND p_admin_override THEN
      PERFORM mudarabah_unenrol_next_cycle(p_investment_id);
      SELECT * INTO v_investment FROM investments WHERE id = p_investment_id;
    ELSE
      RAISE EXCEPTION 'This investment has already been rolled over';
    END IF;
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
    deadline, decided_by, via, locked
  ) VALUES (
    p_investment_id, v_investment.investor_id, v_investment.cycle_id, p_decision,
    CASE WHEN p_decision = 'partial_exit' THEN p_slots_to_withdraw ELSE NULL END,
    COALESCE(p_bank_name, v_investor.bank_name),
    COALESCE(p_account_name, v_investor.account_name),
    COALESCE(p_account_number, v_investor.account_number),
    p_notes, v_deadline, auth.uid(), v_via, TRUE
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
    locked            = TRUE,
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

  -- 036: and the slots that continue join the next cycle now.
  -- A no-op before the cycle settles, and for an exit. Writing
  -- next_investment_id is what makes the instruction final:
  -- the guard at the top of this function refuses any
  -- enrolment that has one.
  v_enrol := mudarabah_enrol_next_cycle(p_investment_id);

  RETURN jsonb_build_object(
    'success', TRUE,
    'decision', p_decision,
    'slots_to_withdraw', p_slots_to_withdraw,
    'deadline', v_deadline,
    'paymentRequests', v_sync,
    'enrolment', v_enrol,
    'locked', TRUE
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 9. process_cycle_rollover — finding the successor the new way.
--
--    Byte-for-byte the 035 version but for the destination lookup —
--    verified by diff. Still the bulk path an administrator runs for
--    everyone who never submitted an instruction; the ones who did
--    are skipped, because they already carry next_investment_id.
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
