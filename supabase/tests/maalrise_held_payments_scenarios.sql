-- ============================================================
-- MaalRise 062 — held payments and MaalGrow KYC — scenarios
-- Scratch database only (051–062). Everything ROLLS BACK.
--
--   R49 a month's profit is approved although one investor has no
--       confirmed bank details: the others are payable, that one is
--       on hold (shown to them as approved, waiting for their bank
--       details); approving their KYC in MaalGrow verifies them in
--       MaalRise at once, confirms the bank details on that KYC and
--       releases the held payment; MaalRise's own different confirmed
--       details are never overwritten; MaalGrow rows are not changed
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000d801', 'admin@hp.com'), ('a0000000-0000-0000-0000-00000000d802', 'ops@hp.com'),
 ('a0000000-0000-0000-0000-00000000d803', 'fin@hp.com'), ('b0000000-0000-0000-0000-00000000d805', 'officer@hp.com'),
 ('10000000-0000-0000-0000-00000000d811', 'ready@hp.com'), ('10000000-0000-0000-0000-00000000d812', 'waiting@hp.com'),
 ('10000000-0000-0000-0000-00000000d813', 'own@hp.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000d801', 'admin@hp.com', 'HP Admin', 'administrator'),
 ('a0000000-0000-0000-0000-00000000d802', 'ops@hp.com', 'HP Ops', 'operations'),
 ('a0000000-0000-0000-0000-00000000d803', 'fin@hp.com', 'HP Fin', 'finance'),
 ('b0000000-0000-0000-0000-00000000d805', 'officer@hp.com', 'HP Officer', 'payment_officer'),
 ('10000000-0000-0000-0000-00000000d811', 'ready@hp.com', 'Ready Investor', 'investor'),
 ('10000000-0000-0000-0000-00000000d812', 'waiting@hp.com', 'Waiting Investor', 'investor'),
 ('10000000-0000-0000-0000-00000000d813', 'own@hp.com', 'Own Bank Investor', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;
-- MaalGrow records: KYC submitted, not yet approved; bank details on the KYC form
INSERT INTO investors (id, profile_id, investor_code, full_name, email, kyc_status, kyc_submitted_at, bank_name, account_name, account_number) VALUES
 ('20000000-0000-0000-0000-00000000d812', '10000000-0000-0000-0000-00000000d812', 'MG-HP0002', 'Waiting Investor', 'waiting@hp.com',
  'pending', NOW(), 'GTB', 'Waiting Investor', '0222222222'),
 ('20000000-0000-0000-0000-00000000d813', '10000000-0000-0000-0000-00000000d813', 'MG-HP0003', 'Own Bank Investor', 'own@hp.com',
  'pending', NOW(), 'UBA', 'Own Bank Investor', '0333333333');
CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000d801'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000d802' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000d803'
    WHEN 'officer' THEN 'b0000000-0000-0000-0000-00000000d805'
    WHEN 'ready' THEN '10000000-0000-0000-0000-00000000d811' WHEN 'waiting' THEN '10000000-0000-0000-0000-00000000d812' END, true);
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE c UUID; t UUID; a UUID; b UUID; o UUID; f UUID; r UUID; d UUID; m JSONB; g_before TEXT;
BEGIN
  PERFORM pg_temp.as_user('ops');
  c := maalrise_create_cycle(jsonb_build_object('name', 'Held Payments Cycle', 'transaction_name', 'Murabaha',
    'counterparty_id', maalrise_create_counterparty('{"name":"Held Co"}'), 'start_date', (CURRENT_DATE - 35)::TEXT,
    'duration_months', 3, 'unit_price_kobo', 100000));
  t := maalrise_save_terms(c, '{"cost_kobo":100000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":103000000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":3000000,"sale_price_kobo":103000000,"fee_kobo":99900,
    "investor_pool_kobo":2900100,"counterparty_total_kobo":103000000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 966700, 'fee_kobo', 33300,
       'counterparty_gross_kobo', 1000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(t);
  a := maalrise_add_investor('10000000-0000-0000-0000-00000000d811',
         '{"full_name":"Ready Investor","bank_name":"Access","account_name":"Ready Investor","account_number":"0111111111"}');
  b := maalrise_add_investor('10000000-0000-0000-0000-00000000d812', '{"full_name":"Waiting Investor"}');
  o := maalrise_add_investor('10000000-0000-0000-0000-00000000d813',
         '{"full_name":"Own Bank Investor","bank_name":"Kuda","account_name":"Own Bank Investor","account_number":"0444444444"}');
  PERFORM maalrise_confirm_bank_details(a);
  PERFORM maalrise_confirm_bank_details(o);   -- MaalRise holds its own confirmed details for this person
  IF (SELECT kyc_status || ':' || COALESCE(account_number, '-') || ':' || (bank_confirmed_at IS NULL)::TEXT
        FROM maalrise_investors WHERE id = b) <> 'pending_review:0222222222:true' THEN
    RAISE EXCEPTION 'TEST FAIL R49: before MaalGrow approves, the KYC bank details should be pre-filled unconfirmed (%)',
      (SELECT kyc_status || ':' || COALESCE(account_number, '-') FROM maalrise_investors WHERE id = b); END IF;
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', c, 'category', 'contract', 'name', 'c.pdf',
    'storage_path', 'maalrise/hp/c.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10, 'visible_to_investors', true));
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(t);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, a, 500, 50000000, CURRENT_DATE - 36, 'HP-1');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, b, 300, 30000000, CURRENT_DATE - 36, 'HP-2');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, o, 200, 20000000, CURRENT_DATE - 36, 'HP-3');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM maalrise_activate_cycle(c);

  -- Month 1 arrives and is confirmed; the distribution is approved
  PERFORM pg_temp.as_user('fin');
  r := maalrise_record_receipt(c, jsonb_build_object('period', 1, 'amount_kobo', 1000000, 'received_on', CURRENT_DATE));
  PERFORM pg_temp.as_user('admin');
  d := maalrise_confirm_receipt(r);
  PERFORM maalrise_approve_distribution(d);
  IF (SELECT string_agg(investor_name || '=' || status || ':' || COALESCE(account_number, '-'), ',' ORDER BY investor_name)
        FROM maalrise_distribution_lines WHERE distribution_id = d)
     <> 'Own Bank Investor=payable:0444444444,Ready Investor=payable:0111111111,Waiting Investor=on_hold:-' THEN
    RAISE EXCEPTION 'TEST FAIL R49: approval should pay the confirmed and hold the rest: %',
      (SELECT string_agg(investor_name || '=' || status, ',') FROM maalrise_distribution_lines WHERE distribution_id = d); END IF;
  IF NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = 'b0000000-0000-0000-0000-00000000d805' AND message LIKE '%on hold until bank details are confirmed: Waiting Investor%')
     AND NOT EXISTS (SELECT 1 FROM maalrise_notifications WHERE user_id = 'b0000000-0000-0000-0000-00000000d805' AND message LIKE '%on hold until bank details are confirmed: Waiting Investor%') THEN
    RAISE EXCEPTION 'TEST FAIL R49: the payment officer was not told who is on hold'; END IF;

  -- What the waiting investor sees: approved, waiting for their bank details
  PERFORM pg_temp.as_user('waiting');
  m := maalrise_my_cycle(c)->'months'->0;
  IF m->>'status' <> 'approved' OR (m->>'on_hold_kobo')::BIGINT <= 0 OR (m->>'approved_kobo')::BIGINT <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL R49: the investor on hold should see approved, waiting: %', m; END IF;

  -- MaalGrow approves KYC (as its screens do): MaalRise follows at once
  g_before := (SELECT bank_name || account_name || account_number FROM investors WHERE id = '20000000-0000-0000-0000-00000000d812');
  PERFORM pg_temp.as_user('admin');
  UPDATE investors SET kyc_status = 'approved', kyc_approved_at = NOW(), kyc_approved_by = 'a0000000-0000-0000-0000-00000000d801'
   WHERE id IN ('20000000-0000-0000-0000-00000000d812', '20000000-0000-0000-0000-00000000d813');
  IF (SELECT kyc_status || ':' || kyc_source || ':' || account_number || ':' || (bank_confirmed_by = 'a0000000-0000-0000-0000-00000000d801')::TEXT
        FROM maalrise_investors WHERE id = b) <> 'verified:maalgrow:0222222222:true' THEN
    RAISE EXCEPTION 'TEST FAIL R49: MaalGrow approval should verify and confirm the KYC bank details in MaalRise'; END IF;
  IF (SELECT status || ':' || account_number FROM maalrise_distribution_lines WHERE distribution_id = d AND maalrise_investor_id = b)
     <> 'payable:0222222222' THEN
    RAISE EXCEPTION 'TEST FAIL R49: the held payment was not released'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'maalrise_bank_confirmed_via_maalgrow_kyc' AND entity_id = b::TEXT)
     OR NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'maalrise_release_held_payments' AND entity_id = b::TEXT) THEN
    RAISE EXCEPTION 'TEST FAIL R49: confirmation and release should be recorded'; END IF;
  -- MaalRise's own different confirmed details are kept
  IF (SELECT account_number FROM maalrise_investors WHERE id = o) <> '0444444444' THEN
    RAISE EXCEPTION 'TEST FAIL R49: MaalGrow overwrote MaalRise''s own confirmed bank details'; END IF;
  IF (SELECT kyc_status FROM maalrise_investors WHERE id = o) <> 'verified' THEN
    RAISE EXCEPTION 'TEST FAIL R49: KYC should still count everywhere'; END IF;
  -- MaalGrow's own rows are not changed
  IF (SELECT bank_name || account_name || account_number FROM investors WHERE id = '20000000-0000-0000-0000-00000000d812') <> g_before THEN
    RAISE EXCEPTION 'TEST FAIL R49: MaalGrow bank details were changed'; END IF;

  -- Now the investor sees an ordinary approved payment
  PERFORM pg_temp.as_user('waiting');
  m := maalrise_my_cycle(c)->'months'->0;
  IF m->>'status' <> 'approved' OR (m->>'on_hold_kobo')::BIGINT <> 0 OR (m->>'approved_kobo')::BIGINT <= 0 THEN
    RAISE EXCEPTION 'TEST FAIL R49: after release the investor should see approved: %', m; END IF;

  -- The internal helpers are not callable from the API
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND (
       has_function_privilege('authenticated', 'maalrise_apply_maalgrow_kyc(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'maalrise_release_held_payments(uuid)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'TEST FAIL R49: an internal helper is callable from the API'; END IF;
  RAISE NOTICE 'PASS R49: only the unconfirmed investor is held; MaalGrow KYC approval verifies, confirms its bank details and releases the payment at once; MaalRise''s own confirmed details kept; MaalGrow untouched';
END $$;
ROLLBACK;
