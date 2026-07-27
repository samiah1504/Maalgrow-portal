-- ============================================================
-- 030 — settle the profit; leave the capital question open
--
-- THE ORDERING WAS BACKWARDS. Settlement demanded a capital
-- instruction from every investor, guessing on behalf of anyone who
-- had not given one — first "paid out", later "continues". Both
-- guesses were wrong in the same way: they wrote a decision into a
-- frozen snapshot that the investor had not made, and then told them
-- so on their own statement.
--
-- An investor cannot sensibly decide whether to take their capital
-- until they know what they earned, and what they earned is only
-- known once the cycle is settled. Requiring the instruction first
-- asks them to choose in the dark — and holds up everybody else's
-- profit while they do.
--
-- So the two events are separated. Settlement declares and pays the
-- PROFIT, which was never conditional on anything. Capital stays open
-- until the investor answers, and if they never do,
-- process_cycle_rollover applies its own long-standing default of
-- continuing — at the moment the capital actually has to move, weeks
-- later, rather than pre-emptively.
--
-- ARITHMETICALLY IT IS ROLLOVER. Nothing is withdrawn, so the payout
-- is the net profit and not a kobo more. Every settlement assertion
-- holds unchanged. The value is kept distinct only because the
-- statement has to say "we have not received your instruction yet"
-- instead of claiming a choice on the investor's behalf — wording the
-- report renderer has always had and never been able to reach.
--
-- Re-runnable. No existing row changes meaning: settlements already
-- taken keep the values they were written with.
-- ============================================================

DO $$ BEGIN
  ALTER TABLE mudarabah_settlement_holders
    DROP CONSTRAINT IF EXISTS mudarabah_settlement_holders_capital_action_check;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

ALTER TABLE mudarabah_settlement_holders
  ADD CONSTRAINT mudarabah_settlement_holders_capital_action_check
  CHECK (capital_action IN ('withdraw', 'rollover', 'partial', 'undecided'));

COMMENT ON COLUMN mudarabah_settlement_holders.capital_action IS
  'withdraw | rollover | partial | undecided. "undecided" is a state, not a missing value: the profit was paid and the capital question was left open for the investor to answer.';
