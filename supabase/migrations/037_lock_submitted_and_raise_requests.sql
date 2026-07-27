-- ============================================================
-- 037 — lock what was already submitted, and raise their payment
--
-- THE SITUATION THIS FIXES. Migration 036 made an instruction final
-- the moment it is given, and raises the payment request in the same
-- breath. But it only does that for instructions submitted AFTER it
-- was applied. The investors who answered before then are in a
-- half-state: their decision is on record, their profit has been
-- declared, and nothing has been raised for them. They are waiting on
-- money they have already asked for, and they do not know the portal
-- changed underneath them.
--
-- This closes that gap for the ones already in flight. It is a
-- one-off correction of existing rows, not a new rule — the rule is
-- in 036 and applies to everyone from here on.
--
-- WHAT IT DOES, PER INSTRUCTION ALREADY ON RECORD:
--
--   1. marks it locked, so it is as final as one given today
--   2. raises the payment request it implies — the profit for
--      everyone, and the capital too for a withdrawal
--
-- WHOSE INSTRUCTIONS ARE NOT TOUCHED. Anyone who has not answered
-- yet. Their window stays open and they follow the normal flow; they
-- lock when they submit, like everybody else.
--
-- IT RAISES NOTHING TWICE. The amounts come from
-- sync_maturity_payment_requests, which reconciles what should exist
-- against what does. Running this a second time reports zero created,
-- because there is nothing left to create. A request already
-- approved, processing or paid is never touched.
--
-- IT RAISES NOTHING EARLY EITHER. Before a cycle settles there is no
-- declared profit, so there is no amount to ask for and the helper
-- does nothing. Only settled cycles produce requests here.
--
-- NOT ENROLMENT. This locks and pays; it does not move anybody's
-- capital into the next cycle. That is what the rollover run is for,
-- and it is a separate decision about a separate thing.
--
-- Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The correction, as a function so the result is reportable.
--
--    Not gated on is_admin(): it is applied from the SQL editor,
--    where there is no signed-in user to check. SECURITY DEFINER and
--    revoked from anon and authenticated, so nothing an investor or
--    a logged-in administrator can reach calls it by accident.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_lock_submitted_instructions(
  p_cycle_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_rec      RECORD;
  v_sync     JSONB;
  v_locked   INTEGER := 0;
  v_raised   INTEGER := 0;
  v_skipped  INTEGER := 0;
  v_detail   JSONB := '[]'::JSONB;
BEGIN
  FOR v_rec IN
    SELECT rd.investment_id,
           rd.decision::TEXT   AS decision,
           rd.locked           AS was_locked,
           i.investment_code,
           inv.full_name,
           inv.investor_code,
           c.cycle_label
    FROM rollover_decisions rd
    JOIN investments i   ON i.id = rd.investment_id
    JOIN investors  inv  ON inv.id = i.investor_id
    JOIN cycles     c    ON c.id = i.cycle_id
    WHERE (p_cycle_id IS NULL OR rd.source_cycle_id = p_cycle_id)
      -- Only where the capital has NOT already been processed.
      -- A rolled-over enrolment is finished with; reopening its
      -- requests would be re-asking for money already accounted for.
      AND i.next_investment_id IS NULL
    ORDER BY inv.full_name
  LOOP
    IF NOT v_rec.was_locked THEN
      UPDATE rollover_decisions
         SET locked = TRUE, updated_at = NOW()
       WHERE investment_id = v_rec.investment_id;
      v_locked := v_locked + 1;
    END IF;

    v_sync := sync_maturity_payment_requests(v_rec.investment_id);

    IF (v_sync->>'created') IS NOT NULL AND (v_sync->>'created')::INT > 0 THEN
      v_raised := v_raised + (v_sync->>'created')::INT;
    ELSIF v_sync->>'skipped' IS NOT NULL THEN
      v_skipped := v_skipped + 1;
    END IF;

    v_detail := v_detail || jsonb_build_object(
      'investor',       v_rec.full_name,
      'investorCode',   v_rec.investor_code,
      'investment',     v_rec.investment_code,
      'cycle',          v_rec.cycle_label,
      'decision',       v_rec.decision,
      'wasAlreadyLocked', v_rec.was_locked,
      'payment',        v_sync
    );
  END LOOP;

  RETURN jsonb_build_object(
    'lockedNow',       v_locked,
    'requestsRaised',  v_raised,
    'couldNotRaise',   v_skipped,
    'instructions',    v_detail
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION mudarabah_lock_submitted_instructions(UUID)
      FROM anon, authenticated;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. Apply it, right now, to every instruction already on record.
--
--    The notice is the audit trail of this run — Supabase shows it
--    alongside the result, and it says exactly what moved.
-- ------------------------------------------------------------
DO $$
DECLARE v_result JSONB;
BEGIN
  v_result := mudarabah_lock_submitted_instructions();
  RAISE NOTICE '037: locked % instruction(s), raised % payment request(s), % could not be raised',
    v_result->>'lockedNow', v_result->>'requestsRaised', v_result->>'couldNotRaise';
END $$;

-- ------------------------------------------------------------
-- 3. What that produced — one row per investor who has answered.
--
--    The last statement on purpose: the Supabase editor shows only
--    the final result, and this is the one worth seeing. Any row
--    where "profit_request" reads NOT RAISED needs attention — it
--    means the investor has no bank details on record, and nothing
--    can be requested until they do.
-- ------------------------------------------------------------
SELECT
  inv.full_name                                  AS investor,
  inv.investor_code                              AS code,
  c.cycle_label                                  AS cycle,
  i.units                                        AS slots,
  rd.decision::TEXT                              AS instruction,
  rd.locked                                      AS locked,
  COALESCE(
    (SELECT pr.status::TEXT || ' — ₦' || TO_CHAR(pr.amount, 'FM999,999,999,990.00')
       FROM payment_requests pr
      WHERE pr.investment_id = i.id AND pr.type = 'roi'
      ORDER BY pr.created_at DESC LIMIT 1),
    'NOT RAISED'
  )                                              AS profit_request,
  COALESCE(
    (SELECT pr.status::TEXT || ' — ₦' || TO_CHAR(pr.amount, 'FM999,999,999,990.00')
       FROM payment_requests pr
      WHERE pr.investment_id = i.id AND pr.type = 'capital'
      ORDER BY pr.created_at DESC LIMIT 1),
    CASE WHEN rd.decision::TEXT IN ('exit', 'partial_exit')
         THEN 'NOT RAISED' ELSE 'n/a — capital continues' END
  )                                              AS capital_request
FROM rollover_decisions rd
JOIN investments i  ON i.id  = rd.investment_id
JOIN investors  inv ON inv.id = i.investor_id
JOIN cycles     c   ON c.id  = i.cycle_id
ORDER BY
  -- Anything unraised first. It is the only part that needs doing.
  (SELECT COUNT(*) FROM payment_requests pr
    WHERE pr.investment_id = i.id AND pr.type = 'roi') ASC,
  inv.full_name;
