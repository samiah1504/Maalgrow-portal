-- ============================================================
-- The carry-forward the batch rollover never recorded — 046
--
-- THE REPORTED FIGURE. Series C, May–Aug 2026: ₦16,500,000 of slots
-- with no confirmed payment behind them — thirty-three slots, half
-- the cycle. The money was real. It arrived in the previous cycle and
-- was never withdrawn; the ledger simply had no row saying so.
--
-- Two paths continue an investor's capital and only one recorded it:
-- mudarabah_enrol_next_cycle (per investor, on submission) wrote a
-- confirmed 'rollover' payment; process_cycle_rollover (the batch)
-- created the investment and no payment at all.
--
--   C1  the batch rollover now records the carry-forward
--   C2  so the new enrolment is fully funded, not a gap
--   C3  the amount matches the capital that moved
--   C4  it is marked 'rollover' and points at the cycle it came from
--   C5  the backfill fixes an enrolment that predates the fix
--   C6  and fixes only the SHORTFALL, never the whole capital again
--   C7  it does not invent money for somebody who simply has not paid
--   C8  running it twice changes nothing
-- ============================================================
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000cf01', 'cfadmin@test.com'),
  ('10000000-0000-0000-0000-00000000cf01', 'roller@test.com'),
  ('10000000-0000-0000-0000-00000000cf02', 'fresh@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-00000000cf01', 'cfadmin@test.com', 'CF Admin', 'super_admin'),
  ('10000000-0000-0000-0000-00000000cf01', 'roller@test.com', 'Rolls Over', 'investor'),
  ('10000000-0000-0000-0000-00000000cf02', 'fresh@test.com', 'Never Paid', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO investors (id, profile_id, investor_code, full_name, email,
                       bank_name, account_name, account_number) VALUES
  ('20000000-0000-0000-0000-00000000cf01', '10000000-0000-0000-0000-00000000cf01',
   'MGF0001', 'Rolls Over', 'roller@test.com', 'GTB', 'Rolls Over', '0000000501'),
  ('20000000-0000-0000-0000-00000000cf02', '10000000-0000-0000-0000-00000000cf02',
   'MGF0002', 'Never Paid', 'fresh@test.com', 'GTB', 'Never Paid', '0000000502')
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id, name, description, start_month_offset, price_per_unit,
                    mudarabah_investor_ratio, default_wht_rate)
VALUES ('30000000-0000-0000-0000-00000000cf01', 'C', 'Series C', 0, 500000, 0.50, 0.10)
ON CONFLICT (name) DO UPDATE SET price_per_unit = EXCLUDED.price_per_unit;

-- The cycle they came from, and the one they are going to.
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date,
                    status, unit_value) VALUES
  ('40000000-0000-0000-0000-00000000cf01', (SELECT id FROM series WHERE name='C'),
   9801, 'C-9801 (Feb–May)', CURRENT_DATE - 180, CURRENT_DATE - 90, 'completed', 500000),
  ('40000000-0000-0000-0000-00000000cf02', (SELECT id FROM series WHERE name='C'),
   9802, 'C-9802 (May–Aug)', CURRENT_DATE - 89, CURRENT_DATE + 2, 'active', 500000);

-- Rolls Over held 4 slots and was paid for them, properly, in the
-- cycle that has now finished.
INSERT INTO investments (id, investment_code, investor_id, series_id, cycle_id, units,
                         price_per_unit, capital, investment_date, maturity_date,
                         status, declared_profit, declared_wht, declared_profit_net) VALUES
  ('50000000-0000-0000-0000-00000000cf01', 'MGC9801-1', '20000000-0000-0000-0000-00000000cf01',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-00000000cf01',
   4, 500000, 2000000, CURRENT_DATE-180, CURRENT_DATE-90, 'matured', 200000, 20000, 180000);

INSERT INTO investment_payments (investment_id, investor_id, series_id, cycle_id,
                                 amount, units, payment_date, status, method)
VALUES ('50000000-0000-0000-0000-00000000cf01', '20000000-0000-0000-0000-00000000cf01',
        (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-00000000cf01',
        2000000, 4, CURRENT_DATE-180, 'confirmed', 'transfer');

-- The batch rollover refuses to run before the profit is declared,
-- which is right — so the fixture declares it, as the real cycle had.
INSERT INTO cycle_profit_declarations
  (cycle_id, total_revenue, total_expenses, net_profit,
   investor_profit_share, company_profit_share, profit_per_slot, total_slots)
VALUES ('40000000-0000-0000-0000-00000000cf01',
        1000000, 600000, 400000, 200000, 200000, 50000, 4);

SET LOCAL test.uid = 'a0000000-0000-0000-0000-00000000cf01';

-- ------------------------------------------------------------
-- C1–C4 — the batch rollover, as an administrator runs it
-- ------------------------------------------------------------
DO $$
DECLARE
  v_new  investments%ROWTYPE;
  v_pay  investment_payments%ROWTYPE;
  v_gap  NUMERIC;
BEGIN
  INSERT INTO rollover_decisions
    (investment_id, investor_id, source_cycle_id, decision, submitted_at,
     deadline, decided_by, via, locked,
     bank_name, account_name, account_number)
  VALUES ('50000000-0000-0000-0000-00000000cf01', '20000000-0000-0000-0000-00000000cf01',
          '40000000-0000-0000-0000-00000000cf01', 'continue', NOW(),
          CURRENT_DATE, '10000000-0000-0000-0000-00000000cf01', 'investor', TRUE,
          'GTB', 'Rolls Over', '0000000501');

  PERFORM process_cycle_rollover('40000000-0000-0000-0000-00000000cf01', NULL, FALSE);

  SELECT * INTO v_new FROM investments
   WHERE parent_investment_id = '50000000-0000-0000-0000-00000000cf01';
  IF v_new.id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL C1: the batch rollover created no enrolment';
  END IF;

  -- C1. The row that was never written.
  SELECT * INTO v_pay FROM investment_payments WHERE investment_id = v_new.id;
  IF v_pay.id IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL C1: the carry-forward was not recorded — this is the reported bug';
  END IF;

  -- C2. Which is the whole point: no gap.
  v_gap := v_new.capital - investment_confirmed_paid(v_new.id);
  IF v_gap <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL C2: % of the new enrolment reads as unfunded', v_gap;
  END IF;
  IF EXISTS (SELECT 1 FROM investment_funding_gaps('40000000-0000-0000-0000-00000000cf02')) THEN
    RAISE EXCEPTION 'TEST FAIL C2: the new cycle still shows on the funding-gap report';
  END IF;

  -- C3. The amount that actually moved, not the slot price.
  IF v_pay.amount <> v_new.capital THEN
    RAISE EXCEPTION 'TEST FAIL C3: carried % against capital of %',
      v_pay.amount, v_new.capital;
  END IF;

  -- C4. Recognisable as a carry-forward months later.
  IF v_pay.method <> 'rollover' OR v_pay.status::TEXT <> 'confirmed' THEN
    RAISE EXCEPTION 'TEST FAIL C4: recorded as % / %', v_pay.method, v_pay.status;
  END IF;
  IF v_pay.reference NOT LIKE 'ROLL-%' THEN
    RAISE EXCEPTION 'TEST FAIL C4: the reference does not name the source — %', v_pay.reference;
  END IF;

  RAISE NOTICE 'PASS C1–C4: the batch records the carry-forward, and the cycle is funded';
END $$;

-- ------------------------------------------------------------
-- C5–C8 — the backfill, on an enrolment that predates the fix
--
--     Simulated exactly as the live data looks: delete the payment
--     row and the enrolment is what process_cycle_rollover used to
--     leave behind.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_new_id UUID;
  v_gap    NUMERIC;
  v_n      INTEGER;
  v_pay    NUMERIC;
BEGIN
  SELECT id INTO v_new_id FROM investments
   WHERE parent_investment_id = '50000000-0000-0000-0000-00000000cf01';

  DELETE FROM investment_payments WHERE investment_id = v_new_id;

  v_gap := (SELECT capital FROM investments WHERE id = v_new_id)
           - investment_confirmed_paid(v_new_id);
  IF v_gap <= 0 THEN
    RAISE EXCEPTION 'TEST FAIL C5: the fixture no longer reproduces the reported state';
  END IF;

  SELECT COUNT(*) INTO v_n FROM backfill_rollover_carry_forward(NULL, TRUE);
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL C5: the backfill found % enrolments, expected 1', v_n;
  END IF;

  v_gap := (SELECT capital FROM investments WHERE id = v_new_id)
           - investment_confirmed_paid(v_new_id);
  IF v_gap <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL C5: still % short after the backfill', v_gap;
  END IF;

  -- C6. A partial payment already recorded must not be counted
  -- twice. Half of it back, then backfill: only the half is added.
  DELETE FROM investment_payments WHERE investment_id = v_new_id;
  INSERT INTO investment_payments (investment_id, investor_id, series_id, cycle_id,
                                   amount, units, payment_date, status, method)
  SELECT id, investor_id, series_id, cycle_id, capital / 2, units,
         CURRENT_DATE, 'confirmed', 'transfer'
    FROM investments WHERE id = v_new_id;

  PERFORM backfill_rollover_carry_forward(NULL, TRUE);

  SELECT investment_confirmed_paid(v_new_id) INTO v_pay;
  IF v_pay <> (SELECT capital FROM investments WHERE id = v_new_id) THEN
    RAISE EXCEPTION 'TEST FAIL C6: paid % against capital of %',
      v_pay, (SELECT capital FROM investments WHERE id = v_new_id);
  END IF;

  -- C8. And again changes nothing.
  SELECT COUNT(*) INTO v_n FROM backfill_rollover_carry_forward(NULL, TRUE);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL C8: a second run found % more to do', v_n;
  END IF;

  RAISE NOTICE 'PASS C5/C6/C8: backfilled once, only the shortfall, and never twice';
END $$;

-- ------------------------------------------------------------
-- C7 — and it does NOT invent money
--
--     Never Paid holds slots in the new cycle with no payment and no
--     parent investment. That is a genuine unpaid slot and it must
--     stay on the funding-gap report, which is exactly where the
--     warning on the series page comes from.
-- ------------------------------------------------------------
DO $$ DECLARE v_n INTEGER; BEGIN
  INSERT INTO investments (id, investment_code, investor_id, series_id, cycle_id, units,
                           price_per_unit, capital, investment_date, maturity_date, status)
  VALUES ('50000000-0000-0000-0000-00000000cf02', 'MGC9802-2',
          '20000000-0000-0000-0000-00000000cf02',
          (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-00000000cf02',
          2, 500000, 1000000, CURRENT_DATE-89, CURRENT_DATE+2, 'active');

  SELECT COUNT(*) INTO v_n FROM backfill_rollover_carry_forward(NULL, TRUE);
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL C7: the backfill invented money for somebody who never paid';
  END IF;

  -- And they are still reported, because they genuinely owe.
  SELECT COUNT(*) INTO v_n FROM investment_funding_gaps('40000000-0000-0000-0000-00000000cf02')
   WHERE investor_code = 'MGF0002';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL C7: a genuinely unpaid slot stopped being reported';
  END IF;

  RAISE NOTICE 'PASS C7: a real unpaid slot is untouched, and still reported';
END $$;

ROLLBACK;
\echo '=== ALL CARRY-FORWARD TESTS PASSED ==='
