-- ============================================================
-- 027 — the maturity instruction window
--
-- THE PROBLEM. The instruction form lives on one investment's detail
-- page. Nothing anywhere tells an investor it is wanted, so most
-- never find it, and a cycle reaches maturity with a third of its
-- members silent. The administrator is then left guessing on their
-- behalf, one by one, on the settlement screen.
--
-- THE WINDOW. Each cycle gets an explicit period in which the
-- instruction is asked for — by default the five days before the
-- cycle ends and the five days after. While it is open the portal
-- interrupts: a dialog on arrival and a banner on the dashboard and
-- the investments list, for that investor's affected holdings only.
-- The moment they answer, all of it disappears.
--
-- WHEN IT CLOSES, IT CLOSES QUIETLY. No "the deadline has passed",
-- no "contact support". Nothing is asked of the investor because
-- nothing more is needed: silence now means the capital continues and
-- the profit is paid out, which is the outcome that requires no
-- action from anybody. Someone who wants their capital instead will
-- say so, and that is a conversation rather than a form.
--
-- ONE DATE, TWO MEANINGS, KEPT SEPARATE. The window governs what is
-- DISPLAYED. rollover_deadline still governs what is ACCEPTED, and
-- the two are aligned here so a prompt is never shown for something
-- that would be refused on submission.
--
-- Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The window's two edges.
--
--    NULL on either side means "use the default", computed from the
--    cycle's end date rather than stored, so moving a cycle's dates
--    moves its window with them.
-- ------------------------------------------------------------
ALTER TABLE cycles
  ADD COLUMN IF NOT EXISTS instruction_opens_at  DATE,
  ADD COLUMN IF NOT EXISTS instruction_closes_at DATE;

COMMENT ON COLUMN cycles.instruction_opens_at IS
  'When the portal starts asking for maturity instructions. NULL = five days before end_date.';
COMMENT ON COLUMN cycles.instruction_closes_at IS
  'When it stops asking. NULL = five days after end_date. After this, silence means the capital continues.';

CREATE OR REPLACE FUNCTION cycle_instruction_window(p_cycle_id UUID)
RETURNS TABLE (opens_at DATE, closes_at DATE, is_open BOOLEAN) AS $$
  SELECT
    COALESCE(c.instruction_opens_at,  c.end_date - INTERVAL '5 days')::DATE,
    COALESCE(c.instruction_closes_at, c.end_date + INTERVAL '5 days')::DATE,
    CURRENT_DATE >= COALESCE(c.instruction_opens_at,  c.end_date - INTERVAL '5 days')::DATE
      AND CURRENT_DATE <= COALESCE(c.instruction_closes_at, c.end_date + INTERVAL '5 days')::DATE
  FROM cycles c WHERE c.id = p_cycle_id;
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 2. What to interrupt THIS investor about, right now.
--
--    Resolved from the session, never from a parameter — the caller
--    cannot ask about somebody else's holdings. Returns nothing at
--    all when there is nothing to ask, which is what makes the
--    prompt disappear on its own the moment they answer.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION my_maturity_prompts()
RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'investmentId',   i.id,
    'investmentCode', i.investment_code,
    'seriesName',     s.name,
    'cycleLabel',     c.cycle_label,
    'units',          i.units,
    'capital',        i.capital,
    'maturityDate',   to_char(i.maturity_date, 'YYYY-MM-DD'),
    'closesAt',       to_char(w.closes_at, 'YYYY-MM-DD')
  ) ORDER BY i.maturity_date), '[]'::JSONB)
  FROM investments i
  JOIN cycles c  ON c.id = i.cycle_id
  JOIN series s  ON s.id = i.series_id
  CROSS JOIN LATERAL cycle_instruction_window(c.id) w
  WHERE i.investor_id = get_my_investor_id()
    AND i.status::text IN ('active', 'matured')
    AND i.next_investment_id IS NULL
    AND w.is_open
    -- Answered already? Then there is nothing to ask.
    AND NOT EXISTS (
      SELECT 1 FROM rollover_decisions rd WHERE rd.investment_id = i.id
    );
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. Accept instructions for as long as the window is shown.
--
--    submit_rollover_decision measured its deadline from
--    COALESCE(rollover_deadline, end_date), which closes on the day
--    the cycle ends — days before the window does. That would have
--    shown a prompt and then refused what it invited.
--
--    Byte-for-byte the 012 version but for the deadline expression.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION rollover_decision_deadline(p_cycle_id UUID)
RETURNS DATE AS $$
  SELECT GREATEST(
    COALESCE(c.rollover_deadline, c.end_date),
    (SELECT closes_at FROM cycle_instruction_window(p_cycle_id))
  )
  FROM cycles c WHERE c.id = p_cycle_id;
$$ LANGUAGE sql STABLE;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION cycle_instruction_window(UUID) TO authenticated;
    GRANT EXECUTE ON FUNCTION my_maturity_prompts() TO authenticated;
    GRANT EXECUTE ON FUNCTION rollover_decision_deadline(UUID) TO authenticated;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. submit_rollover_decision, measuring against the window.
--
--    Byte-for-byte the 012 version but for one line — verified
--    by diff: the deadline expression, and nothing else.
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
