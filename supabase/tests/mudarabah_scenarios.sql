-- ============================================================
-- Mudarabah trading ledger — scenario tests (migration 018)
-- Run against a DB with migrations 001–018 applied.
--
-- The ledger attaches to the EXISTING series/cycles/investments.
-- Ledger money is integer kobo; the portal's own columns stay naira.
-- ============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'mudadmin@test.com'),
  ('a0000000-0000-0000-0000-0000000000f2', 'mudops@test.com'),
  ('10000000-0000-0000-0000-0000000000f1', 'mi1@test.com'),
  ('10000000-0000-0000-0000-0000000000f2', 'mi2@test.com'),
  ('10000000-0000-0000-0000-0000000000f3', 'mi3@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'mudadmin@test.com', 'Mud Admin', 'super_admin'),
  ('a0000000-0000-0000-0000-0000000000f2', 'mudops@test.com', 'Mud Ops', 'operations'),
  ('10000000-0000-0000-0000-0000000000f1', 'mi1@test.com', 'Holder One', 'investor'),
  ('10000000-0000-0000-0000-0000000000f2', 'mi2@test.com', 'Holder Two', 'investor'),
  ('10000000-0000-0000-0000-0000000000f3', 'mi3@test.com', 'Other Cycle', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO investors (id, profile_id, investor_code, full_name, email) VALUES
  ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'MGM0001', 'Holder One', 'mi1@test.com'),
  ('20000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f2', 'MGM0002', 'Holder Two', 'mi2@test.com'),
  ('20000000-0000-0000-0000-0000000000f3', '10000000-0000-0000-0000-0000000000f3', 'MGM0003', 'Other Cycle', 'mi3@test.com')
ON CONFLICT (id) DO NOTHING;

-- 042: a withholding tax credit note cannot be issued without a
-- STRUCTURED residential address. That gate is what these suites now
-- run into, so the fixture gives the investors the address a real one
-- would have.
UPDATE investors SET
  residential_street_address = '12 Awolowo Road, Ikeja GRA, opposite the secretariat',
  residential_state_code     = 'LA',
  residential_state_name     = 'Lagos',
  residential_lga_code       = 'LA-IKEJA',
  residential_lga_name       = 'Ikeja',
  residential_city           = 'Ikeja'
WHERE investor_code IN ('MGM0001', 'MGM0002', 'MGM0003');


-- Existing series and two cycles within it
INSERT INTO series (id, name, description, start_month_offset, price_per_unit, mudarabah_investor_ratio)
VALUES ('30000000-0000-0000-0000-0000000000f1', 'A', 'Series A', 0, 100000, 0.70)
ON CONFLICT (name) DO UPDATE SET
  price_per_unit = EXCLUDED.price_per_unit,
  mudarabah_investor_ratio = EXCLUDED.mudarabah_investor_ratio;

INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status, unit_value)
VALUES
  ('40000000-0000-0000-0000-0000000000f1',
   (SELECT id FROM series WHERE name = 'A'), 901, 'A-901', '2026-01-01', '2026-03-31', 'subscription_open', 100000),
  ('40000000-0000-0000-0000-0000000000f2',
   (SELECT id FROM series WHERE name = 'A'), 902, 'A-902', '2026-04-01', '2026-06-30', 'subscription_open', 100000);

-- Membership lives in investments. Half slots are real.
INSERT INTO investments (
  investment_code, investor_id, series_id, cycle_id, units, price_per_unit,
  capital, investment_date, maturity_date, status
) VALUES
  ('MGA901-0001', '20000000-0000-0000-0000-0000000000f1',
   (SELECT id FROM series WHERE name='A'), '40000000-0000-0000-0000-0000000000f1',
   12.5, 100000, 1250000, '2026-01-01', '2026-03-31', 'active'),
  ('MGA901-0002', '20000000-0000-0000-0000-0000000000f2',
   (SELECT id FROM series WHERE name='A'), '40000000-0000-0000-0000-0000000000f1',
   7.5, 100000, 750000, '2026-01-01', '2026-03-31', 'active'),
  -- A member of a DIFFERENT cycle, who must never appear in cycle 901
  ('MGA902-0001', '20000000-0000-0000-0000-0000000000f3',
   (SELECT id FROM series WHERE name='A'), '40000000-0000-0000-0000-0000000000f2',
   5, 100000, 500000, '2026-04-01', '2026-06-30', 'active');

SET test.uid = 'a0000000-0000-0000-0000-0000000000f1';

-- ------------------------------------------------------------
-- Scenario 1: the ledger attaches to an existing cycle and
-- reads its terms and membership from the existing records
-- ------------------------------------------------------------
DO $$
DECLARE v_id UUID; v_out JSONB;
BEGIN
  v_id := mudarabah_save_ledger(jsonb_build_object(
    'cycleId', '40000000-0000-0000-0000-0000000000f1',
    'description', 'home furniture',
    'status', 'active',
    'products', jsonb_build_array(
      jsonb_build_object('id','sofa','name','3-seater sofa'),
      jsonb_build_object('id','table','name','Dining table')),
    'months', jsonb_build_array(
      jsonb_build_object('ads',6000000,'logistics',2500000,'misc',1000000,'bankCharges',500000,
        'rows', jsonb_build_array(
          jsonb_build_object('productId','sofa','qty',20,'unitCost',4700000,'soldQty',13,'sellPrice',7100000,'stockLeft',7),
          jsonb_build_object('productId','table','qty',50,'unitCost',910000,'soldQty',31,'sellPrice',1430000,'stockLeft',19))),
      jsonb_build_object('ads',5500000,'logistics',2200000,'misc',800000,'bankCharges',600000,'rows', jsonb_build_array()),
      jsonb_build_object('ads',5000000,'logistics',2000000,'misc',1200000,'bankCharges',700000,'rows', jsonb_build_array()))
  ));

  v_out := mudarabah_get_ledger('40000000-0000-0000-0000-0000000000f1');

  -- Terms come from the EXISTING records, not from the ledger
  IF (v_out->>'unitValue')::NUMERIC <> 100000 THEN
    RAISE EXCEPTION 'TEST FAIL S1: unit value not read from the cycle: %', v_out->>'unitValue';
  END IF;
  IF (v_out->>'ratio')::NUMERIC <> 0.70 THEN
    RAISE EXCEPTION 'TEST FAIL S1: ratio not read from the series: %', v_out->>'ratio';
  END IF;
  -- Membership and half slots come from investments
  IF (v_out->>'totalUnits')::NUMERIC <> 20 THEN
    RAISE EXCEPTION 'TEST FAIL S1: total units wrong: %', v_out->>'totalUnits';
  END IF;
  IF (v_out->>'investorCount')::INTEGER <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL S1: investor count wrong: %', v_out->>'investorCount';
  END IF;
  IF (v_out->>'pooledCapital')::NUMERIC <> 2000000 THEN
    RAISE EXCEPTION 'TEST FAIL S1: pooled capital wrong: %', v_out->>'pooledCapital';
  END IF;
  IF jsonb_array_length(v_out->'products') <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL S1: products did not round trip';
  END IF;

  -- No duplicate cycle entity: the ledger stores no slot value, slots,
  -- ratio, dates or name of its own
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'mudarabah_ledgers'
      AND column_name IN ('slot_price','slots','ratio','start_date','name','wht')
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S1: the ledger duplicates something the cycle already holds';
  END IF;

  -- And no parallel holdings table exists
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'mudarabah_holdings') THEN
    RAISE EXCEPTION 'TEST FAIL S1: mudarabah_holdings still exists';
  END IF;

  RAISE NOTICE 'PASS S1: the ledger attaches to the existing cycle and duplicates nothing';
END $$;

-- ------------------------------------------------------------
-- Scenario 2: terms lock once subscriptions close
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  PERFORM mudarabah_set_cycle_terms('40000000-0000-0000-0000-0000000000f1', 0.65, NULL, 0.10);
  IF (SELECT investor_ratio FROM cycles WHERE id = '40000000-0000-0000-0000-0000000000f1') <> 0.65 THEN
    RAISE EXCEPTION 'TEST FAIL S2: per-cycle ratio override not set';
  END IF;
  IF mudarabah_effective_ratio('40000000-0000-0000-0000-0000000000f1') <> 0.65 THEN
    RAISE EXCEPTION 'TEST FAIL S2: override does not win over the series value';
  END IF;
  -- The other cycle still falls back to the series
  IF mudarabah_effective_ratio('40000000-0000-0000-0000-0000000000f2') <> 0.70 THEN
    RAISE EXCEPTION 'TEST FAIL S2: fallback to the series ratio broken';
  END IF;

  -- Close subscriptions: terms are now fixed
  UPDATE cycles SET status = 'subscription_closed'
  WHERE id = '40000000-0000-0000-0000-0000000000f1';

  BEGIN
    PERFORM mudarabah_set_cycle_terms('40000000-0000-0000-0000-0000000000f1', 0.90, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL S2: terms were changed after subscriptions closed';
  END IF;

  RAISE NOTICE 'PASS S2: terms override the series, then lock when subscriptions close';
END $$;

-- ------------------------------------------------------------
-- Scenario 3: settlement writes through to the portal's own
-- declaration, and allocates exactly across half slots with tax
-- ------------------------------------------------------------
DO $$
DECLARE
  v_s1 UUID; v_s2 UUID;
  v_computed JSONB; v_holders JSONB;
  v_decl cycle_profit_declarations%ROWTYPE;
  v_gross BIGINT; v_net BIGINT; v_wht BIGINT;
  v_i1 investments%ROWTYPE; v_i2 investments%ROWTYPE;
BEGIN
  UPDATE cycles SET status = 'active' WHERE id = '40000000-0000-0000-0000-0000000000f1';

  -- Figures from the shared engine. Investor pot is deliberately not
  -- divisible by 20 units, so the allocation has a remainder to place.
  -- profit 1,000,000.01 naira → ratio 0.65 → pot 65,000,000.65 kobo
  v_computed := jsonb_build_object(
    'revenue', 500000001, 'profit', 100000001,
    'holderPot', 65000001, 'managerPot', 35000000
  );
  v_holders := jsonb_build_array(
    jsonb_build_object(
      'investmentId', (SELECT id FROM investments WHERE investment_code='MGA901-0001'),
      'investorId', '20000000-0000-0000-0000-0000000000f1',
      'units', 12.5, 'capital', 125000000,
      'grossProfit', 40625001, 'wht', 4062500, 'netProfit', 36562501,
      'capitalAction', 'rollover', 'slotsWithdrawn', 0,
      'capitalWithdrawn', 0, 'amountPaid', 36562501),
    jsonb_build_object(
      'investmentId', (SELECT id FROM investments WHERE investment_code='MGA901-0002'),
      'investorId', '20000000-0000-0000-0000-0000000000f2',
      'units', 7.5, 'capital', 75000000,
      'grossProfit', 24375000, 'wht', 2437500, 'netProfit', 21937500,
      'capitalAction', 'withdraw', 'slotsWithdrawn', 7.5,
      'capitalWithdrawn', 75000000, 'amountPaid', 96937500)
  );

  v_s1 := mudarabah_settle_cycle('40000000-0000-0000-0000-0000000000f1', '1.0.0', v_computed, v_holders);
  -- Settling again changes nothing at all
  v_s2 := mudarabah_settle_cycle('40000000-0000-0000-0000-0000000000f1', '1.0.0', v_computed, v_holders);

  IF v_s1 <> v_s2 THEN
    RAISE EXCEPTION 'TEST FAIL S3: second settle created a new settlement';
  END IF;
  IF (SELECT COUNT(*) FROM mudarabah_settlements
      WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S3: more than one settlement';
  END IF;

  -- The terms actually used are on the record
  IF (SELECT ratio_used FROM mudarabah_settlements WHERE id = v_s1) <> 0.65
     OR (SELECT wht_rate_used FROM mudarabah_settlements WHERE id = v_s1) <> 0.10 THEN
    RAISE EXCEPTION 'TEST FAIL S3: the terms used were not recorded';
  END IF;

  -- The write-through: the portal's own declaration now exists
  SELECT * INTO v_decl FROM cycle_profit_declarations
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'TEST FAIL S3: settling did not declare profit on the cycle';
  END IF;

  -- Allocation is exact in kobo across HALF slots
  SELECT COALESCE(SUM(ROUND(declared_profit * 100)), 0),
         COALESCE(SUM(ROUND(declared_wht * 100)), 0),
         COALESCE(SUM(ROUND(declared_profit_net * 100)), 0)
  INTO v_gross, v_wht, v_net
  FROM investments WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1';

  IF v_gross <> ROUND(v_decl.investor_profit_share * 100) THEN
    RAISE EXCEPTION 'TEST FAIL S3: holder gross % kobo <> investor pot % kobo',
      v_gross, ROUND(v_decl.investor_profit_share * 100);
  END IF;
  IF v_net + v_wht <> v_gross THEN
    RAISE EXCEPTION 'TEST FAIL S3: net + tax (% + %) <> gross %', v_net, v_wht, v_gross;
  END IF;
  IF ROUND(v_decl.total_wht * 100) <> v_wht THEN
    RAISE EXCEPTION 'TEST FAIL S3: declaration total_wht does not match the holders';
  END IF;

  -- Gross stays authoritative; net sits alongside it
  IF v_decl.profit_per_slot_net <> v_decl.profit_per_slot - v_decl.wht_per_slot THEN
    RAISE EXCEPTION 'TEST FAIL S3: net per slot is not gross minus tax';
  END IF;

  -- A half-slot holder gets a proportional share
  SELECT * INTO v_i1 FROM investments WHERE investment_code = 'MGA901-0001';
  SELECT * INTO v_i2 FROM investments WHERE investment_code = 'MGA901-0002';
  IF NOT (v_i1.declared_profit > v_i2.declared_profit) THEN
    RAISE EXCEPTION 'TEST FAIL S3: 12.5 slots did not earn more than 7.5';
  END IF;

  RAISE NOTICE 'PASS S3: settlement is idempotent, writes through, and allocates exactly across half slots';
END $$;

-- ------------------------------------------------------------
-- Scenario 4: profit is paid to EVERY holder, whatever they do
-- with their capital
-- ------------------------------------------------------------
DO $$
DECLARE v_profit_entries INTEGER; v_capital_entries INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_profit_entries
  FROM mudarabah_balance_entries
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1' AND entry_type = 'profit';

  SELECT COUNT(*) INTO v_capital_entries
  FROM mudarabah_balance_entries
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1' AND entry_type = 'capital';

  -- Both holders get profit; only the one withdrawing gets capital
  IF v_profit_entries <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL S4: expected profit paid to both holders, got % entries', v_profit_entries;
  END IF;
  IF v_capital_entries <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S4: capital should move only for the withdrawing holder, got %', v_capital_entries;
  END IF;

  -- The rolling-over holder is still paid their profit
  IF NOT EXISTS (
    SELECT 1 FROM mudarabah_settlement_holders
    WHERE investor_id = '20000000-0000-0000-0000-0000000000f1'
      AND capital_action = 'rollover' AND net_profit > 0 AND amount_paid = net_profit
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S4: a holder rolling capital over was not paid their profit';
  END IF;

  RAISE NOTICE 'PASS S4: profit is paid to every holder; only capital depends on their decision';
END $$;

-- ------------------------------------------------------------
-- Scenario 5: nothing from another cycle can ever be included
--
-- Sending one investor another cycle's figures is the worst failure
-- this feature can have, so it is asserted from both directions.
-- ------------------------------------------------------------
DO $$
DECLARE v_other UUID := '20000000-0000-0000-0000-0000000000f3';
BEGIN
  IF EXISTS (
    SELECT 1 FROM mudarabah_settlement_holders h
    JOIN mudarabah_settlements s ON s.id = h.settlement_id
    WHERE s.cycle_id = '40000000-0000-0000-0000-0000000000f1'
      AND h.investor_id = v_other
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S5: a member of another cycle is in this settlement';
  END IF;

  IF EXISTS (
    SELECT 1 FROM mudarabah_balance_entries
    WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1' AND investor_id = v_other
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S5: another cycle''s member has a balance entry here';
  END IF;

  -- The other cycle's investor was not touched by this declaration
  IF (SELECT declared_profit FROM investments WHERE investment_code = 'MGA902-0001') IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL S5: declaring cycle 901 stamped profit on a cycle 902 investment';
  END IF;

  -- The ledger read for 901 lists only its own members
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(
      mudarabah_get_ledger('40000000-0000-0000-0000-0000000000f1')->'holders') x
    WHERE (x->>'investorId')::UUID = v_other
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S5: the ledger listed a member of another cycle';
  END IF;

  RAISE NOTICE 'PASS S5: nothing addressed to a member of another cycle';
END $$;

-- ------------------------------------------------------------
-- Scenario 6: unsettle retains the snapshot and leaves a trail
-- ------------------------------------------------------------
DO $$
DECLARE v_old UUID; v_reversals INTEGER;
BEGIN
  SELECT id INTO v_old FROM mudarabah_settlements
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1' AND is_current;

  PERFORM mudarabah_unsettle_cycle('40000000-0000-0000-0000-0000000000f1', 'Month 3 stock count was wrong');

  IF NOT EXISTS (
    SELECT 1 FROM mudarabah_settlements
    WHERE id = v_old AND is_current = FALSE
      AND supersede_reason = 'Month 3 stock count was wrong'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S6: the earlier snapshot was not retained';
  END IF;

  IF (SELECT status FROM mudarabah_ledgers
      WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1') <> 'active' THEN
    RAISE EXCEPTION 'TEST FAIL S6: the ledger did not reopen';
  END IF;

  SELECT COUNT(*) INTO v_reversals FROM mudarabah_balance_entries
  WHERE settlement_id = v_old AND entry_type = 'reversal';
  -- 2 profit + 2 withholding tax + 1 capital withdrawal
  IF v_reversals <> 5 THEN
    RAISE EXCEPTION 'TEST FAIL S6: expected reversals for every entry, got %', v_reversals;
  END IF;

  IF (SELECT SUM(amount) FROM mudarabah_balance_entries WHERE settlement_id = v_old) <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL S6: reversals do not cancel the originals';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM mudarabah_cycle_events
    WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1' AND action = 'unsettled'
      AND reason = 'Month 3 stock count was wrong'
      AND actor_id = 'a0000000-0000-0000-0000-0000000000f1'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S6: unsettle not logged with who and why';
  END IF;

  RAISE NOTICE 'PASS S6: unsettle retains the snapshot, reverses by new entries, and logs who and why';
END $$;

-- ------------------------------------------------------------
-- Scenario 7: permissions and confidentiality
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000f2';
  BEGIN
    PERFORM mudarabah_set_cycle_terms('40000000-0000-0000-0000-0000000000f2', 0.9, NULL, NULL);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL S7: non-administrator changed a cycle''s terms';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename IN ('mudarabah_products', 'mudarabah_month_rows',
                        'mudarabah_months', 'mudarabah_settlement_products')
      AND qual ILIKE '%get_my_investor_id%'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S7: an investor policy exists on a per-product table';
  END IF;

  RAISE NOTICE 'PASS S7: only administrators set terms; per-product data stays admin-only';
END $$;

-- ------------------------------------------------------------
-- Scenario 8: credit notes — only after the tax is filed, and
-- only for investors who have a tax identification number
-- ------------------------------------------------------------
DO $$
DECLARE
  v_settle UUID; v_res JSONB; v_again JSONB; v_rem UUID;
  v_ref TEXT; v_amount BIGINT; v_ref2 TEXT; v_amount2 BIGINT;
  v_total BIGINT; v_declared BIGINT; v_ok BOOLEAN := FALSE;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000f1';

  -- Scenario 6 reopened this cycle, so it has no CURRENT settlement.
  -- Since migration 023 a filing can only cover a settled cycle — you
  -- cannot remit tax on figures that have been withdrawn — so settle
  -- it again before anything can be certified.
  PERFORM mudarabah_settle_cycle(
    '40000000-0000-0000-0000-0000000000f1', '1.0.0',
    jsonb_build_object('revenue', 500000001, 'profit', 100000001,
                       'holderPot', 65000001, 'managerPot', 35000000),
    jsonb_build_array(
      jsonb_build_object(
        'investmentId', (SELECT id FROM investments WHERE investment_code='MGA901-0001'),
        'investorId', '20000000-0000-0000-0000-0000000000f1',
        'units', 12.5, 'capital', 125000000,
        'grossProfit', 40625001, 'wht', 4062500, 'netProfit', 36562501,
        'capitalAction', 'rollover', 'slotsWithdrawn', 0,
        'capitalWithdrawn', 0, 'amountPaid', 36562501),
      jsonb_build_object(
        'investmentId', (SELECT id FROM investments WHERE investment_code='MGA901-0002'),
        'investorId', '20000000-0000-0000-0000-0000000000f2',
        'units', 7.5, 'capital', 75000000,
        'grossProfit', 24375000, 'wht', 2437500, 'netProfit', 21937500,
        'capitalAction', 'withdraw', 'slotsWithdrawn', 7.5,
        'capitalWithdrawn', 75000000, 'amountPaid', 96937500)));

  SELECT id INTO v_settle FROM mudarabah_settlements
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1' AND is_current;

  -- Issuing with no filing on record is refused: a note must never
  -- claim a remittance that has not happened. Since migration 023 the
  -- filing is a RECORD, not a string, so there is nothing to type in.
  BEGIN
    PERFORM mudarabah_issue_credit_notes('00000000-0000-0000-0000-000000000000'::UUID);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL S8: a credit note was issued before the tax was filed';
  END IF;

  v_rem := mudarabah_create_remittance(
    'FIRS/2026/00123', '2026-04-30', 100000,
    ARRAY['40000000-0000-0000-0000-0000000000f1']::UUID[]);

  -- Neither investor has a tax number yet, so nobody gets a note
  v_res := mudarabah_issue_credit_notes(v_rem);
  IF (v_res->>'issued')::INT <> 0 OR (v_res->>'skipped_no_tin')::INT <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL S8: expected nobody issued and 2 skipped, got %', v_res;
  END IF;
  IF EXISTS (SELECT 1 FROM wht_credit_notes) THEN
    RAISE EXCEPTION 'TEST FAIL S8: a note was issued for an investor with no tax number';
  END IF;

  -- One investor fills in their tax number
  UPDATE investors SET tin = '12345678-0001'
  WHERE id = '20000000-0000-0000-0000-0000000000f1';

  v_res := mudarabah_issue_credit_notes(v_rem);
  IF (v_res->>'issued')::INT <> 1 OR (v_res->>'skipped_no_tin')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S8: expected 1 issued and 1 still waiting, got %', v_res;
  END IF;

  SELECT reference, wht_amount INTO v_ref, v_amount
  FROM wht_credit_notes WHERE investor_id = '20000000-0000-0000-0000-0000000000f1';

  -- The filing details are on the note
  IF NOT EXISTS (
    SELECT 1 FROM wht_credit_notes
    WHERE investor_id = '20000000-0000-0000-0000-0000000000f1'
      AND remittance_reference = 'FIRS/2026/00123'
      AND filed_on = '2026-04-30'
      AND investor_tin = '12345678-0001'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S8: the filing details were not recorded on the note';
  END IF;

  -- Running it again issues nothing new and changes nothing
  v_again := mudarabah_issue_credit_notes(v_rem);
  IF (v_again->>'issued')::INT <> 0 OR (v_again->>'already_issued')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S8: reissuing created a duplicate, got %', v_again;
  END IF;

  SELECT reference, wht_amount INTO v_ref2, v_amount2
  FROM wht_credit_notes WHERE investor_id = '20000000-0000-0000-0000-0000000000f1';
  IF v_ref2 <> v_ref OR v_amount2 <> v_amount THEN
    RAISE EXCEPTION 'TEST FAIL S8: a reissued note changed';
  END IF;

  -- The readiness screen shows who is still waiting
  IF (SELECT COUNT(*) FROM mudarabah_credit_note_readiness('40000000-0000-0000-0000-0000000000f1')
      WHERE NOT has_tin) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S8: readiness does not show who is missing a tax number';
  END IF;

  -- Once the second investor fills theirs in, they are caught up
  UPDATE investors SET tin = '12345678-0002'
  WHERE id = '20000000-0000-0000-0000-0000000000f2';
  v_res := mudarabah_issue_credit_notes(v_rem);
  IF (v_res->>'issued')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S8: the investor who caught up was not issued a note';
  END IF;

  -- And the notes now reconcile with the declaration exactly
  SELECT COALESCE(SUM(wht_amount), 0) INTO v_total FROM wht_credit_notes
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1';
  SELECT ROUND(total_wht * 100) INTO v_declared FROM cycle_profit_declarations
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000f1';
  IF v_total <> v_declared THEN
    RAISE EXCEPTION 'TEST FAIL S8: notes total % kobo, declaration says %', v_total, v_declared;
  END IF;

  RAISE NOTICE 'PASS S8: notes issue only after filing, only with a tax number, and reconcile exactly';
END $$;

-- ------------------------------------------------------------
-- Scenario 9: issuer details are editable from the app
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN := FALSE;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000f1';
  PERFORM mudarabah_update_issuer_settings(
    'MaalVest Limited', '12 Marina, Lagos', 'TIN-99887766',
    'Samiah Yusuf', 'Managing Director', NULL);

  IF NOT EXISTS (
    SELECT 1 FROM wht_issuer_settings
    WHERE id = 1 AND company_name = 'MaalVest Limited'
      AND company_tin = 'TIN-99887766' AND signatory_title = 'Managing Director'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S9: issuer settings were not saved';
  END IF;

  -- A blank company name is refused: it appears on every note
  BEGIN
    PERFORM mudarabah_update_issuer_settings('   ');
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL S9: a blank company name was accepted';
  END IF;

  -- Only an administrator may change them
  v_ok := FALSE;
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000f2';
  BEGIN
    PERFORM mudarabah_update_issuer_settings('Someone Else Ltd');
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL S9: a non-administrator changed the issuer details';
  END IF;

  RAISE NOTICE 'PASS S9: issuer details are editable by an administrator only';
END $$;

ROLLBACK;
