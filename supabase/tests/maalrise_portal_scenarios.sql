-- ============================================================
-- MaalRise investor portal (054) — scenarios
--
-- Run ONLY against a scratch database built from the stub and the
-- migrations (051–054). Everything ROLLS BACK at the end.
--
--   R32 an investor sees their own Cycle: dates, units, capital and
--       expected profit per month by the distribution rule (largest
--       remainder); never cost, markup, fee or other investors; others
--       see nothing
--   R33 direct table reads: an investor can no longer read the Cycle's
--       terms, schedule, Cycle row, own MaalRise record or KYC notes
--   R34 month status follows the money: due → processing → approved →
--       paid (only once marked paid) and part_paid; payment history
--       shows the last four digits of the account only
--   R35 bank detail changes: investor requests; one at a time; staff
--       approve (becomes the confirmed account) or reject with a
--       reason; investor may cancel their own; decisions are final
--   R36 investor notifications for payments and bank decisions
--   R37 helper not callable; product access; no direct writes;
--       MaalGrow untouched; audited; email drafts only
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000d001', 'sa@d.com'),
 ('a0000000-0000-0000-0000-00000000d002', 'admin@d.com'),
 ('a0000000-0000-0000-0000-00000000d003', 'ops@d.com'),
 ('a0000000-0000-0000-0000-00000000d004', 'fin@d.com'),
 ('b0000000-0000-0000-0000-00000000d001', 'officer@d.com'),
 ('10000000-0000-0000-0000-00000000d101', 'pinv1@d.com'),
 ('10000000-0000-0000-0000-00000000d102', 'pinv2@d.com'),
 ('10000000-0000-0000-0000-00000000d103', 'pinv3@d.com'),
 ('10000000-0000-0000-0000-00000000d104', 'pinv4@d.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000d001', 'sa@d.com',      'D Super Admin', 'super_admin'),
 ('a0000000-0000-0000-0000-00000000d002', 'admin@d.com',   'D Admin',       'administrator'),
 ('a0000000-0000-0000-0000-00000000d003', 'ops@d.com',     'D Ops',         'operations'),
 ('a0000000-0000-0000-0000-00000000d004', 'fin@d.com',     'D Finance',     'finance'),
 ('b0000000-0000-0000-0000-00000000d001', 'officer@d.com', 'D Officer',     'payment_officer'),
 ('10000000-0000-0000-0000-00000000d101', 'pinv1@d.com',   'Portal One',    'investor'),
 ('10000000-0000-0000-0000-00000000d102', 'pinv2@d.com',   'Portal Two',    'investor'),
 ('10000000-0000-0000-0000-00000000d103', 'pinv3@d.com',   'Portal Three',  'investor'),
 ('10000000-0000-0000-0000-00000000d104', 'pinv4@d.com',   'Portal Four',   'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, email = EXCLUDED.email;

CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON ids TO authenticated;
CREATE TEMP TABLE before_counts AS
  SELECT (SELECT COUNT(*) FROM investors) AS investors, (SELECT COUNT(*) FROM payment_requests) AS payment_requests,
         (SELECT COUNT(*) FROM notifications) AS notifications, (SELECT COUNT(*) FROM investments) AS investments;

CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p
    WHEN 'sa' THEN 'a0000000-0000-0000-0000-00000000d001' WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000d002'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000d003' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000d004'
    WHEN 'officer' THEN 'b0000000-0000-0000-0000-00000000d001'
    WHEN 'inv1' THEN '10000000-0000-0000-0000-00000000d101' WHEN 'inv2' THEN '10000000-0000-0000-0000-00000000d102'
    WHEN 'inv3' THEN '10000000-0000-0000-0000-00000000d103' WHEN 'inv4' THEN '10000000-0000-0000-0000-00000000d104' END, true);
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION pg_temp.fails(p_sql TEXT) RETURNS BOOLEAN AS $$ SELECT pg_temp.err(p_sql) IS NOT NULL; $$ LANGUAGE sql;
CREATE FUNCTION pg_temp.month(p_cycle JSONB, p_period INTEGER) RETURNS JSONB AS $$
  SELECT m FROM jsonb_array_elements(p_cycle->'months') m WHERE (m->>'period')::INTEGER = p_period;
$$ LANGUAGE sql;

-- ₦1,000,000 cost at ₦1,000 a unit (1,000 units), 3% total markup,
-- 3.33% of the markup deducted, 3 months: each month ₦10,000 gross =
-- ₦333 fee + ₦9,667 to investors (966,700 kobo = 966.7 kobo a unit).
-- Holdings 333 / 334 / 333 units → expected 321,911 / 322,878 / 321,911
-- kobo a month (the one leftover kobo goes to the largest remainder).
-- Started a month and six days ago: month 1 was due six days ago.
DO $$
DECLARE v_cycle UUID; v_terms UUID; v_start DATE := (maalrise_today() - INTERVAL '1 month' - INTERVAL '6 days')::DATE; f UUID;
BEGIN
  PERFORM pg_temp.as_user('ops');
  INSERT INTO ids VALUES ('cp', maalrise_create_counterparty('{"name":"Portal Counterparty Ltd"}'));
  v_cycle := maalrise_create_cycle(jsonb_build_object('name', 'Portal Test', 'transaction_name', 'Murabaha',
    'counterparty_id', (SELECT v FROM ids WHERE k = 'cp'), 'start_date', v_start, 'duration_months', 3, 'unit_price_kobo', 100000));
  INSERT INTO ids VALUES ('c', v_cycle);
  v_terms := maalrise_save_terms(v_cycle,
    '{"cost_kobo":100000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":103000000,
      "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
      "markup_kobo":3000000,"sale_price_kobo":103000000,"fee_kobo":99900,
      "investor_pool_kobo":2900100,"counterparty_total_kobo":103000000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 966700, 'fee_kobo', 33300,
       'counterparty_gross_kobo', 1000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(v_terms);
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(v_terms);
  PERFORM pg_temp.as_user('ops');
  INSERT INTO ids VALUES ('i1', maalrise_add_investor('10000000-0000-0000-0000-00000000d101', '{"bank_name":"GTB","account_name":"Portal One","account_number":"4000000001"}'));
  INSERT INTO ids VALUES ('i2', maalrise_add_investor('10000000-0000-0000-0000-00000000d102', '{"bank_name":"Access","account_name":"Portal Two","account_number":"4000000002"}'));
  INSERT INTO ids VALUES ('i3', maalrise_add_investor('10000000-0000-0000-0000-00000000d103', '{"bank_name":"Zenith","account_name":"Portal Three","account_number":"4000000003"}'));
  INSERT INTO ids VALUES ('i4', maalrise_add_investor('10000000-0000-0000-0000-00000000d104', '{"bank_name":"UBA","account_name":"Portal Four","account_number":"4000000004"}'));
  FOR f IN SELECT v FROM ids WHERE k IN ('i1', 'i2', 'i3', 'i4') LOOP
    PERFORM maalrise_record_kyc_submission(f, '{"id_type":"NIN","id_number":"1"}');
    PERFORM maalrise_review_kyc(f, 'verified', 'Staff-only KYC note');
    PERFORM maalrise_confirm_bank_details(f);
  END LOOP;
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', v_cycle, 'category', 'contract', 'name', 'P.pdf',
    'storage_path', 'test/portal/contract.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10));
  PERFORM pg_temp.as_user('fin');
  INSERT INTO ids VALUES ('f1', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'i1'), 333, 33300000, v_start - 1, 'PF-1'));
  INSERT INTO ids VALUES ('f2', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'i2'), 334, 33400000, v_start - 1, 'PF-2'));
  INSERT INTO ids VALUES ('f3', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'i3'), 333, 33300000, v_start - 1, 'PF-3'));
  PERFORM pg_temp.as_user('sa');
  FOR f IN SELECT v FROM ids WHERE k IN ('f1', 'f2', 'f3') LOOP PERFORM maalrise_confirm_funding(f); END LOOP;
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_activate_cycle(v_cycle);
  -- A second Cycle that is never activated: invisible to investors.
  PERFORM pg_temp.as_user('ops');
  INSERT INTO ids VALUES ('draft', maalrise_create_cycle(jsonb_build_object('name', 'Portal Draft', 'transaction_name', 'Murabaha',
    'counterparty_id', (SELECT v FROM ids WHERE k = 'cp'), 'start_date', v_start, 'duration_months', 3, 'unit_price_kobo', 100000)));
END $$;

-- ------------------------------------------------------------
-- R32 — what an investor sees
-- ------------------------------------------------------------
DO $$
DECLARE c UUID := (SELECT v FROM ids WHERE k = 'c'); j JSONB; t TEXT; p TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  j := maalrise_my_cycle(c);
  RESET ROLE;
  IF j IS NULL THEN RAISE EXCEPTION 'TEST FAIL R32: investor cannot see own Cycle'; END IF;
  IF (j->>'units')::INTEGER <> 333 OR (j->>'capital_kobo')::BIGINT <> 33300000 OR j->>'counterparty_name' <> 'Portal Counterparty Ltd'
     OR (j->>'maturity_date')::DATE <> maalrise_maturity_date(c) OR j->>'status' <> 'active' THEN
    RAISE EXCEPTION 'TEST FAIL R32: header wrong: %', j; END IF;
  IF jsonb_array_length(j->'months') <> 3 OR EXISTS (SELECT 1 FROM jsonb_array_elements(j->'months') m
                                                     WHERE (m->>'expected_kobo')::BIGINT <> 321911) THEN
    RAISE EXCEPTION 'TEST FAIL R32: inv1 expected profit wrong: %', j->'months'; END IF;
  IF pg_temp.month(j, 1)->>'status' <> 'due' OR pg_temp.month(j, 2)->>'status' <> 'scheduled' THEN
    RAISE EXCEPTION 'TEST FAIL R32: initial month status wrong: %', j->'months'; END IF;
  IF j->'capital'->>'status' <> 'scheduled' OR (j->'capital'->>'expected_kobo')::BIGINT <> 33300000 THEN
    RAISE EXCEPTION 'TEST FAIL R32: capital wrong: %', j->'capital'; END IF;
  -- Nothing beyond the investor's own figures.
  t := j::TEXT;
  IF t ~* '(cost|markup|fee|pool|gross|sale_price|Portal Two|Portal Three|4000000002|kyc|note)' THEN
    RAISE EXCEPTION 'TEST FAIL R32: investor view leaks: %', t; END IF;

  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv2');
  j := maalrise_my_cycle(c);
  RESET ROLE;
  IF (pg_temp.month(j, 1)->>'expected_kobo')::BIGINT <> 322878 THEN
    RAISE EXCEPTION 'TEST FAIL R32: largest remainder not applied to inv2: %', pg_temp.month(j, 1); END IF;

  SET LOCAL ROLE authenticated;
  FOREACH p IN ARRAY ARRAY['inv4', 'sa', 'officer'] LOOP
    PERFORM pg_temp.as_user(p);
    IF maalrise_my_cycle(c) IS NOT NULL OR maalrise_my_cycles() <> '[]'::JSONB OR maalrise_my_payments() <> '[]'::JSONB THEN
      RESET ROLE; RAISE EXCEPTION 'TEST FAIL R32: % sees a Cycle they hold nothing in', p; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('sa');
  IF maalrise_my_profile() IS NOT NULL THEN RESET ROLE; RAISE EXCEPTION 'TEST FAIL R32: staff has a MaalRise investor profile'; END IF;
  PERFORM pg_temp.as_user('inv1');
  IF maalrise_my_cycle((SELECT v FROM ids WHERE k = 'draft')) IS NOT NULL OR jsonb_array_length(maalrise_my_cycles()) <> 1 THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R32: an unactivated Cycle is visible'; END IF;
  j := maalrise_my_profile();
  RESET ROLE;
  IF j->>'investor_code' IS NULL OR j->'bank'->>'account_number' <> '4000000001' OR NOT (j->'bank'->>'confirmed')::BOOLEAN
     OR j->>'kyc_status' <> 'verified' OR j::TEXT ~* 'note' THEN
    RAISE EXCEPTION 'TEST FAIL R32: profile wrong: %', j; END IF;
  RAISE NOTICE 'PASS R32: investor sees own Cycle, expected profit by largest remainder, nothing else; others see nothing';
END $$;

-- ------------------------------------------------------------
-- R33 — direct table reads
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT; v_n INTEGER;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  FOREACH t IN ARRAY ARRAY['maalrise_cycle_terms', 'maalrise_schedule_lines', 'maalrise_cycles', 'maalrise_investors',
                           'maalrise_kyc_submissions', 'maalrise_bank_change_requests', 'maalrise_counterparties'] LOOP
    EXECUTE format('SELECT COUNT(*) FROM %I', t) INTO v_n;
    IF v_n <> 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAIL R33: investor reads % directly (% rows)', t, v_n; END IF;
  END LOOP;
  SELECT COUNT(*) INTO v_n FROM maalrise_allocations;
  RESET ROLE;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL R33: investor lost their own allocation (% rows)', v_n; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('admin');
  SELECT COUNT(*) INTO v_n FROM maalrise_cycle_terms;
  RESET ROLE;
  IF v_n = 0 THEN RAISE EXCEPTION 'TEST FAIL R33: staff lost read access to terms'; END IF;
  RAISE NOTICE 'PASS R33: terms, schedule, Cycle row, own record and KYC notes no longer readable directly; staff unaffected';
END $$;

-- ------------------------------------------------------------
-- R34 — month status follows the money
-- ------------------------------------------------------------
DO $$
DECLARE c UUID := (SELECT v FROM ids WHERE k = 'c'); r UUID; d UUID; l UUID; j JSONB; pay JSONB;
BEGIN
  -- Month 1 in full: recorded, confirmed → processing
  PERFORM pg_temp.as_user('fin');
  r := maalrise_record_receipt(c, jsonb_build_object('period', 1, 'amount_kobo', 1000000, 'received_on', maalrise_today()));
  PERFORM pg_temp.as_user('admin');
  d := maalrise_confirm_receipt(r);
  INSERT INTO ids VALUES ('d1', d);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  j := maalrise_my_cycle(c);
  pay := maalrise_my_payments();
  RESET ROLE;
  IF pg_temp.month(j, 1)->>'status' <> 'processing' OR (pg_temp.month(j, 1)->>'processing_kobo')::BIGINT <> 321911
     OR pay <> '[]'::JSONB THEN
    RAISE EXCEPTION 'TEST FAIL R34: after confirmation: % / %', pg_temp.month(j, 1), pay; END IF;

  -- Approved → approved, and listed (not yet paid)
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_distribution(d);
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  j := maalrise_my_cycle(c);
  pay := maalrise_my_payments();
  RESET ROLE;
  IF pg_temp.month(j, 1)->>'status' <> 'approved' OR jsonb_array_length(pay) <> 1 OR pay->0->>'status' <> 'payable'
     OR pay->0->>'paid_on' IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL R34: after approval: % / %', pg_temp.month(j, 1), pay; END IF;

  -- Marked paid → paid, with date, reference, last four digits only
  SELECT id INTO l FROM maalrise_distribution_lines WHERE distribution_id = d
     AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i1');
  PERFORM pg_temp.as_user('officer');
  PERFORM maalrise_mark_line_paid(l, maalrise_today(), 'PTRF-1');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  j := maalrise_my_cycle(c);
  pay := maalrise_my_payments();
  RESET ROLE;
  IF pg_temp.month(j, 1)->>'status' <> 'paid' OR (pg_temp.month(j, 1)->>'paid_kobo')::BIGINT <> 321911
     OR (pg_temp.month(j, 1)->>'paid_on')::DATE <> maalrise_today() OR pg_temp.month(j, 1)->'references' <> '["PTRF-1"]'::JSONB THEN
    RAISE EXCEPTION 'TEST FAIL R34: after payment: %', pg_temp.month(j, 1); END IF;
  IF pay->0->>'status' <> 'paid' OR pay->0->>'account_ending' <> '0001' OR pay->0->>'reference' <> 'PTRF-1'
     OR pay::TEXT LIKE '%4000000001%' OR pay->0->>'kind' <> 'profit' OR (pay->0->>'period')::INTEGER <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R34: payment history wrong: %', pay; END IF;

  -- Reversal by a super admin: back to approved; never shows paid
  PERFORM pg_temp.as_user('sa');
  PERFORM maalrise_reverse_line_payment(l, 'Wrong account');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  j := maalrise_my_cycle(c);
  RESET ROLE;
  IF pg_temp.month(j, 1)->>'status' <> 'approved' THEN RAISE EXCEPTION 'TEST FAIL R34: reversed payment still shows paid'; END IF;
  PERFORM pg_temp.as_user('officer');
  PERFORM maalrise_mark_line_paid(l, maalrise_today(), 'PTRF-2');

  -- Month 2 in part (half), paid → part_paid; month 3 still scheduled
  PERFORM pg_temp.as_user('fin');
  r := maalrise_record_receipt(c, jsonb_build_object('period', 2, 'amount_kobo', 500000, 'received_on', maalrise_today()));
  PERFORM pg_temp.as_user('admin');
  d := maalrise_confirm_receipt(r);
  PERFORM maalrise_approve_distribution(d);
  SELECT id INTO l FROM maalrise_distribution_lines WHERE distribution_id = d
     AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i1');
  PERFORM pg_temp.as_user('officer');
  PERFORM maalrise_mark_line_paid(l, maalrise_today(), 'PTRF-3');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  j := maalrise_my_cycle(c);
  pay := maalrise_my_payments();
  RESET ROLE;
  IF pg_temp.month(j, 2)->>'status' <> 'part_paid' OR (pg_temp.month(j, 2)->>'paid_kobo')::BIGINT >= 321911
     OR (pg_temp.month(j, 2)->>'paid_kobo')::BIGINT = 0 OR pg_temp.month(j, 3)->>'status' <> 'scheduled' THEN
    RAISE EXCEPTION 'TEST FAIL R34: part payment: % / %', pg_temp.month(j, 2), pg_temp.month(j, 3); END IF;
  IF jsonb_array_length(pay) <> 2 THEN RAISE EXCEPTION 'TEST FAIL R34: expected 2 payments, got %', pay; END IF;

  -- inv2 never sees inv1's payments
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv2');
  pay := maalrise_my_payments();
  RESET ROLE;
  IF pay::TEXT LIKE '%PTRF%' OR EXISTS (SELECT 1 FROM jsonb_array_elements(pay) x WHERE x->>'account_ending' = '0001') THEN
    RAISE EXCEPTION 'TEST FAIL R34: inv2 sees inv1''s payment'; END IF;
  RAISE NOTICE 'PASS R34: due → processing → approved → paid (only once marked paid) → part paid; history shows last 4 digits';
END $$;

-- ------------------------------------------------------------
-- R35 — bank detail change requests
-- ------------------------------------------------------------
DO $$
DECLARE q1 UUID; q2 UUID; q3 UUID; j JSONB; v_err TEXT; p TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  IF NOT pg_temp.fails('SELECT maalrise_request_bank_change(''{"bank_name":"GTB","account_name":"Portal One","account_number":"4000000001"}'')') THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R35: request identical to confirmed details accepted'; END IF;
  IF NOT pg_temp.fails('SELECT maalrise_request_bank_change(''{"bank_name":"Opay","account_name":"Portal One","account_number":"12345"}'')') THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R35: short account number accepted'; END IF;
  q1 := maalrise_request_bank_change('{"bank_name":"Opay","account_name":"Portal One","account_number":"5000000001"}');
  v_err := pg_temp.err('SELECT maalrise_request_bank_change(''{"bank_name":"Kuda","account_name":"Portal One","account_number":"5000000009"}'')');
  IF v_err NOT LIKE '%already have a change waiting%' THEN RESET ROLE; RAISE EXCEPTION 'TEST FAIL R35: second pending request: %', v_err; END IF;
  j := maalrise_my_profile();
  -- Direct insert refused: no write policy
  IF NOT pg_temp.fails(format('INSERT INTO maalrise_bank_change_requests (maalrise_investor_id, bank_name, account_name, account_number, requested_by) VALUES (%L, ''X'', ''X'', ''1111111111'', auth.uid())', (SELECT v FROM ids WHERE k = 'i1'))) THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R35: direct insert allowed'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_review_bank_change(%L, true, NULL)', q1)) THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R35: investor approved their own request'; END IF;
  RESET ROLE;
  IF j->'pending_request'->>'account_number' <> '5000000001' OR j->'bank'->>'account_number' <> '4000000001' THEN
    RAISE EXCEPTION 'TEST FAIL R35: profile does not show the pending request beside the confirmed account: %', j; END IF;
  IF NOT EXISTS (SELECT 1 FROM maalrise_notifications n JOIN profiles pr ON pr.id = n.user_id
                 WHERE n.kind = 'bank_change_requested' AND pr.role::TEXT = 'operations') THEN
    RAISE EXCEPTION 'TEST FAIL R35: staff not notified of the request'; END IF;

  FOREACH p IN ARRAY ARRAY['fin', 'officer'] LOOP
    PERFORM pg_temp.as_user(p);
    IF NOT pg_temp.fails(format('SELECT maalrise_review_bank_change(%L, true, NULL)', q1)) THEN
      RAISE EXCEPTION 'TEST FAIL R35: % reviewed a bank change', p; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('ops');
  PERFORM maalrise_review_bank_change(q1, true, NULL);
  IF (SELECT account_number || bank_name FROM maalrise_investors WHERE id = (SELECT v FROM ids WHERE k = 'i1')) <> '5000000001Opay'
     OR (SELECT bank_confirmed_by FROM maalrise_investors WHERE id = (SELECT v FROM ids WHERE k = 'i1')) <> 'a0000000-0000-0000-0000-00000000d003' THEN
    RAISE EXCEPTION 'TEST FAIL R35: approval did not set and confirm the new account'; END IF;
  IF (SELECT COUNT(*) FROM maalrise_bank_details_history WHERE maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i1')
       AND account_number = '5000000001') <> 2 THEN RAISE EXCEPTION 'TEST FAIL R35: bank history incomplete'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_review_bank_change(%L, false, ''late'')', q1)) THEN
    RAISE EXCEPTION 'TEST FAIL R35: a decided request was changed'; END IF;
  IF NOT pg_temp.fails(format('UPDATE maalrise_bank_change_requests SET status = ''rejected'', reject_reason = ''x'' WHERE id = %L', q1)) THEN
    RAISE EXCEPTION 'TEST FAIL R35: a decided request could be edited'; END IF;
  IF NOT pg_temp.fails(format('DELETE FROM maalrise_bank_change_requests WHERE id = %L', q1)) THEN
    RAISE EXCEPTION 'TEST FAIL R35: a request could be deleted'; END IF;

  -- Rejection needs a reason
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv2');
  q2 := maalrise_request_bank_change('{"bank_name":"Kuda","account_name":"Portal Two","account_number":"5000000002"}');
  RESET ROLE;
  PERFORM pg_temp.as_user('admin');
  IF NOT pg_temp.fails(format('SELECT maalrise_review_bank_change(%L, false, '' '')', q2)) THEN
    RAISE EXCEPTION 'TEST FAIL R35: rejected without a reason'; END IF;
  PERFORM maalrise_review_bank_change(q2, false, 'Account name does not match');
  IF (SELECT account_number FROM maalrise_investors WHERE id = (SELECT v FROM ids WHERE k = 'i2')) <> '4000000002' THEN
    RAISE EXCEPTION 'TEST FAIL R35: rejection changed the account'; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv2');
  j := maalrise_my_profile();
  RESET ROLE;
  IF j->'last_decision'->>'status' <> 'rejected' OR j->'last_decision'->>'reason' <> 'Account name does not match'
     OR j->'pending_request' <> 'null'::JSONB THEN
    RAISE EXCEPTION 'TEST FAIL R35: investor does not see the decision: %', j; END IF;

  -- Cancel: own only
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv3');
  q3 := maalrise_request_bank_change('{"bank_name":"FCMB","account_name":"Portal Three","account_number":"5000000003"}');
  PERFORM pg_temp.as_user('inv2');
  IF NOT pg_temp.fails(format('SELECT maalrise_cancel_bank_change(%L)', q3)) THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R35: another investor cancelled the request'; END IF;
  PERFORM pg_temp.as_user('inv3');
  PERFORM maalrise_cancel_bank_change(q3);
  RESET ROLE;
  IF (SELECT status FROM maalrise_bank_change_requests WHERE id = q3) <> 'cancelled' THEN
    RAISE EXCEPTION 'TEST FAIL R35: cancel did not work'; END IF;
  RAISE NOTICE 'PASS R35: investor requests; one at a time; staff approve (confirmed) or reject with reason; own cancel; final';
END $$;

-- ------------------------------------------------------------
-- R36 — investor notifications
-- ------------------------------------------------------------
DO $$
DECLARE v_unread INTEGER;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  v_unread := (maalrise_my_notifications()->>'unread')::INTEGER;
  IF NOT EXISTS (SELECT 1 FROM maalrise_notifications WHERE kind = 'payment_paid' AND message LIKE '%PTRF-1%')
     OR NOT EXISTS (SELECT 1 FROM maalrise_notifications WHERE kind = 'bank_change_approved' AND message LIKE '%ending 0001%')
     OR EXISTS (SELECT 1 FROM maalrise_notifications WHERE kind LIKE 'bank_change_requested') THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R36: investor notifications wrong'; END IF;
  PERFORM maalrise_mark_notifications_read(NULL);
  IF (maalrise_my_notifications()->>'unread')::INTEGER <> 0 OR v_unread = 0 THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R36: unread count wrong (% before)', v_unread; END IF;
  PERFORM pg_temp.as_user('inv2');
  IF NOT EXISTS (SELECT 1 FROM maalrise_notifications WHERE kind = 'bank_change_rejected' AND message LIKE '%does not match%') THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R36: rejection notice missing'; END IF;
  RESET ROLE;
  RAISE NOTICE 'PASS R36: investors are notified of payments and bank decisions; unread count and mark-read work';
END $$;

-- ------------------------------------------------------------
-- R37 — helper, access, writes, MaalGrow, audit, drafts
-- ------------------------------------------------------------
DO $$
DECLARE b before_counts%ROWTYPE; t TEXT; a JSONB;
BEGIN
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  IF NOT pg_temp.fails(format('SELECT maalrise_investor_share(%L, %L, 100)', (SELECT v FROM ids WHERE k = 'c'), (SELECT v FROM ids WHERE k = 'i2'))) THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R37: share helper callable'; END IF;
  a := maalrise_my_access();
  IF NOT (a->>'maalrise')::BOOLEAN OR (a->>'maalgrow')::BOOLEAN THEN RESET ROLE; RAISE EXCEPTION 'TEST FAIL R37: inv1 access %', a; END IF;
  PERFORM pg_temp.as_user('sa');
  a := maalrise_my_access();
  IF (a->>'maalrise')::BOOLEAN OR (a->>'maalgrow')::BOOLEAN THEN RESET ROLE; RAISE EXCEPTION 'TEST FAIL R37: staff access %', a; END IF;
  PERFORM pg_temp.as_user('inv1');
  PERFORM pg_temp.err('UPDATE maalrise_investors SET account_number = ''9999999999'' WHERE true');
  PERFORM pg_temp.err('UPDATE maalrise_distribution_lines SET status = ''paid'' WHERE true');
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM maalrise_investors WHERE account_number = '9999999999') THEN
    RAISE EXCEPTION 'TEST FAIL R37: investor changed bank details directly'; END IF;
  SELECT * INTO b FROM before_counts;
  IF (SELECT COUNT(*) FROM investors) <> b.investors OR (SELECT COUNT(*) FROM payment_requests) <> b.payment_requests
     OR (SELECT COUNT(*) FROM notifications) <> b.notifications OR (SELECT COUNT(*) FROM investments) <> b.investments THEN
    RAISE EXCEPTION 'TEST FAIL R37: a MaalGrow table changed'; END IF;
  FOREACH t IN ARRAY ARRAY['maalrise_request_bank_change', 'maalrise_approve_bank_change', 'maalrise_reject_bank_change',
                           'maalrise_cancel_bank_change'] LOOP
    IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = t) THEN RAISE EXCEPTION 'TEST FAIL R37: % not audited', t; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE status <> 'draft') THEN RAISE EXCEPTION 'TEST FAIL R37: an email was sent'; END IF;
  RAISE NOTICE 'PASS R37: helper not callable; product access right; no direct writes; MaalGrow untouched; audited; drafts only';
END $$;

ROLLBACK;
