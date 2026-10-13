-- ============================================================
-- MaalRise capital settlement and closing (053) — scenarios
--
-- Run ONLY against a scratch database built from the stub and the
-- migrations (051, 052 and 053). Everything ROLLS BACK at the end.
--
--   R24 a super admin reverses a confirmed monthly entry (reason
--       required, only before approval); the distribution is
--       recalculated exactly; an empty distribution cannot be approved
--   R25 capital reminders on and after maturity; nothing created
--   R26 capital entries: who records/confirms; never above the capital
--       owed; payout prepared only when the FULL capital is confirmed
--   R27 a super admin reverses a confirmed capital entry: the prepared
--       settlement is cancelled; recording again prepares a new one
--   R28 capital settlement: each investor gets exactly what they funded;
--       admins approve; bank changes block until refreshed
--   R29 paying capital: officer/admins mark paid; investor sees own;
--       super admin reverses with reason; history append-only
--   R30 closing: refused while anything is unreceived, unapproved or
--       unpaid; allowed when complete; a closed Cycle is final
--   R31 no direct writes; helper not callable; MaalGrow untouched;
--       everything audited; email drafts only
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000c001', 'sa@c.com'),
 ('a0000000-0000-0000-0000-00000000c002', 'admin@c.com'),
 ('a0000000-0000-0000-0000-00000000c003', 'ops@c.com'),
 ('a0000000-0000-0000-0000-00000000c004', 'fin@c.com'),
 ('b0000000-0000-0000-0000-00000000c001', 'officer@c.com'),
 ('10000000-0000-0000-0000-00000000c101', 'cinv1@c.com'),
 ('10000000-0000-0000-0000-00000000c102', 'cinv2@c.com'),
 ('10000000-0000-0000-0000-00000000c103', 'cinv3@c.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000c001', 'sa@c.com',      'C Super Admin', 'super_admin'),
 ('a0000000-0000-0000-0000-00000000c002', 'admin@c.com',   'C Admin',       'administrator'),
 ('a0000000-0000-0000-0000-00000000c003', 'ops@c.com',     'C Ops',         'operations'),
 ('a0000000-0000-0000-0000-00000000c004', 'fin@c.com',     'C Finance',     'finance'),
 ('b0000000-0000-0000-0000-00000000c001', 'officer@c.com', 'C Officer',     'payment_officer'),
 ('10000000-0000-0000-0000-00000000c101', 'cinv1@c.com',   'Capital One',   'investor'),
 ('10000000-0000-0000-0000-00000000c102', 'cinv2@c.com',   'Capital Two',   'investor'),
 ('10000000-0000-0000-0000-00000000c103', 'cinv3@c.com',   'Capital Three', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, email = EXCLUDED.email;

CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON ids TO authenticated;
CREATE TEMP TABLE before_counts AS
  SELECT (SELECT COUNT(*) FROM investors) AS investors, (SELECT COUNT(*) FROM payment_requests) AS payment_requests,
         (SELECT COUNT(*) FROM notifications) AS notifications, (SELECT COUNT(*) FROM investments) AS investments;

CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p
    WHEN 'sa' THEN 'a0000000-0000-0000-0000-00000000c001' WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000c002'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000c003' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000c004'
    WHEN 'officer' THEN 'b0000000-0000-0000-0000-00000000c001' WHEN 'inv1' THEN '10000000-0000-0000-0000-00000000c101' END, true);
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

-- ₦100m cost, 12% total markup, 5% of markup deducted, 2 months:
-- each month ₦6,000,000 gross = ₦300,000 fee + ₦5,700,000 to investors.
-- Started two months and six days ago: maturity was six days ago.
DO $$
DECLARE v_cycle UUID; v_terms UUID; v_start DATE := (maalrise_today() - INTERVAL '2 months' - INTERVAL '6 days')::DATE; f UUID;
BEGIN
  PERFORM pg_temp.as_user('ops');
  INSERT INTO ids VALUES ('cp', maalrise_create_counterparty('{"name":"Kanziy Capital Ltd"}'));
  v_cycle := maalrise_create_cycle(jsonb_build_object('name', 'Capital Test', 'transaction_name', 'Murabaha',
    'counterparty_id', (SELECT v FROM ids WHERE k = 'cp'), 'start_date', v_start, 'duration_months', 2, 'unit_price_kobo', 10000000));
  INSERT INTO ids VALUES ('c', v_cycle);
  v_terms := maalrise_save_terms(v_cycle,
    '{"cost_kobo":10000000000,"markup_type":"percent","markup_bps":1200,"stated_sale_price_kobo":11200000000,
      "fee_basis":"markup","fee_bps":500,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
      "markup_kobo":1200000000,"sale_price_kobo":11200000000,"fee_kobo":60000000,
      "investor_pool_kobo":1140000000,"counterparty_total_kobo":11200000000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 570000000, 'fee_kobo', 30000000,
       'counterparty_gross_kobo', 600000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 2) g));
  PERFORM maalrise_submit_terms(v_terms);
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(v_terms);
  PERFORM pg_temp.as_user('ops');
  INSERT INTO ids VALUES ('i1', maalrise_add_investor('10000000-0000-0000-0000-00000000c101', '{"bank_name":"GTB","account_name":"Capital One","account_number":"3000000001"}'));
  INSERT INTO ids VALUES ('i2', maalrise_add_investor('10000000-0000-0000-0000-00000000c102', '{"bank_name":"Access","account_name":"Capital Two","account_number":"3000000002"}'));
  INSERT INTO ids VALUES ('i3', maalrise_add_investor('10000000-0000-0000-0000-00000000c103', '{"bank_name":"Zenith","account_name":"Capital Three","account_number":"3000000003"}'));
  FOR f IN SELECT v FROM ids WHERE k IN ('i1', 'i2', 'i3') LOOP
    PERFORM maalrise_record_kyc_submission(f, '{"id_type":"NIN","id_number":"1"}');
    PERFORM maalrise_review_kyc(f, 'verified', NULL);
    PERFORM maalrise_confirm_bank_details(f);
  END LOOP;
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', v_cycle, 'category', 'contract', 'name', 'C.pdf',
    'storage_path', 'test/capital/contract.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10));
  PERFORM pg_temp.as_user('fin');
  INSERT INTO ids VALUES ('f1', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'i1'), 600, 6000000000, v_start - 1, 'CF-1'));
  INSERT INTO ids VALUES ('f2', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'i2'), 333, 3330000000, v_start - 1, 'CF-2'));
  INSERT INTO ids VALUES ('f3', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'i3'), 67, 670000000, v_start - 1, 'CF-3'));
  PERFORM pg_temp.as_user('sa');
  FOR f IN SELECT v FROM ids WHERE k IN ('f1', 'f2', 'f3') LOOP PERFORM maalrise_confirm_funding(f); END LOOP;
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_activate_cycle(v_cycle);
  RAISE NOTICE 'setup: active 2-month Cycle from %, maturity %', v_start, maalrise_maturity_date(v_cycle);
END $$;

-- ------------------------------------------------------------
-- R25 — capital reminders (before anything is recorded)
-- ------------------------------------------------------------
DO $$
BEGIN
  PERFORM pg_temp.as_user('fin');
  PERFORM maalrise_my_notifications();
  IF NOT EXISTS (SELECT 1 FROM maalrise_notifications WHERE user_id = 'a0000000-0000-0000-0000-00000000c004' AND kind = 'capital_due'
                 AND message LIKE '%Capital Test matured on%capital of ₦100,000,000.00%') THEN
    RAISE EXCEPTION 'TEST FAIL R25: no capital-due reminder';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM maalrise_notifications WHERE user_id = 'a0000000-0000-0000-0000-00000000c004' AND kind = 'capital_followup') THEN
    RAISE EXCEPTION 'TEST FAIL R25: no capital follow-up six days after maturity';
  END IF;
  IF EXISTS (SELECT 1 FROM maalrise_capital_receipts) OR EXISTS (SELECT 1 FROM maalrise_capital_settlements) THEN
    RAISE EXCEPTION 'TEST FAIL R25: a reminder created capital records';
  END IF;
  RAISE NOTICE 'PASS R25: capital-due reminder and five-day follow-up; nothing recorded by a date';
END $$;

-- ------------------------------------------------------------
-- R24 — reversing a confirmed monthly entry
-- ------------------------------------------------------------
DO $$
DECLARE c UUID := (SELECT v FROM ids WHERE k = 'c'); a UUID; b UUID; m1 UUID; d UUID; v_err TEXT; dd maalrise_distributions%ROWTYPE;
BEGIN
  PERFORM pg_temp.as_user('admin');
  m1 := maalrise_record_receipt(c, jsonb_build_object('period', 1, 'amount_kobo', 600000000, 'received_on', maalrise_today() - 30, 'reference', 'M1'));
  INSERT INTO ids VALUES ('d1', maalrise_confirm_receipt(m1));
  a := maalrise_record_receipt(c, jsonb_build_object('period', 2, 'amount_kobo', 200000000, 'received_on', maalrise_today() - 7, 'reference', 'M2A'));
  d := maalrise_confirm_receipt(a);
  b := maalrise_record_receipt(c, jsonb_build_object('period', 2, 'amount_kobo', 400000000, 'received_on', maalrise_today() - 6, 'reference', 'M2B'));
  PERFORM maalrise_confirm_receipt(b);
  INSERT INTO ids VALUES ('d2', d);

  -- only a super admin; reason required; only confirmed entries
  IF NOT pg_temp.fails(format('SELECT maalrise_reverse_receipt(%L, %L)', a, 'typo')) THEN
    RAISE EXCEPTION 'TEST FAIL R24: an administrator reversed a confirmed entry'; END IF;
  PERFORM pg_temp.as_user('sa');
  IF NOT pg_temp.fails(format('SELECT maalrise_reverse_receipt(%L, %L)', a, ' ')) THEN
    RAISE EXCEPTION 'TEST FAIL R24: reversed without a reason'; END IF;
  PERFORM maalrise_reverse_receipt(a, 'Recorded against the wrong Cycle');
  SELECT * INTO dd FROM maalrise_distributions WHERE id = d;
  -- remaining ₦4m: fee = round(400m × 30m / 600m) = 20m exactly
  IF dd.applied_kobo <> 400000000 OR dd.fee_kobo <> 20000000 OR dd.net_kobo <> 380000000
     OR (SELECT SUM(amount_kobo) FROM maalrise_distribution_lines WHERE distribution_id = d) <> 380000000 THEN
    RAISE EXCEPTION 'TEST FAIL R24: distribution not recalculated exactly %', row_to_json(dd);
  END IF;
  IF (SELECT status FROM maalrise_receipts WHERE id = a) <> 'reversed' THEN RAISE EXCEPTION 'TEST FAIL R24: entry not kept as reversed'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_reverse_receipt(%L, %L)', a, 'again')) THEN
    RAISE EXCEPTION 'TEST FAIL R24: reversed twice'; END IF;

  -- reverse the other part too: an empty distribution cannot be approved
  PERFORM maalrise_reverse_receipt(b, 'Wrong month');
  PERFORM pg_temp.as_user('admin');
  v_err := pg_temp.err(format('SELECT maalrise_approve_distribution(%L)', d));
  IF v_err IS NULL OR v_err NOT LIKE '%Nothing to approve%' THEN RAISE EXCEPTION 'TEST FAIL R24: empty distribution approved (%)', v_err; END IF;

  -- record it correctly again (references may be reused): the same open distribution fills up
  a := maalrise_record_receipt(c, jsonb_build_object('period', 2, 'amount_kobo', 600000000, 'received_on', maalrise_today() - 6, 'reference', 'M2A'));
  IF maalrise_confirm_receipt(a) <> d THEN RAISE EXCEPTION 'TEST FAIL R24: a new distribution was opened instead of the empty one'; END IF;
  IF (SELECT applied_kobo || ':' || fee_kobo FROM maalrise_distributions WHERE id = d) <> '600000000:30000000' THEN
    RAISE EXCEPTION 'TEST FAIL R24: month 2 not exact after re-recording'; END IF;

  -- after approval, an entry can no longer be reversed
  PERFORM maalrise_approve_distribution((SELECT v FROM ids WHERE k = 'd1'));
  PERFORM pg_temp.as_user('sa');
  v_err := pg_temp.err(format('SELECT maalrise_reverse_receipt(%L, %L)', m1, 'late change'));
  IF v_err IS NULL OR v_err NOT LIKE '%already approved%' THEN RAISE EXCEPTION 'TEST FAIL R24: reversed after approval (%)', v_err; END IF;
  RAISE NOTICE 'PASS R24: super admin reverses a confirmed entry with a reason; recalculated exactly; empty distributions refused; final once approved';
END $$;

-- ------------------------------------------------------------
-- R26 — capital entries
-- ------------------------------------------------------------
DO $$
DECLARE c UUID := (SELECT v FROM ids WHERE k = 'c'); p TEXT; v_err TEXT; x UUID; y UUID;
BEGIN
  FOREACH p IN ARRAY ARRAY['officer', 'ops', 'inv1'] LOOP
    PERFORM pg_temp.as_user(p);
    IF NOT pg_temp.fails(format('SELECT maalrise_record_capital(%L, %L)', c, jsonb_build_object('amount_kobo', 1, 'received_on', maalrise_today()))) THEN
      RAISE EXCEPTION 'TEST FAIL R26: % recorded capital', p; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('fin');
  IF NOT pg_temp.fails(format('SELECT maalrise_record_capital(%L, %L)', c, jsonb_build_object('amount_kobo', 1, 'received_on', maalrise_today() + 1))) THEN
    RAISE EXCEPTION 'TEST FAIL R26: future-dated capital accepted'; END IF;
  v_err := pg_temp.err(format('SELECT maalrise_record_capital(%L, %L)', c, jsonb_build_object('amount_kobo', 10000000001, 'received_on', maalrise_today())));
  IF v_err IS NULL OR v_err NOT LIKE '%more than the ₦100,000,000.00 of capital still owed%' THEN
    RAISE EXCEPTION 'TEST FAIL R26: capital above the amount owed accepted (%)', v_err; END IF;

  -- a split transfer: ₦40m then ₦60m
  x := maalrise_record_capital(c, jsonb_build_object('amount_kobo', 4000000000, 'received_on', maalrise_today() - 5, 'reference', 'CAP-1'));
  y := maalrise_record_capital(c, jsonb_build_object('amount_kobo', 6000000000, 'received_on', maalrise_today() - 4, 'reference', 'CAP-2'));
  INSERT INTO ids VALUES ('cap1', x), ('cap2', y);
  v_err := pg_temp.err(format('SELECT maalrise_record_capital(%L, %L)', c, jsonb_build_object('amount_kobo', 1, 'received_on', maalrise_today())));
  IF v_err IS NULL OR v_err NOT LIKE '%already fully recorded%' THEN RAISE EXCEPTION 'TEST FAIL R26: capital recorded beyond the full amount (%)', v_err; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_confirm_capital(%L)', x)) THEN RAISE EXCEPTION 'TEST FAIL R26: finance confirmed capital'; END IF;

  PERFORM pg_temp.as_user('admin');
  IF maalrise_confirm_capital(x) IS NOT NULL OR EXISTS (SELECT 1 FROM maalrise_capital_settlements) THEN
    RAISE EXCEPTION 'TEST FAIL R26: capital was prepared for payout before the full amount was confirmed'; END IF;
  INSERT INTO ids VALUES ('s1', maalrise_confirm_capital(y));
  IF (SELECT v FROM ids WHERE k = 's1') IS NULL THEN RAISE EXCEPTION 'TEST FAIL R26: full capital confirmed but nothing prepared'; END IF;
  RAISE NOTICE 'PASS R26: finance/admins record, admins confirm; never above the capital owed; payout prepared only once the full ₦100m is confirmed';
END $$;

-- ------------------------------------------------------------
-- R27 — reversing a confirmed capital entry
-- ------------------------------------------------------------
DO $$
DECLARE c UUID := (SELECT v FROM ids WHERE k = 'c'); y UUID;
BEGIN
  PERFORM pg_temp.as_user('admin');
  IF NOT pg_temp.fails(format('SELECT maalrise_reverse_capital(%L, %L)', (SELECT v FROM ids WHERE k = 'cap2'), 'x')) THEN
    RAISE EXCEPTION 'TEST FAIL R27: an administrator reversed capital'; END IF;
  PERFORM pg_temp.as_user('sa');
  PERFORM maalrise_reverse_capital((SELECT v FROM ids WHERE k = 'cap2'), 'Wrong amount keyed');
  IF (SELECT status FROM maalrise_capital_settlements WHERE id = (SELECT v FROM ids WHERE k = 's1')) <> 'cancelled'
     OR EXISTS (SELECT 1 FROM maalrise_capital_payments WHERE settlement_id = (SELECT v FROM ids WHERE k = 's1')) THEN
    RAISE EXCEPTION 'TEST FAIL R27: the prepared settlement was not cancelled'; END IF;
  PERFORM pg_temp.as_user('fin');
  y := maalrise_record_capital(c, jsonb_build_object('amount_kobo', 6000000000, 'received_on', maalrise_today() - 4, 'reference', 'CAP-2'));
  PERFORM pg_temp.as_user('admin');
  INSERT INTO ids VALUES ('s2', maalrise_confirm_capital(y));
  IF (SELECT COUNT(*) FROM maalrise_capital_settlements WHERE cycle_id = c AND status <> 'cancelled') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R27: not exactly one live settlement'; END IF;
  RAISE NOTICE 'PASS R27: super admin reverses a capital entry; the prepared settlement is cancelled and re-prepared once capital is complete again';
END $$;

-- ------------------------------------------------------------
-- R28 — capital settlement
-- ------------------------------------------------------------
DO $$
DECLARE s UUID := (SELECT v FROM ids WHERE k = 's2'); v_err TEXT; v_n INTEGER;
BEGIN
  IF (SELECT string_agg(amount_kobo::TEXT, ',' ORDER BY amount_kobo DESC) FROM maalrise_capital_payments WHERE settlement_id = s)
     <> '6000000000,3330000000,670000000' THEN
    RAISE EXCEPTION 'TEST FAIL R28: investors do not get back exactly what they funded'; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('officer');
  SELECT COUNT(*) INTO v_n FROM maalrise_capital_payments;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL R28: officer saw unapproved capital payments'; END IF;

  PERFORM pg_temp.as_user('fin');
  IF NOT pg_temp.fails(format('SELECT maalrise_approve_capital_settlement(%L)', s)) THEN RAISE EXCEPTION 'TEST FAIL R28: finance approved'; END IF;
  PERFORM pg_temp.as_user('ops');
  PERFORM maalrise_set_bank_details((SELECT v FROM ids WHERE k = 'i3'), 'Kuda', 'Capital Three', '4000000003');
  PERFORM maalrise_confirm_bank_details((SELECT v FROM ids WHERE k = 'i3'));
  PERFORM pg_temp.as_user('admin');
  v_err := pg_temp.err(format('SELECT maalrise_approve_capital_settlement(%L)', s));
  IF v_err IS NULL OR v_err NOT LIKE '%Capital Three%' THEN RAISE EXCEPTION 'TEST FAIL R28: approved against an outdated account (%)', v_err; END IF;
  PERFORM maalrise_refresh_capital_settlement(s);
  PERFORM maalrise_approve_capital_settlement(s);
  IF (SELECT account_number FROM maalrise_capital_payments WHERE settlement_id = s AND investor_name = 'Capital Three') <> '4000000003'
     OR EXISTS (SELECT 1 FROM maalrise_capital_payments WHERE settlement_id = s AND status <> 'payable') THEN
    RAISE EXCEPTION 'TEST FAIL R28: approval did not make the refreshed payments payable'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_refresh_capital_settlement(%L)', s)) THEN RAISE EXCEPTION 'TEST FAIL R28: approved settlement recalculated'; END IF;
  PERFORM pg_temp.as_user('sa');
  v_err := pg_temp.err(format('SELECT maalrise_reverse_capital(%L, %L)', (SELECT v FROM ids WHERE k = 'cap1'), 'late'));
  IF v_err IS NULL OR v_err NOT LIKE '%already approved%' THEN RAISE EXCEPTION 'TEST FAIL R28: capital reversed after approval (%)', v_err; END IF;
  RAISE NOTICE 'PASS R28: each investor gets exactly their funded capital; admins approve; changed accounts block until refreshed; approved is final';
END $$;

-- ------------------------------------------------------------
-- R29 — paying capital
-- ------------------------------------------------------------
DO $$
DECLARE l UUID; v_status TEXT; v_n INTEGER; p TEXT;
BEGIN
  SELECT id INTO l FROM maalrise_capital_payments WHERE settlement_id = (SELECT v FROM ids WHERE k = 's2') AND investor_name = 'Capital One';
  FOREACH p IN ARRAY ARRAY['fin', 'ops', 'inv1'] LOOP
    PERFORM pg_temp.as_user(p);
    IF NOT pg_temp.fails(format('SELECT maalrise_mark_capital_paid(%L, %L, %L)', l, maalrise_today(), 'X')) THEN
      RAISE EXCEPTION 'TEST FAIL R29: % marked capital paid', p; END IF;
  END LOOP;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  SELECT status INTO v_status FROM maalrise_capital_payments WHERE id = l;
  SELECT COUNT(*) INTO v_n FROM maalrise_capital_payments;
  RESET ROLE;
  IF v_status <> 'payable' OR v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL R29: investor view wrong (% / %)', v_status, v_n; END IF;

  PERFORM pg_temp.as_user('officer');
  IF NOT pg_temp.fails(format('SELECT maalrise_mark_capital_paid(%L, %L, %L)', l, maalrise_today() + 1, 'X')) THEN
    RAISE EXCEPTION 'TEST FAIL R29: future transfer date accepted'; END IF;
  PERFORM maalrise_mark_capital_paid(l, maalrise_today(), 'CAPTRF-1');
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  SELECT status INTO v_status FROM maalrise_capital_payments WHERE id = l;
  PERFORM pg_temp.as_user('officer');
  SELECT COUNT(*) INTO v_n FROM maalrise_capital_settlements WHERE status = 'approved';
  RESET ROLE;
  IF v_status <> 'paid' THEN RAISE EXCEPTION 'TEST FAIL R29: investor does not see paid'; END IF;
  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL R29: officer cannot see the approved settlement'; END IF;
  IF NOT EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE to_email = 'cinv1@c.com' AND kind = 'capital_paid' AND status = 'draft'
                 AND body LIKE '%CAPTRF-1%') THEN RAISE EXCEPTION 'TEST FAIL R29: no capital-paid email draft'; END IF;

  PERFORM pg_temp.as_user('admin');
  IF NOT pg_temp.fails(format('SELECT maalrise_reverse_capital_payment(%L, %L)', l, 'x')) THEN RAISE EXCEPTION 'TEST FAIL R29: admin reversed'; END IF;
  PERFORM pg_temp.as_user('sa');
  PERFORM maalrise_reverse_capital_payment(l, 'Bounced');
  PERFORM pg_temp.as_user('officer');
  PERFORM maalrise_mark_capital_paid(l, maalrise_today(), 'CAPTRF-2');
  IF (SELECT string_agg(event, ',' ORDER BY created_at) FROM maalrise_capital_payment_events WHERE line_id = l) <> 'marked_paid,reversed,marked_paid' THEN
    RAISE EXCEPTION 'TEST FAIL R29: history incomplete'; END IF;
  IF NOT pg_temp.fails('DELETE FROM maalrise_capital_payment_events WHERE true') THEN RAISE EXCEPTION 'TEST FAIL R29: history deletable'; END IF;
  RAISE NOTICE 'PASS R29: officer marks capital paid; investor sees paid only after; super admin reverses with reason; history append-only';
END $$;

-- ------------------------------------------------------------
-- R30 — closing the Cycle
-- ------------------------------------------------------------
DO $$
DECLARE c UUID := (SELECT v FROM ids WHERE k = 'c'); v_err TEXT; l UUID;
BEGIN
  PERFORM pg_temp.as_user('admin');
  v_err := pg_temp.err(format('SELECT maalrise_close_cycle(%L)', c));
  IF v_err IS NULL OR v_err NOT LIKE '%awaiting approval%' OR v_err NOT LIKE '%not yet marked paid%' THEN
    RAISE EXCEPTION 'TEST FAIL R30: closed while unfinished, or reasons missing (%)', v_err; END IF;

  -- finish: approve month 2, pay every profit and capital payment
  -- Capital Three changed bank account in R28: refresh month 2 first
  PERFORM maalrise_refresh_distribution((SELECT v FROM ids WHERE k = 'd2'));
  PERFORM maalrise_approve_distribution((SELECT v FROM ids WHERE k = 'd2'));
  PERFORM pg_temp.as_user('officer');
  FOR l IN SELECT id FROM maalrise_distribution_lines WHERE cycle_id = c AND status = 'payable' LOOP
    PERFORM maalrise_mark_line_paid(l, maalrise_today(), 'P-' || left(l::TEXT, 8));
  END LOOP;
  FOR l IN SELECT id FROM maalrise_capital_payments WHERE cycle_id = c AND status = 'payable' LOOP
    PERFORM maalrise_mark_capital_paid(l, maalrise_today(), 'C-' || left(l::TEXT, 8));
  END LOOP;

  PERFORM pg_temp.as_user('ops');
  IF NOT pg_temp.fails(format('SELECT maalrise_close_cycle(%L)', c)) THEN RAISE EXCEPTION 'TEST FAIL R30: operations closed a Cycle'; END IF;
  PERFORM pg_temp.as_user('admin');
  IF NOT (maalrise_close_checks(c)->>'all_ok')::BOOLEAN THEN RAISE EXCEPTION 'TEST FAIL R30: checks fail when complete: %', maalrise_close_checks(c); END IF;
  PERFORM maalrise_close_cycle(c);
  IF (SELECT status FROM maalrise_cycles WHERE id = c) <> 'closed' THEN RAISE EXCEPTION 'TEST FAIL R30: not closed'; END IF;

  -- final: no more entries, no reversal of payments
  IF NOT pg_temp.fails(format('SELECT maalrise_record_capital(%L, %L)', c, jsonb_build_object('amount_kobo', 1, 'received_on', maalrise_today()))) THEN
    RAISE EXCEPTION 'TEST FAIL R30: capital recorded on a closed Cycle'; END IF;
  PERFORM pg_temp.as_user('sa');
  v_err := pg_temp.err(format('SELECT maalrise_reverse_line_payment(%L, %L)',
    (SELECT id FROM maalrise_distribution_lines WHERE cycle_id = c LIMIT 1), 'after close'));
  IF v_err IS NULL OR v_err NOT LIKE '%closed%' THEN RAISE EXCEPTION 'TEST FAIL R30: profit payment reversed after close (%)', v_err; END IF;
  v_err := pg_temp.err(format('SELECT maalrise_reverse_capital_payment(%L, %L)',
    (SELECT id FROM maalrise_capital_payments WHERE cycle_id = c LIMIT 1), 'after close'));
  IF v_err IS NULL OR v_err NOT LIKE '%closed%' THEN RAISE EXCEPTION 'TEST FAIL R30: capital payment reversed after close (%)', v_err; END IF;
  RAISE NOTICE 'PASS R30: closing refused until everything is received, approved and paid; then closed and final';
END $$;

-- ------------------------------------------------------------
-- R31 — no direct writes; MaalGrow untouched; audited; drafts only
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT; p TEXT; b before_counts%ROWTYPE;
BEGIN
  SET LOCAL ROLE authenticated;
  FOREACH p IN ARRAY ARRAY['sa', 'admin', 'fin', 'officer', 'inv1'] LOOP
    PERFORM pg_temp.as_user(p);
    FOREACH t IN ARRAY ARRAY[
      format('INSERT INTO maalrise_capital_receipts (cycle_id, amount_kobo, received_on, recorded_by) VALUES (%L, 1, CURRENT_DATE, auth.uid())', (SELECT v FROM ids WHERE k = 'c')),
      format('INSERT INTO maalrise_capital_settlements (cycle_id, cycle_name, counterparty_name, maturity_date, capital_kobo, prepared_by) VALUES (%L, ''x'', ''x'', CURRENT_DATE, 1, auth.uid())', (SELECT v FROM ids WHERE k = 'c')),
      format('SELECT maalrise_build_capital_payments(%L)', (SELECT v FROM ids WHERE k = 's2'))] LOOP
      IF NOT pg_temp.fails(t) THEN RESET ROLE; RAISE EXCEPTION 'TEST FAIL R31: % could run: %', p, t; END IF;
    END LOOP;
    PERFORM pg_temp.err('UPDATE maalrise_capital_payments SET status = ''paid'' WHERE true');
    PERFORM pg_temp.err('UPDATE maalrise_cycles SET status = ''active'' WHERE true');
  END LOOP;
  RESET ROLE;
  IF (SELECT status FROM maalrise_cycles WHERE id = (SELECT v FROM ids WHERE k = 'c')) <> 'closed' THEN
    RAISE EXCEPTION 'TEST FAIL R31: a closed Cycle was reopened directly'; END IF;
  SELECT * INTO b FROM before_counts;
  IF (SELECT COUNT(*) FROM investors) <> b.investors OR (SELECT COUNT(*) FROM payment_requests) <> b.payment_requests
     OR (SELECT COUNT(*) FROM notifications) <> b.notifications OR (SELECT COUNT(*) FROM investments) <> b.investments THEN
    RAISE EXCEPTION 'TEST FAIL R31: a MaalGrow table changed'; END IF;
  FOREACH t IN ARRAY ARRAY['maalrise_reverse_receipt', 'maalrise_record_capital', 'maalrise_confirm_capital', 'maalrise_reverse_capital',
                           'maalrise_approve_capital_settlement', 'maalrise_refresh_capital_settlement', 'maalrise_mark_capital_paid',
                           'maalrise_reverse_capital_payment', 'maalrise_close_cycle'] LOOP
    IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = t) THEN RAISE EXCEPTION 'TEST FAIL R31: % not audited', t; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE status <> 'draft') THEN RAISE EXCEPTION 'TEST FAIL R31: an email was sent'; END IF;
  RAISE NOTICE 'PASS R31: no direct writes; helper not callable; MaalGrow untouched; every action audited; drafts only';
END $$;

ROLLBACK;
