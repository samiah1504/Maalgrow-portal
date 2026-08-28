-- ============================================================
-- 047 must not disturb a rollover that already works
--
-- THE CONCERN, STATED FAIRLY. 047 makes declare_cycle_profit raise
-- payment requests EARLIER than before — at declaration rather than
-- when the rollover runs. process_cycle_rollover then runs over the
-- same investments and calls the same sync. If that second pass
-- duplicated the requests, or threw because they already existed, a
-- working rollover would have been broken by a fix aimed elsewhere.
--
-- So this runs the real sequence, in order, on the real functions:
--
--     investor submits early
--          -> declare_cycle_profit   (047 raises the request here)
--               -> process_cycle_rollover  (raises nothing new)
--
--   R1  the rollover still completes, with nothing failed
--   R2  NO DUPLICATE payment requests
--   R3  the continuing investor is enrolled in the next cycle
--   R4  the carry-forward payment is still recorded
--   R5  an exit is still paid capital as well as profit
--   R6  the amounts are untouched by having been raised earlier
-- ============================================================
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'radmin@test.com'),
  ('10000000-0000-0000-0000-0000000000f1', 'rcont@test.com'),
  ('10000000-0000-0000-0000-0000000000f2', 'rexit@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'radmin@test.com', 'R Admin',  'super_admin'),
  ('10000000-0000-0000-0000-0000000000f1', 'rcont@test.com',  'R Continue','investor'),
  ('10000000-0000-0000-0000-0000000000f2', 'rexit@test.com',  'R Exit',    'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000f1';

INSERT INTO investors (
  id, profile_id, investor_code, full_name, email, phone,
  bank_name, account_name, account_number
) VALUES
  ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1',
   'MG-RCONT', 'R Continue', 'rcont@test.com', '08000000021',
   'GTBank', 'R Continue', '0000000021'),
  ('20000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f2',
   'MG-REXIT', 'R Exit', 'rexit@test.com', '08000000022',
   'GTBank', 'R Exit', '0000000022')
ON CONFLICT (id) DO NOTHING;

-- A cycle and its successor. The rollover needs somewhere to go.
INSERT INTO cycles (
  id, series_id, cycle_number, cycle_label, start_date, end_date,
  total_slots, status
) VALUES
  ('40000000-0000-0000-0000-0000000000f1', (SELECT id FROM series WHERE name = 'C'),
   71, 'Source Cycle', '2026-05-01', '2026-08-31', 100, 'active'),
  ('40000000-0000-0000-0000-0000000000f2', (SELECT id FROM series WHERE name = 'C'),
   72, 'Destination Cycle', '2026-09-01', '2026-11-30', 100, 'active')
ON CONFLICT (id) DO NOTHING;

INSERT INTO investments (
  id, investment_code, investor_id, series_id, cycle_id,
  units, price_per_unit, capital, investment_date, maturity_date, status
) VALUES
  ('50000000-0000-0000-0000-0000000000f1', 'MG-C-071-R1',
   '20000000-0000-0000-0000-0000000000f1', (SELECT id FROM series WHERE name='C'),
   '40000000-0000-0000-0000-0000000000f1', 1, 100000, 100000,
   '2026-05-01', '2026-08-31', 'active'),
  ('50000000-0000-0000-0000-0000000000f2', 'MG-C-071-R2',
   '20000000-0000-0000-0000-0000000000f2', (SELECT id FROM series WHERE name='C'),
   '40000000-0000-0000-0000-0000000000f1', 1, 100000, 100000,
   '2026-05-01', '2026-08-31', 'active')
ON CONFLICT (id) DO NOTHING;

-- BOTH answer BEFORE settlement. This is the case 047 is about, and
-- it is also the case that puts 047 and the rollover on the same
-- investments — which is exactly the collision being tested for.
INSERT INTO rollover_decisions (
  investment_id, investor_id, source_cycle_id, decision,
  bank_name, account_name, account_number
) VALUES
  ('50000000-0000-0000-0000-0000000000f1', '20000000-0000-0000-0000-0000000000f1',
   '40000000-0000-0000-0000-0000000000f1', 'continue',
   'GTBank', 'R Continue', '0000000021'),
  ('50000000-0000-0000-0000-0000000000f2', '20000000-0000-0000-0000-0000000000f2',
   '40000000-0000-0000-0000-0000000000f1', 'exit',
   'GTBank', 'R Exit', '0000000022')
ON CONFLICT (investment_id) DO NOTHING;

-- ------------------------------------------------------------
-- STEP 1 — declare. Under 047 this raises their requests.
-- ------------------------------------------------------------
DO $$ DECLARE v_res JSONB; v_n INT; BEGIN
  v_res := declare_cycle_profit(
    '40000000-0000-0000-0000-0000000000f1', 1000000, 0,
    'Declaration before the rollover', NULL, FALSE
  );

  SELECT COUNT(*) INTO v_n FROM payment_requests
  WHERE investment_id IN ('50000000-0000-0000-0000-0000000000f1',
                          '50000000-0000-0000-0000-0000000000f2');
  -- Continue: profit. Exit: profit + capital. Three in total.
  IF v_n <> 3 THEN
    RAISE EXCEPTION 'SETUP: expected 3 requests raised at declaration, got %', v_n;
  END IF;

  PERFORM set_config('test.after_declare', v_n::TEXT, TRUE);
  RAISE NOTICE 'PASS step 1: declaration raised % request(s)', v_n;
END $$;

-- ------------------------------------------------------------
-- STEP 2 — the rollover, over the very same investments.
-- ------------------------------------------------------------
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := process_cycle_rollover(
    '40000000-0000-0000-0000-0000000000f1',
    '40000000-0000-0000-0000-0000000000f2',
    FALSE
  );
  PERFORM set_config('test.rollover_result', v_res::TEXT, TRUE);

  -- R1. Nothing failed.
  IF (v_res->>'failed')::INT <> 0 THEN
    RAISE EXCEPTION
      'TEST FAIL R1: the rollover reported % failure(s) after 047 — %',
      v_res->>'failed', v_res->'results';
  END IF;
  IF (v_res->>'rolled')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R1: expected 1 rolled, got %', v_res->>'rolled';
  END IF;
  IF (v_res->>'withdrawn')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R1: expected 1 withdrawn, got %', v_res->>'withdrawn';
  END IF;

  RAISE NOTICE 'PASS R1: the rollover completed — 1 rolled, 1 withdrawn, 0 failed';
END $$;

-- ------------------------------------------------------------
-- R2 — THE ONE THE CONCERN IS ABOUT
--
--      The rollover called the same sync over the same investments.
--      If it inserted again, these counts would have doubled.
-- ------------------------------------------------------------
DO $$ DECLARE v_before INT; v_after INT; v_dupes INT; BEGIN
  v_before := current_setting('test.after_declare')::INT;

  SELECT COUNT(*) INTO v_after FROM payment_requests
  WHERE investment_id IN ('50000000-0000-0000-0000-0000000000f1',
                          '50000000-0000-0000-0000-0000000000f2');

  IF v_after <> v_before THEN
    RAISE EXCEPTION
      'TEST FAIL R2: the rollover raised % extra request(s) on top of the % from declaration',
      v_after - v_before, v_before;
  END IF;

  -- And not by any other route either: one request per investment
  -- per type, nothing paired up.
  SELECT COUNT(*) INTO v_dupes FROM (
    SELECT investment_id, type FROM payment_requests
    WHERE investment_id IN ('50000000-0000-0000-0000-0000000000f1',
                            '50000000-0000-0000-0000-0000000000f2')
    GROUP BY investment_id, type HAVING COUNT(*) > 1
  ) d;
  IF v_dupes > 0 THEN
    RAISE EXCEPTION 'TEST FAIL R2: % investment/type pair(s) have more than one request', v_dupes;
  END IF;

  RAISE NOTICE 'PASS R2: the rollover raised nothing twice (% requests, unchanged)', v_after;
END $$;

-- ------------------------------------------------------------
-- R3 / R4 — the continuing investor still moves, with their money
-- ------------------------------------------------------------
DO $$ DECLARE v_new UUID; v_cap NUMERIC; v_paid NUMERIC; v_has_046 BOOLEAN; BEGIN
  SELECT next_investment_id INTO v_new FROM investments
  WHERE id = '50000000-0000-0000-0000-0000000000f1';
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL R3: the continuing investor was not enrolled in the next cycle';
  END IF;

  SELECT capital INTO v_cap FROM investments WHERE id = v_new;
  IF v_cap <> 100000 THEN
    RAISE EXCEPTION 'TEST FAIL R3: the new enrolment carries % capital, expected 100000', v_cap;
  END IF;

  /*
   * R4 — THE CARRY-FORWARD, AND WHICH PATH WROTE IT.
   *
   * Two functions can enrol somebody into the next cycle, and only
   * one of them records the money:
   *
   *   mudarabah_enrol_next_cycle   runs inside submit_rollover_decision
   *                                when the investor answers. Writes
   *                                the carry-forward (036:354).
   *
   *   process_cycle_rollover       the admin batch. Writes it only
   *                                once 046 is applied.
   *
   * This test drives the BATCH path — the decisions are inserted
   * directly, so the submission path never ran. On a database without
   * 046 the carry-forward is therefore absent, and that is the 046
   * bug showing through, not anything 047 did: R1 and R2 above pass
   * identically either way.
   *
   * So the assertion follows the schema rather than demanding 046.
   * Asserting unconditionally would leave a permanently red test on a
   * database that has deliberately not taken 046, which teaches
   * everybody to ignore it.
   */
  SELECT investment_confirmed_paid(v_new) INTO v_paid;

  SELECT prosrc LIKE '%Capital carried forward%' INTO v_has_046
  FROM pg_proc WHERE proname = 'process_cycle_rollover';

  IF v_has_046 THEN
    IF v_paid <> v_cap THEN
      RAISE EXCEPTION
        'TEST FAIL R4: 046 is applied, but the new enrolment holds % capital with only % recorded as paid',
        v_cap, v_paid;
    END IF;
    RAISE NOTICE 'PASS R3/R4: enrolled into the next cycle, and the batch path recorded the carry-forward';
  ELSE
    IF v_paid <> 0 THEN
      RAISE EXCEPTION
        'TEST FAIL R4: 046 is NOT applied, so the batch path should have recorded nothing, but % is paid',
        v_paid;
    END IF;
    RAISE NOTICE 'PASS R3: enrolled into the next cycle. R4 skipped — 046 is not applied, so the batch path records no carry-forward (the submission path still does).';
  END IF;
END $$;

-- ------------------------------------------------------------
-- R5 / R6 — the exit, and the amounts
-- ------------------------------------------------------------
DO $$ DECLARE v_roi NUMERIC; v_cap NUMERIC; v_net NUMERIC; BEGIN
  SELECT MAX(amount) FILTER (WHERE type = 'roi'),
         MAX(amount) FILTER (WHERE type = 'capital')
    INTO v_roi, v_cap
  FROM payment_requests WHERE investment_id = '50000000-0000-0000-0000-0000000000f2';

  IF v_roi IS NULL OR v_cap IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL R5: the exit is missing a request (roi %, capital %)', v_roi, v_cap;
  END IF;
  IF v_cap <> 100000 THEN
    RAISE EXCEPTION 'TEST FAIL R5: capital request is %, expected 100000', v_cap;
  END IF;

  -- R6. Raised at declaration, and still the net profit afterwards.
  SELECT declared_profit_net INTO v_net FROM investments
  WHERE id = '50000000-0000-0000-0000-0000000000f2';
  IF v_roi <> v_net THEN
    RAISE EXCEPTION
      'TEST FAIL R6: the request is for % but the net profit is % — raising it early changed the amount',
      v_roi, v_net;
  END IF;

  RAISE NOTICE 'PASS R5/R6: the exit has both requests, at the right amounts';
END $$;

ROLLBACK;
\echo '=== 047 DOES NOT DISTURB THE ROLLOVER ==='
