-- ============================================================
-- Withholding tax issuance scenarios — step 6 part B
--
--   T10 notes cannot be issued for a cycle with no remittance
--   T11 issuing stamps the remittance reference and certifies
--   T12 one investor's note can be issued alone, and the batch
--       afterwards neither reissues nor renumbers it
--   T14 an investor with no tax number is skipped, and gets one
--       once they supply it
--   T15 reissuing keeps the original reference
--   T16 an investor sees their tax state before a note exists
--   T17 one filing covers several cycles
--
-- T13 (a mismatch warns but proceeds) is a decision taken in the
-- preview, not in the database, and is tested with the API.
--
-- Run against a DB with 001–023 applied.
-- ============================================================
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000b1', 'taxadmin@test.com'),
  ('10000000-0000-0000-0000-0000000000b1', 'hasTin@test.com'),
  ('10000000-0000-0000-0000-0000000000b2', 'noTin@test.com'),
  ('10000000-0000-0000-0000-0000000000b3', 'second@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000b1', 'taxadmin@test.com', 'Tax Admin', 'super_admin'),
  ('10000000-0000-0000-0000-0000000000b1', 'hasTin@test.com', 'Has Tin', 'investor'),
  ('10000000-0000-0000-0000-0000000000b2', 'noTin@test.com', 'No Tin', 'investor'),
  ('10000000-0000-0000-0000-0000000000b3', 'second@test.com', 'Second Cycle', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;

INSERT INTO investors (id, profile_id, investor_code, full_name, email, tin, address) VALUES
  ('20000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-0000000000b1', 'MGT0001', 'Has Tin', 'hasTin@test.com', 'TIN-AAA', '1 Road'),
  ('20000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-0000000000b2', 'MGT0002', 'No Tin', 'noTin@test.com', NULL, '2 Road'),
  ('20000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-0000000000b3', 'MGT0003', 'Second Cycle', 'second@test.com', 'TIN-CCC', '3 Road')
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id, name, description, start_month_offset, price_per_unit, mudarabah_investor_ratio, default_wht_rate)
VALUES ('30000000-0000-0000-0000-0000000000b1', 'B', 'Series B', 0, 100000, 0.70, 0.10)
ON CONFLICT (name) DO UPDATE SET default_wht_rate = EXCLUDED.default_wht_rate;

-- Two cycles, so one filing can be shown covering both
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status, unit_value, wht_rate)
VALUES
  ('40000000-0000-0000-0000-0000000000b1', (SELECT id FROM series WHERE name='B'),
   501, 'B-501', '2026-01-01', '2026-03-31', 'active', 100000, 0.10),
  ('40000000-0000-0000-0000-0000000000b2', (SELECT id FROM series WHERE name='B'),
   502, 'B-502', '2026-01-01', '2026-03-31', 'active', 100000, 0.10);

INSERT INTO investments (id, investment_code, investor_id, series_id, cycle_id, units, price_per_unit, capital, investment_date, maturity_date, status) VALUES
  ('50000000-0000-0000-0000-0000000000b1', 'MGB501-1', '20000000-0000-0000-0000-0000000000b1', (SELECT id FROM series WHERE name='B'), '40000000-0000-0000-0000-0000000000b1', 10, 100000, 1000000, '2026-01-01', '2026-03-31', 'active'),
  ('50000000-0000-0000-0000-0000000000b2', 'MGB501-2', '20000000-0000-0000-0000-0000000000b2', (SELECT id FROM series WHERE name='B'), '40000000-0000-0000-0000-0000000000b1', 10, 100000, 1000000, '2026-01-01', '2026-03-31', 'active'),
  ('50000000-0000-0000-0000-0000000000b3', 'MGB502-1', '20000000-0000-0000-0000-0000000000b3', (SELECT id FROM series WHERE name='B'), '40000000-0000-0000-0000-0000000000b2', 5, 100000, 500000, '2026-01-01', '2026-03-31', 'active');

SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000b1';

SELECT mudarabah_save_ledger(jsonb_build_object(
  'cycleId', c, 'description', 'home furniture', 'discloseMode', 'perSlot', 'status', 'active',
  'products', jsonb_build_array(jsonb_build_object('id','w','name','Widget')),
  'months', jsonb_build_array(
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB),
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB),
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB))))
FROM unnest(ARRAY['40000000-0000-0000-0000-0000000000b1',
                  '40000000-0000-0000-0000-0000000000b2']::UUID[]) AS c;

SELECT mudarabah_settle_cycle(
  '40000000-0000-0000-0000-0000000000b1', '1.0.0',
  '{"revenue":40000000,"profit":8000000,"holderPot":5600000,"managerPot":2400000}'::JSONB,
  jsonb_build_array(
    jsonb_build_object('investmentId','50000000-0000-0000-0000-0000000000b1',
      'investorId','20000000-0000-0000-0000-0000000000b1','units',10,'capital',100000000,
      'grossProfit',2800000,'wht',280000,'netProfit',2520000,
      'capitalAction','rollover','slotsWithdrawn',0,'capitalWithdrawn',0,'amountPaid',2520000),
    jsonb_build_object('investmentId','50000000-0000-0000-0000-0000000000b2',
      'investorId','20000000-0000-0000-0000-0000000000b2','units',10,'capital',100000000,
      'grossProfit',2800000,'wht',280000,'netProfit',2520000,
      'capitalAction','rollover','slotsWithdrawn',0,'capitalWithdrawn',0,'amountPaid',2520000)));

SELECT mudarabah_settle_cycle(
  '40000000-0000-0000-0000-0000000000b2', '1.0.0',
  '{"revenue":20000000,"profit":4000000,"holderPot":2800000,"managerPot":1200000}'::JSONB,
  jsonb_build_array(jsonb_build_object(
    'investmentId','50000000-0000-0000-0000-0000000000b3',
    'investorId','20000000-0000-0000-0000-0000000000b3','units',5,'capital',50000000,
    'grossProfit',2800000,'wht',280000,'netProfit',2520000,
    'capitalAction','rollover','slotsWithdrawn',0,'capitalWithdrawn',0,'amountPaid',2520000)));

-- ------------------------------------------------------------
-- T16 + T10: before any filing
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN := FALSE; v_state TEXT;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000b1';

  -- T16: settled and deducted, nothing filed
  SELECT wht_state INTO v_state FROM mudarabah_settlement_holders
  WHERE investment_id = '50000000-0000-0000-0000-0000000000b1';
  IF v_state <> 'withheld' THEN
    RAISE EXCEPTION 'TEST FAIL T16: expected withheld before any filing, got %', v_state;
  END IF;

  -- T10: issuing against a remittance that does not exist is refused
  BEGIN
    PERFORM mudarabah_issue_credit_notes('00000000-0000-0000-0000-000000000000'::UUID);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL T10: notes were issued with no remittance on record';
  END IF;

  IF EXISTS (SELECT 1 FROM wht_credit_notes) THEN
    RAISE EXCEPTION 'TEST FAIL T10: a credit note exists before any filing';
  END IF;

  RAISE NOTICE 'PASS T10/T16: nothing can be certified before the tax is filed';
END $$;

-- ------------------------------------------------------------
-- T16 (investor side): they can see their own state
-- ------------------------------------------------------------
DO $$
DECLARE v_n INTEGER;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL test.uid = '10000000-0000-0000-0000-0000000000b1';

  SELECT COUNT(*) INTO v_n FROM mudarabah_settlement_holders WHERE wht_state = 'withheld';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T16: an investor cannot see their own tax state (saw % rows)', v_n;
  END IF;
  -- and no note yet
  IF EXISTS (SELECT 1 FROM mudarabah_my_credit_note('40000000-0000-0000-0000-0000000000b1')) THEN
    RAISE EXCEPTION 'TEST FAIL T16: a credit note appeared before it was issued';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS T16: an investor sees their tax withheld before any note exists';
END $$;

-- ------------------------------------------------------------
-- T17 + T12: one filing over two cycles; then a single investor
-- ------------------------------------------------------------
DO $$
DECLARE
  v_rem UUID; v_res JSONB; v_ref TEXT; v_state TEXT;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000b1';

  PERFORM mudarabah_update_issuer_settings('MaalGrow Limited', '12 Ahmadu Bello Way', '0123456');

  -- T17: a single monthly filing covering BOTH cycles
  v_rem := mudarabah_create_remittance(
    'FIRS/KD/2026/0042', '2026-05-14', 840000,
    ARRAY['40000000-0000-0000-0000-0000000000b1',
          '40000000-0000-0000-0000-0000000000b2']::UUID[],
    'Federal Inland Revenue Service', 'May monthly filing');

  IF (SELECT COUNT(*) FROM wht_remittance_cycles WHERE remittance_id = v_rem) <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL T17: the filing did not cover both cycles';
  END IF;

  -- Recording it issues NOTHING, but does move the state on
  IF EXISTS (SELECT 1 FROM wht_credit_notes) THEN
    RAISE EXCEPTION 'TEST FAIL T17: recording a remittance issued a note by itself';
  END IF;
  SELECT wht_state INTO v_state FROM mudarabah_settlement_holders
  WHERE investment_id = '50000000-0000-0000-0000-0000000000b1';
  IF v_state <> 'remitted' THEN
    RAISE EXCEPTION 'TEST FAIL T17: expected remitted after filing, got %', v_state;
  END IF;

  -- The preview covers everyone the filing touches, across both cycles
  IF (SELECT COUNT(*) FROM mudarabah_issuance_preview(v_rem)) <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL T17: the preview does not cover all three holders';
  END IF;
  IF (SELECT COUNT(*) FROM mudarabah_issuance_preview(v_rem) WHERE NOT has_tin) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T17: the preview does not flag the investor with no tax number';
  END IF;

  -- T12: ONE investor, ahead of the rest
  v_res := mudarabah_issue_credit_notes(v_rem, NULL, '50000000-0000-0000-0000-0000000000b1');
  IF (v_res->>'issued')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T12: expected one note, got %', v_res->>'issued';
  END IF;

  SELECT reference INTO v_ref FROM wht_credit_notes
  WHERE investment_id = '50000000-0000-0000-0000-0000000000b1';

  -- T11: the remittance reference is stamped on, and the state moves
  IF (SELECT remittance_reference FROM wht_credit_notes
      WHERE investment_id = '50000000-0000-0000-0000-0000000000b1') <> 'FIRS/KD/2026/0042' THEN
    RAISE EXCEPTION 'TEST FAIL T11: the note does not carry the remittance reference';
  END IF;
  IF (SELECT filed_on FROM wht_credit_notes
      WHERE investment_id = '50000000-0000-0000-0000-0000000000b1') <> '2026-05-14' THEN
    RAISE EXCEPTION 'TEST FAIL T11: the note does not carry the date filed';
  END IF;
  SELECT wht_state INTO v_state FROM mudarabah_settlement_holders
  WHERE investment_id = '50000000-0000-0000-0000-0000000000b1';
  IF v_state <> 'certified' THEN
    RAISE EXCEPTION 'TEST FAIL T11: issuing did not certify the record, state is %', v_state;
  END IF;

  -- ...and the others are untouched by that single issuance
  IF (SELECT COUNT(*) FROM wht_credit_notes) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T12: issuing for one investor issued for others too';
  END IF;

  -- T12 + T14: now the batch. The single note is NOT renumbered, and
  -- the investor with no tax number is skipped rather than failed.
  v_res := mudarabah_issue_credit_notes(v_rem);
  IF (v_res->>'issued')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T12: the batch should have issued one more, issued %', v_res->>'issued';
  END IF;
  IF (v_res->>'already_issued')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T12: the batch did not recognise the note already issued';
  END IF;
  IF (v_res->>'skipped_no_tin')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T14: the investor with no tax number was not skipped';
  END IF;
  IF (SELECT reference FROM wht_credit_notes
      WHERE investment_id = '50000000-0000-0000-0000-0000000000b1') <> v_ref THEN
    RAISE EXCEPTION 'TEST FAIL T12: the batch renumbered a note already issued';
  END IF;

  RAISE NOTICE 'PASS T11/T12/T14/T17: one filing over two cycles; a single note first, then the rest, unrenumbered';
END $$;

-- ------------------------------------------------------------
-- T14 (continued): the tax number arrives late
-- ------------------------------------------------------------
DO $$
DECLARE v_rem UUID; v_res JSONB;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000b1';
  SELECT id INTO v_rem FROM wht_remittances WHERE reference = 'FIRS/KD/2026/0042';

  UPDATE investors SET tin = 'TIN-BBB' WHERE id = '20000000-0000-0000-0000-0000000000b2';

  v_res := mudarabah_issue_credit_notes(v_rem);
  IF (v_res->>'issued')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T14: the late tax number did not produce a note, issued %', v_res->>'issued';
  END IF;
  IF (SELECT investor_tin FROM wht_credit_notes
      WHERE investment_id = '50000000-0000-0000-0000-0000000000b2') <> 'TIN-BBB' THEN
    RAISE EXCEPTION 'TEST FAIL T14: the note does not carry the tax number';
  END IF;
  IF (SELECT COUNT(*) FROM wht_credit_notes) <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL T14: expected three notes in total';
  END IF;

  RAISE NOTICE 'PASS T14: running issuance again catches up whoever has since supplied a tax number';
END $$;

-- ------------------------------------------------------------
-- T15: reissuing keeps the reference and every figure
-- ------------------------------------------------------------
DO $$
DECLARE
  v_note UUID; v_ref TEXT; v_amt BIGINT; v_gross BIGINT; v_count INTEGER;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000b1';

  SELECT id, reference, wht_amount, gross_profit, reissue_count
  INTO v_note, v_ref, v_amt, v_gross, v_count
  FROM wht_credit_notes WHERE investment_id = '50000000-0000-0000-0000-0000000000b1';

  PERFORM mudarabah_record_remittance(v_note, 'FIRS/KD/2026/0042-AMENDED');

  IF (SELECT reference FROM wht_credit_notes WHERE id = v_note) <> v_ref THEN
    RAISE EXCEPTION 'TEST FAIL T15: reissuing changed the note reference';
  END IF;
  IF (SELECT wht_amount FROM wht_credit_notes WHERE id = v_note) <> v_amt
     OR (SELECT gross_profit FROM wht_credit_notes WHERE id = v_note) <> v_gross THEN
    RAISE EXCEPTION 'TEST FAIL T15: reissuing changed a figure';
  END IF;
  IF (SELECT remittance_reference FROM wht_credit_notes WHERE id = v_note)
     <> 'FIRS/KD/2026/0042-AMENDED' THEN
    RAISE EXCEPTION 'TEST FAIL T15: the corrected remittance reference was not applied';
  END IF;
  IF (SELECT reissue_count FROM wht_credit_notes WHERE id = v_note) <> v_count + 1 THEN
    RAISE EXCEPTION 'TEST FAIL T15: the reissue was not counted';
  END IF;

  RAISE NOTICE 'PASS T15: a reissue keeps the reference and the figures, and is counted';
END $$;

-- ------------------------------------------------------------
-- The administrator's overview, and what an investor sees at the end
-- ------------------------------------------------------------
DO $$
DECLARE v_row RECORD;
BEGIN
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000b1';

  SELECT * INTO v_row FROM mudarabah_wht_overview()
  WHERE cycle_id = '40000000-0000-0000-0000-0000000000b1';

  IF v_row.investors_taxed <> 2 OR v_row.total_withheld <> 560000 THEN
    RAISE EXCEPTION 'TEST FAIL: the overview totals are wrong — % taxed, % withheld',
      v_row.investors_taxed, v_row.total_withheld;
  END IF;
  IF v_row.notes_issued <> 2 OR v_row.notes_due <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL: the overview issued/due counts are wrong — % of %',
      v_row.notes_issued, v_row.notes_due;
  END IF;
  IF v_row.state <> 'certified' THEN
    RAISE EXCEPTION 'TEST FAIL: the overview state is %, expected certified', v_row.state;
  END IF;

  RAISE NOTICE 'PASS: the overview shows what is withheld, filed and certified';
END $$;

DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL test.uid = '10000000-0000-0000-0000-0000000000b1';

  IF NOT EXISTS (SELECT 1 FROM mudarabah_my_credit_note('40000000-0000-0000-0000-0000000000b1')) THEN
    RAISE EXCEPTION 'TEST FAIL: an investor cannot see their own issued credit note';
  END IF;
  -- and still only their own
  IF (SELECT COUNT(*) FROM wht_credit_notes) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL: an investor can see credit notes that are not theirs';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS: an investor reads their own credit note, and only their own';
END $$;

ROLLBACK;
