-- ============================================================
-- MaalRise 061 — refunding an investor's funding — scenarios
-- Scratch database only (051–061). Everything ROLLS BACK.
--
--   R48 refused on an active Cycle (reopen first); approvers only;
--       date, bank reference and reason required; the entry is kept,
--       marked refunded, and its units leave the Cycle (part refunds
--       too); its reference cannot be reused; a new terms version at
--       the lower cost lets the Cycle activate; the refunded investor
--       no longer sees it
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000d901', 'admin@rf.com'), ('a0000000-0000-0000-0000-00000000d902', 'ops@rf.com'),
 ('a0000000-0000-0000-0000-00000000d903', 'fin@rf.com'), ('a0000000-0000-0000-0000-00000000d904', 'sup@rf.com'),
 ('b0000000-0000-0000-0000-00000000d905', 'officer@rf.com'), ('a0000000-0000-0000-0000-00000000d906', 'sa@rf.com'), ('10000000-0000-0000-0000-00000000d913', 'three@rf.com'),
 ('10000000-0000-0000-0000-00000000d911', 'one@rf.com'), ('10000000-0000-0000-0000-00000000d912', 'two@rf.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000d901', 'admin@rf.com', 'VA Admin', 'administrator'),
 ('a0000000-0000-0000-0000-00000000d902', 'ops@rf.com', 'VA Ops', 'operations'),
 ('a0000000-0000-0000-0000-00000000d903', 'fin@rf.com', 'VA Fin', 'finance'),
 ('a0000000-0000-0000-0000-00000000d904', 'sup@rf.com', 'VA Support', 'customer_support'),
 ('b0000000-0000-0000-0000-00000000d905', 'officer@rf.com', 'VA Officer', 'payment_officer'),
 ('a0000000-0000-0000-0000-00000000d906', 'sa@rf.com', 'RO Super', 'super_admin'),
 ('10000000-0000-0000-0000-00000000d913', 'three@rf.com', 'Investor Three', 'investor'),
 ('10000000-0000-0000-0000-00000000d911', 'one@rf.com', 'Investor One', 'investor'),
 ('10000000-0000-0000-0000-00000000d912', 'two@rf.com', 'Investor Two', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;
CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000d901'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000d902' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000d903'
    WHEN 'sup' THEN 'a0000000-0000-0000-0000-00000000d904' WHEN 'officer' THEN 'b0000000-0000-0000-0000-00000000d905'
    WHEN 'one' THEN '10000000-0000-0000-0000-00000000d911' WHEN 'two' THEN '10000000-0000-0000-0000-00000000d912'
    WHEN 'sa' THEN 'a0000000-0000-0000-0000-00000000d906' END, true);
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE c UUID; t UUID; t2 UUID; a UUID; b UUID; x UUID; f UUID; e TEXT; fa UUID; fb UUID;
BEGIN
  -- An activated Cycle of ₦1,000,000 (1,000 units of ₦1,000) — the real cost was ₦1,500,000 and Investor Three is missing.
  PERFORM pg_temp.as_user('ops');
  c := maalrise_create_cycle(jsonb_build_object('name', 'Refund Cycle', 'transaction_name', 'Murabaha',
    'counterparty_id', maalrise_create_counterparty('{"name":"Refund Co"}'), 'start_date', CURRENT_DATE::TEXT,
    'duration_months', 3, 'unit_price_kobo', 100000));
  t := maalrise_save_terms(c, '{"cost_kobo":100000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":103000000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":3000000,"sale_price_kobo":103000000,"fee_kobo":99900,
    "investor_pool_kobo":2900100,"counterparty_total_kobo":103000000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 966700, 'fee_kobo', 33300,
       'counterparty_gross_kobo', 1000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(t);
  a := maalrise_add_investor('10000000-0000-0000-0000-00000000d911', '{"full_name":"Investor One"}');
  b := maalrise_add_investor('10000000-0000-0000-0000-00000000d912', '{"full_name":"Investor Two"}');
  x := maalrise_add_investor('10000000-0000-0000-0000-00000000d913', '{"full_name":"Investor Three"}');
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', c, 'category', 'contract', 'name', 'c.pdf',
    'storage_path', 'maalrise/rf/c.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10, 'visible_to_investors', true));
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(t);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, a, 600, 60000000, CURRENT_DATE, 'RF-1');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, b, 400, 40000000, CURRENT_DATE, 'RF-2');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM maalrise_activate_cycle(c);

  fa := (SELECT id FROM maalrise_investor_fundings WHERE reference = 'RF-1');
  fb := (SELECT id FROM maalrise_investor_fundings WHERE reference = 'RF-2');
  -- Active: refused, reopen first
  PERFORM pg_temp.as_user('admin');
  e := pg_temp.err(format('SELECT maalrise_refund_funding(%L, %L)', fb, '{"refunded_on":"2020-01-01","reference":"x","reason":"y"}'));
  IF e NOT LIKE '%only before the Cycle is activated%reopen it first%' THEN RAISE EXCEPTION 'TEST FAIL R48: refund on an active Cycle: %', e; END IF;
  PERFORM pg_temp.as_user('sa');
  PERFORM maalrise_reopen_cycle(c, 'Investor Two asked for a refund');

  -- Roles, and every detail required
  FOREACH e IN ARRAY ARRAY['ops', 'fin', 'two'] LOOP
    PERFORM pg_temp.as_user(e);
    IF pg_temp.err(format('SELECT maalrise_refund_funding(%L, %L)', fb, jsonb_build_object('refunded_on', CURRENT_DATE, 'reference', 'R', 'reason', 'r')))
       IS DISTINCT FROM 'Unauthorized' THEN RAISE EXCEPTION 'TEST FAIL R48: % recorded a refund', e; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('admin');
  IF pg_temp.err(format('SELECT maalrise_refund_funding(%L, %L)', fb, jsonb_build_object('refunded_on', CURRENT_DATE + 3, 'reference', 'R', 'reason', 'r'))) NOT LIKE '%future%'
     OR pg_temp.err(format('SELECT maalrise_refund_funding(%L, %L)', fb, jsonb_build_object('refunded_on', CURRENT_DATE - 30, 'reference', 'R', 'reason', 'r'))) NOT LIKE '%before the money was received%'
     OR pg_temp.err(format('SELECT maalrise_refund_funding(%L, %L)', fb, jsonb_build_object('refunded_on', CURRENT_DATE, 'reference', ' ', 'reason', 'r'))) NOT LIKE '%bank reference%'
     OR pg_temp.err(format('SELECT maalrise_refund_funding(%L, %L)', fb, jsonb_build_object('refunded_on', CURRENT_DATE, 'reference', 'R', 'reason', ''))) NOT LIKE '%reason is required%'
     OR pg_temp.err(format('SELECT maalrise_refund_funding(%L, %L)', fb, '{"reference":"R","reason":"r"}')) NOT LIKE '%date of the refund%' THEN
    RAISE EXCEPTION 'TEST FAIL R48: incomplete refunds were not refused'; END IF;

  -- The refund: Investor Two leaves; the entry is kept, marked refunded
  PERFORM maalrise_refund_funding(fb, jsonb_build_object('refunded_on', CURRENT_DATE, 'reference', 'TRF-REFUND-2', 'reason', 'Asked for a refund before the start'));
  IF (SELECT status || ':' || refund_reference || ':' || (refunded_by IS NOT NULL)::TEXT FROM maalrise_investor_fundings WHERE id = fb)
     <> 'refunded:TRF-REFUND-2:true' THEN RAISE EXCEPTION 'TEST FAIL R48: entry not marked refunded'; END IF;
  IF EXISTS (SELECT 1 FROM maalrise_allocations WHERE cycle_id = c AND maalrise_investor_id = b)
     OR (SELECT SUM(units) FROM maalrise_allocations WHERE cycle_id = c) <> 600 THEN
    RAISE EXCEPTION 'TEST FAIL R48: Investor Two''s units still allocated'; END IF;
  IF pg_temp.err(format('SELECT maalrise_refund_funding(%L, %L)', fb, jsonb_build_object('refunded_on', CURRENT_DATE, 'reference', 'R', 'reason', 'r'))) NOT LIKE '%Only confirmed funding can be refunded%' THEN
    RAISE EXCEPTION 'TEST FAIL R48: refunded twice'; END IF;
  PERFORM pg_temp.as_user('fin');
  IF pg_temp.err(format('SELECT maalrise_record_funding(%L, %L, 400, 40000000, CURRENT_DATE, %L)', c, b, 'rf-2')) NOT LIKE '%duplicate key%'
     AND pg_temp.err(format('SELECT maalrise_record_funding(%L, %L, 400, 40000000, CURRENT_DATE, %L)', c, b, 'rf-2')) NOT LIKE '%unique%' THEN
    RAISE EXCEPTION 'TEST FAIL R48: the refunded reference could be used again'; END IF;
  PERFORM pg_temp.as_user('admin');
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'maalrise_refund_funding' AND entity_id = fb::TEXT
                   AND new_values->>'reference' = 'TRF-REFUND-2') THEN RAISE EXCEPTION 'TEST FAIL R48: refund not audited'; END IF;

  -- A partial holding: Investor One had two entries; refunding one leaves the other
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, a, 100, 10000000, CURRENT_DATE, 'RF-1b');
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_confirm_funding(f);
  PERFORM maalrise_refund_funding(f, jsonb_build_object('refunded_on', CURRENT_DATE, 'reference', 'TRF-1b', 'reason', 'Part refund'));
  IF (SELECT units || ':' || capital_kobo FROM maalrise_allocations WHERE cycle_id = c AND maalrise_investor_id = a) <> '600:60000000' THEN
    RAISE EXCEPTION 'TEST FAIL R48: part refund left the wrong allocation'; END IF;

  -- Activation is refused until the cost matches; a new version at ₦600,000 settles it
  e := pg_temp.err(format('SELECT maalrise_activate_cycle(%L)', c));
  IF e NOT LIKE '%Funding shortfall%' THEN RAISE EXCEPTION 'TEST FAIL R48: activated with a shortfall: %', e; END IF;
  PERFORM pg_temp.as_user('ops');
  t2 := maalrise_save_terms(c, '{"cost_kobo":60000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":61800000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":1800000,"sale_price_kobo":61800000,"fee_kobo":59940,
    "investor_pool_kobo":1740060,"counterparty_total_kobo":61800000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 580020, 'fee_kobo', 19980,
       'counterparty_gross_kobo', 600000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(t2);
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(t2);
  PERFORM maalrise_activate_cycle(c);
  PERFORM pg_temp.as_user('two');
  IF maalrise_my_cycles() <> '[]'::JSONB THEN RAISE EXCEPTION 'TEST FAIL R48: the refunded investor still sees the Cycle'; END IF;
  PERFORM pg_temp.as_user('one');
  IF (maalrise_my_cycles()->0->>'units')::INT <> 600 THEN RAISE EXCEPTION 'TEST FAIL R48: Investor One''s holding wrong'; END IF;
  RAISE NOTICE 'PASS R48: refunds before activation (approvers, date/reference/reason); units leave the Cycle; entry kept; reactivated at the lower cost';
END $$;
ROLLBACK;
