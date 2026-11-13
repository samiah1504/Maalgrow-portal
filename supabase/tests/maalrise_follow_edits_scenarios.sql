-- ============================================================
-- MaalRise 063 — MaalRise follows the investor Edit page — scenarios
-- Scratch database only (051–063). Everything ROLLS BACK.
--
--   R50 a MaalRise investor's login email, name and phone changed on
--       the MaalGrow Edit page reach MaalRise; a MaalGrow-only edit is
--       unaffected; bank details moved by an administrator are used and
--       confirmed in MaalRise, an unpaid payment moves to the new
--       account, operations cannot do it, and the follower is not
--       callable from the API
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000e801', 'admin@fe.com'), ('a0000000-0000-0000-0000-00000000e802', 'ops@fe.com'),
 ('a0000000-0000-0000-0000-00000000e803', 'fin@fe.com'),
 ('10000000-0000-0000-0000-00000000e811', 'rise@fe.com'), ('10000000-0000-0000-0000-00000000e812', 'grow@fe.com')
ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000e801', 'admin@fe.com', 'FE Admin', 'administrator'),
 ('a0000000-0000-0000-0000-00000000e802', 'ops@fe.com', 'FE Ops', 'operations'),
 ('a0000000-0000-0000-0000-00000000e803', 'fin@fe.com', 'FE Fin', 'finance'),
 ('10000000-0000-0000-0000-00000000e811', 'rise@fe.com', 'Rise Only', 'investor'),
 ('10000000-0000-0000-0000-00000000e812', 'grow@fe.com', 'Grow Only', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;
-- Both have a MaalGrow investor record (MaalRise-only people get one for the KYC form)
INSERT INTO investors (id, profile_id, investor_code, full_name, email, phone, kyc_status) VALUES
 ('20000000-0000-0000-0000-00000000e811', '10000000-0000-0000-0000-00000000e811', 'MG-FE0001', 'Rise Only', 'rise@fe.com', '0800000001', 'pending'),
 ('20000000-0000-0000-0000-00000000e812', '10000000-0000-0000-0000-00000000e812', 'MG-FE0002', 'Grow Only', 'grow@fe.com', '0800000002', 'pending');
CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000e801'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000e802' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000e803'
    WHEN 'none' THEN '' END, true);
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE c UUID; t UUID; x UUID; f UUID; r UUID; d UUID; res JSONB; e TEXT; g_before TEXT;
BEGIN
  PERFORM pg_temp.as_user('ops');
  c := maalrise_create_cycle(jsonb_build_object('name', 'Follow Edits Cycle', 'transaction_name', 'Murabaha',
    'counterparty_id', maalrise_create_counterparty('{"name":"Follow Co"}'), 'start_date', (CURRENT_DATE - 35)::TEXT,
    'duration_months', 3, 'unit_price_kobo', 100000));
  t := maalrise_save_terms(c, '{"cost_kobo":100000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":103000000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":3000000,"sale_price_kobo":103000000,"fee_kobo":99900,
    "investor_pool_kobo":2900100,"counterparty_total_kobo":103000000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 966700, 'fee_kobo', 33300,
       'counterparty_gross_kobo', 1000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(t);
  x := maalrise_add_investor('10000000-0000-0000-0000-00000000e811',
         '{"full_name":"Rise Only","bank_name":"Access","account_name":"Rise Only","account_number":"0111111111"}');
  PERFORM maalrise_confirm_bank_details(x);
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', c, 'category', 'contract', 'name', 'c.pdf',
    'storage_path', 'maalrise/fe/c.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10, 'visible_to_investors', true));
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(t);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, x, 1000, 100000000, CURRENT_DATE - 36, 'FE-1');
  PERFORM pg_temp.as_user('admin'); PERFORM maalrise_confirm_funding(f);
  PERFORM maalrise_activate_cycle(c);
  PERFORM pg_temp.as_user('fin');
  r := maalrise_record_receipt(c, jsonb_build_object('period', 1, 'amount_kobo', 1000000, 'received_on', CURRENT_DATE));
  PERFORM pg_temp.as_user('admin');
  d := maalrise_confirm_receipt(r);
  PERFORM maalrise_approve_distribution(d);
  IF (SELECT status || ':' || account_number FROM maalrise_distribution_lines WHERE distribution_id = d) <> 'payable:0111111111' THEN
    RAISE EXCEPTION 'TEST FAIL R50: setup: the payment should be payable to the first account'; END IF;

  -- The Edit page runs with the service role (no signed-in user), as here
  PERFORM pg_temp.as_user('none');

  -- 1. Email: the login and profile change together (admin_set_investor_email + auth)
  UPDATE profiles SET email = 'Rise.New@FE.com ' WHERE id = '10000000-0000-0000-0000-00000000e811';
  IF (SELECT email FROM maalrise_investors WHERE id = x) <> 'rise.new@fe.com' THEN
    RAISE EXCEPTION 'TEST FAIL R50: the MaalRise email did not follow the login (%)', (SELECT email FROM maalrise_investors WHERE id = x); END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'maalrise_email_from_login' AND entity_id = x::TEXT
                 AND old_values->>'email' = 'rise@fe.com') THEN
    RAISE EXCEPTION 'TEST FAIL R50: the email change was not audited'; END IF;

  -- 2. Name and phone
  UPDATE investors SET full_name = 'Rise Renamed', phone = '0809999999' WHERE id = '20000000-0000-0000-0000-00000000e811';
  IF (SELECT full_name || ':' || phone FROM maalrise_investors WHERE id = x) <> 'Rise Renamed:0809999999' THEN
    RAISE EXCEPTION 'TEST FAIL R50: name and phone did not follow'; END IF;
  UPDATE investors SET full_name = '  ' WHERE id = '20000000-0000-0000-0000-00000000e811';
  IF (SELECT full_name FROM maalrise_investors WHERE id = x) <> 'Rise Renamed' THEN
    RAISE EXCEPTION 'TEST FAIL R50: a blank name must never reach MaalRise'; END IF;
  UPDATE investors SET full_name = 'Rise Renamed' WHERE id = '20000000-0000-0000-0000-00000000e811';

  -- A MaalGrow-only investor's edits work as before and touch nothing in MaalRise
  UPDATE investors SET full_name = 'Grow Renamed', phone = '0807777777' WHERE id = '20000000-0000-0000-0000-00000000e812';
  UPDATE profiles SET email = 'grow.new@fe.com' WHERE id = '10000000-0000-0000-0000-00000000e812';
  IF (SELECT full_name || phone FROM investors WHERE id = '20000000-0000-0000-0000-00000000e812') <> 'Grow Renamed0807777777' THEN
    RAISE EXCEPTION 'TEST FAIL R50: a MaalGrow-only edit was affected'; END IF;

  -- 3. Bank details moved on the Edit page
  UPDATE investors SET bank_name = 'GTB', account_name = 'Rise Renamed', account_number = '0222222222'
   WHERE id = '20000000-0000-0000-0000-00000000e811';
  IF (SELECT account_number FROM maalrise_investors WHERE id = x) <> '0111111111' THEN
    RAISE EXCEPTION 'TEST FAIL R50: a bank edit alone must not change MaalRise (only the admin follower does)'; END IF;
  e := pg_temp.err($q$SELECT maalrise_bank_from_maalgrow_edit('20000000-0000-0000-0000-00000000e811', 'a0000000-0000-0000-0000-00000000e802')$q$);
  IF e IS NULL OR e NOT LIKE '%Only a super admin or administrator%' THEN
    RAISE EXCEPTION 'TEST FAIL R50: operations should not be able to move bank details (%)', e; END IF;
  g_before := (SELECT bank_name || account_name || account_number || kyc_status::TEXT FROM investors WHERE id = '20000000-0000-0000-0000-00000000e811');
  res := maalrise_bank_from_maalgrow_edit('20000000-0000-0000-0000-00000000e811', 'a0000000-0000-0000-0000-00000000e801');
  IF res->>'updated' <> 'true' OR (res->>'moved')::INT <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R50: the admin bank change should apply and move one unpaid payment (%)', res; END IF;
  IF (SELECT bank_name || ':' || account_number || ':' || (bank_confirmed_by = 'a0000000-0000-0000-0000-00000000e801')::TEXT
        FROM maalrise_investors WHERE id = x) <> 'GTB:0222222222:true' THEN
    RAISE EXCEPTION 'TEST FAIL R50: MaalRise should use the new account, confirmed by the admin'; END IF;
  IF (SELECT status || ':' || account_number FROM maalrise_distribution_lines WHERE distribution_id = d) <> 'payable:0222222222' THEN
    RAISE EXCEPTION 'TEST FAIL R50: the unpaid payment should now go to the new account (%)',
      (SELECT status || ':' || COALESCE(account_number, '-') FROM maalrise_distribution_lines WHERE distribution_id = d); END IF;
  IF (SELECT COUNT(*) FROM maalrise_bank_details_history WHERE maalrise_investor_id = x AND account_number = '0222222222'
        AND actor = 'a0000000-0000-0000-0000-00000000e801') <> 2
     OR NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'maalrise_bank_from_maalgrow_edit' AND entity_id = x::TEXT
                    AND new_values->>'by' = 'a0000000-0000-0000-0000-00000000e801') THEN
    RAISE EXCEPTION 'TEST FAIL R50: the bank change should be in the history and the audit log'; END IF;
  IF (SELECT bank_name || account_name || account_number || kyc_status::TEXT FROM investors WHERE id = '20000000-0000-0000-0000-00000000e811') <> g_before THEN
    RAISE EXCEPTION 'TEST FAIL R50: the MaalGrow record was changed by the follower'; END IF;
  res := maalrise_bank_from_maalgrow_edit('20000000-0000-0000-0000-00000000e811', 'a0000000-0000-0000-0000-00000000e801');
  IF res->>'reason' <> 'unchanged' THEN RAISE EXCEPTION 'TEST FAIL R50: a repeat should change nothing (%)', res; END IF;
  res := maalrise_bank_from_maalgrow_edit('20000000-0000-0000-0000-00000000e812', 'a0000000-0000-0000-0000-00000000e801');
  IF res->>'reason' <> 'not_maalrise' THEN RAISE EXCEPTION 'TEST FAIL R50: a MaalGrow-only investor has no MaalRise bank (%)', res; END IF;

  -- Paid payments keep the account they went to
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_mark_line_paid((SELECT id FROM maalrise_distribution_lines WHERE distribution_id = d), CURRENT_DATE, 'FE-PAID');
  PERFORM pg_temp.as_user('none');
  UPDATE investors SET account_number = '0333333333' WHERE id = '20000000-0000-0000-0000-00000000e811';
  res := maalrise_bank_from_maalgrow_edit('20000000-0000-0000-0000-00000000e811', 'a0000000-0000-0000-0000-00000000e801');
  IF (res->>'moved')::INT <> 0 OR (SELECT status || ':' || account_number FROM maalrise_distribution_lines WHERE distribution_id = d) <> 'paid:0222222222' THEN
    RAISE EXCEPTION 'TEST FAIL R50: a paid payment must keep its account (%)', res; END IF;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated')
     AND has_function_privilege('authenticated', 'maalrise_bank_from_maalgrow_edit(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'TEST FAIL R50: the bank follower is callable from the API'; END IF;
  RAISE NOTICE 'PASS R50: email, name and phone follow the Edit page; MaalGrow-only edits unaffected; admin bank change used and confirmed in MaalRise, unpaid payment moved, paid kept; operations refused; not callable from the API';
END $$;
ROLLBACK;
