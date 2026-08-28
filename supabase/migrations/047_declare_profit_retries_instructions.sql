-- ============================================================
-- 047 — declaring the profit retries the instructions already given
--
-- THE REPORT. Investors who submitted their maturity instruction
-- BEFORE the cycle was settled showed on the Awaiting request tab,
-- after settlement, as:
--
--     "Answered, bank details on file, and still nothing raised.
--      Worth looking at directly."
--
-- Which was exactly true, and not their fault or the tab's.
--
-- THE CAUSE. sync_maturity_payment_requests is the only thing that
-- raises a payment request, and it refuses while there is no amount
-- to ask for:
--
--     IF v_inv.declared_profit IS NULL THEN                 -- 035:78
--       RETURN jsonb_build_object('skipped', 'profit not declared yet');
--
-- That is right. Before settlement the profit does not exist, and a
-- request for an unknown amount is worse than no request.
--
-- So submitting early goes: submit_rollover_decision calls the sync,
-- the sync skips, nothing is raised. Correct at that moment.
--
-- Then the cycle is settled. declare_cycle_profit writes
-- declared_profit onto every investment in the cycle and notifies
-- everybody that their profit has been declared — and stops there.
-- It never calls the sync. Nothing in the portal goes back for the
-- people the sync had refused, so the condition that blocked them
-- becomes false and no one re-asks the question.
--
-- Which side of settlement they answered on decided everything:
--
--     answered AFTER   profit already set, request raised on the spot
--     answered BEFORE  sync skipped, and nothing ever retried
--
-- ── WHAT THIS DOES, AND WHAT IT DELIBERATELY DOES NOT ────────
--
-- declare_cycle_profit now retries the sync, in the same loop that
-- has just given the investment its declared_profit.
--
-- ONLY for an investor with an instruction already on record.
-- rollover_decisions has no draft state — the row is written when
-- they submit — so its existence is exactly "they have answered".
--
-- NOT for everybody in the cycle. Running the sync unconditionally
-- would also raise a profit request for every investor who has said
-- nothing at all, because the sync reads a missing instruction as
-- 'continue'. Their capital question is still open; the rollover
-- raises their profit when it runs, as it does today. Declaring a
-- profit must not start paying out people who have not asked to be
-- paid, so the retry is gated and the four cases stay as they are:
--
--   1. submitted early     -> raised here, when the amount appears
--   2. profit declared     -> (this migration)
--   3. submitted late      -> raised on submission, as now
--   4. never submitted     -> nothing raised, as now
--
-- FAILING TO RAISE MUST NOT UNDO A DECLARATION. The profit is the
-- fact the whole cycle is computed from; a payment request is a
-- consequence of it and can be retried. A sync that throws is caught
-- and counted, not allowed to roll the settlement back — and anyone
-- missed still appears on the Awaiting request tab, which is what
-- that tab is for.
--
-- The function is otherwise byte-for-byte the 032 text: extracted
-- programmatically and diffed, 47 lines added and one changed (a
-- comma, to make room for the two new counts in the return value).
--
-- Re-runnable. The second run finds nothing to backfill.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Declaring the profit, now retrying what it unblocked.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION declare_cycle_profit(
  p_cycle_id        UUID,
  p_total_revenue   NUMERIC,
  p_total_expenses  NUMERIC,
  p_notes           TEXT DEFAULT NULL,
  p_wht_rate        NUMERIC DEFAULT NULL,
  p_allow_redeclare BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
  v_cycle           cycles%ROWTYPE;
  v_total_units     NUMERIC(12,2);
  v_net_profit      NUMERIC(20,2);
  v_ratio           NUMERIC(5,4);
  v_wht_rate        NUMERIC(5,4);
  v_pot_kobo        BIGINT;
  v_inv_share       NUMERIC(20,2);
  v_co_share        NUMERIC(20,2);
  v_profit_per_slot NUMERIC(20,6);
  v_wht_per_slot    NUMERIC(20,6);
  v_decl_id         UUID;
  v_inv_count       INTEGER := 0;
  v_alloc_sum       BIGINT := 0;
  v_wht_sum         BIGINT := 0;
  v_leftover        BIGINT;
  v_rec             RECORD;
  -- 047
  v_sync            JSONB;
  v_raised          INTEGER := 0;
  v_retry_failed    INTEGER := 0;
BEGIN
  SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;

  IF v_cycle.status NOT IN ('awaiting_profit_declaration', 'active') AND NOT p_allow_redeclare THEN
    RAISE EXCEPTION 'Cycle is not awaiting profit declaration (status: %)', v_cycle.status;
  END IF;

  IF EXISTS (SELECT 1 FROM cycle_profit_declarations WHERE cycle_id = p_cycle_id)
     AND NOT p_allow_redeclare THEN
    RAISE EXCEPTION 'Profit has already been declared for this cycle';
  END IF;

  v_ratio    := mudarabah_effective_ratio(p_cycle_id);
  v_wht_rate := COALESCE(p_wht_rate, mudarabah_effective_wht_rate(p_cycle_id), 0);

  SELECT COALESCE(SUM(units), 0) INTO v_total_units
  FROM investments
  WHERE cycle_id = p_cycle_id AND status IN ('active', 'matured');

  IF v_total_units = 0 THEN
    RAISE EXCEPTION 'No investments found in this cycle';
  END IF;

  v_net_profit      := p_total_revenue - p_total_expenses;
  v_inv_share       := ROUND(v_net_profit * v_ratio, 2);
  v_co_share        := v_net_profit - v_inv_share;
  v_profit_per_slot := v_inv_share / v_total_units;
  v_wht_per_slot    := ROUND(v_profit_per_slot * v_wht_rate, 6);
  v_pot_kobo        := ROUND(v_inv_share * 100);

  -- Largest remainder: floor each holder's exact share, then hand the
  -- remaining kobo to the largest fractional remainders. Nobody is
  -- systematically shortchanged and the total is exact.
  CREATE TEMP TABLE IF NOT EXISTS mud_alloc (
    investment_id UUID PRIMARY KEY,
    investor_id   UUID,
    units         NUMERIC(12,2),
    gross_kobo    BIGINT,
    wht_kobo      BIGINT,
    remainder     NUMERIC(30,10)
  ) ON COMMIT DROP;
  -- 031: TRUNCATE, not DELETE. Supabase runs the safeupdate
  -- guard, which raises "DELETE requires a WHERE clause" on any
  -- unfiltered DELETE — including inside a function, which is where
  -- this one is. Emptying a temp table is exactly what TRUNCATE is
  -- for, so this is both safe and clearer than DELETE ... WHERE TRUE.
  TRUNCATE mud_alloc;

  INSERT INTO mud_alloc (investment_id, investor_id, units, gross_kobo, remainder)
  SELECT i.id, i.investor_id, i.units,
         FLOOR(v_pot_kobo * i.units / v_total_units),
         (v_pot_kobo * i.units / v_total_units)
           - FLOOR(v_pot_kobo * i.units / v_total_units)
  FROM investments i
  WHERE i.cycle_id = p_cycle_id AND i.status IN ('active', 'matured');

  SELECT COALESCE(SUM(gross_kobo), 0) INTO v_alloc_sum FROM mud_alloc;
  v_leftover := v_pot_kobo - v_alloc_sum;

  IF v_leftover > 0 THEN
    UPDATE mud_alloc SET gross_kobo = gross_kobo + 1
    WHERE investment_id IN (
      SELECT investment_id FROM mud_alloc
      ORDER BY remainder DESC, investment_id
      LIMIT v_leftover
    );
  END IF;

  -- Tax on each holder's ALLOCATED gross
  -- 032: WHERE TRUE for the same guard that blocked the DELETE.
  -- Every row is meant, and saying so explicitly is what satisfies
  -- safeupdate. There is no TRUNCATE equivalent for an UPDATE.
  UPDATE mud_alloc SET wht_kobo = ROUND(gross_kobo * v_wht_rate)
  WHERE TRUE;

  SELECT COALESCE(SUM(gross_kobo), 0), COALESCE(SUM(wht_kobo), 0)
  INTO v_alloc_sum, v_wht_sum FROM mud_alloc;

  IF v_alloc_sum <> v_pot_kobo THEN
    RAISE EXCEPTION 'Allocation does not add up: holders total % kobo, investor pot is % kobo',
      v_alloc_sum, v_pot_kobo;
  END IF;

  IF EXISTS (SELECT 1 FROM cycle_profit_declarations WHERE cycle_id = p_cycle_id) THEN
    UPDATE cycle_profit_declarations SET
      total_revenue         = p_total_revenue,
      total_expenses        = p_total_expenses,
      net_profit            = v_net_profit,
      investor_profit_share = v_inv_share,
      company_profit_share  = v_co_share,
      profit_per_slot       = v_profit_per_slot,
      total_slots           = v_total_units,
      wht_rate              = v_wht_rate,
      wht_per_slot          = v_wht_per_slot,
      profit_per_slot_net   = v_profit_per_slot - v_wht_per_slot,
      total_wht             = v_wht_sum / 100.0,
      notes                 = p_notes,
      declared_by           = auth.uid(),
      declared_at           = NOW()
    WHERE cycle_id = p_cycle_id
    RETURNING id INTO v_decl_id;
  ELSE
    INSERT INTO cycle_profit_declarations (
      cycle_id, total_revenue, total_expenses, net_profit,
      investor_profit_share, company_profit_share,
      profit_per_slot, total_slots, wht_rate, wht_per_slot,
      profit_per_slot_net, total_wht, notes, declared_by
    ) VALUES (
      p_cycle_id, p_total_revenue, p_total_expenses, v_net_profit,
      v_inv_share, v_co_share, v_profit_per_slot, v_total_units,
      v_wht_rate, v_wht_per_slot, v_profit_per_slot - v_wht_per_slot,
      v_wht_sum / 100.0, p_notes, auth.uid()
    ) RETURNING id INTO v_decl_id;
  END IF;

  FOR v_rec IN SELECT * FROM mud_alloc LOOP
    UPDATE investments SET
      declared_profit     = v_rec.gross_kobo / 100.0,
      declared_wht        = v_rec.wht_kobo / 100.0,
      declared_profit_net = (v_rec.gross_kobo - v_rec.wht_kobo) / 100.0,
      status              = CASE WHEN status = 'active' THEN 'matured' ELSE status END,
      updated_at          = NOW()
    WHERE id = v_rec.investment_id;

    INSERT INTO notifications (user_id, title, message, type, action_url)
    SELECT inv.profile_id,
      'Profit Declared for Your Investment',
      FORMAT(
        'The profit for cycle %s has been declared. Your share is ₦%s%s.',
        v_cycle.cycle_label,
        TO_CHAR(v_rec.gross_kobo / 100.0, 'FM999,999,999,999.00'),
        CASE WHEN v_rec.wht_kobo > 0
          THEN FORMAT(', and ₦%s after withholding tax',
                 TO_CHAR((v_rec.gross_kobo - v_rec.wht_kobo) / 100.0, 'FM999,999,999,999.00'))
          ELSE '' END
      ),
      'maturity',
      FORMAT('/investments/%s', v_rec.investment_id)
    FROM investors inv WHERE inv.id = v_rec.investor_id;

    /*
     * 047 — THE RETRY THIS FUNCTION NEVER DID.
     *
     * sync_maturity_payment_requests refuses to run while
     * declared_profit IS NULL, which is right: before settlement
     * there is no amount to ask for. An investor who submits their
     * instruction early therefore has the sync skip, and until now
     * nothing came back for them once the amount existed. They read
     * as "Answered, bank details on file, and still nothing raised".
     *
     * The blocking condition became false three statements ago. This
     * is the retry.
     *
     * ONLY FOR AN INSTRUCTION ALREADY ON RECORD. rollover_decisions
     * has no draft state — a row is written when the investor
     * submits — so its existence IS "they have answered". Someone who
     * has not answered is left alone deliberately: their capital
     * question is still open, and the rollover raises their profit
     * later. Declaring a profit must not start paying out people who
     * have not asked to be paid.
     *
     * FAILING TO RAISE A REQUEST MUST NOT UNDO A DECLARATION. The
     * profit is the fact everything else is computed from; a payment
     * request is a consequence of it and can be retried. So this is
     * caught and counted rather than allowed to roll the settlement
     * back — and anyone missed still shows on the Awaiting request
     * tab, which is what that tab is for.
     */
    IF EXISTS (
      SELECT 1 FROM rollover_decisions rd
      WHERE rd.investment_id = v_rec.investment_id
    ) THEN
      BEGIN
        v_sync := sync_maturity_payment_requests(v_rec.investment_id);
        v_raised := v_raised + COALESCE((v_sync->>'created')::INTEGER, 0);
      EXCEPTION WHEN OTHERS THEN
        v_retry_failed := v_retry_failed + 1;
      END;
    END IF;

    v_inv_count := v_inv_count + 1;
  END LOOP;

  UPDATE cycles SET status = 'completed', updated_at = NOW()
  WHERE id = p_cycle_id AND status <> 'completed';

  RETURN jsonb_build_object(
    'success',               true,
    'declaration_id',        v_decl_id,
    'net_profit',            v_net_profit,
    'investor_profit_share', v_inv_share,
    'company_profit_share',  v_co_share,
    'profit_per_slot',       v_profit_per_slot,
    'wht_rate',              v_wht_rate,
    'wht_per_slot',          v_wht_per_slot,
    'profit_per_slot_net',   v_profit_per_slot - v_wht_per_slot,
    'total_wht',             v_wht_sum / 100.0,
    'total_slots',           v_total_units,
    'investments_updated',   v_inv_count,
    'requests_raised',       v_raised,
    'requests_failed',       v_retry_failed
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


-- ------------------------------------------------------------
-- 2. The investors already sitting in that state.
--
--    STRICTLY ADDITIVE. Only enrolments with NO payment request at
--    all — not one that is pending, not one that was rejected. The
--    sync is a reconciler: left to itself it would also replace a
--    pending request whose amount no longer matches, and re-raise one
--    that had been rejected. Both are correct behaviour for a live
--    submission and wrong for a migration, where a rejection is a
--    decision somebody made and a pending request may already be on
--    a payment run. So this only ever fills a hole.
--
--    Not through an admin-gated helper: a migration has no signed-in
--    user to gate on. sync_maturity_payment_requests is SECURITY
--    DEFINER and revoked from anon and authenticated, so it is
--    reachable here and from nowhere an investor can get to.
--
--    Rolled-over enrolments are left out for the reason 037 gives:
--    process_cycle_rollover has already run this same sync over them
--    with this same data, so there is nothing here it did not do.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_rec      RECORD;
  v_sync     JSONB;
  v_raised   INTEGER := 0;
  v_people   INTEGER := 0;
  v_skipped  INTEGER := 0;
  v_failed   INTEGER := 0;
BEGIN
  FOR v_rec IN
    SELECT i.id, i.investment_code, inv.full_name, c.cycle_label
    FROM investments i
    JOIN rollover_decisions rd ON rd.investment_id = i.id
    JOIN investors inv ON inv.id = i.investor_id
    JOIN cycles    c   ON c.id = i.cycle_id
    WHERE i.declared_profit IS NOT NULL
      AND i.next_investment_id IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM payment_requests pr WHERE pr.investment_id = i.id
      )
    ORDER BY inv.full_name
  LOOP
    BEGIN
      v_sync := sync_maturity_payment_requests(v_rec.id);
      IF COALESCE((v_sync->>'created')::INTEGER, 0) > 0 THEN
        v_raised := v_raised + (v_sync->>'created')::INTEGER;
        v_people := v_people + 1;
      ELSE
        -- Usually 'no bank details on record', which is a real
        -- answer and not a failure: they stay on the Awaiting
        -- request tab under that reason, where somebody can chase it.
        v_skipped := v_skipped + 1;
        RAISE NOTICE '047: nothing raised for % (%) — %',
          v_rec.full_name, v_rec.investment_code,
          COALESCE(v_sync->>'skipped', 'nothing was owed');
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      RAISE NOTICE '047: FAILED for % (%) — %',
        v_rec.full_name, v_rec.investment_code, SQLERRM;
    END;
  END LOOP;

  RAISE NOTICE '047: % request(s) raised for % investor(s); % skipped; % failed',
    v_raised, v_people, v_skipped, v_failed;
  IF v_raised = 0 AND v_skipped = 0 AND v_failed = 0 THEN
    RAISE NOTICE '047: nothing to backfill — every submitted instruction already has its request.';
  END IF;
END $$;
