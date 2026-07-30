-- ============================================================
-- KYC Extension — scenario tests (migration 015)
-- Run against a DB with migrations 001–015 applied.
-- ============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.com'),
  ('10000000-0000-0000-0000-000000000001', 'k1@test.com'),
  ('10000000-0000-0000-0000-000000000002', 'k2@test.com'),
  ('10000000-0000-0000-0000-000000000003', 'k3@test.com');

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.com', 'Super Admin', 'super_admin'),
  ('10000000-0000-0000-0000-000000000001', 'k1@test.com', 'Kyc One', 'investor'),
  ('10000000-0000-0000-0000-000000000002', 'k2@test.com', 'Kyc Two', 'investor'),
  ('10000000-0000-0000-0000-000000000003', 'k3@test.com', 'Kyc Three', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- K1: legacy approved investor (old KYC complete, new fields missing)
-- K2: fully complete + submitted (pending) — bulk-approvable
-- K3: submitted but missing occupation + next of kin
INSERT INTO investors (id, profile_id, investor_code, full_name, email, phone, address,
                       bank_name, account_name, account_number, kyc_status, kyc_submitted_at,
                       gender, nationality, occupation) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MG10001',
   'Kyc One', 'k1@test.com', '08011111111', '1 Legacy Street, Lagos',
   'GTB', 'Kyc One', '0111111111', 'approved', NOW() - INTERVAL '30 days',
   NULL, NULL, NULL),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'MG10002',
   'Kyc Two', 'k2@test.com', '08022222222', '2 Complete Close, Abuja',
   'UBA', 'Kyc Two', '0222222222', 'pending', NOW() - INTERVAL '1 day',
   'female', 'Nigerian', 'Trader'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'MG10003',
   'Kyc Three', 'k3@test.com', '08033333333', '3 Halfway House, Ibadan',
   'Zenith', 'Kyc Three', '0333333333', 'pending', NOW() - INTERVAL '1 day',
   'male', 'Nigerian', NULL);

INSERT INTO next_of_kin (investor_id, full_name, relationship, phone, address, city, state, country)
VALUES ('20000000-0000-0000-0000-000000000002', 'Sister Two', 'Sibling', '08099999999',
        '2 Family Road', 'Abuja', 'FCT', 'Nigeria');

-- 042: these investors must have a STRUCTURED residential address.
-- Without one a withholding tax credit note cannot be issued, which
-- is the whole point of the gate — so the fixture supplies what a
-- real investor would have supplied.
UPDATE investors SET
  residential_street_address = '12 Awolowo Road, Ikeja GRA, opposite the secretariat',
  residential_state_code     = 'LA',
  residential_state_name     = 'Lagos',
  residential_lga_code       = 'LA-IKEJA',
  residential_lga_name       = 'Ikeja',
  residential_city           = 'Ikeja'
WHERE id IN ('20000000-0000-0000-0000-000000000002');


SET test.uid = 'a0000000-0000-0000-0000-000000000001';

-- Scenario 1: legacy approved investor is detected as Update Required
-- (approved + missing new fields) without being rejected or losing data
DO $$
DECLARE m TEXT[]; v_status TEXT; v_addr TEXT;
BEGIN
  m := kyc_missing_fields('20000000-0000-0000-0000-000000000001');
  IF NOT ('Gender' = ANY(m) AND 'Nationality' = ANY(m) AND 'Occupation' = ANY(m)
          AND 'Next-of-kin details' = ANY(m)) THEN
    RAISE EXCEPTION 'TEST FAIL S1: missing fields wrong: %', m;
  END IF;
  IF 'Bank details' = ANY(m) OR 'Phone number' = ANY(m) THEN
    RAISE EXCEPTION 'TEST FAIL S1: legacy data wrongly flagged missing';
  END IF;
  SELECT kyc_status::text, address INTO v_status, v_addr
  FROM investors WHERE id = '20000000-0000-0000-0000-000000000001';
  IF v_status <> 'approved' OR v_addr <> '1 Legacy Street, Lagos' THEN
    RAISE EXCEPTION 'TEST FAIL S1: legacy record was modified';
  END IF;
  RAISE NOTICE 'PASS S1: legacy approved investor = Update Required, data intact';
END $$;

-- Scenario 2: bulk approval — partial success with per-record reasons
DO $$
DECLARE r JSONB;
BEGIN
  r := bulk_approve_kyc(ARRAY[
    '20000000-0000-0000-0000-000000000001',  -- already approved → excluded
    '20000000-0000-0000-0000-000000000002',  -- complete + pending → approved
    '20000000-0000-0000-0000-000000000003'   -- missing occupation + NOK → excluded
  ]::uuid[]);

  IF (r->>'approved')::int <> 1 OR (r->>'excluded_count')::int <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL S2: expected 1 approved / 2 excluded, got %', r;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM investors
    WHERE id = '20000000-0000-0000-0000-000000000002'
      AND kyc_status = 'approved'
      AND kyc_approved_at IS NOT NULL
      AND kyc_approved_by = 'a0000000-0000-0000-0000-000000000001'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S2: eligible record not approved with metadata';
  END IF;
  IF (SELECT kyc_status::text FROM investors WHERE id = '20000000-0000-0000-0000-000000000003') <> 'pending' THEN
    RAISE EXCEPTION 'TEST FAIL S2: incomplete record was approved';
  END IF;
  IF r::text NOT LIKE '%Already approved%' OR r::text NOT LIKE '%Next-of-kin details%' THEN
    RAISE EXCEPTION 'TEST FAIL S2: exclusion reasons missing: %', r;
  END IF;
  IF (SELECT COUNT(*) FROM audit_logs WHERE action = 'kyc_approved') < 1
     OR (SELECT COUNT(*) FROM audit_logs WHERE action = 'kyc_bulk_approved') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S2: audit events missing';
  END IF;
  RAISE NOTICE 'PASS S2: bulk approval partial success, reasons + audit events recorded';
END $$;

-- Scenario 3: double approval is a no-op exclusion
DO $$
DECLARE r JSONB;
BEGIN
  r := bulk_approve_kyc(ARRAY['20000000-0000-0000-0000-000000000002']::uuid[]);
  IF (r->>'approved')::int <> 0 OR (r->>'excluded_count')::int <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S3: already-approved record approved twice: %', r;
  END IF;
  RAISE NOTICE 'PASS S3: already-approved records are never approved twice';
END $$;

-- Scenario 4: investor completes missing fields → complete; non-admin
-- cannot bulk approve
DO $$
DECLARE r JSONB; m TEXT[];
BEGIN
  UPDATE investors SET occupation = 'Teacher'
  WHERE id = '20000000-0000-0000-0000-000000000003';
  INSERT INTO next_of_kin (investor_id, full_name, relationship, phone, address, city, state, country)
  VALUES ('20000000-0000-0000-0000-000000000003', 'Brother Three', 'Sibling', '08088888888',
          '3 Family Road', 'Ibadan', 'Oyo', 'Nigeria');

  -- 042. Occupation and next of kin are no longer the whole of it:
  -- KYC is not complete until the residential address has its four
  -- parts. Asserted BEFORE supplying them, so this is a test of the
  -- new requirement and not merely a fixture that satisfies it.
  m := kyc_missing_fields('20000000-0000-0000-0000-000000000003');
  IF NOT ('State of residence' = ANY(m) AND 'Local government area' = ANY(m)
          AND 'City or town' = ANY(m)) THEN
    RAISE EXCEPTION 'TEST FAIL S4: KYC passed without a structured address — %', m;
  END IF;

  UPDATE investors SET
    residential_street_address = '3 Halfway House, Bodija, near the market',
    residential_state_code = 'OY', residential_state_name = 'Oyo',
    residential_lga_code = 'OY-IBADAN-NORTH', residential_lga_name = 'Ibadan North',
    residential_city = 'Ibadan'
  WHERE id = '20000000-0000-0000-0000-000000000003';

  m := kyc_missing_fields('20000000-0000-0000-0000-000000000003');
  IF array_length(m, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL S4: still missing after completion: %', m;
  END IF;

  SET LOCAL test.uid = '10000000-0000-0000-0000-000000000003';
  BEGIN
    r := bulk_approve_kyc(ARRAY['20000000-0000-0000-0000-000000000003']::uuid[]);
    RAISE EXCEPTION 'TEST FAIL S4: investor performed bulk approval';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%permission%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS S4: completion clears missing list; investors cannot bulk approve';
END $$;

ROLLBACK;
\echo '=== ALL KYC EXTENSION TESTS PASSED ==='
