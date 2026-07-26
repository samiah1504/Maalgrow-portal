-- ============================================================
-- Settlement scenarios — migration 021
--
-- Kept separate from mudarabah_scenarios.sql so that file does not
-- have to change. Run against a DB with 001–021 applied.
--
-- Covers what step 6 part A adds:
--   T3  settling twice produces one of everything
--   T4  unsettle then re-settle: earlier snapshot retained, entries
--       reversed, and the DECLARATION reversed with them
--   T5  write-through — investments.declared_profit matches the
--       snapshot for every investor
--   T10 a cycle whose credit notes are issued cannot be reopened
--   T11 settlement leaves every taxed holder in state 'withheld'
--   T12 no instruction on record stays null, not 'rollover'
--   T13 cycle history reads the snapshot
-- ============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000e1', 'setadmin@test.com'),
  ('10000000-0000-0000-0000-0000000000e1', 'se1@test.com'),
  ('10000000-0000-0000-0000-0000000000e2', 'se2@test.com'),
  ('10000000-0000-0000-0000-0000000000e3', 'se3@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000e1', 'setadmin@test.com', 'Settle Admin', 'super_admin'),
  ('10000000-0000-0000-0000-0000000000e1', 'se1@test.com', 'Decided Exit', 'investor'),
  ('10000000-0000-0000-0000-0000000000e2', 'se2@test.com', 'Decided Stay', 'investor'),
  ('10000000-0000-0000-0000-0000000000e3', 'se3@test.com', 'Never Answered', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO investors (id, profile_id, investor_code, full_name, email, tin) VALUES
  ('20000000-0000-0000-0000-0000000000e1', '10000000-0000-0000-0000-0000000000e1', 'MGS0001', 'Decided Exit', 'se1@test.com', 'TIN-0001'),
  ('20000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-0000000000e2', 'MGS0002', 'Decided Stay', 'se2@test.com', 'TIN-0002'),
  ('20000000-0000-0000-0000-0000000000e3', '10000000-0000-0000-0000-0000000000e3', 'MGS0003', 'Never Answered', 'se3@test.com', NULL)
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id, name, description, start_month_offset, price_per_unit, mudarabah_investor_ratio)
VALUES ('30000000-0000-0000-0000-0000000000e1', 'C', 'Series C', 0, 100000, 0.70)
ON CONFLICT (name) DO UPDATE SET
  price_per_unit = EXCLUDED.price_per_unit,
  mudarabah_investor_ratio = EXCLUDED.mudarabah_investor_ratio;

-- The withholding rate is set ON THE CYCLE, because the snapshot's tax
-- and the declaration's tax are computed on two different sides — the
-- engine in TypeScript, and declare_cycle_profit in SQL — and they have
-- to agree exactly. Leaving the rate to default to zero here would let
-- the test pass a snapshot the declaration disagreed with.
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status, unit_value, wht_rate)
VALUES ('40000000-0000-0000-0000-0000000000e1',
  (SELECT id FROM series WHERE name = 'C'), 801, 'S-801', '2026-01-01', '2026-03-31', 'active', 100000, 0.10);

INSERT INTO investments (
  investment_code, investor_id, series_id, cycle_id, units, price_per_unit,
  capital, investment_date, maturity_date, status
) VALUES
  ('MGS801-0001', '20000000-0000-0000-0000-0000000000e1',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-0000000000e1',
   10, 100000, 1000000, '2026-01-01', '2026-03-31', 'active'),
  ('MGS801-0002', '20000000-0000-0000-0000-0000000000e2',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-0000000000e1',
   6, 100000, 600000, '2026-01-01', '2026-03-31', 'active'),
  ('MGS801-0003', '20000000-0000-0000-0000-0000000000e3',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-0000000000e1',
   4, 100000, 400000, '2026-01-01', '2026-03-31', 'active');

-- Two investors answered; the third never did.
INSERT INTO rollover_decisions (investment_id, investor_id, source_cycle_id, decision, slots_to_withdraw)
VALUES
  ((SELECT id FROM investments WHERE investment_code='MGS801-0001'),
   '20000000-0000-0000-0000-0000000000e1', '40000000-0000-0000-0000-0000000000e1', 'exit', NULL),
  ((SELECT id FROM investments WHERE investment_code='MGS801-0002'),
   '20000000-0000-0000-0000-0000000000e2', '40000000-0000-0000-0000-0000000000e1', 'continue', NULL);

SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000e1';

-- A ledger has to exist before the cycle can be settled
SELECT mudarabah_save_ledger(jsonb_build_object(
  'cycleId', '40000000-0000-0000-0000-0000000000e1',
  'description', 'home furniture',
  'discloseMode', 'perSlot',
  'status', 'active',
  'products', jsonb_build_array(jsonb_build_object('id', 'w', 'name', 'Widget')),
  'months', jsonb_build_array(
    jsonb_build_object('ads', 0, 'logistics', 0, 'misc', 0, 'bankCharges', 0, 'rows', '[]'::JSONB),
    jsonb_build_object('ads', 0, 'logistics', 0, 'misc', 0, 'bankCharges', 0, 'rows', '[]'::JSONB),
    jsonb_build_object('ads', 0, 'logistics', 0, 'misc', 0, 'bankCharges', 0, 'rows', '[]'::JSONB))
));

-- ------------------------------------------------------------
-- T12: no instruction on record stays NULL
-- ------------------------------------------------------------
DO $$
DECLARE v_holders JSONB;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000e1';
  v_holders := (mudarabah_get_ledger('40000000-0000-0000-0000-0000000000e1'))->'holders';

  IF (SELECT COUNT(*) FROM jsonb_array_elements(v_holders) h
      WHERE h->>'investorCode' = 'MGS0003'
        AND h->'capitalAction' = 'null'::JSONB) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T12: an investor who never answered was not left null';
  END IF;

  -- The two who DID answer keep exactly what they chose
  IF (SELECT h->>'capitalAction' FROM jsonb_array_elements(v_holders) h
      WHERE h->>'investorCode' = 'MGS0001') <> 'withdraw' THEN
    RAISE EXCEPTION 'TEST FAIL T12: an exit decision was not read as withdraw';
  END IF;
  IF (SELECT h->>'capitalAction' FROM jsonb_array_elements(v_holders) h
      WHERE h->>'investorCode' = 'MGS0002') <> 'rollover' THEN
    RAISE EXCEPTION 'TEST FAIL T12: a continue decision was not read as rollover';
  END IF;

  -- And the tax number travels, so the preview can warn about who lacks one
  IF (SELECT h->>'investorTin' FROM jsonb_array_elements(v_holders) h
      WHERE h->>'investorCode' = 'MGS0001') <> 'TIN-0001' THEN
    RAISE EXCEPTION 'TEST FAIL T12: the tax number was not carried through';
  END IF;
  IF (SELECT h->'investorTin' FROM jsonb_array_elements(v_holders) h
      WHERE h->>'investorCode' = 'MGS0003') <> 'null'::JSONB THEN
    RAISE EXCEPTION 'TEST FAIL T12: a missing tax number was not reported as missing';
  END IF;

  RAISE NOTICE 'PASS T12: no instruction stays null, and the tax number travels with the holder';
END $$;

-- ------------------------------------------------------------
-- T3 / T5 / T11: settle once, twice; write-through; tax state
-- ------------------------------------------------------------
DO $$
DECLARE
  v_s1 UUID; v_s2 UUID;
  v_computed JSONB; v_holders JSONB;
  v_gross BIGINT; v_pot BIGINT;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000e1';

  -- 20 slots, investor pot 14,000,000 kobo, 10% tax
  v_computed := jsonb_build_object(
    'revenue', 60000000, 'profit', 20000000,
    'holderPot', 14000000, 'managerPot', 6000000);

  v_holders := jsonb_build_array(
    jsonb_build_object(
      'investmentId', (SELECT id FROM investments WHERE investment_code='MGS801-0001'),
      'investorId', '20000000-0000-0000-0000-0000000000e1',
      'units', 10, 'capital', 100000000,
      'grossProfit', 7000000, 'wht', 700000, 'netProfit', 6300000,
      'capitalAction', 'withdraw', 'slotsWithdrawn', 10,
      'capitalWithdrawn', 100000000, 'amountPaid', 106300000),
    jsonb_build_object(
      'investmentId', (SELECT id FROM investments WHERE investment_code='MGS801-0002'),
      'investorId', '20000000-0000-0000-0000-0000000000e2',
      'units', 6, 'capital', 60000000,
      'grossProfit', 4200000, 'wht', 420000, 'netProfit', 3780000,
      'capitalAction', 'rollover', 'slotsWithdrawn', 0,
      'capitalWithdrawn', 0, 'amountPaid', 3780000),
    -- Never answered: capital paid out by default, and said so
    jsonb_build_object(
      'investmentId', (SELECT id FROM investments WHERE investment_code='MGS801-0003'),
      'investorId', '20000000-0000-0000-0000-0000000000e3',
      'units', 4, 'capital', 40000000,
      'grossProfit', 2800000, 'wht', 280000, 'netProfit', 2520000,
      'capitalAction', 'withdraw', 'slotsWithdrawn', 4,
      'capitalWithdrawn', 40000000, 'amountPaid', 42520000,
      'amountPaidNote', 'No maturity instruction on record — capital paid out by default')
  );

  v_s1 := mudarabah_settle_cycle('40000000-0000-0000-0000-0000000000e1', '1.0.0', v_computed, v_holders);
  v_s2 := mudarabah_settle_cycle('40000000-0000-0000-0000-0000000000e1', '1.0.0', v_computed, v_holders);

  -- T3: one of everything
  IF v_s1 <> v_s2 THEN
    RAISE EXCEPTION 'TEST FAIL T3: settling twice made a second snapshot';
  END IF;
  IF (SELECT COUNT(*) FROM mudarabah_settlements
      WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T3: more than one settlement';
  END IF;
  IF (SELECT COUNT(*) FROM cycle_profit_declarations
      WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T3: more than one declaration';
  END IF;
  -- 3 profit entries + 3 tax + 2 capital (the rollover holder takes none)
  IF (SELECT COUNT(*) FROM mudarabah_balance_entries
      WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1') <> 8 THEN
    RAISE EXCEPTION 'TEST FAIL T3: balance entries doubled — found %',
      (SELECT COUNT(*) FROM mudarabah_balance_entries
       WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1');
  END IF;

  -- T5: the write-through matches the snapshot for EVERY investor
  IF EXISTS (
    SELECT 1
    FROM mudarabah_settlement_holders h
    JOIN investments i ON i.id = h.investment_id
    WHERE h.settlement_id = v_s1
      AND ROUND(i.declared_profit * 100) <> h.gross_profit
  ) THEN
    RAISE EXCEPTION 'TEST FAIL T5: declared_profit does not match the snapshot';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM mudarabah_settlement_holders h
    JOIN investments i ON i.id = h.investment_id
    WHERE h.settlement_id = v_s1
      AND ROUND(i.declared_wht * 100) <> h.wht
  ) THEN
    RAISE EXCEPTION 'TEST FAIL T5: declared_wht does not match the snapshot';
  END IF;

  SELECT SUM(gross_profit) INTO v_gross
  FROM mudarabah_settlement_holders WHERE settlement_id = v_s1;
  v_pot := (v_computed->>'holderPot')::BIGINT;
  IF v_gross <> v_pot THEN
    RAISE EXCEPTION 'TEST FAIL T5: holders total % <> pot %', v_gross, v_pot;
  END IF;

  -- T11: every taxed holder is left withheld — not remitted, not certified
  IF EXISTS (
    SELECT 1 FROM mudarabah_settlement_holders
    WHERE settlement_id = v_s1 AND wht > 0 AND wht_state <> 'withheld'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL T11: settlement left a holder in the wrong tax state';
  END IF;

  -- T8: settlement issues no credit notes and allocates no references
  IF EXISTS (SELECT 1 FROM wht_credit_notes
             WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1') THEN
    RAISE EXCEPTION 'TEST FAIL T8: settling issued a credit note';
  END IF;

  RAISE NOTICE 'PASS T3/T5/T8/T11: one of everything, write-through exact, tax withheld, no notes issued';
END $$;

-- ------------------------------------------------------------
-- T4: unsettle reverses the money AND the declaration; re-settling
--     writes a new snapshot and keeps the old one
-- ------------------------------------------------------------
DO $$
DECLARE
  v_old UUID; v_new UUID;
  v_computed JSONB; v_holders JSONB;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000e1';

  SELECT id INTO v_old FROM mudarabah_settlements
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1' AND is_current;

  PERFORM mudarabah_unsettle_cycle('40000000-0000-0000-0000-0000000000e1', 'A month was entered twice');

  -- The snapshot is retained, marked superseded
  IF (SELECT is_current FROM mudarabah_settlements WHERE id = v_old) THEN
    RAISE EXCEPTION 'TEST FAIL T4: the old settlement is still current';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mudarabah_settlements WHERE id = v_old) THEN
    RAISE EXCEPTION 'TEST FAIL T4: the old settlement was deleted rather than retained';
  END IF;
  IF (SELECT COUNT(*) FROM mudarabah_settlement_holders WHERE settlement_id = v_old) <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL T4: the old snapshot lost its holders';
  END IF;

  -- The money nets to zero, by reversal rather than deletion
  IF (SELECT SUM(amount) FROM mudarabah_balance_entries
      WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1') <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL T4: balance entries do not net to zero after unsettle';
  END IF;

  -- THE NEW PART: the declaration is reversed too, leaving no orphans
  IF EXISTS (SELECT 1 FROM cycle_profit_declarations
             WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1') THEN
    RAISE EXCEPTION 'TEST FAIL T4: the profit declaration outlived the settlement';
  END IF;
  IF EXISTS (SELECT 1 FROM investments
             WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1'
               AND declared_profit IS NOT NULL) THEN
    RAISE EXCEPTION 'TEST FAIL T4: an investment kept a declared profit';
  END IF;
  IF EXISTS (SELECT 1 FROM investments
             WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1'
               AND status = 'matured') THEN
    RAISE EXCEPTION 'TEST FAIL T4: an investment was left matured';
  END IF;
  IF (SELECT status FROM cycles WHERE id = '40000000-0000-0000-0000-0000000000e1')
     <> 'awaiting_profit_declaration' THEN
    RAISE EXCEPTION 'TEST FAIL T4: the cycle was left completed';
  END IF;

  -- Re-settle: a NEW snapshot, the old one retained
  v_computed := jsonb_build_object(
    'revenue', 60000000, 'profit', 20000000,
    'holderPot', 14000000, 'managerPot', 6000000);
  v_holders := jsonb_build_array(
    jsonb_build_object(
      'investmentId', (SELECT id FROM investments WHERE investment_code='MGS801-0001'),
      'investorId', '20000000-0000-0000-0000-0000000000e1',
      'units', 10, 'capital', 100000000,
      'grossProfit', 7000000, 'wht', 700000, 'netProfit', 6300000,
      'capitalAction', 'withdraw', 'slotsWithdrawn', 10,
      'capitalWithdrawn', 100000000, 'amountPaid', 106300000),
    jsonb_build_object(
      'investmentId', (SELECT id FROM investments WHERE investment_code='MGS801-0002'),
      'investorId', '20000000-0000-0000-0000-0000000000e2',
      'units', 6, 'capital', 60000000,
      'grossProfit', 4200000, 'wht', 420000, 'netProfit', 3780000,
      'capitalAction', 'rollover', 'slotsWithdrawn', 0,
      'capitalWithdrawn', 0, 'amountPaid', 3780000),
    jsonb_build_object(
      'investmentId', (SELECT id FROM investments WHERE investment_code='MGS801-0003'),
      'investorId', '20000000-0000-0000-0000-0000000000e3',
      'units', 4, 'capital', 40000000,
      'grossProfit', 2800000, 'wht', 280000, 'netProfit', 2520000,
      'capitalAction', 'withdraw', 'slotsWithdrawn', 4,
      'capitalWithdrawn', 40000000, 'amountPaid', 42520000)
  );

  v_new := mudarabah_settle_cycle('40000000-0000-0000-0000-0000000000e1', '1.0.0', v_computed, v_holders);

  IF v_new = v_old THEN
    RAISE EXCEPTION 'TEST FAIL T4: re-settling reused the superseded snapshot';
  END IF;
  IF (SELECT COUNT(*) FROM mudarabah_settlements
      WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1') <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL T4: the earlier snapshot was not retained';
  END IF;
  IF (SELECT COUNT(*) FROM mudarabah_settlements
      WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1' AND is_current) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T4: more than one settlement is current';
  END IF;
  -- The declaration is back, once
  IF (SELECT COUNT(*) FROM cycle_profit_declarations
      WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T4: re-settling did not restore exactly one declaration';
  END IF;

  RAISE NOTICE 'PASS T4: unsettle reverses money and declaration alike; re-settling keeps the old snapshot';
END $$;

-- ------------------------------------------------------------
-- T13: an investor's cycle history reads the snapshot
-- ------------------------------------------------------------
DO $$
DECLARE v_row RECORD; v_count INTEGER;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000e1';

  SELECT COUNT(*) INTO v_count
  FROM mudarabah_investor_cycle_history('20000000-0000-0000-0000-0000000000e1');
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T13: expected one current cycle in the history, found %', v_count;
  END IF;

  SELECT * INTO v_row
  FROM mudarabah_investor_cycle_history('20000000-0000-0000-0000-0000000000e1');

  IF v_row.gross_profit <> 7000000 OR v_row.wht <> 700000 OR v_row.net_profit <> 6300000 THEN
    RAISE EXCEPTION 'TEST FAIL T13: the history does not match the snapshot';
  END IF;
  IF v_row.capital_action <> 'withdraw' OR v_row.slots_withdrawn <> 10 THEN
    RAISE EXCEPTION 'TEST FAIL T13: the capital action is wrong';
  END IF;
  IF v_row.net_return_pct <> ROUND((6300000::NUMERIC / 100000000) * 100, 2) THEN
    RAISE EXCEPTION 'TEST FAIL T13: the net return percentage is wrong — got %', v_row.net_return_pct;
  END IF;
  IF v_row.series_name <> 'C' OR v_row.cycle_label <> 'S-801' THEN
    RAISE EXCEPTION 'TEST FAIL T13: the cycle is not identified';
  END IF;
  IF v_row.wht_state <> 'withheld' THEN
    RAISE EXCEPTION 'TEST FAIL T13: the tax state is not shown';
  END IF;

  -- Nobody sees another investor's history
  IF EXISTS (
    SELECT 1 FROM mudarabah_investor_cycle_history('20000000-0000-0000-0000-0000000000e2')
    WHERE gross_profit = 7000000
  ) THEN
    RAISE EXCEPTION 'TEST FAIL T13: one investor''s figures appeared in another''s history';
  END IF;

  RAISE NOTICE 'PASS T13: cycle history reads the snapshot, per investor';
END $$;

-- ------------------------------------------------------------
-- T10: a cycle with credit notes issued cannot be reopened
-- ------------------------------------------------------------
DO $$
DECLARE v_settlement UUID; v_ok BOOLEAN := FALSE; v_result JSONB; v_rem UUID;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000e1';

  PERFORM mudarabah_update_issuer_settings('MaalGrow Limited', '12 Ahmadu Bello Way', '0123456');

  SELECT id INTO v_settlement FROM mudarabah_settlements
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000e1' AND is_current;

  -- Since 023 a note is issued against a recorded filing, never a
  -- reference typed into a box.
  v_rem := mudarabah_create_remittance(
    'FIRS/2026/0001', '2026-05-14', 1776112,
    ARRAY['40000000-0000-0000-0000-0000000000e1']::UUID[]);
  v_result := mudarabah_issue_credit_notes(v_rem);

  IF (v_result->>'issued')::INT <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL T10: expected 2 notes (the third has no tax number), got %',
      v_result->>'issued';
  END IF;
  IF (v_result->>'skipped_no_tin')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T10: the investor with no tax number was not skipped';
  END IF;

  BEGIN
    PERFORM mudarabah_unsettle_cycle('40000000-0000-0000-0000-0000000000e1', 'Changed my mind');
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL T10: a cycle with issued credit notes was reopened';
  END IF;

  -- And the settlement is untouched by the attempt
  IF NOT (SELECT is_current FROM mudarabah_settlements WHERE id = v_settlement) THEN
    RAISE EXCEPTION 'TEST FAIL T10: the refused unsettle still superseded the snapshot';
  END IF;

  RAISE NOTICE 'PASS T10: issued credit notes hold the cycle shut';
END $$;

ROLLBACK;
