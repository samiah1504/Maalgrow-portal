-- ============================================================
-- MaalRise 061 — moving funding credited to the wrong investor — scenarios
-- Scratch database only (051–061). Everything ROLLS BACK.
--
--   R48 refused while active (reopen first); approvers only, with a
--       reason; part of an entry (split) or all of it moves to the right
--       investor; allocations follow; the Cycle total is unchanged;
--       audited; the Cycle activates again on the same terms
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000c901', 'admin@mv.com'), ('a0000000-0000-0000-0000-00000000c902', 'ops@mv.com'),
 ('a0000000-0000-0000-0000-00000000c903', 'fin@mv.com'), ('a0000000-0000-0000-0000-00000000c904', 'sup@mv.com'),
 ('b0000000-0000-0000-0000-00000000c905', 'officer@mv.com'), ('a0000000-0000-0000-0000-00000000c906', 'sa@mv.com'), ('10000000-0000-0000-0000-00000000c913', 'three@mv.com'),
 ('10000000-0000-0000-0000-00000000c911', 'one@mv.com'), ('10000000-0000-0000-0000-00000000c912', 'two@mv.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000c901', 'admin@mv.com', 'VA Admin', 'administrator'),
 ('a0000000-0000-0000-0000-00000000c902', 'ops@mv.com', 'VA Ops', 'operations'),
 ('a0000000-0000-0000-0000-00000000c903', 'fin@mv.com', 'VA Fin', 'finance'),
 ('a0000000-0000-0000-0000-00000000c904', 'sup@mv.com', 'VA Support', 'customer_support'),
 ('b0000000-0000-0000-0000-00000000c905', 'officer@mv.com', 'VA Officer', 'payment_officer'),
 ('a0000000-0000-0000-0000-00000000c906', 'sa@mv.com', 'RO Super', 'super_admin'),
 ('10000000-0000-0000-0000-00000000c913', 'three@mv.com', 'Investor Three', 'investor'),
 ('10000000-0000-0000-0000-00000000c911', 'one@mv.com', 'Investor One', 'investor'),
 ('10000000-0000-0000-0000-00000000c912', 'two@mv.com', 'Investor Two', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;
CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000c901'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000c902' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000c903'
    WHEN 'sup' THEN 'a0000000-0000-0000-0000-00000000c904' WHEN 'officer' THEN 'b0000000-0000-0000-0000-00000000c905'
    WHEN 'one' THEN '10000000-0000-0000-0000-00000000c911' WHEN 'two' THEN '10000000-0000-0000-0000-00000000c912' WHEN 'three' THEN '10000000-0000-0000-0000-00000000c913'
    WHEN 'sa' THEN 'a0000000-0000-0000-0000-00000000c906' END, true);
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE c UUID; t UUID; a UUID; b UUID; x UUID; f UUID; e TEXT; fa UUID; fb UUID; n UUID;
BEGIN
  -- An activated Cycle of ₦1,000,000 (1,000 units of ₦1,000) — the real cost was ₦1,500,000 and Investor Three is missing.
  PERFORM pg_temp.as_user('ops');
  c := maalrise_create_cycle(jsonb_build_object('name', 'Move Cycle', 'transaction_name', 'Murabaha',
    'counterparty_id', maalrise_create_counterparty('{"name":"Move Co"}'), 'start_date', CURRENT_DATE::TEXT,
    'duration_months', 3, 'unit_price_kobo', 100000));
  t := maalrise_save_terms(c, '{"cost_kobo":100000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":103000000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":3000000,"sale_price_kobo":103000000,"fee_kobo":99900,
    "investor_pool_kobo":2900100,"counterparty_total_kobo":103000000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 966700, 'fee_kobo', 33300,
       'counterparty_gross_kobo', 1000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(t);
  a := maalrise_add_investor('10000000-0000-0000-0000-00000000c911', '{"full_name":"Investor One"}');
  b := maalrise_add_investor('10000000-0000-0000-0000-00000000c912', '{"full_name":"Investor Two"}');
  x := maalrise_add_investor('10000000-0000-0000-0000-00000000c913', '{"full_name":"Investor Three"}');
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', c, 'category', 'contract', 'name', 'c.pdf',
    'storage_path', 'maalrise/mv/c.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10, 'visible_to_investors', true));
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(t);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, a, 600, 60000000, CURRENT_DATE, 'MV-1');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, b, 400, 40000000, CURRENT_DATE, 'MV-2');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM maalrise_activate_cycle(c);

  fa := (SELECT id FROM maalrise_investor_fundings WHERE reference = 'MV-1');   -- One: 600 units
  fb := (SELECT id FROM maalrise_investor_fundings WHERE reference = 'MV-2');   -- Two: 400 units
  -- Active: refused; reopen first
  PERFORM pg_temp.as_user('admin');
  e := pg_temp.err(format('SELECT maalrise_move_funding(%L, %L, 2, %L)', fa, x, 'wrong investor'));
  IF e NOT LIKE '%only before the Cycle is activated%reopen it first%' THEN RAISE EXCEPTION 'TEST FAIL R48: moved on an active Cycle: %', e; END IF;
  PERFORM pg_temp.as_user('sa');
  PERFORM maalrise_reopen_cycle(c, '2 units were credited to the wrong investor');

  -- Roles and rules
  FOREACH e IN ARRAY ARRAY['ops', 'fin', 'one'] LOOP
    PERFORM pg_temp.as_user(e);
    IF pg_temp.err(format('SELECT maalrise_move_funding(%L, %L, 2, %L)', fa, x, 'r')) IS DISTINCT FROM 'Unauthorized' THEN
      RAISE EXCEPTION 'TEST FAIL R48: % moved funding', e; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('admin');
  IF pg_temp.err(format('SELECT maalrise_move_funding(%L, %L, 2, %L)', fa, x, ' ')) NOT LIKE 'A reason is required'
     OR pg_temp.err(format('SELECT maalrise_move_funding(%L, %L, 0, %L)', fa, x, 'r')) NOT LIKE 'Units to move must be between 1 and 600%'
     OR pg_temp.err(format('SELECT maalrise_move_funding(%L, %L, 601, %L)', fa, x, 'r')) NOT LIKE 'Units to move must be between 1 and 600%'
     OR pg_temp.err(format('SELECT maalrise_move_funding(%L, %L, 2, %L)', fa, a, 'r')) NOT LIKE '%already with this investor%'
     OR pg_temp.err(format('SELECT maalrise_move_funding(%L, %L, 2, %L)', fa, gen_random_uuid(), 'r')) NOT LIKE 'Choose the investor%' THEN
    RAISE EXCEPTION 'TEST FAIL R48: bad moves were not refused'; END IF;

  -- Part of an entry: 2 of Investor One's 600 units belong to Investor Three
  n := maalrise_move_funding(fa, x, 2, '2 units were Investor Three''s, credited to Investor One by mistake');
  IF n = fa THEN RAISE EXCEPTION 'TEST FAIL R48: a part move should split the entry'; END IF;
  IF (SELECT units || ':' || amount_kobo || ':' || status FROM maalrise_investor_fundings WHERE id = fa) <> '598:59800000:confirmed'
     OR (SELECT maalrise_investor_id::TEXT || ':' || units || ':' || amount_kobo || ':' || status || ':' || reference || ':' || received_on::TEXT
           FROM maalrise_investor_fundings WHERE id = n) <> x::TEXT || ':2:200000:confirmed:MV-1/moved:' || CURRENT_DATE::TEXT THEN
    RAISE EXCEPTION 'TEST FAIL R48: split wrong'; END IF;
  IF (SELECT string_agg(i.full_name || '=' || a2.units || '/' || a2.capital_kobo, ',' ORDER BY i.full_name)
        FROM maalrise_allocations a2 JOIN maalrise_investors i ON i.id = a2.maalrise_investor_id WHERE a2.cycle_id = c)
     <> 'Investor One=598/59800000,Investor Three=2/200000,Investor Two=400/40000000' THEN
    RAISE EXCEPTION 'TEST FAIL R48: allocations wrong after the part move'; END IF;

  -- A whole entry: Investor Two's 400 units were all Investor Three's
  n := maalrise_move_funding(fb, x, 400, 'Whole entry was Investor Three''s');
  IF n <> fb OR (SELECT maalrise_investor_id FROM maalrise_investor_fundings WHERE id = fb) <> x
     OR EXISTS (SELECT 1 FROM maalrise_allocations WHERE cycle_id = c AND maalrise_investor_id = b)
     OR (SELECT units FROM maalrise_allocations WHERE cycle_id = c AND maalrise_investor_id = x) <> 402 THEN
    RAISE EXCEPTION 'TEST FAIL R48: whole-entry move wrong'; END IF;

  -- Totals unchanged; every move recorded; activate again with the same terms
  IF (SELECT SUM(units) FROM maalrise_allocations WHERE cycle_id = c) <> 1000
     OR (SELECT SUM(amount_kobo) FROM maalrise_investor_fundings WHERE cycle_id = c AND status = 'confirmed') <> 100000000 THEN
    RAISE EXCEPTION 'TEST FAIL R48: the Cycle total changed'; END IF;
  IF (SELECT COUNT(*) FROM audit_logs WHERE action = 'maalrise_move_funding' AND new_values->>'reason' IS NOT NULL) <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL R48: moves not audited'; END IF;
  PERFORM maalrise_activate_cycle(c);
  PERFORM pg_temp.as_user('three');
  IF (maalrise_my_cycles()->0->>'units')::INT <> 402 THEN RAISE EXCEPTION 'TEST FAIL R48: Investor Three does not see 402 units'; END IF;
  PERFORM pg_temp.as_user('two');
  IF maalrise_my_cycles() <> '[]'::JSONB THEN RAISE EXCEPTION 'TEST FAIL R48: Investor Two still sees the Cycle'; END IF;
  PERFORM pg_temp.as_user('one');
  IF (maalrise_my_cycles()->0->>'units')::INT <> 598 THEN RAISE EXCEPTION 'TEST FAIL R48: Investor One should hold 598'; END IF;
  RAISE NOTICE 'PASS R48: units moved to the right investor (part or whole entry) before activation; allocations follow; totals unchanged; audited';
END $$;
ROLLBACK;
