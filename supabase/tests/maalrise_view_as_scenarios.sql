-- ============================================================
-- MaalRise 059 — "View as investor" — scenarios
-- Scratch database only (051–059). Everything ROLLS BACK.
--
--   R46 staff see exactly what the investor sees (same profile,
--       Cycles and payments, figure for figure); investors and the
--       payment officer cannot use it; each view is recorded; the
--       parameterised functions are not callable from the API
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000f901', 'admin@va.com'), ('a0000000-0000-0000-0000-00000000f902', 'ops@va.com'),
 ('a0000000-0000-0000-0000-00000000f903', 'fin@va.com'), ('a0000000-0000-0000-0000-00000000f904', 'sup@va.com'),
 ('b0000000-0000-0000-0000-00000000f905', 'officer@va.com'),
 ('10000000-0000-0000-0000-00000000f911', 'one@va.com'), ('10000000-0000-0000-0000-00000000f912', 'two@va.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000f901', 'admin@va.com', 'VA Admin', 'administrator'),
 ('a0000000-0000-0000-0000-00000000f902', 'ops@va.com', 'VA Ops', 'operations'),
 ('a0000000-0000-0000-0000-00000000f903', 'fin@va.com', 'VA Fin', 'finance'),
 ('a0000000-0000-0000-0000-00000000f904', 'sup@va.com', 'VA Support', 'customer_support'),
 ('b0000000-0000-0000-0000-00000000f905', 'officer@va.com', 'VA Officer', 'payment_officer'),
 ('10000000-0000-0000-0000-00000000f911', 'one@va.com', 'Investor One', 'investor'),
 ('10000000-0000-0000-0000-00000000f912', 'two@va.com', 'Investor Two', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;
CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000f901'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000f902' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000f903'
    WHEN 'sup' THEN 'a0000000-0000-0000-0000-00000000f904' WHEN 'officer' THEN 'b0000000-0000-0000-0000-00000000f905'
    WHEN 'one' THEN '10000000-0000-0000-0000-00000000f911' WHEN 'two' THEN '10000000-0000-0000-0000-00000000f912' END, true);
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE c UUID; t UUID; a UUID; b UUID; f1 UUID; f2 UUID; me JSONB; staff JSONB; e TEXT; r TEXT;
BEGIN
  PERFORM pg_temp.as_user('ops');
  c := maalrise_create_cycle(jsonb_build_object('name', 'View As Cycle', 'transaction_name', 'Murabaha',
    'counterparty_id', maalrise_create_counterparty('{"name":"View As Co"}'), 'start_date', (CURRENT_DATE - 40)::TEXT,
    'duration_months', 3, 'unit_price_kobo', 100000));
  t := maalrise_save_terms(c, '{"cost_kobo":100000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":103000000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":3000000,"sale_price_kobo":103000000,"fee_kobo":99900,
    "investor_pool_kobo":2900100,"counterparty_total_kobo":103000000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 966700, 'fee_kobo', 33300,
       'counterparty_gross_kobo', 1000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(t);
  a := maalrise_add_investor('10000000-0000-0000-0000-00000000f911',
         '{"full_name":"Investor One","bank_name":"GTB","account_name":"Investor One","account_number":"0123456789"}');
  b := maalrise_add_investor('10000000-0000-0000-0000-00000000f912', '{"full_name":"Investor Two"}');
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', c, 'category', 'contract', 'name', 'c.pdf',
    'storage_path', 'maalrise/va/c.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10, 'visible_to_investors', true));
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(t);
  PERFORM pg_temp.as_user('fin');
  f1 := maalrise_record_funding(c, a, 600, 60000000, CURRENT_DATE - 41, 'VA-1');
  f2 := maalrise_record_funding(c, b, 400, 40000000, CURRENT_DATE - 41, 'VA-2');
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_confirm_funding(f1);
  PERFORM maalrise_confirm_funding(f2);
  PERFORM maalrise_confirm_bank_details(a);
  PERFORM maalrise_activate_cycle(c);   -- 058: KYC outstanding does not block

  -- What Investor One sees in their own portal
  PERFORM pg_temp.as_user('one');
  me := jsonb_build_object('profile', maalrise_my_profile(), 'cycles', maalrise_my_cycles(), 'payments', maalrise_my_payments());
  IF jsonb_array_length(me->'cycles') <> 1 OR (me->'cycles'->0->>'units')::INT <> 600 OR me->'profile'->>'investor_code' IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL R46: the investor''s own view is wrong: %', me; END IF;
  e := pg_temp.err(format('SELECT maalrise_view_as_investor(%L)', b));
  IF e IS DISTINCT FROM 'Unauthorized' THEN RAISE EXCEPTION 'TEST FAIL R46: an investor used View as investor: %', e; END IF;

  -- Every staff role sees the same, figure for figure; the payment officer cannot
  FOREACH r IN ARRAY ARRAY['admin', 'ops', 'fin', 'sup'] LOOP
    PERFORM pg_temp.as_user(r);
    staff := maalrise_view_as_investor(a);
    IF staff IS DISTINCT FROM me THEN RAISE EXCEPTION 'TEST FAIL R46: % saw something different:% vs %', r, staff, me; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('officer');
  e := pg_temp.err(format('SELECT maalrise_view_as_investor(%L)', a));
  IF e IS DISTINCT FROM 'Unauthorized' THEN RAISE EXCEPTION 'TEST FAIL R46: the payment officer used View as investor: %', e; END IF;

  -- Investor Two: their own share only, nothing of Investor One
  PERFORM pg_temp.as_user('admin');
  staff := maalrise_view_as_investor(b);
  IF (staff->'cycles'->0->>'units')::INT <> 400 OR staff::TEXT LIKE '%Investor One%' OR staff::TEXT LIKE '%0123456789%' THEN
    RAISE EXCEPTION 'TEST FAIL R46: Investor Two''s view %', staff; END IF;
  PERFORM pg_temp.as_user('two');
  IF jsonb_build_object('profile', maalrise_my_profile(), 'cycles', maalrise_my_cycles(), 'payments', maalrise_my_payments())
     IS DISTINCT FROM staff THEN RAISE EXCEPTION 'TEST FAIL R46: Investor Two sees something different'; END IF;
  -- Someone with no MaalRise record still gets nothing
  PERFORM pg_temp.as_user('fin');
  IF maalrise_my_profile() IS NOT NULL OR maalrise_my_cycles() <> '[]'::JSONB OR maalrise_my_payments() <> '[]'::JSONB THEN
    RAISE EXCEPTION 'TEST FAIL R46: a non-investor saw MaalRise data'; END IF;

  IF (SELECT COUNT(*) FROM audit_logs WHERE action = 'maalrise_view_as_investor') <> 5 THEN
    RAISE EXCEPTION 'TEST FAIL R46: each view should be recorded'; END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') AND (
       has_function_privilege('authenticated', 'maalrise_investor_cycles_view(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'maalrise_investor_payments_view(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'maalrise_investor_profile_view(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'maalrise_investor_cycle_view(uuid,uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'maalrise_cycle_visible_to(uuid,uuid)', 'EXECUTE')) THEN
    RAISE EXCEPTION 'TEST FAIL R46: an internal view function is callable from the API'; END IF;
  RAISE NOTICE 'PASS R46: staff see exactly what the investor sees; investors and the payment officer cannot; every view recorded; internals not callable';
END $$;
ROLLBACK;
