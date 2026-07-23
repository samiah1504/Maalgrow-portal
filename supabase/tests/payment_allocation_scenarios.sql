-- ============================================================
-- Payment Allocation — scenario tests (migration 014)
-- Run against a DB with migrations 001–014 applied.
--
-- Rules under test:
--   • record_investor_payment allocates to series + cycle:
--     top-up when the enrolment exists, create when it doesn't
--   • amount must equal slots × series price (0.5 steps)
--   • pending → confirm applies allocation; reject applies none
--   • edit recalculates old AND new allocations (incl. moves)
--   • reversal removes the allocation but keeps the record
--   • instalments (apply_to_outstanding) never change slots
--   • cycle totals + amount_received stay consistent throughout
-- ============================================================
\set ON_ERROR_STOP on

BEGIN;

-- ─── Seed ───────────────────────────────────────────────────
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.com'),
  ('10000000-0000-0000-0000-000000000001', 'p1@test.com'),
  ('10000000-0000-0000-0000-000000000002', 'p2@test.com');

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.com', 'Super Admin', 'super_admin'),
  ('10000000-0000-0000-0000-000000000001', 'p1@test.com', 'Pay One', 'investor'),
  ('10000000-0000-0000-0000-000000000002', 'p2@test.com', 'Pay Two', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO investors (id, profile_id, investor_code, full_name, email) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MG00001', 'Pay One', 'p1@test.com'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'MG00002', 'Pay Two', 'p2@test.com');

UPDATE series SET price_per_unit = 500000, is_active = TRUE WHERE name IN ('A', 'B');
UPDATE series SET is_active = FALSE WHERE name = 'C';

-- Cycles: A1 active, A2 upcoming, B1 active, A0 matured
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status)
SELECT c.id, s.id, c.num, c.label, c.sd, c.ed, c.st::cycle_status
FROM (VALUES
  ('c1000000-0000-0000-0000-00000000000a'::uuid, 'A', 1, 'A-Cycle 1', CURRENT_DATE - 30, CURRENT_DATE + 60, 'active'),
  ('c1000000-0000-0000-0000-00000000000b'::uuid, 'A', 2, 'A-Cycle 2', CURRENT_DATE + 61, CURRENT_DATE + 150, 'upcoming'),
  ('c1000000-0000-0000-0000-00000000000c'::uuid, 'B', 1, 'B-Cycle 1', CURRENT_DATE - 30, CURRENT_DATE + 60, 'active'),
  ('c1000000-0000-0000-0000-00000000000d'::uuid, 'A', 0, 'A-Cycle 0', CURRENT_DATE - 200, CURRENT_DATE - 100, 'matured')
) AS c(id, sname, num, label, sd, ed, st)
JOIN series s ON s.name::text = c.sname;

-- Existing enrolment for P1 in A1: 2 slots / ₦1,000,000 (the spec's example)
INSERT INTO investments (id, investment_code, investor_id, series_id, cycle_id, units, price_per_unit, capital, investment_date, maturity_date, status)
SELECT '30000000-0000-0000-0000-000000000001', 'MG-A-001-MG00001', '20000000-0000-0000-0000-000000000001', s.id,
       'c1000000-0000-0000-0000-00000000000a', 2.0, 500000, 1000000, CURRENT_DATE - 30, CURRENT_DATE + 60, 'active'
FROM series s WHERE s.name = 'A';

SET test.uid = 'a0000000-0000-0000-0000-000000000001';

-- Helper: assert cycle totals
CREATE OR REPLACE FUNCTION assert_cycle(p_cycle UUID, p_capital NUMERIC, p_slots NUMERIC, p_investors INT, p_received NUMERIC, p_ctx TEXT)
RETURNS VOID AS $$
DECLARE c cycles%ROWTYPE;
BEGIN
  SELECT * INTO c FROM cycles WHERE id = p_cycle;
  IF c.total_capital <> p_capital OR c.total_slots <> p_slots
     OR c.total_investors <> p_investors OR c.amount_received <> p_received THEN
    RAISE EXCEPTION 'TEST FAIL [%]: cycle % totals cap=% slots=% inv=% recv=% (expected cap=% slots=% inv=% recv=%)',
      p_ctx, c.cycle_label, c.total_capital, c.total_slots, c.total_investors, c.amount_received,
      p_capital, p_slots, p_investors, p_received;
  END IF;
END; $$ LANGUAGE plpgsql;

-- ════════════════════════════════════════════════════════════
-- Scenario 1: top-up an existing enrolment (spec example:
-- ₦1,000,000 + ₦500,000 → ₦1,500,000, 3 slots, 2 payment rows)
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE r JSONB;
BEGIN
  r := record_investor_payment(
    '20000000-0000-0000-0000-000000000001',
    (SELECT id FROM series WHERE name = 'A'),
    'c1000000-0000-0000-0000-00000000000a',
    500000, 1.0, CURRENT_DATE, 'bank_transfer', 'REF-001', NULL, 'confirmed', FALSE);

  IF (r->>'enrolment_units')::numeric <> 3.0 OR (r->>'enrolment_capital')::numeric <> 1500000 THEN
    RAISE EXCEPTION 'TEST FAIL S1: expected 3 slots / 1,500,000 got % / %',
      r->>'enrolment_units', r->>'enrolment_capital';
  END IF;
  IF (SELECT COUNT(*) FROM investments WHERE investor_id = '20000000-0000-0000-0000-000000000001'
        AND cycle_id = 'c1000000-0000-0000-0000-00000000000a') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S1: duplicate enrolment created';
  END IF;
  IF (SELECT COUNT(*) FROM investment_payments WHERE investment_id = '30000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S1: payment history row missing';
  END IF;
  -- seed enrolment (1M, 2 slots, 1 investor, 0 received) + this payment
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000a', 1500000, 3.0, 1, 500000, 'S1');
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'payment_recorded') THEN
    RAISE EXCEPTION 'TEST FAIL S1: audit log missing';
  END IF;
  RAISE NOTICE 'PASS S1: top-up existing enrolment (1M + 500k = 1.5M / 3 slots)';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 2: new enrolment (investor not yet in the cycle),
-- fractional 0.5 slots = ₦250,000
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE r JSONB;
BEGIN
  r := record_investor_payment(
    '20000000-0000-0000-0000-000000000002',
    (SELECT id FROM series WHERE name = 'A'),
    'c1000000-0000-0000-0000-00000000000a',
    250000, 0.5, CURRENT_DATE, 'cash', 'REF-002', NULL, 'confirmed', FALSE);

  IF r->>'investment_id' IS NULL OR (r->>'enrolment_units')::numeric <> 0.5 THEN
    RAISE EXCEPTION 'TEST FAIL S2: enrolment not created correctly: %', r;
  END IF;
  IF (SELECT investment_code FROM investments WHERE id = (r->>'investment_id')::uuid)
     NOT LIKE 'MG-A-001-MG00002%' THEN
    RAISE EXCEPTION 'TEST FAIL S2: bad investment code';
  END IF;
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000a', 1750000, 3.5, 2, 750000, 'S2');
  RAISE NOTICE 'PASS S2: new enrolment with fractional 0.5 slot';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 3: payment to a different series (B) creates a
-- separate enrolment there
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE r JSONB;
BEGIN
  r := record_investor_payment(
    '20000000-0000-0000-0000-000000000001',
    (SELECT id FROM series WHERE name = 'B'),
    'c1000000-0000-0000-0000-00000000000c',
    1000000, 2.0, CURRENT_DATE, 'bank_transfer', 'REF-003', NULL, 'confirmed', FALSE);

  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000c', 1000000, 2.0, 1, 1000000, 'S3');
  IF (r->>'investor_active_capital')::numeric <> 2500000 THEN
    RAISE EXCEPTION 'TEST FAIL S3: investor total capital % (expected 2,500,000)', r->>'investor_active_capital';
  END IF;
  RAISE NOTICE 'PASS S3: separate series enrolment; investor totals aggregate across series';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 4: validation failures
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE v_a UUID := (SELECT id FROM series WHERE name = 'A');
        v_b UUID := (SELECT id FROM series WHERE name = 'B');
        v_c UUID := (SELECT id FROM series WHERE name = 'C');
BEGIN
  -- amount / slots mismatch
  BEGIN
    PERFORM record_investor_payment('20000000-0000-0000-0000-000000000001', v_a,
      'c1000000-0000-0000-0000-00000000000a', 600000, 1.0, CURRENT_DATE, NULL, NULL, NULL, 'confirmed', FALSE);
    RAISE EXCEPTION 'TEST FAIL S4a: mismatched amount accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%does not match%' THEN RAISE; END IF;
  END;
  -- cycle not in series
  BEGIN
    PERFORM record_investor_payment('20000000-0000-0000-0000-000000000001', v_b,
      'c1000000-0000-0000-0000-00000000000a', 500000, 1.0, CURRENT_DATE, NULL, NULL, NULL, 'confirmed', FALSE);
    RAISE EXCEPTION 'TEST FAIL S4b: cross-series cycle accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%does not belong%' THEN RAISE; END IF;
  END;
  -- zero amount
  BEGIN
    PERFORM record_investor_payment('20000000-0000-0000-0000-000000000001', v_a,
      'c1000000-0000-0000-0000-00000000000a', 0, 0, CURRENT_DATE, NULL, NULL, NULL, 'confirmed', FALSE);
    RAISE EXCEPTION 'TEST FAIL S4c: zero amount accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%greater than 0%' THEN RAISE; END IF;
  END;
  -- duplicate reference (case-insensitive)
  BEGIN
    PERFORM record_investor_payment('20000000-0000-0000-0000-000000000001', v_a,
      'c1000000-0000-0000-0000-00000000000a', 500000, 1.0, CURRENT_DATE, NULL, 'ref-001', NULL, 'confirmed', FALSE);
    RAISE EXCEPTION 'TEST FAIL S4d: duplicate reference accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%already exists%' THEN RAISE; END IF;
  END;
  -- matured cycle
  BEGIN
    PERFORM record_investor_payment('20000000-0000-0000-0000-000000000001', v_a,
      'c1000000-0000-0000-0000-00000000000d', 500000, 1.0, CURRENT_DATE, NULL, NULL, NULL, 'confirmed', FALSE);
    RAISE EXCEPTION 'TEST FAIL S4e: matured cycle accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%cannot receive new allocations%' THEN RAISE; END IF;
  END;
  -- inactive series
  BEGIN
    PERFORM record_investor_payment('20000000-0000-0000-0000-000000000001', v_c,
      (SELECT id FROM cycles WHERE series_id = v_c LIMIT 1), 500000, 1.0, CURRENT_DATE, NULL, NULL, NULL, 'confirmed', FALSE);
    RAISE EXCEPTION 'TEST FAIL S4f: inactive series accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%inactive%' AND SQLERRM NOT LIKE '%Select a cycle%' THEN RAISE; END IF;
  END;
  -- bad slot step
  BEGIN
    PERFORM record_investor_payment('20000000-0000-0000-0000-000000000001', v_a,
      'c1000000-0000-0000-0000-00000000000a', 600000, 1.2, CURRENT_DATE, NULL, NULL, NULL, 'confirmed', FALSE);
    RAISE EXCEPTION 'TEST FAIL S4g: 1.2 slots accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%steps of 0.5%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS S4: mismatch, cross-series, zero, duplicate ref, matured cycle, inactive series, bad step all rejected';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 5: non-admin cannot record payments
-- ════════════════════════════════════════════════════════════
SET test.uid = '10000000-0000-0000-0000-000000000001';
DO $$
BEGIN
  BEGIN
    PERFORM record_investor_payment('20000000-0000-0000-0000-000000000001',
      (SELECT id FROM series WHERE name = 'A'),
      'c1000000-0000-0000-0000-00000000000a', 500000, 1.0, CURRENT_DATE, NULL, NULL, NULL, 'confirmed', FALSE);
    RAISE EXCEPTION 'TEST FAIL S5: investor recorded a payment';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%permission%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS S5: investor blocked from recording payments';
END $$;
SET test.uid = 'a0000000-0000-0000-0000-000000000001';

-- ════════════════════════════════════════════════════════════
-- Scenario 6: pending payment → no allocation until confirmed;
-- reject leaves no allocation
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE r JSONB; v_pay UUID; v_units NUMERIC;
BEGIN
  -- pending on the UPCOMING cycle A2 (no enrolment yet)
  r := record_investor_payment(
    '20000000-0000-0000-0000-000000000002',
    (SELECT id FROM series WHERE name = 'A'),
    'c1000000-0000-0000-0000-00000000000b',
    500000, 1.0, CURRENT_DATE, 'bank_transfer', 'REF-PEND', NULL, 'pending', FALSE);
  v_pay := (r->>'payment_id')::uuid;

  IF r->>'investment_id' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL S6: pending payment allocated an enrolment';
  END IF;
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000b', 0, 0, 0, 0, 'S6-pending');

  r := confirm_investor_payment(v_pay);
  IF r->>'investment_id' IS NULL OR (r->>'payment_status') <> 'confirmed' THEN
    RAISE EXCEPTION 'TEST FAIL S6: confirmation did not allocate: %', r;
  END IF;
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000b', 500000, 1.0, 1, 500000, 'S6-confirmed');

  -- pending then rejected → nothing ever counted
  r := record_investor_payment(
    '20000000-0000-0000-0000-000000000002',
    (SELECT id FROM series WHERE name = 'A'),
    'c1000000-0000-0000-0000-00000000000b',
    250000, 0.5, CURRENT_DATE, NULL, 'REF-REJ', NULL, 'pending', FALSE);
  r := reject_investor_payment((r->>'payment_id')::uuid, 'never arrived');
  SELECT units INTO v_units FROM investments
    WHERE investor_id = '20000000-0000-0000-0000-000000000002'
      AND cycle_id = 'c1000000-0000-0000-0000-00000000000b';
  IF v_units <> 1.0 THEN
    RAISE EXCEPTION 'TEST FAIL S6: rejected payment changed the enrolment';
  END IF;
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000b', 500000, 1.0, 1, 500000, 'S6-rejected');
  RAISE NOTICE 'PASS S6: pending holds no allocation; confirm allocates; reject never counts';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 7: edit amount (REF-003: 2 slots → 1 slot in B1)
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE v_pay UUID; r JSONB;
BEGIN
  SELECT id INTO v_pay FROM investment_payments WHERE reference = 'REF-003';
  r := edit_investor_payment(v_pay,
    (SELECT id FROM series WHERE name = 'B'),
    'c1000000-0000-0000-0000-00000000000c',
    500000, 1.0, CURRENT_DATE, 'bank_transfer', 'REF-003', 'reduced');

  IF (r->>'enrolment_units')::numeric <> 1.0 OR (r->>'enrolment_capital')::numeric <> 500000 THEN
    RAISE EXCEPTION 'TEST FAIL S7: enrolment not recalculated: %', r;
  END IF;
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000c', 500000, 1.0, 1, 500000, 'S7');
  RAISE NOTICE 'PASS S7: editing the amount recalculated enrolment and cycle totals';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 8: move a payment to another cycle. The B1 payment
-- is P1's only allocation there → old enrolment is cancelled,
-- new enrolment appears in A2.
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE v_pay UUID; r JSONB; v_old_status TEXT;
BEGIN
  SELECT id INTO v_pay FROM investment_payments WHERE reference = 'REF-003';
  r := edit_investor_payment(v_pay,
    (SELECT id FROM series WHERE name = 'A'),
    'c1000000-0000-0000-0000-00000000000b',
    500000, 1.0, CURRENT_DATE, 'bank_transfer', 'REF-003', 'moved to A2');

  SELECT status::text INTO v_old_status FROM investments
  WHERE investor_id = '20000000-0000-0000-0000-000000000001'
    AND cycle_id = 'c1000000-0000-0000-0000-00000000000c';
  IF v_old_status <> 'cancelled' THEN
    RAISE EXCEPTION 'TEST FAIL S8: drained source enrolment is % (expected cancelled)', v_old_status;
  END IF;
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000c', 0, 0, 0, 0, 'S8-source');
  -- A2 already has P2's 1 slot from S6
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000b', 1000000, 2.0, 2, 1000000, 'S8-target');
  IF (SELECT COUNT(*) FROM investment_payments WHERE reference = 'REF-003') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S8: payment history row lost on move';
  END IF;
  RAISE NOTICE 'PASS S8: cycle move updated both cycles; drained enrolment cancelled; history kept';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 9: reverse a confirmed payment (S1's ₦500k top-up).
-- Enrolment drops back to 2 slots / ₦1,000,000; record kept.
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE v_pay UUID; r JSONB; v_row investment_payments%ROWTYPE;
BEGIN
  SELECT id INTO v_pay FROM investment_payments WHERE reference = 'REF-001';

  BEGIN
    PERFORM reverse_investor_payment(v_pay, '');
    RAISE EXCEPTION 'TEST FAIL S9: reversal without reason accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%reason is required%' THEN RAISE; END IF;
  END;

  r := reverse_investor_payment(v_pay, 'Recorded in error');
  IF (r->>'enrolment_units')::numeric <> 2.0 OR (r->>'enrolment_capital')::numeric <> 1000000 THEN
    RAISE EXCEPTION 'TEST FAIL S9: allocation not removed: %', r;
  END IF;
  SELECT * INTO v_row FROM investment_payments WHERE id = v_pay;
  IF v_row.status <> 'reversed' OR v_row.reversal_reason IS NULL OR v_row.reversed_by IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL S9: reversal metadata missing';
  END IF;
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000a', 1250000, 2.5, 2, 250000, 'S9');

  -- double reversal blocked
  BEGIN
    PERFORM reverse_investor_payment(v_pay, 'again');
    RAISE EXCEPTION 'TEST FAIL S9: double reversal accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%Only confirmed%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS S9: reversal removed allocation, kept the record, blocked double-reverse';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 10: instalment toward outstanding balance
-- (P1 in A1: capital ₦1,000,000, confirmed payments now ₦0)
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE r JSONB; v_units NUMERIC;
BEGIN
  r := record_investor_payment(
    '20000000-0000-0000-0000-000000000001',
    (SELECT id FROM series WHERE name = 'A'),
    'c1000000-0000-0000-0000-00000000000a',
    400000, NULL, CURRENT_DATE, 'bank_transfer', 'REF-INST', NULL, 'confirmed', TRUE);

  SELECT units INTO v_units FROM investments WHERE id = '30000000-0000-0000-0000-000000000001';
  IF v_units <> 2.0 THEN
    RAISE EXCEPTION 'TEST FAIL S10: instalment changed slots (%)', v_units;
  END IF;
  PERFORM assert_cycle('c1000000-0000-0000-0000-00000000000a', 1250000, 2.5, 2, 650000, 'S10');

  -- over-payment of outstanding blocked (outstanding is now 600k)
  BEGIN
    PERFORM record_investor_payment(
      '20000000-0000-0000-0000-000000000001',
      (SELECT id FROM series WHERE name = 'A'),
      'c1000000-0000-0000-0000-00000000000a',
      700000, NULL, CURRENT_DATE, NULL, 'REF-OVER', NULL, 'confirmed', TRUE);
    RAISE EXCEPTION 'TEST FAIL S10: instalment above outstanding accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%exceeds the outstanding%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS S10: instalment kept slots, tracked received; over-payment blocked';
END $$;

-- ════════════════════════════════════════════════════════════
-- Scenario 11: RLS — investors read only their own payments
-- ════════════════════════════════════════════════════════════
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies
  WHERE tablename = 'investment_payments'
    AND policyname = 'Investors view own investment payments';
  IF n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S11: investor RLS policy missing on investment_payments';
  END IF;
  RAISE NOTICE 'PASS S11: investor self-read RLS policy present';
END $$;

ROLLBACK;
\echo '=== ALL PAYMENT ALLOCATION TESTS PASSED ==='
