-- ============================================================
-- Maturity Instructions — scenario tests
-- Run against a DB with migrations 001–012 applied.
--
-- Business rules under test:
--   • Declared profit is ALWAYS paid at maturity
--   • continue      = capital continues (the no-response default)
--   • exit          = all capital withdrawn
--   • partial_exit  = N slots withdrawn, remainder continues
--   • Instructions lock at maturity; admin exception can override
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
  ('10000000-0000-0000-0000-000000000007', 'i7@test.com'),
  ('10000000-0000-0000-0000-000000000008', 'i8@test.com');

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.com', 'Super Admin', 'super_admin'),
  ('10000000-0000-0000-0000-000000000001', 'i1@test.com', 'Investor One',   'investor'),
  ('10000000-0000-0000-0000-000000000002', 'i2@test.com', 'Investor Two',   'investor'),
  ('10000000-0000-0000-0000-000000000003', 'i3@test.com', 'Investor Three', 'investor'),
  ('10000000-0000-0000-0000-000000000004', 'i4@test.com', 'Investor Four',  'investor'),
  ('10000000-0000-0000-0000-000000000005', 'i5@test.com', 'Investor Five',  'investor'),
  ('10000000-0000-0000-0000-000000000006', 'i6@test.com', 'Investor Six',   'investor'),
  ('10000000-0000-0000-0000-000000000007', 'i7@test.com', 'Investor Seven', 'investor'),
  ('10000000-0000-0000-0000-000000000008', 'i8@test.com', 'Investor Eight', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;

-- Bank details present except I4 (uses legacy rollover_all, no payout)
-- and I7 (used to test the missing-bank failure path).
INSERT INTO investors (id, profile_id, investor_code, full_name, email, bank_name, account_name, account_number) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MV00001', 'Investor One',   'i1@test.com', 'GTB', 'Investor One',   '0123456781'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'MV00002', 'Investor Two',   'i2@test.com', 'GTB', 'Investor Two',   '0123456789'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'MV00003', 'Investor Three', 'i3@test.com', 'GTB', 'Investor Three', '0123456780'),
  ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000004', 'MV00004', 'Investor Four',  'i4@test.com', NULL,  NULL,             NULL),
  ('20000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000005', 'MV00005', 'Investor Five',  'i5@test.com', 'UBA', 'Investor Five',  '0123456785'),
  ('20000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000006', 'MV00006', 'Investor Six',   'i6@test.com', 'UBA', 'Investor Six',   '0123456786'),
  ('20000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000007', 'MV00007', 'Investor Seven', 'i7@test.com', NULL,  NULL,             NULL),
  ('20000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000008', 'MV00008', 'Investor Eight', 'i8@test.com', 'Zenith', 'Investor Eight', '0123456788');

-- ─── Series A: ₦500,000 slot, 50/50 mudarabah ───────────────
UPDATE series SET price_per_unit = 500000, mudarabah_investor_ratio = 0.50, min_units = 0.5
WHERE name = 'A';

-- ─── Source cycle ending today ──────────────────────────────
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status)
SELECT 'c0000000-0000-0000-0000-000000000001', id, 1,
       'Test Cycle 1',
       CURRENT_DATE - INTERVAL '3 months', CURRENT_DATE, 'active'
FROM series WHERE name = 'A';

-- ─── Investments (10 slots total) ───────────────────────────
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
  ('30000000-0000-0000-0000-000000000007'::uuid, 'MG-A-001-MV00007', '20000000-0000-0000-0000-000000000007'::uuid, 1.0::numeric,  500000::numeric),
  ('30000000-0000-0000-0000-000000000008'::uuid, 'MG-A-001-MV00008', '20000000-0000-0000-0000-000000000008'::uuid, 2.0::numeric, 1000000::numeric)
) AS x(id, code, inv, units, capital)
WHERE s.name = 'A';

-- ════════════════════════════════════════════════════════════
-- Maturity instructions (submitted while cycle still active)
-- ════════════════════════════════════════════════════════════

-- I2: withdraw everything (Option 2)
SET test.uid = '10000000-0000-0000-0000-000000000002';
SELECT submit_rollover_decision('30000000-0000-0000-0000-000000000002', 'exit', 'GTB', 'Investor Two', '0123456789', NULL);

-- I3: profit paid, capital continues (Option 1, explicit)
SET test.uid = '10000000-0000-0000-0000-000000000003';
SELECT submit_rollover_decision('30000000-0000-0000-0000-000000000003', 'continue', 'GTB', 'Investor Three', '0123456780', NULL);

-- Partial validation runs FIRST, because from migration 036 a valid
-- instruction locks: the arithmetic has to be exercised before I8 has
-- answered, or every attempt below is refused for being a second one.
SET test.uid = '10000000-0000-0000-0000-000000000008';

-- Partial validation: withdrawing ALL slots must direct to Option 2
DO $$
BEGIN
  BEGIN
    PERFORM submit_rollover_decision('30000000-0000-0000-0000-000000000008', 'partial_exit', 'Zenith', 'Investor Eight', '0123456788', NULL, FALSE, 2.0);
    RAISE EXCEPTION 'TEST FAIL: partial_exit accepted full-slot withdrawal';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%Withdraw All%' THEN
      RAISE NOTICE 'PASS: full-slot partial redirected to Option 2';
    ELSE RAISE; END IF;
  END;
  BEGIN
    PERFORM submit_rollover_decision('30000000-0000-0000-0000-000000000008', 'partial_exit', 'Zenith', 'Investor Eight', '0123456788', NULL, FALSE, 3.0);
    RAISE EXCEPTION 'TEST FAIL: partial_exit accepted more slots than owned';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%cannot withdraw more slots%' THEN
      RAISE NOTICE 'PASS: over-withdrawal rejected';
    ELSE RAISE; END IF;
  END;
  BEGIN
    PERFORM submit_rollover_decision('30000000-0000-0000-0000-000000000008', 'partial_exit', 'Zenith', 'Investor Eight', '0123456788', NULL, FALSE, 0);
    RAISE EXCEPTION 'TEST FAIL: partial_exit accepted zero slots';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%more than zero%' THEN
      RAISE NOTICE 'PASS: zero-slot withdrawal rejected';
    ELSE RAISE; END IF;
  END;
END $$;

-- I8: partial withdrawal (Option 3) — withdraw 0.5 of 2 slots
SELECT submit_rollover_decision('30000000-0000-0000-0000-000000000008', 'partial_exit', 'Zenith', 'Investor Eight', '0123456788', NULL, FALSE, 0.5);

-- 036: and that answer is final. An investor gets one instruction;
-- changing it afterwards is a super admin's job.
DO $$
BEGIN
  BEGIN
    PERFORM submit_rollover_decision('30000000-0000-0000-0000-000000000008', 'partial_exit', 'Zenith', 'Investor Eight', '0123456788', NULL, FALSE, 1.0);
    RAISE EXCEPTION 'TEST FAIL: a submitted instruction was changed by the investor';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE '%locked%' OR SQLERRM LIKE '%already been rolled over%' THEN
      RAISE NOTICE 'PASS: a submitted instruction is final';
    ELSE RAISE; END IF;
  END;
END $$;

-- Deadline lock: I4 tries after the deadline → must fail
SET test.uid = 'a0000000-0000-0000-0000-000000000001';
-- Both halves of the deadline, because from migration 027 the
-- effective one is GREATEST(rollover_deadline, the window's close).
-- Moving only rollover_deadline leaves the window holding it open —
-- this test had been passing vacuously since 027.
UPDATE cycles SET rollover_deadline = CURRENT_DATE - 1,
                  instruction_closes_at = CURRENT_DATE - 1
 WHERE id = 'c0000000-0000-0000-0000-000000000001';

SET test.uid = '10000000-0000-0000-0000-000000000004';
DO $$
BEGIN
  BEGIN
    PERFORM submit_rollover_decision('30000000-0000-0000-0000-000000000004', 'rollover_all');
    RAISE EXCEPTION 'TEST FAIL: instruction accepted after lock';
  EXCEPTION WHEN OTHERS THEN
    -- 034 reworded this: it is the CAPITAL being processed that
    -- closes an instruction, not the profit being declared.
    IF SQLERRM LIKE '%closed for this investment%' OR SQLERRM LIKE '%locked%' THEN
      RAISE NOTICE 'PASS: post-deadline instruction rejected';
    ELSE RAISE; END IF;
  END;
END $$;

-- Super admin approves the exception for I4 (legacy rollover_all)
SET test.uid = 'a0000000-0000-0000-0000-000000000001';
SELECT submit_rollover_decision('30000000-0000-0000-0000-000000000004', 'rollover_all', NULL, NULL, NULL, NULL, TRUE);
UPDATE cycles SET rollover_deadline = NULL, instruction_closes_at = NULL
 WHERE id = 'c0000000-0000-0000-0000-000000000001';

-- I7: force a decision row that will FAIL at processing
-- ('continue' payout with no bank details, inserted directly to
-- simulate legacy/corrupt data)
INSERT INTO rollover_decisions (investment_id, investor_id, source_cycle_id, decision, via)
VALUES ('30000000-0000-0000-0000-000000000007', '20000000-0000-0000-0000-000000000007',
        'c0000000-0000-0000-0000-000000000001', 'continue', 'investor');

-- I1, I5, I6: no instruction → default = profit paid, capital continues

-- ════════════════════════════════════════════════════════════
-- Profit declaration: net 2,000,000 → 1,000,000 investor share
-- over 10 slots → ₦100,000 per slot
-- ════════════════════════════════════════════════════════════
SET test.uid = 'a0000000-0000-0000-0000-000000000001';
SELECT declare_cycle_profit('c0000000-0000-0000-0000-000000000001', 2400000, 400000, 'test declaration');

DO $$
DECLARE v NUMERIC;
BEGIN
  SELECT declared_profit INTO v FROM investments WHERE id = '30000000-0000-0000-0000-000000000001';
  IF v != 100000 THEN RAISE EXCEPTION 'TEST FAIL: I1 declared_profit % != 100000', v; END IF;
  SELECT declared_profit INTO v FROM investments WHERE id = '30000000-0000-0000-0000-000000000005';
  IF v != 50000 THEN RAISE EXCEPTION 'TEST FAIL: I5 declared_profit % != 50000', v; END IF;
  RAISE NOTICE 'PASS: per-slot profit calculated from declared profit (no preset ROI)';
END $$;

SET test.uid = 'a0000000-0000-0000-0000-000000000001';

-- ════════════════════════════════════════════════════════════
-- Next cycle: missing → blocked; then auto-generate (3 months)
-- ════════════════════════════════════════════════════════════
DO $$
BEGIN
  BEGIN
    PERFORM process_cycle_rollover('c0000000-0000-0000-0000-000000000001');
    RAISE EXCEPTION 'TEST FAIL: rollover ran without a next cycle';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM LIKE 'NEXT_CYCLE_MISSING%' THEN
      RAISE NOTICE 'PASS: missing next cycle blocks processing';
    ELSE RAISE; END IF;
  END;
END $$;

DO $$
DECLARE
  v_id UUID;
  v_start DATE; v_end DATE; v_src_end DATE;
BEGIN
  SELECT end_date INTO v_src_end FROM cycles WHERE id = 'c0000000-0000-0000-0000-000000000001';
  SELECT create_next_cycle(s.id) INTO v_id FROM series s WHERE s.name = 'A';
  SELECT start_date, end_date INTO v_start, v_end FROM cycles WHERE id = v_id;
  -- 036: the DAY AFTER the previous cycle ends, and ending the day
  -- before the three months are up, so two cycles never share a date.
  IF v_start != v_src_end + 1
     OR v_end != (v_start + INTERVAL '3 months' - INTERVAL '1 day')::date THEN
    RAISE EXCEPTION 'TEST FAIL: next cycle dates wrong (% → %), expected to start %',
      v_start, v_end, v_src_end + 1;
  END IF;
  RAISE NOTICE 'PASS: next cycle auto-generated, starting the day after (% → %)', v_start, v_end;
END $$;

-- Still open after the declaration: I5 submits once the profit is out.
--
-- This asserted the opposite until migration 034, and that was the
-- Series B failure — settling matures every investment, so a rule
-- keyed on maturity shut out all twenty-eight investors the portal
-- was still asking. Declaring the profit is the PROFIT event;
-- an instruction is about CAPITAL, and stays open until the capital
-- actually moves.
SET test.uid = '10000000-0000-0000-0000-000000000005';
DO $$
BEGIN
  PERFORM submit_rollover_decision('30000000-0000-0000-0000-000000000005', 'continue', 'UBA', 'Investor Five', '0123456785');
  IF NOT EXISTS (SELECT 1 FROM rollover_decisions
                 WHERE investment_id = '30000000-0000-0000-0000-000000000005'
                   AND decision::text = 'continue') THEN
    RAISE EXCEPTION 'TEST FAIL: a matured investment could not be instructed';
  END IF;
  -- 036: and because the profit IS declared, this one goes across to
  -- the next cycle immediately rather than waiting for the bulk run.
  IF (SELECT next_investment_id FROM investments
       WHERE id = '30000000-0000-0000-0000-000000000005') IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: instructing after settlement did not enrol I5';
  END IF;
  RAISE NOTICE 'PASS: instructions stay open after the profit is declared, and enrol at once';
END $$;
SET test.uid = 'a0000000-0000-0000-0000-000000000001';

-- ════════════════════════════════════════════════════════════
-- First processing run — I7 must fail, everyone else processes
-- ════════════════════════════════════════════════════════════
CREATE TEMP TABLE runs (name TEXT PRIMARY KEY, r JSONB);
INSERT INTO runs SELECT 'run1', process_cycle_rollover('c0000000-0000-0000-0000-000000000001');
SELECT r->>'rolled' AS rolled, r->>'withdrawn' AS withdrawn,
       r->>'failed' AS failed, r->>'skipped' AS skipped FROM runs WHERE name='run1';

DO $$
DECLARE v RECORD; c RECORD; n INTEGER; dest UUID; r JSONB;
BEGIN
  SELECT runs.r INTO r FROM runs WHERE name='run1';
  -- 036: five, not six. I5 instructed after the profit was declared and
  -- so went across on submission; the bulk run has one fewer to carry.
  IF (r->>'rolled')::int != 5 OR (r->>'withdrawn')::int != 1 OR (r->>'failed')::int != 1 THEN
    RAISE EXCEPTION 'TEST FAIL: run1 rolled=% withdrawn=% failed=% (expected 5/1/1)',
      r->>'rolled', r->>'withdrawn', r->>'failed';
  END IF;

  SELECT id INTO dest FROM cycles WHERE cycle_number = 2 AND series_id = (SELECT id FROM series WHERE name = 'A');

  -- Default (no instruction): profit paid, capital ONLY continues
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000001';
  IF v.units != 1.0 OR v.capital != 500000 OR v.rollover_balance != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: I1 default continue wrong (units=% capital=% balance=%)', v.units, v.capital, v.rollover_balance;
  END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000001' AND type = 'roi' AND amount = 100000;
  IF n != 1 THEN RAISE EXCEPTION 'TEST FAIL: I1 default profit payout missing'; END IF;
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000001';
  IF c.method != 'automatic' OR c.decision != 'continue' OR c.profit_rolled_over != 0 OR c.withdrawal_amount != 100000 THEN
    RAISE EXCEPTION 'TEST FAIL: I1 rollover record wrong (%, %)', c.method, c.decision;
  END IF;
  RAISE NOTICE 'PASS: no instruction → profit paid + capital continues (default)';

  -- Option 2: full withdrawal
  SELECT COUNT(*) INTO n FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000002';
  IF n != 0 THEN RAISE EXCEPTION 'TEST FAIL: I2 placed in next cycle despite full withdrawal'; END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000002' AND type = 'roi' AND amount = 200000;
  IF n != 1 THEN RAISE EXCEPTION 'TEST FAIL: I2 profit payout missing'; END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000002' AND type = 'capital' AND amount = 1000000;
  IF n != 1 THEN RAISE EXCEPTION 'TEST FAIL: I2 capital payout missing'; END IF;
  RAISE NOTICE 'PASS: Option 2 — profit + full capital paid out, no continuation';

  -- Option 1: explicit continue
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000003';
  IF v.units != 1.0 OR v.capital != 500000 THEN RAISE EXCEPTION 'TEST FAIL: I3 continue wrong'; END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000003' AND type = 'roi' AND amount = 100000;
  IF n != 1 THEN RAISE EXCEPTION 'TEST FAIL: I3 profit payout missing'; END IF;
  RAISE NOTICE 'PASS: Option 1 — profit paid, capital continues';

  -- Option 3: partial withdrawal (0.5 of 2 slots)
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000008';
  IF v.units != 1.5 OR v.capital != 750000 OR v.rollover_balance != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: I8 partial remainder wrong (units=% capital=% balance=%)', v.units, v.capital, v.rollover_balance;
  END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000008' AND type = 'roi' AND amount = 200000;
  IF n != 1 THEN RAISE EXCEPTION 'TEST FAIL: I8 profit payout missing'; END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000008' AND type = 'capital' AND amount = 250000;
  IF n != 1 THEN RAISE EXCEPTION 'TEST FAIL: I8 partial capital payout (0.5 × 500k) missing'; END IF;
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000008';
  IF c.decision != 'partial_exit' OR c.slots_withdrawn != 0.5 OR c.capital_rolled_over != 750000
     OR c.withdrawal_amount != 450000 THEN
    RAISE EXCEPTION 'TEST FAIL: I8 rollover record wrong (slots_out=% cap_rolled=% withdrawal=%)',
      c.slots_withdrawn, c.capital_rolled_over, c.withdrawal_amount;
  END IF;
  RAISE NOTICE 'PASS: Option 3 — partial withdrawal, remainder continues';

  -- Legacy rollover_all via admin exception still works
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000004';
  IF v.capital != 600000 OR v.rollover_balance != 100000 THEN
    RAISE EXCEPTION 'TEST FAIL: I4 rollover_all amounts wrong';
  END IF;
  RAISE NOTICE 'PASS: legacy rollover_all honored via admin exception';

  -- Fractional slots continue correctly
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000005';
  IF v.units != 0.5 OR v.capital != 250000 THEN RAISE EXCEPTION 'TEST FAIL: I5 0.5-slot continue wrong'; END IF;
  SELECT * INTO v FROM investments WHERE parent_investment_id = '30000000-0000-0000-0000-000000000006';
  IF v.units != 1.5 OR v.capital != 750000 THEN RAISE EXCEPTION 'TEST FAIL: I6 1.5-slot continue wrong'; END IF;
  RAISE NOTICE 'PASS: 0.5 and 1.5 slot holdings continue correctly';

  -- I7 failed cleanly (missing bank details), retryable
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000007';
  IF c.status != 'failed' OR c.error NOT LIKE '%bank details%' THEN
    RAISE EXCEPTION 'TEST FAIL: I7 expected failed record, got % (%)', c.status, c.error;
  END IF;
  SELECT COUNT(*) INTO n FROM payment_requests WHERE investment_id = '30000000-0000-0000-0000-000000000007';
  IF n != 0 THEN RAISE EXCEPTION 'TEST FAIL: I7 failure leaked payment requests'; END IF;
  RAISE NOTICE 'PASS: failure isolated per investor, no partial writes';
END $$;

-- ════════════════════════════════════════════════════════════
-- Idempotency: run twice — no duplicates
-- ════════════════════════════════════════════════════════════
INSERT INTO runs SELECT 'run2', process_cycle_rollover('c0000000-0000-0000-0000-000000000001');

DO $$
DECLARE r JSONB := (SELECT runs.r FROM runs WHERE name='run2'); n INTEGER;
BEGIN
  IF (r->>'rolled')::int != 0 OR (r->>'withdrawn')::int != 0 OR (r->>'failed')::int != 1 THEN
    RAISE EXCEPTION 'TEST FAIL: second run must re-process nothing (rolled=% withdrawn=% failed=%)',
      r->>'rolled', r->>'withdrawn', r->>'failed';
  END IF;
  SELECT COUNT(*) INTO n FROM investments;
  IF n != 14 THEN RAISE EXCEPTION 'TEST FAIL: expected 14 investments (8 old + 6 new), found %', n; END IF;
  SELECT COUNT(*) INTO n FROM (
    SELECT investor_id FROM investments
    WHERE cycle_id = (SELECT id FROM cycles WHERE cycle_number = 2 AND series_id = (SELECT id FROM series WHERE name='A'))
    GROUP BY investor_id HAVING COUNT(*) > 1
  ) d;
  IF n != 0 THEN RAISE EXCEPTION 'TEST FAIL: investor appears twice in destination cycle'; END IF;
  RAISE NOTICE 'PASS: double-run creates no duplicate allocations';
END $$;

-- ════════════════════════════════════════════════════════════
-- Failed-record retry: fix I7 bank details and re-run
-- ════════════════════════════════════════════════════════════
UPDATE rollover_decisions
SET bank_name = 'Zenith', account_name = 'Investor Seven', account_number = '0123456700'
WHERE investment_id = '30000000-0000-0000-0000-000000000007';

INSERT INTO runs SELECT 'run3', process_cycle_rollover('c0000000-0000-0000-0000-000000000001');

DO $$
DECLARE r JSONB := (SELECT runs.r FROM runs WHERE name='run3'); c RECORD; n INTEGER; src RECORD; dest RECORD;
BEGIN
  IF (r->>'rolled')::int != 1 OR (r->>'failed')::int != 0 THEN
    RAISE EXCEPTION 'TEST FAIL: retry expected rolled=1 failed=0, got rolled=% failed=%', r->>'rolled', r->>'failed';
  END IF;
  SELECT * INTO c FROM cycle_rollovers WHERE previous_investment_id = '30000000-0000-0000-0000-000000000007';
  IF c.status != 'completed' OR c.error IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL: I7 retry did not complete';
  END IF;
  RAISE NOTICE 'PASS: failed record retried successfully after fixing bank details';

  SELECT * INTO src FROM cycles WHERE id = 'c0000000-0000-0000-0000-000000000001';
  IF src.status != 'completed' OR src.rollover_processed_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL: source cycle not marked historical/processed';
  END IF;
  SELECT * INTO dest FROM cycles WHERE cycle_number = 2 AND series_id = (SELECT id FROM series WHERE name='A');
  -- 036: it starts TOMORROW, so it is correctly still upcoming — the
  -- rollover only activates a destination whose day has come.
  IF dest.status != 'upcoming' THEN
    RAISE EXCEPTION 'TEST FAIL: a cycle that has not started yet is already %', dest.status;
  END IF;
  -- and the nightly job starts it the moment it is due
  UPDATE cycles SET start_date = CURRENT_DATE WHERE id = dest.id;
  PERFORM mudarabah_open_next_cycles();
  SELECT * INTO dest FROM cycles WHERE id = dest.id;
  IF dest.status != 'active' THEN RAISE EXCEPTION 'TEST FAIL: destination cycle not activated when due'; END IF;
  IF dest.total_investors != 7 OR dest.total_slots != 7.5 OR dest.total_capital != 3850000 THEN
    RAISE EXCEPTION 'TEST FAIL: destination totals wrong (investors=% slots=% capital=%)',
      dest.total_investors, dest.total_slots, dest.total_capital;
  END IF;
  SELECT COUNT(*) INTO n FROM investments WHERE cycle_id = src.id;
  IF n != 8 THEN RAISE EXCEPTION 'TEST FAIL: original investment history was deleted/overwritten'; END IF;
  SELECT COUNT(*) INTO n FROM investors;
  IF n != 8 THEN RAISE EXCEPTION 'TEST FAIL: duplicate investor profiles created'; END IF;
  RAISE NOTICE 'PASS: old cycle historical, new cycle active, totals correct, identities preserved';
END $$;

ROLLBACK;
\echo '=== ALL MATURITY INSTRUCTION TESTS PASSED ==='
