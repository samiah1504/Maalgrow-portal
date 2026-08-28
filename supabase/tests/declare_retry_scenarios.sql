-- ============================================================
-- Declaring the profit retries the instructions already given
-- — migration 047
--
-- The four cases the workflow is specified in terms of, and the two
-- that would quietly undo it.
--
--   D1  SUBMITTED EARLY, then profit declared -> request appears
--   D2  NEVER SUBMITTED, profit declared      -> NOTHING is raised
--   D3  submitted AFTER declaration           -> still works (035)
--   D4  nothing is raised twice
--   D5  an exit gets BOTH profit and capital
--   D6  no bank details -> skipped, not a failed declaration
--   D7  a sync that throws does not roll back the declaration
--   D8  the declaration reports what it raised
-- ============================================================
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000d1', 'dadmin@test.com'),
  ('10000000-0000-0000-0000-0000000000d1', 'early@test.com'),
  ('10000000-0000-0000-0000-0000000000d2', 'silent@test.com'),
  ('10000000-0000-0000-0000-0000000000d3', 'late@test.com'),
  ('10000000-0000-0000-0000-0000000000d4', 'exiter@test.com'),
  ('10000000-0000-0000-0000-0000000000d5', 'nobank@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000d1', 'dadmin@test.com', 'D Admin',  'super_admin'),
  ('10000000-0000-0000-0000-0000000000d1', 'early@test.com',  'Early Bird','investor'),
  ('10000000-0000-0000-0000-0000000000d2', 'silent@test.com', 'Silent One','investor'),
  ('10000000-0000-0000-0000-0000000000d3', 'late@test.com',   'Late One',  'investor'),
  ('10000000-0000-0000-0000-0000000000d4', 'exiter@test.com', 'Exit One',  'investor'),
  ('10000000-0000-0000-0000-0000000000d5', 'nobank@test.com', 'No Bank',   'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000d1';

-- Five investors. Four with bank details, one deliberately without.
INSERT INTO investors (
  id, profile_id, investor_code, full_name, email, phone,
  bank_name, account_name, account_number
) VALUES
  ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
   'MG-EARLY', 'Early Bird', 'early@test.com', '08000000001',
   'GTBank', 'Early Bird', '0000000001'),
  ('20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2',
   'MG-SILENT', 'Silent One', 'silent@test.com', '08000000002',
   'GTBank', 'Silent One', '0000000002'),
  ('20000000-0000-0000-0000-0000000000d3', '10000000-0000-0000-0000-0000000000d3',
   'MG-LATE', 'Late One', 'late@test.com', '08000000003',
   'GTBank', 'Late One', '0000000003'),
  ('20000000-0000-0000-0000-0000000000d4', '10000000-0000-0000-0000-0000000000d4',
   'MG-EXIT', 'Exit One', 'exiter@test.com', '08000000004',
   'GTBank', 'Exit One', '0000000004'),
  ('20000000-0000-0000-0000-0000000000d5', '10000000-0000-0000-0000-0000000000d5',
   'MG-NOBANK', 'No Bank', 'nobank@test.com', '08000000005',
   NULL, NULL, NULL)
ON CONFLICT (id) DO NOTHING;

-- The three series are seeded by 001 and series.name is an enum of
-- exactly A, B and C — there is no fourth to invent. Series C it is,
-- at its seeded price of 100,000 a slot.

INSERT INTO cycles (
  id, series_id, cycle_number, cycle_label, start_date, end_date,
  total_slots, status
) VALUES (
  '40000000-0000-0000-0000-0000000000d1', (SELECT id FROM series WHERE name = 'C'),
  1, 'May 2026 - Aug 2026', '2026-05-01', '2026-08-31', 100, 'active'
) ON CONFLICT (id) DO NOTHING;

-- One slot each, so the arithmetic is obvious.
INSERT INTO investments (
  id, investment_code, investor_id, series_id, cycle_id,
  units, price_per_unit, capital, investment_date, maturity_date, status
)
SELECT
  ('50000000-0000-0000-0000-0000000000d' || n)::UUID,
  'MG-D-001-' || n,
  ('20000000-0000-0000-0000-0000000000d' || n)::UUID,
  (SELECT id FROM series WHERE name = 'C'),
  '40000000-0000-0000-0000-0000000000d1',
  1, 100000, 100000, '2026-05-01', '2026-08-31', 'active'
FROM generate_series(1, 5) AS n
ON CONFLICT (id) DO NOTHING;

-- ------------------------------------------------------------
-- The instructions given BEFORE any profit exists.
--
-- Written directly rather than through submit_rollover_decision,
-- because that function refuses before the maturity window opens —
-- and the point here is the row existing, not how it got there.
-- ------------------------------------------------------------
INSERT INTO rollover_decisions (
  investment_id, investor_id, source_cycle_id, decision,
  bank_name, account_name, account_number
) VALUES
  ('50000000-0000-0000-0000-0000000000d1', '20000000-0000-0000-0000-0000000000d1',
   '40000000-0000-0000-0000-0000000000d1', 'continue',
   'GTBank', 'Early Bird', '0000000001'),
  ('50000000-0000-0000-0000-0000000000d4', '20000000-0000-0000-0000-0000000000d4',
   '40000000-0000-0000-0000-0000000000d1', 'exit',
   'GTBank', 'Exit One', '0000000004'),
  ('50000000-0000-0000-0000-0000000000d5', '20000000-0000-0000-0000-0000000000d5',
   '40000000-0000-0000-0000-0000000000d1', 'continue',
   NULL, NULL, NULL)
ON CONFLICT (investment_id) DO NOTHING;

-- The state the bug is reported from: they have answered, and the
-- sync refused because there was no amount yet.
DO $$ DECLARE v_n INT; BEGIN
  SELECT COUNT(*) INTO v_n FROM payment_requests;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'FIXTURE: something raised a request before any profit existed (% rows)', v_n;
  END IF;
  IF (sync_maturity_payment_requests('50000000-0000-0000-0000-0000000000d1')->>'skipped')
     <> 'profit not declared yet' THEN
    RAISE EXCEPTION 'FIXTURE: the sync did not skip before declaration';
  END IF;
  RAISE NOTICE 'PASS fixture: answered early, and nothing raised — the reported state';
END $$;

-- ============================================================
-- THE DECLARATION
-- ============================================================
DO $$
DECLARE
  v_res JSONB;
BEGIN
  -- 1,000,000 revenue, no expenses. Whatever the ratio and the tax
  -- rate work out to, the assertions below read the actual figures
  -- rather than assuming them.
  v_res := declare_cycle_profit(
    '40000000-0000-0000-0000-0000000000d1', 1000000, 0,
    'Test declaration', NULL, FALSE
  );
  PERFORM set_config('test.declare_result', v_res::TEXT, TRUE);
  RAISE NOTICE 'PASS declaration: %', v_res;
END $$;

-- ------------------------------------------------------------
-- D1 — THE REPORTED BUG
--
--      Answered before the profit existed. The declaration must have
--      gone back for them.
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; v_amt NUMERIC; v_net NUMERIC; BEGIN
  SELECT COUNT(*), MAX(amount) INTO v_n, v_amt
  FROM payment_requests
  WHERE investment_id = '50000000-0000-0000-0000-0000000000d1';

  IF v_n <> 1 THEN
    RAISE EXCEPTION
      'TEST FAIL D1: the early instruction was not retried at declaration (% requests) — this is the reported bug',
      v_n;
  END IF;

  SELECT declared_profit_net INTO v_net FROM investments
  WHERE id = '50000000-0000-0000-0000-0000000000d1';
  IF v_amt <> v_net THEN
    RAISE EXCEPTION 'TEST FAIL D1: raised % but the net profit is %', v_amt, v_net;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM payment_requests
    WHERE investment_id = '50000000-0000-0000-0000-0000000000d1'
      AND type = 'roi' AND status = 'pending'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL D1: raised, but not as a pending profit request';
  END IF;

  RAISE NOTICE 'PASS D1: the instruction given early was retried when the amount appeared';
END $$;

-- ------------------------------------------------------------
-- D2 — THE ONE THAT KEEPS THE SCOPE HONEST
--
--      Silent One never answered. sync_maturity_payment_requests
--      reads a missing instruction as 'continue' and would happily
--      raise their profit — so without the EXISTS gate, declaring a
--      profit would start paying out everybody who has said nothing.
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; BEGIN
  SELECT COUNT(*) INTO v_n FROM payment_requests
  WHERE investment_id = '50000000-0000-0000-0000-0000000000d2';
  IF v_n <> 0 THEN
    RAISE EXCEPTION
      'TEST FAIL D2: % request(s) raised for an investor who has not answered', v_n;
  END IF;

  -- And their profit IS declared — so it is the gate holding them
  -- back, not a missing amount.
  IF (SELECT declared_profit FROM investments
      WHERE id = '50000000-0000-0000-0000-0000000000d2') IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL D2: vacuous — no profit was declared for them at all';
  END IF;

  RAISE NOTICE 'PASS D2: nothing raised for the investor who never submitted';
END $$;

-- ------------------------------------------------------------
-- D5 — an exit is owed capital as well as profit
-- ------------------------------------------------------------
DO $$ DECLARE v_roi NUMERIC; v_cap NUMERIC; BEGIN
  SELECT MAX(amount) FILTER (WHERE type = 'roi'),
         MAX(amount) FILTER (WHERE type = 'capital')
    INTO v_roi, v_cap
  FROM payment_requests WHERE investment_id = '50000000-0000-0000-0000-0000000000d4';

  IF v_roi IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL D5: the exiting investor has no profit request';
  END IF;
  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL D5: the exiting investor has no capital request';
  END IF;
  IF v_cap <> 100000 THEN
    RAISE EXCEPTION 'TEST FAIL D5: capital request is %, expected the full 100000', v_cap;
  END IF;

  RAISE NOTICE 'PASS D5: an exit was raised for both profit and capital';
END $$;

-- ------------------------------------------------------------
-- D6 — no bank details is a reason, not a broken settlement
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; BEGIN
  SELECT COUNT(*) INTO v_n FROM payment_requests
  WHERE investment_id = '50000000-0000-0000-0000-0000000000d5';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL D6: a request was raised with nowhere to pay it';
  END IF;

  -- The declaration itself still went through for them.
  IF (SELECT declared_profit FROM investments
      WHERE id = '50000000-0000-0000-0000-0000000000d5') IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL D6: the missing bank details cost them their declaration';
  END IF;

  RAISE NOTICE 'PASS D6: skipped for want of an account, and the declaration stood';
END $$;

-- ------------------------------------------------------------
-- D8 — the declaration says what it did
-- ------------------------------------------------------------
DO $$ DECLARE v_res JSONB; BEGIN
  v_res := current_setting('test.declare_result', TRUE)::JSONB;
  IF (v_res->>'requests_raised') IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL D8: the declaration does not report what it raised';
  END IF;
  -- Early Bird (1) + Exit One (2). No Bank and Silent One raise none.
  IF (v_res->>'requests_raised')::INT <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL D8: reported % raised, expected 3', v_res->>'requests_raised';
  END IF;
  IF (v_res->>'requests_failed')::INT <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL D8: % failed', v_res->>'requests_failed';
  END IF;
  RAISE NOTICE 'PASS D8: the declaration reported 3 raised, 0 failed';
END $$;

-- ------------------------------------------------------------
-- D3 — the existing path still works
--
--      Late One answers AFTER the declaration. 035 raises it on
--      submission and this migration must not have disturbed that.
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; BEGIN
  INSERT INTO rollover_decisions (
    investment_id, investor_id, source_cycle_id, decision,
    bank_name, account_name, account_number
  ) VALUES (
    '50000000-0000-0000-0000-0000000000d3', '20000000-0000-0000-0000-0000000000d3',
    '40000000-0000-0000-0000-0000000000d1', 'continue',
    'GTBank', 'Late One', '0000000003'
  );
  PERFORM sync_maturity_payment_requests('50000000-0000-0000-0000-0000000000d3');

  SELECT COUNT(*) INTO v_n FROM payment_requests
  WHERE investment_id = '50000000-0000-0000-0000-0000000000d3';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL D3: submitting after declaration raised % requests', v_n;
  END IF;
  RAISE NOTICE 'PASS D3: submitting after the declaration still raises immediately';
END $$;

-- ------------------------------------------------------------
-- D4 — nothing is raised twice
--
--      Re-declaring runs the whole loop again over investments that
--      already have their requests.
-- ------------------------------------------------------------
DO $$ DECLARE v_before INT; v_after INT; v_res JSONB; BEGIN
  SELECT COUNT(*) INTO v_before FROM payment_requests;

  v_res := declare_cycle_profit(
    '40000000-0000-0000-0000-0000000000d1', 1000000, 0,
    'Re-declaration', NULL, TRUE
  );

  SELECT COUNT(*) INTO v_after FROM payment_requests;
  IF v_after <> v_before THEN
    RAISE EXCEPTION 'TEST FAIL D4: re-declaring raised % more request(s)', v_after - v_before;
  END IF;
  IF (v_res->>'requests_raised')::INT <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL D4: re-declaring reported % raised', v_res->>'requests_raised';
  END IF;

  RAISE NOTICE 'PASS D4: re-declaring raised nothing a second time';
END $$;

-- ------------------------------------------------------------
-- D7 — a failure to raise must not undo a declaration
--
--      The profit is the fact everything is computed from. Breaking
--      the sync must cost the requests and nothing else.
-- ------------------------------------------------------------
DO $$ BEGIN
  -- A sync that always throws, restored at the end of this block.
  CREATE OR REPLACE FUNCTION sync_maturity_payment_requests(p_investment_id UUID)
  RETURNS JSONB AS $f$
  BEGIN
    RAISE EXCEPTION 'deliberate failure for D7';
  END;
  $f$ LANGUAGE plpgsql SECURITY DEFINER;
END $$;

DO $$ DECLARE v_res JSONB; v_profit NUMERIC; BEGIN
  v_res := declare_cycle_profit(
    '40000000-0000-0000-0000-0000000000d1', 2000000, 0,
    'Declaration with a broken sync', NULL, TRUE
  );

  SELECT declared_profit INTO v_profit FROM investments
  WHERE id = '50000000-0000-0000-0000-0000000000d1';
  IF v_profit IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL D7: a failed request rolled the whole declaration back';
  END IF;
  IF (v_res->>'requests_failed')::INT < 1 THEN
    RAISE EXCEPTION 'TEST FAIL D7: the failure was swallowed without being counted';
  END IF;

  RAISE NOTICE 'PASS D7: the declaration stood, and the failures were counted (%)',
    v_res->>'requests_failed';
END $$;

ROLLBACK;
\echo '=== ALL DECLARE-RETRY TESTS PASSED ==='
