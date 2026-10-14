-- ============================================================
-- MaalRise 060 — reopening an activated Cycle — scenarios
-- Scratch database only (051–060). Everything ROLLS BACK.
--
--   R47 super admin only, with a reason; back to terms approved and
--       hidden from investors; new terms version, the missing funding,
--       activated again; the old terms kept as superseded; refused
--       once a payment has been recorded
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000e901', 'admin@ro.com'), ('a0000000-0000-0000-0000-00000000e902', 'ops@ro.com'),
 ('a0000000-0000-0000-0000-00000000e903', 'fin@ro.com'), ('a0000000-0000-0000-0000-00000000e904', 'sup@ro.com'),
 ('b0000000-0000-0000-0000-00000000e905', 'officer@ro.com'), ('a0000000-0000-0000-0000-00000000e906', 'sa@ro.com'), ('10000000-0000-0000-0000-00000000e913', 'three@ro.com'),
 ('10000000-0000-0000-0000-00000000e911', 'one@ro.com'), ('10000000-0000-0000-0000-00000000e912', 'two@ro.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000e901', 'admin@ro.com', 'VA Admin', 'administrator'),
 ('a0000000-0000-0000-0000-00000000e902', 'ops@ro.com', 'VA Ops', 'operations'),
 ('a0000000-0000-0000-0000-00000000e903', 'fin@ro.com', 'VA Fin', 'finance'),
 ('a0000000-0000-0000-0000-00000000e904', 'sup@ro.com', 'VA Support', 'customer_support'),
 ('b0000000-0000-0000-0000-00000000e905', 'officer@ro.com', 'VA Officer', 'payment_officer'),
 ('a0000000-0000-0000-0000-00000000e906', 'sa@ro.com', 'RO Super', 'super_admin'),
 ('10000000-0000-0000-0000-00000000e913', 'three@ro.com', 'Investor Three', 'investor'),
 ('10000000-0000-0000-0000-00000000e911', 'one@ro.com', 'Investor One', 'investor'),
 ('10000000-0000-0000-0000-00000000e912', 'two@ro.com', 'Investor Two', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;
CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000e901'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000e902' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000e903'
    WHEN 'sup' THEN 'a0000000-0000-0000-0000-00000000e904' WHEN 'officer' THEN 'b0000000-0000-0000-0000-00000000e905'
    WHEN 'one' THEN '10000000-0000-0000-0000-00000000e911' WHEN 'two' THEN '10000000-0000-0000-0000-00000000e912'
    WHEN 'sa' THEN 'a0000000-0000-0000-0000-00000000e906' END, true);
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE c UUID; c2 UUID; t UUID; t2 UUID; a UUID; b UUID; x UUID; f UUID; e TEXT; n INT;
BEGIN
  -- An activated Cycle of ₦1,000,000 (1,000 units of ₦1,000) — the real cost was ₦1,500,000 and Investor Three is missing.
  PERFORM pg_temp.as_user('ops');
  c := maalrise_create_cycle(jsonb_build_object('name', 'Reopen Cycle', 'transaction_name', 'Murabaha',
    'counterparty_id', maalrise_create_counterparty('{"name":"Reopen Co"}'), 'start_date', CURRENT_DATE::TEXT,
    'duration_months', 3, 'unit_price_kobo', 100000));
  t := maalrise_save_terms(c, '{"cost_kobo":100000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":103000000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":3000000,"sale_price_kobo":103000000,"fee_kobo":99900,
    "investor_pool_kobo":2900100,"counterparty_total_kobo":103000000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 966700, 'fee_kobo', 33300,
       'counterparty_gross_kobo', 1000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(t);
  a := maalrise_add_investor('10000000-0000-0000-0000-00000000e911', '{"full_name":"Investor One"}');
  b := maalrise_add_investor('10000000-0000-0000-0000-00000000e912', '{"full_name":"Investor Two"}');
  x := maalrise_add_investor('10000000-0000-0000-0000-00000000e913', '{"full_name":"Investor Three"}');
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', c, 'category', 'contract', 'name', 'c.pdf',
    'storage_path', 'maalrise/ro/c.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10, 'visible_to_investors', true));
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(t);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, a, 600, 60000000, CURRENT_DATE, 'RO-1');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, b, 400, 40000000, CURRENT_DATE, 'RO-2');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM maalrise_activate_cycle(c);

  -- Nobody but a super admin, and never without a reason
  FOREACH e IN ARRAY ARRAY['admin', 'ops', 'fin', 'one'] LOOP
    PERFORM pg_temp.as_user(e);
    IF pg_temp.err(format('SELECT maalrise_reopen_cycle(%L, %L)', c, 'x')) NOT LIKE 'Only a super admin%' THEN
      RAISE EXCEPTION 'TEST FAIL R47: % reopened a Cycle', e; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('sa');
  IF pg_temp.err(format('SELECT maalrise_reopen_cycle(%L, %L)', c, '  ')) NOT LIKE 'Give the reason%' THEN
    RAISE EXCEPTION 'TEST FAIL R47: reopened without a reason'; END IF;

  PERFORM maalrise_reopen_cycle(c, 'Cost was ₦1.5m, not ₦1m; Investor Three''s funding was missed');
  IF (SELECT status || ':' || (activated_at IS NULL)::TEXT FROM maalrise_cycles WHERE id = c) <> 'terms_approved:true' THEN
    RAISE EXCEPTION 'TEST FAIL R47: not back to terms approved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'maalrise_reopen_cycle' AND entity_id = c::TEXT
                   AND new_values->>'reason' LIKE 'Cost was%' AND old_values->>'status' = 'active') THEN
    RAISE EXCEPTION 'TEST FAIL R47: reopening not recorded with its reason'; END IF;
  PERFORM pg_temp.as_user('one');
  IF maalrise_my_cycles() <> '[]'::JSONB THEN RAISE EXCEPTION 'TEST FAIL R47: investors still see a reopened Cycle'; END IF;
  PERFORM pg_temp.as_user('sa');
  IF pg_temp.err(format('SELECT maalrise_reopen_cycle(%L, %L)', c, 'again')) NOT LIKE 'Only an active Cycle%' THEN
    RAISE EXCEPTION 'TEST FAIL R47: reopened twice'; END IF;

  -- The correction, through the normal steps: new terms at ₦1.5m, the missing funding, activate again
  PERFORM pg_temp.as_user('ops');
  t2 := maalrise_save_terms(c, '{"cost_kobo":150000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":154500000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":4500000,"sale_price_kobo":154500000,"fee_kobo":149850,
    "investor_pool_kobo":4350150,"counterparty_total_kobo":154500000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 1450050, 'fee_kobo', 49950,
       'counterparty_gross_kobo', 1500000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(t2);
  PERFORM pg_temp.as_user('fin');
  IF pg_temp.err(format('SELECT maalrise_record_funding(%L, %L, 500, 50000000, CURRENT_DATE, %L)', c, x, 'RO-3')) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL R47: funding could not be recorded on the reopened Cycle'; END IF;
  f := (SELECT id FROM maalrise_investor_fundings WHERE reference = 'RO-3');
  PERFORM pg_temp.as_user('admin');
  IF pg_temp.err(format('SELECT maalrise_confirm_funding(%L)', f)) NOT LIKE '%would exceed%' THEN
    RAISE EXCEPTION 'TEST FAIL R47: extra units confirmed against the old ₦1m terms'; END IF;
  PERFORM maalrise_approve_terms(t2);
  PERFORM maalrise_confirm_funding(f);
  IF (SELECT string_agg(version || status, ',' ORDER BY version) FROM maalrise_cycle_terms WHERE cycle_id = c) <> '1superseded,2approved' THEN
    RAISE EXCEPTION 'TEST FAIL R47: the first terms should be kept, superseded'; END IF;
  PERFORM maalrise_activate_cycle(c);
  IF (SELECT status FROM maalrise_cycles WHERE id = c) <> 'active'
     OR (SELECT SUM(units) FROM maalrise_allocations WHERE cycle_id = c) <> 1500 THEN
    RAISE EXCEPTION 'TEST FAIL R47: not active with 1,500 units'; END IF;
  PERFORM pg_temp.as_user('one');
  IF (maalrise_my_cycles()->0->>'units')::INT <> 600 OR jsonb_array_length(maalrise_my_cycles()->0->'months') <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL R47: investor view after correction %', maalrise_my_cycles(); END IF;

  -- Once a payment has been recorded, reopening is refused
  PERFORM pg_temp.as_user('fin');
  PERFORM maalrise_record_receipt(c, jsonb_build_object('period', 1, 'amount_kobo', 1000, 'received_on', CURRENT_DATE));
  PERFORM pg_temp.as_user('sa');
  e := pg_temp.err(format('SELECT maalrise_reopen_cycle(%L, %L)', c, 'too late'));
  IF e NOT LIKE '%cannot be reopened: a payment received from the counterparty%' THEN
    RAISE EXCEPTION 'TEST FAIL R47: reopened after a payment was recorded: %', e; END IF;
  RAISE NOTICE 'PASS R47: a super admin reopens a mistaken activation with a reason; new terms, missing funding, activate again; refused once money has moved';
END $$;
ROLLBACK;
