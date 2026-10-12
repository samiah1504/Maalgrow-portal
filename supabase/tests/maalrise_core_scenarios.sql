-- ============================================================
-- MaalRise core (051) — workflow, permissions, isolation
--
-- Run ONLY against a scratch database built from the stub and the
-- migrations. Never against staging or production: it creates users.
--
--   R1  only preparing roles can create counterparties and Cycles;
--       the Payment Officer, finance and customer support cannot
--   R2  terms are stored only if the database's arithmetic agrees
--   R3  preparer and submitter cannot approve; another approver can
--   R4  approved terms and their schedule are frozen, even to the owner
--   R5  a new version supersedes the old, which is kept unchanged
--   R6  investors: staff refused; MaalGrow KYC reused; bank details
--       pre-filled UNCONFIRMED; duplicates refused
--   R7  funding: exact amounts, a second person confirms, no
--       over-subscription, allocations follow confirmation
--   R8  activation refused while any check fails, allowed when all pass
--   R9  investors see only their own records, only once active;
--       the Payment Officer sees nothing
--   R10 no direct writes for anyone — functions only
--   R11 every action is in the existing audit log
--   R12 the markup rate is the total for the whole Cycle: never
--       annualised, never multiplied by the months (confirmed rule)
-- ============================================================
\set ON_ERROR_STOP on

-- Everything below, grants included, is inside one transaction that
-- ROLLS BACK: the scratch database is left exactly as it was found.
BEGIN;

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
-- Supabase grants table privileges to authenticated by default; RLS is
-- what must stop them. Grant ALL here so the tests prove exactly that.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated;

INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000e001', 'sa@t.com'),
 ('a0000000-0000-0000-0000-00000000e002', 'admin@t.com'),
 ('a0000000-0000-0000-0000-00000000e003', 'ops@t.com'),
 ('a0000000-0000-0000-0000-00000000e004', 'fin@t.com'),
 ('a0000000-0000-0000-0000-00000000e005', 'cs@t.com'),
 ('b0000000-0000-0000-0000-00000000e001', 'officer@t.com'),
 ('10000000-0000-0000-0000-00000000e001', 'both@t.com'),
 ('10000000-0000-0000-0000-00000000e002', 'riseonly@t.com'),
 ('10000000-0000-0000-0000-00000000e003', 'growonly@t.com') ON CONFLICT DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000e001', 'sa@t.com',       'Super Admin',   'super_admin'),
 ('a0000000-0000-0000-0000-00000000e002', 'admin@t.com',    'Administrator', 'administrator'),
 ('a0000000-0000-0000-0000-00000000e003', 'ops@t.com',      'Operations',    'operations'),
 ('a0000000-0000-0000-0000-00000000e004', 'fin@t.com',      'Finance',       'finance'),
 ('a0000000-0000-0000-0000-00000000e005', 'cs@t.com',       'Support',       'customer_support'),
 ('b0000000-0000-0000-0000-00000000e001', 'officer@t.com',  'Officer',       'payment_officer'),
 ('10000000-0000-0000-0000-00000000e001', 'both@t.com',     'Both Products', 'investor'),
 ('10000000-0000-0000-0000-00000000e002', 'riseonly@t.com', 'Rise Only',     'investor'),
 ('10000000-0000-0000-0000-00000000e003', 'growonly@t.com', 'Grow Only',     'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

-- Two MaalGrow investors: one KYC-approved (will join MaalRise), one not in MaalRise at all
INSERT INTO investors (id, profile_id, investor_code, full_name, email, phone, bank_name, account_name, account_number, kyc_status) VALUES
 ('20000000-0000-0000-0000-00000000e001', '10000000-0000-0000-0000-00000000e001', 'MGE001', 'Both Products', 'both@t.com',
  '08010000001', 'GTB', 'Both Products', '0123456701', 'approved'),
 ('20000000-0000-0000-0000-00000000e003', '10000000-0000-0000-0000-00000000e003', 'MGE003', 'Grow Only', 'growonly@t.com',
  '08010000003', 'Zenith', 'Grow Only', '0123456703', 'approved');

-- The Alpha terms in kobo: ₦100m cost, 12% markup, 5% of markup deducted
CREATE FUNCTION pg_temp.alpha_terms(p_waived BOOLEAN) RETURNS JSONB AS $$
  SELECT CASE WHEN NOT p_waived THEN
    '{"cost_kobo":10000000000,"markup_type":"percent","markup_bps":1200,"stated_sale_price_kobo":11200000000,
      "fee_basis":"markup","fee_bps":500,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
      "markup_kobo":1200000000,"sale_price_kobo":11200000000,"fee_kobo":60000000,
      "investor_pool_kobo":1140000000,"counterparty_total_kobo":11200000000,"engine_version":"test"}'::JSONB
  ELSE
    '{"cost_kobo":10000000000,"markup_type":"percent","markup_bps":1200,"stated_sale_price_kobo":11200000000,
      "fee_basis":"markup","fee_treatment":"waived","schedule_mode":"equal",
      "markup_kobo":1200000000,"sale_price_kobo":11200000000,"fee_kobo":0,
      "investor_pool_kobo":1200000000,"counterparty_total_kobo":11200000000,"engine_version":"test"}'::JSONB
  END;
$$ LANGUAGE sql;

CREATE FUNCTION pg_temp.alpha_schedule(p_net BIGINT, p_fee BIGINT) RETURNS JSONB AS $$
  SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', p_net, 'fee_kobo', p_fee,
                                      'counterparty_gross_kobo', p_net + p_fee, 'rounding_adjustment_kobo', 0) ORDER BY g)
  FROM generate_series(1, 6) g;
$$ LANGUAGE sql;

CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON ids TO authenticated;

-- ------------------------------------------------------------
-- R1 — who may prepare
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN; r TEXT;
BEGIN
  FOREACH r IN ARRAY ARRAY['b0000000-0000-0000-0000-00000000e001', 'a0000000-0000-0000-0000-00000000e004',
                           'a0000000-0000-0000-0000-00000000e005', '10000000-0000-0000-0000-00000000e001'] LOOP
    PERFORM set_config('test.uid', r, true);
    BEGIN
      PERFORM maalrise_create_counterparty('{"name":"Nope Ltd"}');
      v_ok := TRUE;
    EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
    IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R1: % was allowed to create a counterparty', r; END IF;
  END LOOP;

  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e003', true);
  INSERT INTO ids VALUES ('cp', maalrise_create_counterparty('{"name":"Test Counterparty Ltd","registration_no":"RC 1"}'));
  INSERT INTO ids VALUES ('alpha', maalrise_create_cycle(jsonb_build_object(
    'name', 'MaalRise Test Alpha', 'transaction_name', 'Commodity Murabaha', 'counterparty_id', (SELECT v FROM ids WHERE k = 'cp'),
    'start_date', '2026-07-01', 'duration_months', 6, 'unit_price_kobo', 10000000)));
  RAISE NOTICE 'PASS R1: officer, finance, support and investors refused; operations prepared a Cycle';
END $$;

-- ------------------------------------------------------------
-- R2 — arithmetic is checked by the database
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN; v_cycle UUID := (SELECT v FROM ids WHERE k = 'alpha');
BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e003', true);

  BEGIN  -- pool off by a kobo
    PERFORM maalrise_save_terms(v_cycle, pg_temp.alpha_terms(false) || '{"investor_pool_kobo":1140000001}',
                                pg_temp.alpha_schedule(190000000, 10000000));
    v_ok := TRUE; EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R2: a pool one kobo out was stored'; END IF;

  BEGIN  -- contract sale price disagrees
    PERFORM maalrise_save_terms(v_cycle, pg_temp.alpha_terms(false) || '{"stated_sale_price_kobo":11199999999}',
                                pg_temp.alpha_schedule(190000000, 10000000));
    v_ok := TRUE; EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R2: a mismatched contract sale price was stored'; END IF;

  BEGIN  -- schedule short of the pool
    PERFORM maalrise_save_terms(v_cycle, pg_temp.alpha_terms(false), pg_temp.alpha_schedule(189999999, 10000000));
    v_ok := TRUE; EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R2: a schedule short of the pool was stored'; END IF;

  BEGIN  -- no fee treatment stated
    PERFORM maalrise_save_terms(v_cycle, pg_temp.alpha_terms(false) - 'fee_treatment', pg_temp.alpha_schedule(190000000, 10000000));
    v_ok := TRUE; EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R2: terms without a fee treatment were stored'; END IF;

  INSERT INTO ids VALUES ('v1', maalrise_save_terms(v_cycle, pg_temp.alpha_terms(false), pg_temp.alpha_schedule(190000000, 10000000)));
  IF (SELECT COUNT(*) FROM maalrise_cycle_terms WHERE cycle_id = v_cycle) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R2: refused attempts left rows behind';
  END IF;
  IF (SELECT due_date FROM maalrise_schedule_lines WHERE terms_id = (SELECT v FROM ids WHERE k = 'v1') AND period = 6) <> '2027-01-01' THEN
    RAISE EXCEPTION 'TEST FAIL R2: month 6 should fall due on 2027-01-01';
  END IF;
  RAISE NOTICE 'PASS R2: only terms the database can reproduce are stored';
END $$;

-- ------------------------------------------------------------
-- R3 — separate preparation and approval
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN; v_terms UUID := (SELECT v FROM ids WHERE k = 'v1');
BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e003', true);
  PERFORM maalrise_submit_terms(v_terms);

  BEGIN  -- operations may prepare, not approve
    PERFORM maalrise_approve_terms(v_terms); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R3: operations approved terms'; END IF;

  -- An approver who prepared terms cannot approve them
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e001', true);
  INSERT INTO ids VALUES ('beta', maalrise_create_cycle(jsonb_build_object(
    'name', 'MaalRise Test Beta', 'transaction_name', 'Equipment', 'counterparty_id', (SELECT v FROM ids WHERE k = 'cp'),
    'start_date', '2026-07-01', 'duration_months', 6, 'unit_price_kobo', 10000000)));
  INSERT INTO ids VALUES ('beta_v1', maalrise_save_terms((SELECT v FROM ids WHERE k = 'beta'),
    pg_temp.alpha_terms(false), pg_temp.alpha_schedule(190000000, 10000000)));
  PERFORM maalrise_submit_terms((SELECT v FROM ids WHERE k = 'beta_v1'));
  BEGIN
    PERFORM maalrise_approve_terms((SELECT v FROM ids WHERE k = 'beta_v1')); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R3: the preparer approved their own terms'; END IF;

  -- A different approver can
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e002', true);
  PERFORM maalrise_approve_terms(v_terms);
  IF (SELECT status FROM maalrise_cycle_terms WHERE id = v_terms) <> 'approved'
     OR (SELECT status FROM maalrise_cycles WHERE id = (SELECT v FROM ids WHERE k = 'alpha')) <> 'terms_approved'
     OR (SELECT approved_terms_id FROM maalrise_cycles WHERE id = (SELECT v FROM ids WHERE k = 'alpha')) <> v_terms THEN
    RAISE EXCEPTION 'TEST FAIL R3: approval did not take effect';
  END IF;
  RAISE NOTICE 'PASS R3: preparer and submitter cannot approve; a second person can';
END $$;

-- ------------------------------------------------------------
-- R4 — frozen, even to the table owner
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN; v_terms UUID := (SELECT v FROM ids WHERE k = 'v1');
BEGIN
  BEGIN UPDATE maalrise_cycle_terms SET cost_kobo = 1 WHERE id = v_terms; v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R4: approved terms were edited'; END IF;

  BEGIN DELETE FROM maalrise_cycle_terms WHERE id = v_terms; v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R4: approved terms were deleted'; END IF;

  BEGIN UPDATE maalrise_schedule_lines SET investor_net_kobo = investor_net_kobo WHERE terms_id = v_terms; v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R4: an approved schedule was edited'; END IF;

  BEGIN INSERT INTO maalrise_schedule_lines (terms_id, period, due_date, counterparty_gross_kobo, fee_kobo, investor_net_kobo)
        VALUES (v_terms, 7, '2027-02-01', 1, 0, 1); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R4: a month was added to an approved schedule'; END IF;
  RAISE NOTICE 'PASS R4: approved terms and schedule are frozen';
END $$;

-- ------------------------------------------------------------
-- R5 — a new version supersedes; the old one is kept unchanged
-- ------------------------------------------------------------
DO $$
DECLARE v_before JSONB; v_v1 UUID := (SELECT v FROM ids WHERE k = 'v1'); v_cycle UUID := (SELECT v FROM ids WHERE k = 'alpha');
BEGIN
  SELECT to_jsonb(t) - 'status' INTO v_before FROM maalrise_cycle_terms t WHERE id = v_v1;
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e003', true);
  INSERT INTO ids VALUES ('v2', maalrise_save_terms(v_cycle, pg_temp.alpha_terms(true), pg_temp.alpha_schedule(200000000, 0)));
  PERFORM maalrise_submit_terms((SELECT v FROM ids WHERE k = 'v2'));
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e002', true);
  PERFORM maalrise_approve_terms((SELECT v FROM ids WHERE k = 'v2'));

  IF (SELECT status FROM maalrise_cycle_terms WHERE id = v_v1) <> 'superseded' THEN
    RAISE EXCEPTION 'TEST FAIL R5: version 1 was not superseded';
  END IF;
  IF (SELECT to_jsonb(t) - 'status' FROM maalrise_cycle_terms t WHERE id = v_v1) <> v_before THEN
    RAISE EXCEPTION 'TEST FAIL R5: superseding changed version 1''s figures';
  END IF;
  IF (SELECT version FROM maalrise_cycle_terms WHERE id = (SELECT v FROM ids WHERE k = 'v2')) <> 2
     OR (SELECT approved_terms_id FROM maalrise_cycles WHERE id = v_cycle) <> (SELECT v FROM ids WHERE k = 'v2') THEN
    RAISE EXCEPTION 'TEST FAIL R5: version 2 is not the approved terms';
  END IF;
  RAISE NOTICE 'PASS R5: version 2 approved, version 1 kept exactly as it was';
END $$;

-- ------------------------------------------------------------
-- R6 — investors
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN; v_both maalrise_investors%ROWTYPE; v_rise maalrise_investors%ROWTYPE;
BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e003', true);

  BEGIN PERFORM maalrise_add_investor('a0000000-0000-0000-0000-00000000e005', '{}'); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R6: a staff account was added as an investor'; END IF;

  INSERT INTO ids VALUES ('inv_both', maalrise_add_investor('10000000-0000-0000-0000-00000000e001', '{}'));
  INSERT INTO ids VALUES ('inv_rise', maalrise_add_investor('10000000-0000-0000-0000-00000000e002',
    '{"full_name":"Rise Only","bank_name":"Access","account_name":"Rise Only","account_number":"0987654321"}'));

  SELECT * INTO v_both FROM maalrise_investors WHERE id = (SELECT v FROM ids WHERE k = 'inv_both');
  SELECT * INTO v_rise FROM maalrise_investors WHERE id = (SELECT v FROM ids WHERE k = 'inv_rise');

  IF v_both.kyc_status <> 'verified' OR v_both.kyc_source <> 'maalgrow' THEN
    RAISE EXCEPTION 'TEST FAIL R6: verified MaalGrow KYC was not reused (% / %)', v_both.kyc_status, v_both.kyc_source;
  END IF;
  IF v_both.account_number <> '0123456701' OR v_both.bank_confirmed_at IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL R6: MaalGrow bank details should be pre-filled and UNCONFIRMED';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM maalrise_bank_details_history WHERE maalrise_investor_id = v_both.id AND event = 'prefilled_from_maalgrow') THEN
    RAISE EXCEPTION 'TEST FAIL R6: the pre-fill was not recorded';
  END IF;
  IF v_rise.kyc_status <> 'not_started' THEN
    RAISE EXCEPTION 'TEST FAIL R6: bank details alone counted as KYC';
  END IF;
  IF v_both.investor_code !~ '^MR-[A-Z0-9]{6}$' THEN RAISE EXCEPTION 'TEST FAIL R6: bad code %', v_both.investor_code; END IF;

  BEGIN PERFORM maalrise_add_investor('10000000-0000-0000-0000-00000000e001', '{}'); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R6: the same person was added twice'; END IF;

  -- Confirm, then change: the change must clear the confirmation
  PERFORM maalrise_confirm_bank_details(v_both.id);
  PERFORM maalrise_set_bank_details(v_both.id, 'GTB', 'Both Products', '0123456799');
  IF (SELECT bank_confirmed_at FROM maalrise_investors WHERE id = v_both.id) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL R6: changed bank details stayed confirmed';
  END IF;
  IF (SELECT COUNT(*) FROM maalrise_bank_details_history WHERE maalrise_investor_id = v_both.id) <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL R6: bank history should hold prefill, confirm and change';
  END IF;
  -- MaalGrow's own record is untouched
  IF (SELECT account_number FROM investors WHERE id = '20000000-0000-0000-0000-00000000e001') <> '0123456701' THEN
    RAISE EXCEPTION 'TEST FAIL R6: MaalRise changed the MaalGrow bank details';
  END IF;
  RAISE NOTICE 'PASS R6: staff refused, MaalGrow KYC reused, pre-fill unconfirmed, changes clear confirmation, MaalGrow untouched';
END $$;

-- ------------------------------------------------------------
-- R7 — funding and allocations
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN; v_cycle UUID := (SELECT v FROM ids WHERE k = 'alpha'); v_f UUID; v_extra UUID;
BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e004', true);  -- finance records

  BEGIN PERFORM maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'inv_both'), 600, 5999999999, '2026-06-20', 'F-1');
        v_ok := TRUE; EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R7: funding not equal to units × unit price was recorded'; END IF;

  v_f := maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'inv_both'), 600, 6000000000, '2026-06-20', 'F-1');
  BEGIN PERFORM maalrise_confirm_funding(v_f); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R7: the recorder confirmed their own funding'; END IF;

  BEGIN PERFORM maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'inv_rise'), 400, 4000000000, '2026-06-21', 'f-1 ');
        v_ok := TRUE; EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R7: a duplicate reference was accepted'; END IF;

  INSERT INTO ids VALUES ('f_rise', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'inv_rise'), 400, 4000000000, '2026-06-21', 'F-2'));
  v_extra := maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'inv_rise'), 1, 10000000, '2026-06-22', 'F-3');

  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e001', true);  -- super admin confirms
  PERFORM maalrise_confirm_funding(v_f);
  PERFORM maalrise_confirm_funding((SELECT v FROM ids WHERE k = 'f_rise'));
  PERFORM maalrise_confirm_funding(v_f);  -- idempotent

  BEGIN PERFORM maalrise_confirm_funding(v_extra); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R7: funding beyond the cost was confirmed'; END IF;
  INSERT INTO ids VALUES ('f_extra', v_extra);

  IF (SELECT units FROM maalrise_allocations WHERE cycle_id = v_cycle AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'inv_both')) <> 600
     OR (SELECT SUM(capital_kobo) FROM maalrise_allocations WHERE cycle_id = v_cycle) <> 10000000000 THEN
    RAISE EXCEPTION 'TEST FAIL R7: allocations do not follow confirmed funding';
  END IF;
  RAISE NOTICE 'PASS R7: exact amounts, four-eyes confirmation, no duplicates, no over-subscription';
END $$;

-- ------------------------------------------------------------
-- R8 — activation checks
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN; v_cycle UUID := (SELECT v FROM ids WHERE k = 'alpha'); v_msg TEXT; v_checks JSONB;
BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e002', true);
  BEGIN PERFORM maalrise_activate_cycle(v_cycle); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; v_msg := SQLERRM; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R8: a Cycle with failing checks was activated'; END IF;
  IF v_msg NOT LIKE '%KYC%' OR v_msg NOT LIKE '%bank details%' OR v_msg NOT LIKE '%contract%' OR v_msg NOT LIKE '%awaiting confirmation%' THEN
    RAISE EXCEPTION 'TEST FAIL R8: the refusal should name every failing check — got: %', v_msg;
  END IF;

  -- Put everything right
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e004', true);
  PERFORM maalrise_reject_funding((SELECT v FROM ids WHERE k = 'f_extra'), 'Over-subscribed');
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e003', true);
  BEGIN PERFORM maalrise_review_kyc((SELECT v FROM ids WHERE k = 'inv_rise'), 'verified', NULL); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R8: KYC was verified with no submission'; END IF;
  PERFORM maalrise_record_kyc_submission((SELECT v FROM ids WHERE k = 'inv_rise'), '{"id_type":"NIN","id_number":"0000"}');
  PERFORM maalrise_review_kyc((SELECT v FROM ids WHERE k = 'inv_rise'), 'verified', NULL);
  PERFORM maalrise_confirm_bank_details((SELECT v FROM ids WHERE k = 'inv_both'));
  PERFORM maalrise_confirm_bank_details((SELECT v FROM ids WHERE k = 'inv_rise'));
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', v_cycle, 'category', 'contract',
    'name', 'Contract.pdf', 'storage_path', 'maalrise/test/contract.pdf', 'mime_type', 'application/pdf',
    'size_bytes', 1024, 'visible_to_investors', true));

  v_checks := maalrise_activation_checks(v_cycle);
  IF NOT (v_checks->>'all_ok')::BOOLEAN THEN RAISE EXCEPTION 'TEST FAIL R8: checks still failing: %', v_checks; END IF;

  -- Operations may not activate; an approver may
  BEGIN PERFORM maalrise_activate_cycle(v_cycle); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R8: operations activated a Cycle'; END IF;
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e002', true);
  PERFORM maalrise_activate_cycle(v_cycle);
  IF (SELECT status FROM maalrise_cycles WHERE id = v_cycle) <> 'active' THEN
    RAISE EXCEPTION 'TEST FAIL R8: the Cycle did not activate';
  END IF;

  BEGIN PERFORM maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'inv_rise'), 1, 10000000, '2026-07-02', 'LATE');
        v_ok := TRUE; EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R8: funding was recorded on an active Cycle'; END IF;
  RAISE NOTICE 'PASS R8: activation refused with every failing check named, then allowed once all pass';
END $$;

-- ------------------------------------------------------------
-- R9 — who sees what (as the authenticated role, so RLS applies)
-- ------------------------------------------------------------
DO $$
DECLARE v_n INTEGER;
BEGIN
  SET LOCAL ROLE authenticated;

  -- The investor in both products
  PERFORM set_config('test.uid', '10000000-0000-0000-0000-00000000e001', true);
  SELECT COUNT(*) INTO v_n FROM maalrise_investors;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL R9: an investor sees % MaalRise investor rows, expected 1', v_n; END IF;
  SELECT COUNT(*) INTO v_n FROM maalrise_allocations;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL R9: an investor sees % allocations, expected only their own', v_n; END IF;
  SELECT COUNT(*) INTO v_n FROM maalrise_cycles;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL R9: an investor sees % Cycles, expected their one active Cycle', v_n; END IF;
  SELECT COUNT(*) INTO v_n FROM maalrise_cycle_terms;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL R9: an investor sees % term versions, expected only the approved one', v_n; END IF;
  SELECT COUNT(*) INTO v_n FROM maalrise_schedule_lines;
  IF v_n <> 6 THEN RAISE EXCEPTION 'TEST FAIL R9: an investor sees % schedule lines, expected 6', v_n; END IF;
  SELECT COUNT(*) INTO v_n FROM maalrise_bank_details_history;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL R9: an investor reads bank history'; END IF;
  SELECT COUNT(*) INTO v_n FROM maalrise_documents;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL R9: an investor sees % documents, expected the visible contract', v_n; END IF;

  -- A MaalGrow-only investor sees no MaalRise data at all
  PERFORM set_config('test.uid', '10000000-0000-0000-0000-00000000e003', true);
  IF EXISTS (SELECT 1 FROM maalrise_investors) OR EXISTS (SELECT 1 FROM maalrise_cycles)
     OR EXISTS (SELECT 1 FROM maalrise_allocations) OR EXISTS (SELECT 1 FROM maalrise_schedule_lines) THEN
    RAISE EXCEPTION 'TEST FAIL R9: a MaalGrow-only investor read MaalRise data';
  END IF;

  -- The Payment Officer sees nothing in Phase 2
  PERFORM set_config('test.uid', 'b0000000-0000-0000-0000-00000000e001', true);
  IF EXISTS (SELECT 1 FROM maalrise_investors) OR EXISTS (SELECT 1 FROM maalrise_cycles)
     OR EXISTS (SELECT 1 FROM maalrise_investor_fundings) OR EXISTS (SELECT 1 FROM maalrise_cycle_terms) THEN
    RAISE EXCEPTION 'TEST FAIL R9: the Payment Officer read MaalRise data';
  END IF;

  -- Customer support (staff) can read everything
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e005', true);
  SELECT COUNT(*) INTO v_n FROM maalrise_cycles;
  IF v_n <> 2 THEN RAISE EXCEPTION 'TEST FAIL R9: staff see % Cycles, expected 2', v_n; END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS R9: investors see only their own active Cycle; MaalGrow-only investors and the officer see nothing';
END $$;

-- Before activation an allocated investor sees nothing of a Cycle
DO $$
DECLARE v_beta UUID := (SELECT v FROM ids WHERE k = 'beta'); v_f UUID;
BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e004', true);
  v_f := maalrise_record_funding(v_beta, (SELECT v FROM ids WHERE k = 'inv_rise'), 10, 100000000, '2026-06-25', 'B-1');
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e001', true);
  PERFORM maalrise_confirm_funding(v_f);

  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', '10000000-0000-0000-0000-00000000e002', true);
  IF EXISTS (SELECT 1 FROM maalrise_cycles WHERE id = v_beta)
     OR EXISTS (SELECT 1 FROM maalrise_allocations WHERE cycle_id = v_beta)
     OR EXISTS (SELECT 1 FROM maalrise_cycle_terms WHERE cycle_id = v_beta) THEN
    RAISE EXCEPTION 'TEST FAIL R9: an investor saw a Cycle before it was activated';
  END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS R9b: nothing of an unactivated Cycle is visible to its investors';
END $$;

-- ------------------------------------------------------------
-- R10 — no direct writes, even for a super admin
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN; v_n INTEGER;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e001', true);

  BEGIN INSERT INTO maalrise_counterparties (name) VALUES ('Direct Ltd'); v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R10: a direct INSERT succeeded'; END IF;

  UPDATE maalrise_cycles SET status = 'closed' WHERE id = (SELECT v FROM ids WHERE k = 'alpha');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL R10: a direct UPDATE changed % row(s)', v_n; END IF;

  DELETE FROM maalrise_allocations WHERE cycle_id = (SELECT v FROM ids WHERE k = 'alpha');
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL R10: a direct DELETE removed % row(s)', v_n; END IF;

  -- An investor cannot make themselves KYC-verified
  PERFORM set_config('test.uid', '10000000-0000-0000-0000-00000000e002', true);
  UPDATE maalrise_investors SET kyc_status = 'verified' WHERE profile_id = '10000000-0000-0000-0000-00000000e002';
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL R10: an investor edited their own MaalRise record'; END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS R10: no direct writes for anyone — only the functions write';
END $$;

-- ------------------------------------------------------------
-- R11 — the audit trail
-- ------------------------------------------------------------
DO $$
DECLARE a TEXT;
BEGIN
  FOREACH a IN ARRAY ARRAY['maalrise_create_counterparty', 'maalrise_create_cycle', 'maalrise_save_terms',
    'maalrise_submit_terms', 'maalrise_approve_terms', 'maalrise_add_investor', 'maalrise_set_bank_details',
    'maalrise_confirm_bank_details', 'maalrise_record_funding', 'maalrise_confirm_funding', 'maalrise_reject_funding',
    'maalrise_record_kyc_submission', 'maalrise_review_kyc', 'maalrise_register_document', 'maalrise_activate_cycle'] LOOP
    IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = a AND user_id IS NOT NULL) THEN
      RAISE EXCEPTION 'TEST FAIL R11: no attributed audit entry for %', a;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS R11: every MaalRise action is in the existing audit log, attributed';
END $$;

-- ------------------------------------------------------------
-- R12 — markup rate is the total for the Cycle, whatever its length
-- ------------------------------------------------------------
DO $$
DECLARE v_ok BOOLEAN; v_c UUID; v_m INTEGER; v_terms JSONB; v_sched JSONB; v_net BIGINT;
BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000e003', true);
  FOREACH v_m IN ARRAY ARRAY[6, 12] LOOP
    v_c := maalrise_create_cycle(jsonb_build_object(
      'name', 'Markup rule ' || v_m || ' months', 'transaction_name', 'Rule check',
      'counterparty_id', (SELECT v FROM ids WHERE k = 'cp'), 'start_date', '2026-11-01',
      'duration_months', v_m, 'unit_price_kobo', 10000000));
    -- ₦10,000,000 at 35%: ₦3,500,000 markup, ₦13,500,000 sale price, fee waived
    v_terms := '{"cost_kobo":1000000000,"markup_type":"percent","markup_bps":3500,"stated_sale_price_kobo":1350000000,
                 "fee_basis":"markup","fee_treatment":"waived","schedule_mode":"equal",
                 "markup_kobo":350000000,"sale_price_kobo":1350000000,"fee_kobo":0,
                 "investor_pool_kobo":350000000,"counterparty_total_kobo":1350000000,"engine_version":"test"}';
    v_net := 350000000 / v_m;
    SELECT jsonb_agg(jsonb_build_object('period', g,
             'investor_net_kobo', v_net + CASE WHEN g = v_m THEN 350000000 % v_m ELSE 0 END,
             'fee_kobo', 0,
             'counterparty_gross_kobo', v_net + CASE WHEN g = v_m THEN 350000000 % v_m ELSE 0 END,
             'rounding_adjustment_kobo', CASE WHEN g = v_m THEN 350000000 % v_m ELSE 0 END) ORDER BY g)
      INTO v_sched FROM generate_series(1, v_m) g;

    -- An annualised figure (35% × months/12) is refused
    BEGIN
      PERFORM maalrise_save_terms(v_c, v_terms || jsonb_build_object(
        'markup_kobo', 350000000 * v_m / 12, 'sale_price_kobo', 1000000000 + 350000000 * v_m / 12,
        'investor_pool_kobo', 350000000 * v_m / 12, 'counterparty_total_kobo', 1000000000 + 350000000 * v_m / 12,
        'stated_sale_price_kobo', NULL), v_sched);
      v_ok := (v_m = 12);  -- for 12 months the annualised and total figures coincide, so only 6 months can prove it
    EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
    IF v_ok AND v_m <> 12 THEN RAISE EXCEPTION 'TEST FAIL R12: an annualised markup was accepted (% months)', v_m; END IF;

    -- A per-month figure (35% × months) is refused
    BEGIN
      PERFORM maalrise_save_terms(v_c, v_terms || jsonb_build_object(
        'markup_kobo', 350000000 * v_m, 'sale_price_kobo', 1000000000 + 350000000 * v_m,
        'investor_pool_kobo', 350000000 * v_m, 'counterparty_total_kobo', 1000000000 + 350000000 * v_m,
        'stated_sale_price_kobo', NULL), v_sched);
      v_ok := TRUE;
    EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
    IF v_ok THEN RAISE EXCEPTION 'TEST FAIL R12: a markup multiplied by the months was accepted (% months)', v_m; END IF;

    -- The total-for-the-Cycle figure is accepted, for either duration
    PERFORM maalrise_save_terms(v_c, v_terms, v_sched);
    IF (SELECT markup_kobo FROM maalrise_cycle_terms WHERE cycle_id = v_c) <> 350000000
       OR (SELECT sale_price_kobo FROM maalrise_cycle_terms WHERE cycle_id = v_c) <> 1350000000 THEN
      RAISE EXCEPTION 'TEST FAIL R12: ₦10m at 35%% should be ₦3.5m markup and ₦13.5m sale price (% months)', v_m;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS R12: 35%% of ₦10m is ₦3.5m markup / ₦13.5m sale price for 6 and 12 months alike; annualised or per-month figures refused';
END $$;

ROLLBACK;
