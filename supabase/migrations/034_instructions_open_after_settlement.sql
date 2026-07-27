-- ============================================================
-- 034 — instructions close when the CAPITAL moves, not when the
--       profit is declared
--
-- WHAT HAPPENED. Series B settled. Every investor's bell lit up with
-- their profit — and from that moment nobody could submit a maturity
-- instruction. The portal was still asking twenty-eight of them, by
-- dialog and by banner, and refusing every one that answered.
--
-- declare_cycle_profit moves each investment from 'active' to
-- 'matured'. submit_rollover_decision refused anything not 'active'.
-- So settlement and the instruction window were mutually exclusive,
-- which is the exact opposite of what migration 030 established: the
-- profit is declared first BECAUSE an investor cannot decide about
-- their capital until they know what they earned.
--
-- MY OVERSIGHT, AND THE SECOND OF ITS KIND. 027 aligned the DEADLINE
-- so a prompt would never be shown for something submission would
-- refuse, and I did not notice the status check sitting beside it
-- doing precisely that. 033 fixed the same predicate in the ledger's
-- membership counts. This is the third place it was wrong and, per
-- the sweep below, the last.
--
-- MATURING IS THE PROFIT EVENT. Rolling over is the capital event.
-- An instruction is about capital, so it stays open until the capital
-- has actually moved — which next_investment_id, checked a few lines
-- above, already refuses. The status test now excludes only
-- 'completed' and 'cancelled': an enrolment whose capital is done
-- with.
--
-- Byte-for-byte the 027 function but for one condition and the
-- message it raises — verified by diff. Re-runnable.
-- ============================================================

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

  RETURN jsonb_build_object(
    'success', TRUE,
    'decision', p_decision,
    'slots_to_withdraw', p_slots_to_withdraw,
    'deadline', v_deadline
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
