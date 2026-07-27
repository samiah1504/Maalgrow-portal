-- ============================================================
-- Funding invariant scenarios — migration 024
--
-- The rule: an investor is entered only after their payment has
-- arrived and been confirmed, so for every active enrolment
-- investments.capital == SUM(confirmed payments). Nothing enforced
-- that, and two half-links let it drift.
--
--   F1  a funded enrolment can be edited when the money follows
--   F2  raising slots past the money is refused, and writes nothing
--   F3  lowering slots below the money is refused just as firmly —
--       an investor paid for something they would stop holding
--   F4  correcting the PAYMENT fixes the enrolment by itself, which
--       is the resolution the refusal points at
--   F5  reversing a slot-carrying payment removes the slots too
--   F6  reversing a 0-slot payment does NOT, and the gap is reported
--       against the investor by name — this is the reported defect
--   F7  investment_funding_gaps sees only active enrolments, and
--       only the cycle asked about
--   F8  a non-admin session cannot move slots at all
--   F9  the reported case end to end: a money-only top-up closes
--       the gap and leaves her slot count alone
--
-- Run against a DB with 001–024 applied.
-- ============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'fundadmin@test.com'),
  ('10000000-0000-0000-0000-0000000000f1', 'fi1@test.com'),
  ('10000000-0000-0000-0000-0000000000f2', 'fi2@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'fundadmin@test.com', 'Funding Admin', 'super_admin'),
  ('10000000-0000-0000-0000-0000000000f1', 'fi1@test.com', 'Paid In Full', 'investor'),
  ('10000000-0000-0000-0000-0000000000f2', 'fi2@test.com', 'Phantom Slot', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO investors (id, profile_id, investor_code, full_name, email) VALUES
  ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'MGF0001', 'Paid In Full', 'fi1@test.com'),
  ('20000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f2', 'MGF0002', 'Phantom Slot', 'fi2@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id, name, description, start_month_offset, price_per_unit, mudarabah_investor_ratio)
VALUES ('30000000-0000-0000-0000-0000000000f1', 'A', 'Series A', 0, 500000, 0.70)
ON CONFLICT (name) DO UPDATE SET price_per_unit = EXCLUDED.price_per_unit;

INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status, unit_value)
VALUES
  ('40000000-0000-0000-0000-0000000000f1',
   (SELECT id FROM series WHERE name='A'), 901, 'S-901', '2026-04-30', '2026-07-30', 'active', 500000),
  ('40000000-0000-0000-0000-0000000000f2',
   (SELECT id FROM series WHERE name='A'), 902, 'S-902', '2026-08-01', '2026-10-31', 'active', 500000);

-- Two slots each, both fully paid for. This is the state the
-- portal's rule says every enrolment is always in.
INSERT INTO investments (
  investment_code, investor_id, series_id, cycle_id, units, price_per_unit,
  capital, investment_date, maturity_date, status
) VALUES
  ('MGF901-0001', '20000000-0000-0000-0000-0000000000f1',
   (SELECT id FROM series WHERE name='A'), '40000000-0000-0000-0000-0000000000f1',
   2, 500000, 1000000, '2026-04-30', '2026-07-30', 'active'),
  ('MGF901-0002', '20000000-0000-0000-0000-0000000000f2',
   (SELECT id FROM series WHERE name='A'), '40000000-0000-0000-0000-0000000000f1',
   2, 500000, 1000000, '2026-04-30', '2026-07-30', 'active');

-- The first investor's money carries its slots. The second's was
-- booked as a plain amount with no slots against it — the instalment
-- shape, which under this portal's rule should never occur, and which
-- is exactly how the reported cycle came to hold a slot nobody paid
-- for. Both are confirmed; both fully fund their enrolment today.
INSERT INTO investment_payments (
  investment_id, investor_id, series_id, cycle_id, amount, units,
  payment_date, status, reference
) VALUES
  ((SELECT id FROM investments WHERE investment_code='MGF901-0001'),
   '20000000-0000-0000-0000-0000000000f1',
   (SELECT id FROM series WHERE name='A'), '40000000-0000-0000-0000-0000000000f1',
   1000000, 2, '2026-04-25', 'confirmed', 'FUND-REF-0001'),
  ((SELECT id FROM investments WHERE investment_code='MGF901-0002'),
   '20000000-0000-0000-0000-0000000000f2',
   (SELECT id FROM series WHERE name='A'), '40000000-0000-0000-0000-0000000000f1',
   1000000, 0, '2026-04-25', 'confirmed', 'FUND-REF-0002');

SELECT set_config('test.uid', 'a0000000-0000-0000-0000-0000000000f1', false);

-- ------------------------------------------------------------
-- F2 / F3 — the invariant refuses, both ways, and writes nothing
-- ------------------------------------------------------------
DO $$
DECLARE
  v_inv  UUID := (SELECT id FROM investments WHERE investment_code='MGF901-0001');
  v_ok   BOOLEAN := FALSE;
  v_msg  TEXT;
  v_slots NUMERIC;
BEGIN
  -- Baseline: fully funded
  IF investment_confirmed_paid(v_inv) <> 1000000 THEN
    RAISE EXCEPTION 'TEST FAIL: fixture is not fully funded';
  END IF;
  IF EXISTS (SELECT 1 FROM investment_funding_gaps('40000000-0000-0000-0000-0000000000f1')) THEN
    RAISE EXCEPTION 'TEST FAIL: a fully funded cycle reported a gap';
  END IF;

  -- F2: three slots is ₦1,500,000 against ₦1,000,000 confirmed
  BEGIN
    PERFORM set_investment_slots(v_inv, 3, 'trying to credit an unpaid slot');
  EXCEPTION WHEN OTHERS THEN
    v_ok := TRUE;
    v_msg := SQLERRM;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL F2: slots were raised past the money confirmed';
  END IF;
  IF v_msg NOT LIKE '%500000.00 short%' THEN
    RAISE EXCEPTION 'TEST FAIL F2: the refusal did not name the shortfall: %', v_msg;
  END IF;

  -- and nothing was written on the way out
  SELECT units INTO v_slots FROM investments WHERE id = v_inv;
  IF v_slots <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL F2: the refused edit still moved the enrolment to %', v_slots;
  END IF;

  -- F3: one slot is ₦500,000 against ₦1,000,000 confirmed. Money the
  -- investor actually sent would stop being represented by anything.
  v_ok := FALSE;
  BEGIN
    PERFORM set_investment_slots(v_inv, 1, 'trying to drop a paid slot');
  EXCEPTION WHEN OTHERS THEN
    v_ok := TRUE;
    v_msg := SQLERRM;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL F3: slots were dropped below the money confirmed';
  END IF;
  IF v_msg NOT LIKE '%more than the slots account for%' THEN
    RAISE EXCEPTION 'TEST FAIL F3: the refusal read as a shortfall, not an excess: %', v_msg;
  END IF;

  SELECT units INTO v_slots FROM investments WHERE id = v_inv;
  IF v_slots <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL F3: the refused edit still moved the enrolment to %', v_slots;
  END IF;

  RAISE NOTICE 'PASS F2/F3: slots cannot move away from the money, in either direction';
END $$;

-- ------------------------------------------------------------
-- F4 / F1 — correcting the PAYMENT is the resolution, and once the
--           money is right the slot edit goes through
-- ------------------------------------------------------------
DO $$
DECLARE
  v_inv   UUID;
  v_pay   UUID := (SELECT id FROM investment_payments WHERE reference='FUND-REF-0001');
  v_res   JSONB;
  v_units NUMERIC;
BEGIN
  -- The investor actually sent ₦1,500,000 for three slots; ₦1,000,000
  -- was keyed. Correcting the payment carries its slots with it —
  -- this is the existing flow, unchanged by 024.
  --
  -- NOTE the enrolment is resolved through the payment afterwards,
  -- not captured beforehand. When an edit removes an allocation that
  -- covered the whole enrolment, remove_payment_allocation cancels
  -- that row and apply_payment_allocation opens a fresh one, so the
  -- payment lands on a DIFFERENT investment id. Long-standing
  -- behaviour from migration 014; asserting on the old id would be
  -- testing a fiction.
  PERFORM edit_investor_payment(
    v_pay,
    (SELECT id FROM series WHERE name='A'),
    '40000000-0000-0000-0000-0000000000f1',
    1500000, 3, '2026-04-25', NULL, 'FUND-REF-0001', NULL);

  SELECT investment_id INTO v_inv FROM investment_payments WHERE id = v_pay;
  SELECT units INTO v_units FROM investments WHERE id = v_inv;
  IF v_units <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL F4: correcting the payment left the enrolment at % slots', v_units;
  END IF;
  IF investment_confirmed_paid(v_inv) <> 1500000 THEN
    RAISE EXCEPTION 'TEST FAIL F4: confirmed money did not follow the correction';
  END IF;
  IF EXISTS (
    SELECT 1 FROM investment_funding_gaps('40000000-0000-0000-0000-0000000000f1')
    WHERE investment_id = v_inv
  ) THEN
    RAISE EXCEPTION 'TEST FAIL F4: the corrected enrolment still reports a gap';
  END IF;

  -- F1: with the money right, a slot edit that keeps the invariant is
  -- allowed. Half slots are legal and must survive the rounding.
  PERFORM edit_investor_payment(
    v_pay,
    (SELECT id FROM series WHERE name='A'),
    '40000000-0000-0000-0000-0000000000f1',
    1250000, 2.5, '2026-04-25', NULL, 'FUND-REF-0001', NULL);

  SELECT investment_id INTO v_inv FROM investment_payments WHERE id = v_pay;
  v_res := set_investment_slots(v_inv, 2.5, 'no change to the money');
  IF (v_res->>'changed')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL F1: a no-op edit reported a change';
  END IF;

  SELECT units INTO v_units FROM investments WHERE id = v_inv;
  IF v_units <> 2.5 THEN
    RAISE EXCEPTION 'TEST FAIL F1: half slots did not survive, got %', v_units;
  END IF;

  RAISE NOTICE 'PASS F1/F4: correcting the payment carries the enrolment, half slots included';
END $$;

-- ------------------------------------------------------------
-- F5 / F6 — the two reversal shapes, side by side. This is the
--           reported defect, reproduced exactly.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_carrying UUID := (SELECT investment_id FROM investment_payments WHERE reference='FUND-REF-0001');
  v_plain    UUID := (SELECT id FROM investments WHERE investment_code='MGF901-0002');
  v_status   TEXT;
  v_units    NUMERIC;
  v_gap      NUMERIC;
  v_name     TEXT;
BEGIN
  -- F5: reversing a payment that carries slots takes the slots with
  -- it. Its enrolment goes to zero slots, so it is cancelled outright.
  PERFORM reverse_investor_payment(
    (SELECT id FROM investment_payments WHERE reference='FUND-REF-0001'),
    'Funds recalled by the bank');

  SELECT status::text, units INTO v_status, v_units
  FROM investments WHERE id = v_carrying;
  IF v_status <> 'cancelled' OR v_units <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL F5: reversal left the enrolment % with % slots', v_status, v_units;
  END IF;

  -- F6: reversing a payment booked with NO slots leaves the enrolment
  -- holding two slots against ₦0 confirmed. The money moved; the
  -- slots did not. Nothing refuses this — the payment never claimed
  -- to buy anything — so it must be REPORTED, by name.
  PERFORM reverse_investor_payment(
    (SELECT id FROM investment_payments WHERE reference='FUND-REF-0002'),
    'Excess payment returned');

  SELECT status::text, units INTO v_status, v_units
  FROM investments WHERE id = v_plain;
  IF v_status <> 'active' OR v_units <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL F6: expected an untouched active enrolment, got % with % slots',
      v_status, v_units;
  END IF;
  IF investment_confirmed_paid(v_plain) <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL F6: the reversed money is still counted as confirmed';
  END IF;

  SELECT gap, investor_name INTO v_gap, v_name
  FROM investment_funding_gaps('40000000-0000-0000-0000-0000000000f1')
  WHERE investment_id = v_plain;
  IF v_gap IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL F6: the unfunded enrolment was not reported at all';
  END IF;
  IF v_gap <> 1000000 THEN
    RAISE EXCEPTION 'TEST FAIL F6: expected a gap of 1000000, got %', v_gap;
  END IF;
  IF v_name <> 'Phantom Slot' THEN
    RAISE EXCEPTION 'TEST FAIL F6: the gap was not attributed to the investor, got %', v_name;
  END IF;

  -- And the cycle's ledger carries it through to the admin screen
  IF jsonb_array_length(
       mudarabah_get_ledger('40000000-0000-0000-0000-0000000000f1')->'fundingGaps'
     ) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL F6: the ledger did not surface the gap';
  END IF;

  RAISE NOTICE 'PASS F5/F6: slot-carrying reversals move the enrolment; plain ones are reported by name';
END $$;

-- ------------------------------------------------------------
-- F7 — the report is scoped: active enrolments, one cycle
-- ------------------------------------------------------------
DO $$
DECLARE
  v_cancelled UUID := (SELECT investment_id FROM investment_payments WHERE reference='FUND-REF-0001');
BEGIN
  -- The cancelled enrolment from F5 has ₦0 confirmed, but it holds
  -- nothing either. A settled or abandoned row is not a gap.
  IF EXISTS (
    SELECT 1 FROM investment_funding_gaps() WHERE investment_id = v_cancelled
  ) THEN
    RAISE EXCEPTION 'TEST FAIL F7: a cancelled enrolment was reported as a gap';
  END IF;

  -- A different cycle's report must not carry this cycle's problem
  IF EXISTS (
    SELECT 1 FROM investment_funding_gaps('40000000-0000-0000-0000-0000000000f2')
  ) THEN
    RAISE EXCEPTION 'TEST FAIL F7: the gap leaked into an unrelated cycle';
  END IF;

  -- and the portal-wide call still finds it
  IF NOT EXISTS (SELECT 1 FROM investment_funding_gaps()) THEN
    RAISE EXCEPTION 'TEST FAIL F7: the portal-wide report found nothing';
  END IF;

  RAISE NOTICE 'PASS F7: only active enrolments, only the cycle asked about';
END $$;

-- ------------------------------------------------------------
-- F8 — an investor session cannot move slots
-- ------------------------------------------------------------
DO $$
DECLARE
  v_inv UUID := (SELECT id FROM investments WHERE investment_code='MGF901-0002');
  v_ok  BOOLEAN := FALSE;
BEGIN
  PERFORM set_config('test.uid', '10000000-0000-0000-0000-0000000000f2', false);
  BEGIN
    PERFORM set_investment_slots(v_inv, 1, 'from an investor session');
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL F8: an investor moved their own slot count';
  END IF;

  -- and with no session at all
  v_ok := FALSE;
  PERFORM set_config('test.uid', '', false);
  BEGIN
    PERFORM set_investment_slots(v_inv, 1, 'unauthenticated');
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL F8: an unauthenticated request moved slots';
  END IF;

  RAISE NOTICE 'PASS F8: only a payments administrator moves slots';
END $$;

ROLLBACK;

-- ------------------------------------------------------------
-- F9 — the reported case end to end, with her real figures.
--
--   6 slots worth ₦3,000,000, ₦2,500,000 confirmed, and a
--   ₦500,000 payment reversed in the belief it was excess.
--   The slots were always right; only the money record was
--   short. Proves the money-only top-up closes the gap without
--   touching her slot count, and that a second one is refused.
-- ------------------------------------------------------------
BEGIN;
INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000f9','a9@t.com'),
  ('10000000-0000-0000-0000-0000000000f9','i9@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
  ('a0000000-0000-0000-0000-0000000000f9','a9@t.com','A9','super_admin'),
  ('10000000-0000-0000-0000-0000000000f9','i9@t.com','Reversed In Error','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
INSERT INTO investors (id,profile_id,investor_code,full_name,email) VALUES
  ('20000000-0000-0000-0000-0000000000f9','10000000-0000-0000-0000-0000000000f9','MGF0009','Reversed In Error','i9@t.com')
ON CONFLICT DO NOTHING;
INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
VALUES ('30000000-0000-0000-0000-0000000000f9','B','Series B',0,500000,0.50)
ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
VALUES ('40000000-0000-0000-0000-0000000000f9',(SELECT id FROM series WHERE name='B'),909,'Apr 2026 - July 2026','2026-04-30','2026-07-30','active',500000);
-- Her enrolment exactly as the portal shows it
INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status)
VALUES ('MG-B-001-MG-TBKJDN','20000000-0000-0000-0000-0000000000f9',(SELECT id FROM series WHERE name='B'),'40000000-0000-0000-0000-0000000000f9',6,500000,3000000,'2026-04-30','2026-07-30','active');
-- #1 confirmed 2,500,000 ; #2 500,000 booked with NO slots, then reversed
INSERT INTO investment_payments (investment_id,investor_id,series_id,cycle_id,amount,units,payment_date,status,reference)
VALUES
 ((SELECT id FROM investments WHERE investment_code='MG-B-001-MG-TBKJDN'),'20000000-0000-0000-0000-0000000000f9',(SELECT id FROM series WHERE name='B'),'40000000-0000-0000-0000-0000000000f9',2500000,5,'2026-04-30','confirmed','P1'),
 ((SELECT id FROM investments WHERE investment_code='MG-B-001-MG-TBKJDN'),'20000000-0000-0000-0000-0000000000f9',(SELECT id FROM series WHERE name='B'),'40000000-0000-0000-0000-0000000000f9',500000,0,'2026-04-30','confirmed','P2');
SELECT set_config('test.uid','a0000000-0000-0000-0000-0000000000f9',false);
DO $$ BEGIN
  PERFORM reverse_investor_payment((SELECT id FROM investment_payments WHERE reference='P2'),'Believed to be an excess payment');
END $$;

DO $$
DECLARE v_gap NUMERIC; v_units NUMERIC; v_recv NUMERIC;
BEGIN
  SELECT gap INTO v_gap FROM investment_funding_gaps('40000000-0000-0000-0000-0000000000f9');
  IF v_gap <> 500000 THEN RAISE EXCEPTION 'F9 setup: expected a 500000 gap, got %', v_gap; END IF;

  -- THE FIX: money only, no new slots
  PERFORM record_investor_payment(
    '20000000-0000-0000-0000-0000000000f9',
    (SELECT id FROM series WHERE name='B'),
    '40000000-0000-0000-0000-0000000000f9',
    500000, NULL, '2026-04-30', 'bank_transfer',
    'P2-RESTORED', 'Restores 500000 reversed in error', 'confirmed', TRUE);

  SELECT units INTO v_units FROM investments WHERE investment_code='MG-B-001-MG-TBKJDN';
  IF v_units <> 6 THEN RAISE EXCEPTION 'F9: the top-up moved her slots to %', v_units; END IF;

  IF investment_confirmed_paid((SELECT id FROM investments WHERE investment_code='MG-B-001-MG-TBKJDN')) <> 3000000
    THEN RAISE EXCEPTION 'F9: confirmed money did not reach 3000000'; END IF;

  IF EXISTS (SELECT 1 FROM investment_funding_gaps('40000000-0000-0000-0000-0000000000f9'))
    THEN RAISE EXCEPTION 'F9: the gap did not close'; END IF;

  SELECT amount_received INTO v_recv FROM cycles WHERE id='40000000-0000-0000-0000-0000000000f9';
  IF v_recv <> 3000000 THEN RAISE EXCEPTION 'F9: cycle amount_received is %, expected 3000000', v_recv; END IF;

  RAISE NOTICE 'PASS F9: a money-only top-up closes the gap, her slots untouched at 6';
END $$;

-- and a second top-up on a now-funded enrolment is refused
DO $$ DECLARE v_ok BOOLEAN := FALSE; BEGIN
  BEGIN
    PERFORM record_investor_payment('20000000-0000-0000-0000-0000000000f9',
      (SELECT id FROM series WHERE name='B'),'40000000-0000-0000-0000-0000000000f9',
      500000, NULL, '2026-04-30', NULL, 'P3', NULL, 'confirmed', TRUE);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'F9: a top-up past the outstanding balance was accepted'; END IF;
  RAISE NOTICE 'PASS F9b: topping up a fully funded enrolment is refused';
END $$;
ROLLBACK;
