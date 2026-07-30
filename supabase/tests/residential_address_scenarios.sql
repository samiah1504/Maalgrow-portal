-- ============================================================
-- Structured residential address — migration 042
--
-- The address stopped being one box because it is printed on a
-- withholding tax credit note, and "Lagos" identifies nobody. What
-- these check is not that the columns exist but that the two
-- promises hold:
--
--   NOTHING WAS LOST. Every address already on the books is still
--   readable after the migration, in two places.
--
--   AN INCOMPLETE ADDRESS CANNOT REACH A TAX DOCUMENT. And it stops
--   only that investor's note, never the batch.
--
--   R1  the old address is preserved, and the old column untouched
--   R2  a legacy investor is incomplete, and says which parts
--   R3  supplying all four parts clears it
--   R4  "Lagos" on its own is refused
--   R5  an LGA from the wrong state is refused
--   R6  KYC now asks for the parts, not for "Address"
--   R7  a credit note is SKIPPED for an incomplete address — and the
--       rest of the batch still issues
--   R8  the issued note freezes the parts
--   R9  changing an address clears "verified" and stamps the time
--   R10 marking it verified does not immediately unmark itself
--   R11 preserving is not repeated on a second run
--
-- Run against a DB with 001–042 applied.
-- ============================================================
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000c1', 'addradmin@test.com'),
  ('10000000-0000-0000-0000-0000000000c1', 'legacy@test.com'),
  ('10000000-0000-0000-0000-0000000000c2', 'updated@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000c1', 'addradmin@test.com', 'Address Admin', 'super_admin'),
  ('10000000-0000-0000-0000-0000000000c1', 'legacy@test.com', 'Legacy Address', 'investor'),
  ('10000000-0000-0000-0000-0000000000c2', 'updated@test.com', 'Updated Address', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;

-- Legacy Address is exactly what every investor on the books looks
-- like today: one free-text line, and nothing else.
INSERT INTO investors (id, profile_id, investor_code, full_name, email, tin, address) VALUES
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1',
   'MGA0001', 'Legacy Address', 'legacy@test.com', 'TIN-LEG', 'Ilorin'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2',
   'MGA0002', 'Updated Address', 'updated@test.com', 'TIN-UPD', '7 Old Road, Ikeja')
ON CONFLICT (id) DO NOTHING;

-- The migration's preservation step runs on rows that existed when it
-- was applied; these were inserted after, so do here what it did there.
UPDATE investors
   SET previous_address_record = btrim(address)
 WHERE previous_address_record IS NULL
   AND COALESCE(btrim(address), '') <> ''
   AND investor_code IN ('MGA0001', 'MGA0002');

SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000c1';

-- ------------------------------------------------------------
-- R1 — nothing was lost
-- ------------------------------------------------------------
DO $$ DECLARE v_prev TEXT; v_addr TEXT; BEGIN
  SELECT previous_address_record, address INTO v_prev, v_addr
  FROM investors WHERE investor_code = 'MGA0001';

  IF v_prev <> 'Ilorin' THEN
    RAISE EXCEPTION 'TEST FAIL R1: the old address was not preserved — %', v_prev;
  END IF;
  -- BOTH copies. The migration adds; it does not take away.
  IF v_addr <> 'Ilorin' THEN
    RAISE EXCEPTION 'TEST FAIL R1: investors.address was modified — %', v_addr;
  END IF;
  RAISE NOTICE 'PASS R1: the address is preserved, and the original column untouched';
END $$;

-- ------------------------------------------------------------
-- R2 — and it is not mistaken for a real address
-- ------------------------------------------------------------
DO $$ DECLARE m TEXT[]; v_n INT; BEGIN
  m := residential_address_missing('20000000-0000-0000-0000-0000000000c1');
  IF array_length(m, 1) <> 4 THEN
    RAISE EXCEPTION 'TEST FAIL R2: expected all four parts missing, got %', m;
  END IF;
  -- Named individually, in the order the form asks. "Address is
  -- wrong" is not something anyone can act on.
  IF m[1] NOT LIKE 'Street name%' OR m[2] <> 'State of residence'
     OR m[3] <> 'Local government area' OR m[4] <> 'City or town' THEN
    RAISE EXCEPTION 'TEST FAIL R2: wrong parts or wrong order — %', m;
  END IF;
  IF residential_address_complete('20000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'TEST FAIL R2: "Ilorin" counted as a complete address';
  END IF;

  SELECT COUNT(*) INTO v_n FROM investors_needing_address_update()
   WHERE investor_code = 'MGA0001';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R2: the investor is not on the update list';
  END IF;
  RAISE NOTICE 'PASS R2: a legacy address is incomplete, and says which parts';
END $$;

-- ------------------------------------------------------------
-- R3 — supplying the parts clears it
-- ------------------------------------------------------------
DO $$ DECLARE m TEXT[]; BEGIN
  UPDATE investors SET
    residential_street_address = '14 Unity Road, Tanke, beside the filling station',
    residential_state_code = 'KW', residential_state_name = 'Kwara',
    residential_lga_code = 'KW-ILORIN-SOUTH', residential_lga_name = 'Ilorin South',
    residential_city = 'Ilorin'
  WHERE investor_code = 'MGA0002';

  m := residential_address_missing('20000000-0000-0000-0000-0000000000c2');
  IF array_length(m, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL R3: still incomplete — %', m;
  END IF;

  -- One part at a time, to prove each is genuinely required rather
  -- than the whole thing passing on the strength of the street line.
  UPDATE investors SET residential_city = '' WHERE investor_code = 'MGA0002';
  IF residential_address_complete('20000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'TEST FAIL R3: a blank city still counted as complete';
  END IF;
  UPDATE investors SET residential_city = 'Ilorin' WHERE investor_code = 'MGA0002';

  UPDATE investors SET residential_lga_code = NULL, residential_lga_name = NULL
   WHERE investor_code = 'MGA0002';
  IF residential_address_complete('20000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'TEST FAIL R3: a missing LGA still counted as complete';
  END IF;
  UPDATE investors SET residential_lga_code = 'KW-ILORIN-SOUTH',
                       residential_lga_name = 'Ilorin South'
   WHERE investor_code = 'MGA0002';

  RAISE NOTICE 'PASS R3: all four parts are required, each on its own';
END $$;

-- ------------------------------------------------------------
-- R4 — "Lagos" is not an address
--
--     The reported behaviour: people typed a state name into the
--     address box. The rule is crude on purpose — it only has to
--     catch a place name typed where a street belongs.
-- ------------------------------------------------------------
DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    UPDATE investors SET residential_street_address = 'Lagos'
     WHERE investor_code = 'MGA0002';
    RAISE EXCEPTION 'TEST FAIL R4: "Lagos" was accepted as a street address';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%investors_residential_street_length%' THEN
    RAISE EXCEPTION 'TEST FAIL R4: refused for the wrong reason — %', v_msg;
  END IF;
  RAISE NOTICE 'PASS R4: %', v_msg;
END $$;

-- ------------------------------------------------------------
-- R5 — Ikeja is not in Kano
--
--     The dropdown makes this hard. The constraint makes it
--     impossible, including for anything writing to the table
--     without going near a form.
-- ------------------------------------------------------------
DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    UPDATE investors SET residential_state_code = 'KN', residential_state_name = 'Kano',
                         residential_lga_code = 'LA-IKEJA', residential_lga_name = 'Ikeja'
     WHERE investor_code = 'MGA0002';
    RAISE EXCEPTION 'TEST FAIL R5: an LGA from another state was accepted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%investors_residential_lga_in_state%' THEN
    RAISE EXCEPTION 'TEST FAIL R5: refused for the wrong reason — %', v_msg;
  END IF;
  RAISE NOTICE 'PASS R5: an LGA must belong to its state';
END $$;

-- ------------------------------------------------------------
-- R6 — KYC asks for the parts
-- ------------------------------------------------------------
DO $$ DECLARE m TEXT[]; BEGIN
  m := kyc_missing_fields('20000000-0000-0000-0000-0000000000c1');
  IF NOT ('State of residence' = ANY(m) AND 'Local government area' = ANY(m)
          AND 'City or town' = ANY(m)) THEN
    RAISE EXCEPTION 'TEST FAIL R6: KYC does not ask for the parts — %', m;
  END IF;
  -- And no longer for the thing nobody could act on.
  IF 'Address' = ANY(m) THEN
    RAISE EXCEPTION 'TEST FAIL R6: the old catch-all "Address" is still reported — %', m;
  END IF;
  RAISE NOTICE 'PASS R6: KYC names the four parts, not "Address"';
END $$;

-- ------------------------------------------------------------
-- R7 / R8 — the tax document
--
--     Legacy Address has a TIN and no structured address. Updated
--     Address has both. Issuing must produce exactly one note.
-- ------------------------------------------------------------
INSERT INTO series (id, name, description, start_month_offset, price_per_unit,
                    mudarabah_investor_ratio, default_wht_rate)
VALUES ('30000000-0000-0000-0000-0000000000c1', 'C', 'Series C', 0, 100000, 0.70, 0.10)
ON CONFLICT (name) DO UPDATE SET default_wht_rate = EXCLUDED.default_wht_rate;

INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date,
                    status, unit_value, wht_rate)
VALUES ('40000000-0000-0000-0000-0000000000c1', (SELECT id FROM series WHERE name='C'),
        901, 'C-901', '2026-01-01', '2026-03-31', 'active', 100000, 0.10);

INSERT INTO investments (id, investment_code, investor_id, series_id, cycle_id, units,
                         price_per_unit, capital, investment_date, maturity_date, status) VALUES
  ('50000000-0000-0000-0000-0000000000c1', 'MGC901-1', '20000000-0000-0000-0000-0000000000c1',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-0000000000c1',
   10, 100000, 1000000, '2026-01-01', '2026-03-31', 'active'),
  ('50000000-0000-0000-0000-0000000000c2', 'MGC901-2', '20000000-0000-0000-0000-0000000000c2',
   (SELECT id FROM series WHERE name='C'), '40000000-0000-0000-0000-0000000000c1',
   10, 100000, 1000000, '2026-01-01', '2026-03-31', 'active');

SELECT mudarabah_save_ledger(jsonb_build_object(
  'cycleId', '40000000-0000-0000-0000-0000000000c1',
  'description', 'home furniture', 'discloseMode', 'perSlot', 'status', 'active',
  'products', jsonb_build_array(jsonb_build_object('id','w','name','Widget')),
  'months', jsonb_build_array(
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB),
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB),
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB))));

SELECT mudarabah_settle_cycle(
  '40000000-0000-0000-0000-0000000000c1', '1.0.0',
  '{"revenue":40000000,"profit":8000000,"holderPot":5600000,"managerPot":2400000}'::JSONB,
  jsonb_build_array(
    jsonb_build_object('investmentId','50000000-0000-0000-0000-0000000000c1',
      'investorId','20000000-0000-0000-0000-0000000000c1','units',10,'capital',100000000,
      'grossProfit',2800000,'wht',280000,'netProfit',2520000,
      'capitalAction','rollover','slotsWithdrawn',0,'capitalWithdrawn',0,'amountPaid',2520000),
    jsonb_build_object('investmentId','50000000-0000-0000-0000-0000000000c2',
      'investorId','20000000-0000-0000-0000-0000000000c2','units',10,'capital',100000000,
      'grossProfit',2800000,'wht',280000,'netProfit',2520000,
      'capitalAction','rollover','slotsWithdrawn',0,'capitalWithdrawn',0,'amountPaid',2520000)));

DO $$
DECLARE
  v_rem UUID;
  v_res JSONB;
  v_note wht_credit_notes%ROWTYPE;
  v_preview RECORD;
BEGIN
  v_rem := mudarabah_create_remittance(
    'FIRS/KW/2026/0099', '2026-05-14', 560000,
    ARRAY['40000000-0000-0000-0000-0000000000c1']::UUID[],
    'Federal Inland Revenue Service', NULL);

  -- The preview must say so BEFORE anybody presses issue.
  SELECT * INTO v_preview FROM mudarabah_issuance_preview(v_rem)
   WHERE investor_code = 'MGA0001';
  IF v_preview.has_address THEN
    RAISE EXCEPTION 'TEST FAIL R7: the preview claims the legacy investor has an address';
  END IF;
  IF array_length(v_preview.address_missing, 1) <> 4 THEN
    RAISE EXCEPTION 'TEST FAIL R7: the preview does not say what is missing — %',
      v_preview.address_missing;
  END IF;

  v_res := mudarabah_issue_credit_notes(v_rem);

  -- ONE note, not none. The whole batch must not be held up by one
  -- investor's missing city — that is the same rule the no-TIN skip
  -- has always followed.
  IF (v_res->>'issued')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R7: expected 1 issued, got %', v_res::TEXT;
  END IF;
  IF (v_res->>'skipped_no_address')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R7: the skip was not counted — %', v_res::TEXT;
  END IF;
  IF v_res->'blocked_names'->>0 <> 'Legacy Address' THEN
    RAISE EXCEPTION 'TEST FAIL R7: the blocked investor is not named — %', v_res::TEXT;
  END IF;
  IF EXISTS (SELECT 1 FROM wht_credit_notes
              WHERE investor_id = '20000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'TEST FAIL R7: a note was issued with no structured address';
  END IF;
  -- The admin screen reads these by name. Renaming them would empty
  -- the message it shows after issuing, with nothing to indicate why.
  IF v_res->>'reference' IS NULL OR v_res->>'skipped_no_tin' IS NULL
     OR v_res->>'already_issued' IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL R7: the keys the admin screen reads are gone — %', v_res::TEXT;
  END IF;
  RAISE NOTICE 'PASS R7: one investor blocked, the other issued — %', v_res::TEXT;

  -- R8. The parts are frozen onto the note, not looked up later.
  SELECT * INTO v_note FROM wht_credit_notes
   WHERE investor_id = '20000000-0000-0000-0000-0000000000c2';
  IF v_note.investor_state_name <> 'Kwara'
     OR v_note.investor_lga_name <> 'Ilorin South'
     OR v_note.investor_city <> 'Ilorin'
     OR v_note.investor_street_address NOT LIKE '14 Unity Road%' THEN
    RAISE EXCEPTION 'TEST FAIL R8: the note did not freeze the parts — %', v_note;
  END IF;
  -- And the one-line form agrees with them.
  IF v_note.investor_address NOT LIKE '%Ilorin South LGA%'
     OR v_note.investor_address NOT LIKE '%Kwara%' THEN
    RAISE EXCEPTION 'TEST FAIL R8: the printed line disagrees with the parts — %',
      v_note.investor_address;
  END IF;

  -- Moving house afterwards must not rewrite an issued note.
  UPDATE investors SET residential_city = 'Offa' WHERE investor_code = 'MGA0002';
  SELECT * INTO v_note FROM wht_credit_notes
   WHERE investor_id = '20000000-0000-0000-0000-0000000000c2';
  IF v_note.investor_city <> 'Ilorin' THEN
    RAISE EXCEPTION 'TEST FAIL R8: an issued note changed when the investor moved — %',
      v_note.investor_city;
  END IF;
  UPDATE investors SET residential_city = 'Ilorin' WHERE investor_code = 'MGA0002';

  RAISE NOTICE 'PASS R8: the note carries the address as it was when the tax was deducted';
END $$;

-- ------------------------------------------------------------
-- R9 / R10 — verification does not survive a change
-- ------------------------------------------------------------
DO $$ DECLARE v_verified BOOLEAN; v_at TIMESTAMPTZ; BEGIN
  UPDATE investors SET residential_address_verified = TRUE
   WHERE investor_code = 'MGA0002';
  SELECT residential_address_verified INTO v_verified
    FROM investors WHERE investor_code = 'MGA0002';
  IF NOT v_verified THEN
    RAISE EXCEPTION 'TEST FAIL R10: marking it verified did not stick';
  END IF;

  UPDATE investors SET residential_city = 'Offa' WHERE investor_code = 'MGA0002';
  SELECT residential_address_verified, residential_address_updated_at
    INTO v_verified, v_at FROM investors WHERE investor_code = 'MGA0002';

  -- An address somebody checked last month is not the address that
  -- has just been typed over it.
  IF v_verified THEN
    RAISE EXCEPTION 'TEST FAIL R9: the address changed but is still marked verified';
  END IF;
  IF v_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL R9: the change was not stamped';
  END IF;
  RAISE NOTICE 'PASS R9/R10: a change clears verification and records when';
END $$;

-- ------------------------------------------------------------
-- R11 — preserving is done once
--
--     Re-running the migration must not overwrite what was preserved
--     with a later edit of the old column.
-- ------------------------------------------------------------
DO $$ DECLARE v_prev TEXT; BEGIN
  UPDATE investors SET address = 'somebody edited this afterwards'
   WHERE investor_code = 'MGA0001';

  -- Exactly the migration's step 2.
  UPDATE investors
     SET previous_address_record = btrim(address)
   WHERE previous_address_record IS NULL
     AND COALESCE(btrim(address), '') <> '';

  SELECT previous_address_record INTO v_prev
    FROM investors WHERE investor_code = 'MGA0001';
  IF v_prev <> 'Ilorin' THEN
    RAISE EXCEPTION 'TEST FAIL R11: a re-run overwrote the preserved address — %', v_prev;
  END IF;
  RAISE NOTICE 'PASS R11: what was preserved stays preserved';
END $$;

ROLLBACK;
\echo '=== ALL RESIDENTIAL ADDRESS TESTS PASSED ==='
