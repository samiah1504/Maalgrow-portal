-- ============================================================
-- Automatic Cycle Rollover — scenario tests
-- Run against a DB with migrations 001–009 applied.
-- ============================================================
\set ON_ERROR_STOP on

BEGIN;

-- ─── Seed users ─────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.com'),
  ('10000000-0000-0000-0000-000000000001', 'i1@test.com'),
  ('10000000-0000-0000-0000-000000000002', 'i2@test.com'),
  ('10000000-0000-0000-0000-000000000003', 'i3@test.com'),
  ('10000000-0000-0000-0000-000000000004', 'i4@test.com'),
  ('10000000-0000-0000-0000-000000000005', 'i5@test.com'),
  ('10000000-0000-0000-0000-000000000006', 'i6@test.com'),
  ('10000000-0000-0000-0000-000000000007', 'i7@test.com');

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.com', 'Super Admin', 'super_admin'),
  ('10000000-0000-0000-0000-000000000001', 'i1@test.com', 'Investor One',   'investor'),
  ('10000000-0000-0000-0000-000000000002', 'i2@test.com', 'Investor Two',   'investor'),
  ('10000000-0000-0000-0000-000000000003', 'i3@test.com', 'Investor Three', 'investor'),
  ('10000000-0000-0000-0000-000000000004', 'i4@test.com', 'Investor Four',  'investor'),
  ('10000000-0000-0000-0000-000000000005', 'i5@test.com', 'Investor Five',  'investor'),
  ('10000000-0000-0000-0000-000000000006', 'i6@test.com', 'Investor Six',   'investor'),
  ('10000000-0000-0000-0000-000000000007', 'i7@test.com', 'Investor Seven', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;

INSERT INTO investors (id, profile_id, investor_code, full_name, email, bank_name, account_name, account_number) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MV00001', 'Investor One',   'i1@test.com', NULL, NULL, NULL),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'MV00002', 'Investor Two',   'i2@test.com', 'GTB', 'Investor Two', '0123456789'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'MV00003', 'Investor Three', 'i3@test.com', 'GTB', 'Investor Three', '0123456780'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'MV00004', 'Investor Four',  'i4@test.com', NULL, NULL, NULL),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'MV00005', 'Investor Five',  'i5@test.com', NULL, NULL, NULL),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'MV00006', 'Investor Six',   'i6@test.com', NULL, NULL, NULL),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000007', 'MV00007', 'Investor Seven', 'i7@test.com', NULL, NULL, NULL);

-- ─── Series A: ₦500,000 slot, 50/50 mudarabah ───────────────
UPDATE series SET price_per_unit = 500000, mudarabah_investor_ratio = 0.50, min_units = 0.5
WHERE name = 'A';

-- ─── Source cycle ending today ──────────────────────────────
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status)
SELECT 'c0000000-0000-0000-0000-000000000001', id, 1,
       'Test Cycle 1',
       CURRENT_DATE - INTERVAL '3 months', CURRENT_DATE, 'active'
FROM series WHERE name = 'A';

-- ─── Investments (8 slots total) ────────────────────────────
INSERT INTO investments (id, investment_code, investor_id, series_id, cycle_id, units, price_per_unit, capital, investment_date, maturity_date, status)
SELECT x.id, x.code, x.inv, s.id, 'c0000000-0000-0000-0000-000000000001',
       x.units, 500000, x.capital, CURRENT_DATE - INTERVAL '3 months', CURRENT_DATE, 'active'
FROM series s,
(VALUES
  ('30000000-0000-0000-0000-000000000001'::uuid, 'MG-A-001-MV00001', '20000000-0000-0000-0000-000000000001'::uuid, 1.0::numeric,  500000::numeric),
  ('30000000-0000-0000-0000-000000000002'::uuid, 'MG-A-001-MV00002', '20000000-0000-0000-0000-000000000002'::uuid, 2.0::numeric, 1000000::numeric),
  ('30000000-0000-0000-0000-000000000003'::uuid, 'MG-A-001-MV00003', '20000000-0000-0000-0000-000000000003'::uuid, 1.0::numeric,  500000::numeric),
  ('30000000-0000-0000-0000-000000000004'::uuid, 'MG-A-001-MV00004', '20000000-0000-0000-0000-000000000004'::uuid, 1.0::numeric,  500000::numeric),
  ('30000000-0000-0000-0000-000000000005'::uuid, 'MG-A-001-MV00005', '20000000-0000-0000-0000-000000000005'::uuid, 0.5::numeric,  250000::numeric),
  ('30000000-0000-0000-0000-000000000006'::uuid, 'MG-A-001-MV00006', '20000000-0000-0000-0000-000000000006'::uuid, 1.5::numeric,  750000::numeric),
  ('30000000-0000-0000-0000-000000000007'::uuid, 'MG-A-001-MV00007', '20000000-0000-0000-0000-000000000007'::uuid, 1.0::numeric,  500000::numeric)
) AS x(id, code, inv, units, capital)
WHERE s.name = 'A';

-- ════════════════════════════════════════════════════════════
-- Opt-out window: investor decisions
-- ════════════════════════════════════════════════════════════

-- I2 withdraws everything
SET test.uid = '10000000-0000-0000-0000-000000000002';
SELECT submit_rollover_decision('30000000-0000-0000-0000-000000000002', 'exit', 'GTB', 'Investor Two', '0123456789', NULL);

-- I3 withdraws profit, continues with capital
SET test.uid = '10000000-0000-0000-0000-000000000003';
SELECT submit_rollover_decision('30000000-0000-0000-0000-000000000003', 'continue', 'GTB', 'Investor Three', '0123456780', NULL);

-- Deadline enforcement: I4 tries after the deadline → must fail
SET test.uid = 'a0000000-0000-0000-0000-000000000001';
UPDATE cycles SET rollover_deadline = CURRENT_DATE - 1 WHERE id = 'c0000000-0000-0000-0000-000000000001';

SET test.uid = '10000000-0000-0000-0000-000000000004';
DO $$
BEGIN
  BEGIN
    PERFORM submit_rollover_decision('30000000-0000-0000-0000-000000000004', 'rollover_all');
    RAISE EXCEPTION 'TEST FAIL: decision accepted after deadline';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%deadline%' THEN
      RAISE NOTICE 'PASS: post-deadline decision rejected';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- Super admin approves the exception for I4
SET test.uid = 'a0000000-0000-0000-0000-000000000001';
SELECT submit_rollover_decision('30000000-0000-0000-0000-000000000004', 'rollover_all', NULL, NULL, NULL, NULL, TRUE);
UPDATE cycles SET rollover_deadline = NULL WHERE id = 'c0000000-0000-0000-0000-000000000001';

-- I7: force a decision row that will FAIL at processing
-- ('continue' payout with no bank details, inserted directly to
-- simulate legacy/corrupt data)
INSERT INTO rollover_decisions (investment_id, investor_id, source_cycle_id, decision, via)
VALUES ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007',
        'c0000000-0000-0000-0000-000000000001', 'continue', 'investor');

-- I1, I5, I6: no decision → automatic continuation

-- ════════════════════════════════════════════════════════════
-- Profit declaration: net 1,600,000 → 800,000 investor share
-- → ₦100,000 per slot
-- ════════════════════════════════════════════════════════════
SET test.uid = 'a0000000-0000-0000-0000-000000000001';
SELECT declare_cycle_profit('c0000000-0000-0000-0000-000000000001', 2000000, 400000, 'test declaration');

DO $$
DECLARE v NUMERIC;
BEGIN
  SELECT declared_profit INTO v FROM investments WHERE id = '30000000-0000-0000-0000-000000000001';
  IF v != 100000 THEN RAISE EXCEPTION 'TEST FAIL: I1 declared_profit % != 100000', v; END IF;
  SELECT declared_profit INTO v FROM investments WHERE id = '30000000-0000-0000-0000-000000000005';
  IF v != 50000 THEN RAISE EXCEPTION 'TEST FAIL: I5 declared_profit % != 50000', v; END IF;
  RAISE NOTICE 'PASS: per-slot profit calculated from declared profit (no preset ROI)';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 7: next cycle does not exist
-- ════════════════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN
    PERFORM process_cycle_rollover('c0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'TEST FAIL: rollover ran without a next cycle';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NEXT_CYCLE_MISSING%' THEN
      RAISE NOTICE 'PASS: missing next cycle blocks processing';
    ELSE
      RAISE;
    END IF;
  END;
END $$;

-- Create the next cycle; verify 3 CALENDAR months (not 90 days)
DO $$
DECLARE
  v_id UUID;
  v_start DATE; v_end DATE; v_src_end DATE;
BEGIN
  SELECT end_date INTO v_src_end FROM cycles WHERE id = 'c0000000-0000-0000-0000-000000000001';
  SELECT create_next_cycle(s.id) INTO v_id FROM series s WHERE s.name = 'A';
  SELECT start_date, end_date INTO v_start, v_end FROM cycles WHERE id = v_id;
  IF v_start != v_src_end THEN
    RAISE EXCEPTION 'TEST FAIL: next cycle start % != source end %', v_start, v_src_end;
  END IF;
  IF v_end != (v_start + INTERVAL '3 months')::date THEN
    RAISE EXCEPTION 'TEST FAIL: next cycle end % is not start + 3 calendar months', v_end;
  END IF;
  RAISE NOTICE 'PASS: next cycle auto-generated with 3 calendar months (% → %)', v_start, v_end;
END $$;

-- ════════════════════════════════════════════════════════════
-- First processing run — I7 must fail, everyone else processes
-- ════════════════════════════════════════════════════════════
CREATE TEMP TABLE runs (name TEXT PRIMARY KEY, r JSONB);
INSERT INTO runs SELECT 'run1', process_cycle_rollover('c0000000-0000-0000-0000-000000000001');
SELECT r->>'rolled' AS rolled, r->>'withdrawn' AS withdrawn,
       r->>'failed' AS failed, r->>'skipped' AS skipped FROM runs WHERE name='run1';

DO $$
DECLARE r JSONB; v RECORD; c RECORD; n INTEGER; dest UUID;
BEGIN
  SELECT id INTO dest FROM cycles WHERE cycle_number = 2 AND series_id = (SELECT id FROM series WHERE name = 'A');

  -- Scenario 1: I1 did not opt out → automatically continues with capital + profit
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000001';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAIL: I1 not auto-rolled'; END IF;
  IF v.cycle_id != dest OR v.status != 'active' THEN RAISE EXCEPTION 'TEST FAIL: I1 new allocation wrong cycle/status'; END IF;
  IF v.units != 1.0 OR v.capital != 600000 OR v.rollover_balance != 100000 THEN
    RAISE EXCEPTION 'TEST FAIL: I1 rolled units=% capital=% balance=% (expected 1 / 600000 / 100000 — profit NOT converted to slots)', v.units, v.capital, v.rollover_balance;
  END IF;
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000001';
  IF c.method != 'automatic' OR c.decision != 'rollover_all' OR c.status != 'completed'
     OR c.capital_rolled_over != 500000 OR c.profit_rolled_over != 100000 OR c.total_rollover_amount != 600000 THEN
    RAISE EXCEPTION 'TEST FAIL: I1 rollover record wrong (%, %, %)', c.method, c.decision, c.status;
  END IF;
  RAISE NOTICE 'PASS 1: no opt-out → automatic continuation, history linked';

  -- Scenario 2: I2 withdrew everything → NOT in next cycle
  SELECT COUNT(*) INTO n FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000002';
  IF n != 0 THEN RAISE EXCEPTION 'TEST FAIL: I2 placed in next cycle despite full withdrawal'; END IF;
  SELECT * INTO v FROM investments WHERE id = '30000000-0000-0000-0000-000000000002';
  IF v.status != 'completed' OR v.maturity_decision != 'exit' THEN RAISE EXCEPTION 'TEST FAIL: I2 old investment not completed/exit'; END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000002' AND type = 'roi' AND amount = 200000;
  IF n != 1 THEN RAISE EXCEPTION 'TEST FAIL: I2 profit payment request missing'; END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000002' AND type = 'capital' AND amount = 1000000;
  IF n != 1 THEN RAISE EXCEPTION 'TEST FAIL: I2 capital payment request missing'; END IF;
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000002';
  IF c.status != 'withdrawn' OR c.withdrawal_amount != 1200000 OR c.destination_cycle_id IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: I2 rollover record wrong';
  END IF;
  RAISE NOTICE 'PASS 2: full withdrawal → payment requests, no next-cycle allocation';

  -- Scenario 3: I3 withdrew profit, continued with capital
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000003';
  IF v.units != 1.0 OR v.capital != 500000 OR v.rollover_balance != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: I3 rolled units=% capital=% balance=%', v.units, v.capital, v.rollover_balance;
  END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000003' AND type = 'roi' AND amount = 100000;
  IF n != 1 THEN RAISE EXCEPTION 'TEST FAIL: I3 profit payout missing'; END IF;
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000003';
  IF c.decision != 'continue' OR c.profit_rolled_over != 0 OR c.capital_rolled_over != 500000 OR c.withdrawal_amount != 100000 THEN
    RAISE EXCEPTION 'TEST FAIL: I3 rollover record wrong';
  END IF;
  RAISE NOTICE 'PASS 3: withdraw profit + continue capital';

  -- Scenario 4: I4 rolled over capital + profit (via admin exception after deadline)
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000004';
  IF v.capital != 600000 OR v.rollover_balance != 100000 THEN
    RAISE EXCEPTION 'TEST FAIL: I4 rollover_all amounts wrong';
  END IF;
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000004';
  IF c.method != 'admin_exception' THEN RAISE EXCEPTION 'TEST FAIL: I4 method % != admin_exception', c.method; END IF;
  RAISE NOTICE 'PASS 4: rollover capital + profit; post-deadline change only via admin approval';

  -- Scenario 5: fractional slots (0.5 and 1.5) retained
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000005';
  IF v.units != 0.5 OR v.capital != 300000 OR v.rollover_balance != 50000 THEN
    RAISE EXCEPTION 'TEST FAIL: I5 0.5-slot rollover wrong (units=% capital=% balance=%)', v.units, v.capital, v.rollover_balance;
  END IF;
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000006';
  IF v.units != 1.5 OR v.capital != 900000 OR v.rollover_balance != 150000 THEN
    RAISE EXCEPTION 'TEST FAIL: I6 1.5-slot rollover wrong';
  END IF;
  RAISE NOTICE 'PASS 5: 0.5 and 1.5 slot holdings roll correctly';

  -- I7 must be recorded as FAILED (missing bank details), old investment untouched
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000007';
  IF c.status != 'failed' OR c.error NOT LIKE '%bank details%' THEN
    RAISE EXCEPTION 'TEST FAIL: I7 expected failed record, got % (%)', c.status, c.error;
  END IF;
  SELECT * INTO v FROM investments WHERE id = '30000000-0000-0000-0000-000000000007';
  IF v.status != 'matured' OR v.next_investment_id IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: I7 failed item must remain matured and unrolled';
  END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000007';
  IF n != 0 THEN RAISE EXCEPTION 'TEST FAIL: I7 failure leaked payment requests'; END IF;
  RAISE NOTICE 'PASS: failure isolated per investor, retryable, no partial writes';

  -- Scenario 8 analogue: DB state is complete and correct with email_sent=false
  SELECT COUNT(*) INTO n FROM cycle_rollovers WHERE source_cycle_id = 'c0000000-0000-0000-0000-000000000001' AND email_sent = TRUE;
  IF n != 0 THEN RAISE EXCEPTION 'TEST FAIL: email_sent should be false before email dispatch'; END IF;
  RAISE NOTICE 'PASS 8: rollover recorded correctly independent of email delivery';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 6: run the processor twice — no duplicates
-- ════════════════════════════════════════════════════════════
INSERT INTO runs SELECT 'run2', process_cycle_rollover('c0000000-0000-0000-0000-000000000001');

DO $$
DECLARE r JSONB := (SELECT runs.r FROM runs WHERE name='run2'); n INTEGER;
BEGIN
  -- Processed items leave the candidate set entirely (completed status);
  -- only the failed I7 is retried and fails again. Nothing is duplicated.
  IF (r->>'rolled')::int != 0 OR (r->>'withdrawn')::int != 0 OR (r->>'failed')::int != 1 THEN
    RAISE EXCEPTION 'TEST FAIL: second run must re-process nothing (rolled=% withdrawn=% failed=%)',
      r->>'rolled', r->>'withdrawn', r->>'failed';
  END IF;
  SELECT COUNT(*) INTO n FROM investments;
  IF n != 12 THEN RAISE EXCEPTION 'TEST FAIL: expected 12 investments (7 old + 5 new), found %', n; END IF;
  -- no investor twice in destination cycle
  SELECT COUNT(*) INTO n FROM (
    SELECT investor_id FROM investments
    WHERE cycle_id = (SELECT id FROM cycles WHERE cycle_number = 2 AND series_id = (SELECT id FROM series WHERE name='A'))
    GROUP BY investor_id HAVING COUNT(*) > 1
  ) d;
  IF n != 0 THEN RAISE EXCEPTION 'TEST FAIL: investor appears twice in destination cycle'; END IF;
  RAISE NOTICE 'PASS 6: double-run creates no duplicate allocations and counts no capital twice';
END $$;

-- ════════════════════════════════════════════════════════════
-- Failed-record retry: fix I7 bank details and re-run
-- ════════════════════════════════════════════════════════════
UPDATE rollover_decisions
SET bank_name = 'Zenith', account_name = 'Investor Seven', account_number = '0123456700'
WHERE investment_id = '30000000-0000-0000-0000-000000000007';

INSERT INTO runs SELECT 'run3', process_cycle_rollover('c0000000-0000-0000-0000-000000000001');

DO $$
DECLARE r JSONB := (SELECT runs.r FROM runs WHERE name='run3'); v RECORD; c RECORD; n INTEGER; src RECORD; dest RECORD;
BEGIN
  IF (r->>'rolled')::int != 1 OR (r->>'failed')::int != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: retry run expected rolled=1 failed=0, got rolled=% failed=%', r->>'rolled', r->>'failed';
  END IF;
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000007';
  IF c.status != 'completed' OR c.error IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: I7 retry did not complete';
  END IF;
  RAISE NOTICE 'PASS: failed rollover retried successfully after fixing bank details';

  -- Scenario 9: old cycle historical, new cycle active + totals correct
  SELECT * INTO src FROM cycles WHERE id = 'c0000000-0000-0000-0000-000000000001';
  IF src.status != 'completed' OR src.rollover_processed_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: source cycle not marked historical/processed';
  END IF;
  SELECT * INTO dest FROM cycles WHERE cycle_number = 2 AND series_id = (SELECT id FROM series WHERE name='A');
  IF dest.status != 'active' THEN RAISE EXCEPTION 'TEST FAIL: destination cycle not activated'; END IF;
  IF dest.total_investors != 6 OR dest.total_slots != 6.0 OR dest.total_capital != 3400000 THEN
    RAISE EXCEPTION 'TEST FAIL: destination totals wrong (investors=% slots=% capital=%)',
      dest.total_investors, dest.total_slots, dest.total_capital;
  END IF;
  SELECT COUNT(*) INTO n FROM investments WHERE cycle_id = src.id AND status NOT IN ('completed');
  IF n != 0 THEN RAISE EXCEPTION 'TEST FAIL: source cycle still has non-completed investments'; END IF;
  -- history intact: all 7 original investments still exist, untouched codes
  SELECT COUNT(*) INTO n FROM investments WHERE cycle_id = src.id;
  IF n != 7 THEN RAISE EXCEPTION 'TEST FAIL: original investment history was deleted/overwritten'; END IF;
  RAISE NOTICE 'PASS 9: old cycle → history (completed, processed); new cycle active with correct totals';

  -- investor identity preserved: same investor_id everywhere, no new investors created
  SELECT COUNT(*) INTO n FROM investors;
  IF n != 7 THEN RAISE EXCEPTION 'TEST FAIL: duplicate investor profiles created'; END IF;
  RAISE NOTICE 'PASS: same investor profile/code reused — no duplicate accounts';
END $$;

ROLLBACK;
\echo '=== ALL ROLLOVER SCENARIO TESTS PASSED ==='
