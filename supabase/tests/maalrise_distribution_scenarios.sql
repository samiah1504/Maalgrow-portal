-- ============================================================
-- MaalRise monthly profit distribution (052) — scenarios
--
-- Run ONLY against a scratch database built from the stub and the
-- migrations (051 and 052 applied). Never against staging or
-- production: it creates users. Everything ROLLS BACK at the end.
--
--   R13 receipts: who may record and confirm; dates, amounts,
--       references and Cycle status are checked
--   R14 reminders: on and after the scheduled date, follow-up after
--       five days; nothing is recorded or distributed by a date
--   R15 a full month: fee taken, net shared by units to the kobo,
--       bank accounts snapshotted, nothing payable before approval
--   R16 part-payments: each applied once, fee in proportion and exact
--       in total, one open distribution, excess HELD not distributed
--   R17 approval: admins only (the preparer may approve); refused while
--       a bank account is unconfirmed or changed until refreshed
--   R18 a part-payment after approval makes a follow-on distribution
--       for the new money only
--   R19 rejection of a wrong entry; confirmed entries are final
--   R20 paying: who may mark paid; who sees what; super admin alone
--       reverses, with a reason; history is append-only
--   R21 the unsubscribed units' share stays unallocated
--   R22 no direct writes; internal helpers are not callable
--   R23 MaalGrow records untouched; every action audited; the
--       email outbox holds drafts only
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
-- Table privileges as Supabase grants them: RLS must do the stopping.
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000f001', 'sa@d.com'),
 ('a0000000-0000-0000-0000-00000000f002', 'admin@d.com'),
 ('a0000000-0000-0000-0000-00000000f003', 'ops@d.com'),
 ('a0000000-0000-0000-0000-00000000f004', 'fin@d.com'),
 ('a0000000-0000-0000-0000-00000000f005', 'cs@d.com'),
 ('a0000000-0000-0000-0000-00000000f006', 'fin2@d.com'),
 ('b0000000-0000-0000-0000-00000000f001', 'officer@d.com'),
 ('10000000-0000-0000-0000-00000000f001', 'inv1@d.com'),
 ('10000000-0000-0000-0000-00000000f002', 'inv2@d.com'),
 ('10000000-0000-0000-0000-00000000f003', 'inv3@d.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000f001', 'sa@d.com',      'D Super Admin', 'super_admin'),
 ('a0000000-0000-0000-0000-00000000f002', 'admin@d.com',   'D Admin',       'administrator'),
 ('a0000000-0000-0000-0000-00000000f003', 'ops@d.com',     'D Ops',         'operations'),
 ('a0000000-0000-0000-0000-00000000f004', 'fin@d.com',     'D Finance',     'finance'),
 ('a0000000-0000-0000-0000-00000000f005', 'cs@d.com',      'D Support',     'customer_support'),
 ('a0000000-0000-0000-0000-00000000f006', 'fin2@d.com',    'D Finance Two', 'finance'),
 ('b0000000-0000-0000-0000-00000000f001', 'officer@d.com', 'D Officer',     'payment_officer'),
 ('10000000-0000-0000-0000-00000000f001', 'inv1@d.com',    'Investor One',  'investor'),
 ('10000000-0000-0000-0000-00000000f002', 'inv2@d.com',    'Investor Two',  'investor'),
 ('10000000-0000-0000-0000-00000000f003', 'inv3@d.com',    'Investor Three','investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, email = EXCLUDED.email;

CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON ids TO authenticated;
CREATE TEMP TABLE before_counts AS
  SELECT (SELECT COUNT(*) FROM investors) AS investors, (SELECT COUNT(*) FROM payment_requests) AS payment_requests,
         (SELECT COUNT(*) FROM notifications) AS notifications, (SELECT COUNT(*) FROM investments) AS investments;

CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p
    WHEN 'sa' THEN 'a0000000-0000-0000-0000-00000000f001' WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000f002'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000f003' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000f004'
    WHEN 'cs' THEN 'a0000000-0000-0000-0000-00000000f005' WHEN 'fin2' THEN 'a0000000-0000-0000-0000-00000000f006'
    WHEN 'officer' THEN 'b0000000-0000-0000-0000-00000000f001' WHEN 'inv1' THEN '10000000-0000-0000-0000-00000000f001'
    WHEN 'inv2' THEN '10000000-0000-0000-0000-00000000f002' WHEN 'inv3' THEN '10000000-0000-0000-0000-00000000f003' END, true);
$$ LANGUAGE sql;

/** TRUE if the statement fails. */
CREATE FUNCTION pg_temp.fails(p_sql TEXT) RETURNS BOOLEAN AS $$
BEGIN
  EXECUTE p_sql;
  RETURN FALSE;
EXCEPTION WHEN OTHERS THEN
  RETURN TRUE;
END;
$$ LANGUAGE plpgsql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN
  EXECUTE p_sql;
  RETURN NULL;
EXCEPTION WHEN OTHERS THEN
  RETURN SQLERRM;
END;
$$ LANGUAGE plpgsql;

-- ₦100m cost, 12% markup (total for the Cycle), 5% of markup deducted,
-- 6 months: each month the counterparty pays ₦2,000,000, of which
-- ₦100,000 is the fee and ₦1,900,000 goes to investors.
CREATE FUNCTION pg_temp.terms() RETURNS JSONB AS $$
  SELECT '{"cost_kobo":10000000000,"markup_type":"percent","markup_bps":1200,"stated_sale_price_kobo":11200000000,
      "fee_basis":"markup","fee_bps":500,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
      "markup_kobo":1200000000,"sale_price_kobo":11200000000,"fee_kobo":60000000,
      "investor_pool_kobo":1140000000,"counterparty_total_kobo":11200000000,"engine_version":"test"}'::JSONB;
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.schedule() RETURNS JSONB AS $$
  SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 190000000, 'fee_kobo', 10000000,
                                      'counterparty_gross_kobo', 200000000, 'rounding_adjustment_kobo', 0) ORDER BY g)
  FROM generate_series(1, 6) g;
$$ LANGUAGE sql;

-- ------------------------------------------------------------
-- Setup: an ACTIVE Cycle started three months ago (month 3 falls due
-- today), fully funded by three investors holding 600 / 333 / 67 units.
-- ------------------------------------------------------------
DO $$
DECLARE v_cycle UUID; v_terms UUID; v_start DATE := (maalrise_today() - INTERVAL '3 months')::DATE; f UUID;
BEGIN
  PERFORM pg_temp.as_user('ops');
  INSERT INTO ids VALUES ('cp', maalrise_create_counterparty('{"name":"Kanziy Test Ltd"}'));
  v_cycle := maalrise_create_cycle(jsonb_build_object('name', 'Dist Test Alpha', 'transaction_name', 'Murabaha',
    'counterparty_id', (SELECT v FROM ids WHERE k = 'cp'), 'start_date', v_start, 'duration_months', 6,
    'unit_price_kobo', 10000000));
  INSERT INTO ids VALUES ('alpha', v_cycle);
  v_terms := maalrise_save_terms(v_cycle, pg_temp.terms(), pg_temp.schedule());
  PERFORM maalrise_submit_terms(v_terms);
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(v_terms);

  PERFORM pg_temp.as_user('ops');
  INSERT INTO ids VALUES ('i1', maalrise_add_investor('10000000-0000-0000-0000-00000000f001',
    '{"bank_name":"GTB","account_name":"Investor One","account_number":"1000000001"}'));
  INSERT INTO ids VALUES ('i2', maalrise_add_investor('10000000-0000-0000-0000-00000000f002',
    '{"bank_name":"Access","account_name":"Investor Two","account_number":"1000000002"}'));
  INSERT INTO ids VALUES ('i3', maalrise_add_investor('10000000-0000-0000-0000-00000000f003',
    '{"bank_name":"Zenith","account_name":"Investor Three","account_number":"1000000003"}'));
  FOR f IN SELECT v FROM ids WHERE k IN ('i1', 'i2', 'i3') LOOP
    PERFORM maalrise_record_kyc_submission(f, '{"id_type":"NIN","id_number":"1"}');
    PERFORM maalrise_review_kyc(f, 'verified', NULL);
    PERFORM maalrise_confirm_bank_details(f);
  END LOOP;
  PERFORM maalrise_register_document(jsonb_build_object('cycle_id', v_cycle, 'category', 'contract',
    'name', 'Contract.pdf', 'storage_path', 'test/dist-alpha/contract.pdf', 'mime_type', 'application/pdf', 'size_bytes', 10));

  PERFORM pg_temp.as_user('fin');
  INSERT INTO ids VALUES ('f1', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'i1'), 600, 6000000000, v_start - 1, 'DF-1'));
  INSERT INTO ids VALUES ('f2', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'i2'), 333, 3330000000, v_start - 1, 'DF-2'));
  INSERT INTO ids VALUES ('f3', maalrise_record_funding(v_cycle, (SELECT v FROM ids WHERE k = 'i3'), 67, 670000000, v_start - 1, 'DF-3'));
  PERFORM pg_temp.as_user('sa');
  FOR f IN SELECT v FROM ids WHERE k IN ('f1', 'f2', 'f3') LOOP PERFORM maalrise_confirm_funding(f); END LOOP;
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_activate_cycle(v_cycle);
  RAISE NOTICE 'setup: active Cycle starting %, 600/333/67 units', v_start;
END $$;

-- ------------------------------------------------------------
-- R14 — reminders (before any money is recorded)
-- ------------------------------------------------------------
DO $$
DECLARE v_due3 DATE; v_n INTEGER; v_msg TEXT;
BEGIN
  SELECT due_date INTO v_due3 FROM maalrise_schedule_lines l JOIN maalrise_cycles c ON c.approved_terms_id = l.terms_id
   WHERE c.id = (SELECT v FROM ids WHERE k = 'alpha') AND l.period = 3;

  PERFORM pg_temp.as_user('officer');
  PERFORM maalrise_my_notifications();
  IF EXISTS (SELECT 1 FROM maalrise_notifications WHERE kind IN ('payment_due', 'payment_followup')
             AND user_id = 'b0000000-0000-0000-0000-00000000f001') THEN
    RAISE EXCEPTION 'TEST FAIL R14: the payment officer was given payment-date reminders';
  END IF;

  PERFORM pg_temp.as_user('fin');
  IF (maalrise_my_notifications()->>'unread')::INTEGER = 0 THEN RAISE EXCEPTION 'TEST FAIL R14: no reminders'; END IF;
  -- months 1 and 2 are over five days late: due + follow-up; month 3 is due today (or within days)
  SELECT COUNT(*) INTO v_n FROM maalrise_notifications
   WHERE user_id = 'a0000000-0000-0000-0000-00000000f004' AND kind = 'payment_followup';
  IF v_n <> 2 THEN RAISE EXCEPTION 'TEST FAIL R14: expected 2 follow-ups, got %', v_n; END IF;
  IF v_due3 = maalrise_today() THEN
    SELECT message INTO v_msg FROM maalrise_notifications
     WHERE user_id = 'a0000000-0000-0000-0000-00000000f004' AND kind = 'payment_due' AND message LIKE '%month 3%';
    IF v_msg NOT LIKE 'Today is the scheduled payment date for Kanziy Test Ltd. Please record the payment received when available.%' THEN
      RAISE EXCEPTION 'TEST FAIL R14: wrong due-today wording: %', v_msg;
    END IF;
    IF EXISTS (SELECT 1 FROM maalrise_notifications WHERE kind = 'payment_followup' AND message LIKE '%month 3%') THEN
      RAISE EXCEPTION 'TEST FAIL R14: a payment due today was flagged for follow-up';
    END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM maalrise_notifications WHERE message LIKE '%month 4%') THEN
    RAISE EXCEPTION 'TEST FAIL R14: a reminder was raised before its date';
  END IF;

  -- idempotent, and every authorised person gets their own
  SELECT COUNT(*) INTO v_n FROM maalrise_notifications;
  PERFORM maalrise_my_notifications();
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_my_notifications();
  IF (SELECT COUNT(*) FROM maalrise_notifications WHERE user_id = 'a0000000-0000-0000-0000-00000000f004' AND kind LIKE 'payment_%')
     <> (SELECT COUNT(*) FROM maalrise_notifications WHERE user_id = 'a0000000-0000-0000-0000-00000000f002' AND kind LIKE 'payment_%') THEN
    RAISE EXCEPTION 'TEST FAIL R14: finance and admin got different reminders';
  END IF;
  IF EXISTS (SELECT 1 FROM maalrise_notifications GROUP BY user_id, dedupe_key HAVING COUNT(*) > 1) THEN
    RAISE EXCEPTION 'TEST FAIL R14: a reminder was repeated';
  END IF;

  -- a date passing creates no money
  IF EXISTS (SELECT 1 FROM maalrise_receipts) OR EXISTS (SELECT 1 FROM maalrise_distributions) THEN
    RAISE EXCEPTION 'TEST FAIL R14: a receipt or distribution appeared because a date passed';
  END IF;
  -- reminders also exist as email DRAFTS, never sent
  IF NOT EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE kind = 'payment_followup' AND status = 'draft') THEN
    RAISE EXCEPTION 'TEST FAIL R14: no follow-up email draft';
  END IF;

  PERFORM maalrise_mark_notifications_read(NULL);
  IF (maalrise_my_notifications()->>'unread')::INTEGER <> 0 THEN RAISE EXCEPTION 'TEST FAIL R14: mark-all-read failed'; END IF;
  RAISE NOTICE 'PASS R14: reminders on the date, follow-up after five days, once each, finance/admin only, no money created';
END $$;

-- ------------------------------------------------------------
-- R13 — recording and confirming receipts
-- ------------------------------------------------------------
DO $$
DECLARE c TEXT := (SELECT v FROM ids WHERE k = 'alpha')::TEXT; r UUID;
BEGIN
  FOREACH r IN ARRAY ARRAY['b0000000-0000-0000-0000-00000000f001', 'a0000000-0000-0000-0000-00000000f003',
                           'a0000000-0000-0000-0000-00000000f005', '10000000-0000-0000-0000-00000000f001']::UUID[] LOOP
    PERFORM set_config('test.uid', r::TEXT, true);
    IF NOT pg_temp.fails(format('SELECT maalrise_record_receipt(%L, %L)', c,
         jsonb_build_object('period', 1, 'amount_kobo', 1, 'received_on', maalrise_today()))) THEN
      RAISE EXCEPTION 'TEST FAIL R13: % recorded a receipt', r;
    END IF;
  END LOOP;

  PERFORM pg_temp.as_user('fin');
  IF NOT pg_temp.fails(format('SELECT maalrise_record_receipt(%L, %L)', c,
       jsonb_build_object('period', 1, 'amount_kobo', 1, 'received_on', maalrise_today() + 1))) THEN
    RAISE EXCEPTION 'TEST FAIL R13: a future-dated receipt was recorded'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_record_receipt(%L, %L)', c,
       jsonb_build_object('period', 1, 'amount_kobo', 0, 'received_on', maalrise_today()))) THEN
    RAISE EXCEPTION 'TEST FAIL R13: a zero receipt was recorded'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_record_receipt(%L, %L)', c,
       jsonb_build_object('period', 7, 'amount_kobo', 5, 'received_on', maalrise_today()))) THEN
    RAISE EXCEPTION 'TEST FAIL R13: a month outside the schedule was accepted'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_record_receipt(%L, %L)', c,
       jsonb_build_object('period', 1, 'amount_kobo', 5, 'received_on', '2000-01-01'))) THEN
    RAISE EXCEPTION 'TEST FAIL R13: a receipt dated before the Cycle started was accepted'; END IF;

  -- finance records month 1 in full (entered late — the actual date is kept)
  INSERT INTO ids VALUES ('r1', maalrise_record_receipt(c::UUID,
    jsonb_build_object('period', 1, 'amount_kobo', 200000000, 'received_on', maalrise_today() - 40, 'reference', 'KZ-0001')));
  IF NOT pg_temp.fails(format('SELECT maalrise_record_receipt(%L, %L)', c,
       jsonb_build_object('period', 2, 'amount_kobo', 5, 'received_on', maalrise_today(), 'reference', ' kz-0001 '))) THEN
    RAISE EXCEPTION 'TEST FAIL R13: a duplicate reference was accepted'; END IF;
  -- finance cannot confirm
  IF NOT pg_temp.fails(format('SELECT maalrise_confirm_receipt(%L)', (SELECT v FROM ids WHERE k = 'r1'))) THEN
    RAISE EXCEPTION 'TEST FAIL R13: finance confirmed a receipt'; END IF;
  IF (SELECT received_on FROM maalrise_receipts WHERE id = (SELECT v FROM ids WHERE k = 'r1')) <> maalrise_today() - 40 THEN
    RAISE EXCEPTION 'TEST FAIL R13: the actual received date was not kept'; END IF;
  IF EXISTS (SELECT 1 FROM maalrise_distributions) THEN
    RAISE EXCEPTION 'TEST FAIL R13: an unconfirmed receipt produced a distribution'; END IF;
  RAISE NOTICE 'PASS R13: only finance/admins record; dates, amounts, months and references checked; finance cannot confirm';
END $$;

-- ------------------------------------------------------------
-- R15 — a full month
-- ------------------------------------------------------------
DO $$
DECLARE d maalrise_distributions%ROWTYPE; v_dist UUID; v_n INTEGER;
BEGIN
  PERFORM pg_temp.as_user('admin');
  v_dist := maalrise_confirm_receipt((SELECT v FROM ids WHERE k = 'r1'));
  INSERT INTO ids VALUES ('d1', v_dist);
  SELECT * INTO d FROM maalrise_distributions WHERE id = v_dist;
  IF d.applied_kobo <> 200000000 OR d.fee_kobo <> 10000000 OR d.net_kobo <> 190000000 OR d.tax_kobo <> 0
     OR d.unallocated_kobo <> 0 OR d.allocated_kobo <> 190000000 OR d.status <> 'prepared' THEN
    RAISE EXCEPTION 'TEST FAIL R15: wrong month-1 distribution %', row_to_json(d);
  END IF;
  IF (SELECT amount_kobo FROM maalrise_distribution_lines WHERE distribution_id = v_dist AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i1')) <> 114000000
     OR (SELECT amount_kobo FROM maalrise_distribution_lines WHERE distribution_id = v_dist AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i2')) <> 63270000
     OR (SELECT amount_kobo FROM maalrise_distribution_lines WHERE distribution_id = v_dist AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i3')) <> 12730000 THEN
    RAISE EXCEPTION 'TEST FAIL R15: shares are not 600/333/67 of ₦1,900,000';
  END IF;
  IF EXISTS (SELECT 1 FROM maalrise_distribution_lines WHERE distribution_id = v_dist AND (status <> 'pending_approval' OR account_number IS NULL)) THEN
    RAISE EXCEPTION 'TEST FAIL R15: lines should await approval with a bank snapshot';
  END IF;
  IF (SELECT account_number FROM maalrise_distribution_lines WHERE distribution_id = v_dist AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i2')) <> '1000000002' THEN
    RAISE EXCEPTION 'TEST FAIL R15: wrong bank snapshot';
  END IF;
  -- confirming twice is refused, so the same money cannot be distributed twice
  IF NOT pg_temp.fails(format('SELECT maalrise_confirm_receipt(%L)', (SELECT v FROM ids WHERE k = 'r1'))) THEN
    RAISE EXCEPTION 'TEST FAIL R15: a receipt was confirmed twice'; END IF;
  -- the officer sees nothing before approval
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('officer');
  SELECT COUNT(*) INTO v_n FROM maalrise_distribution_lines;
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL R15: the payment officer saw unapproved lines'; END IF;
  RAISE NOTICE 'PASS R15: ₦2m received → ₦100k fee, ₦1.9m shared 600/333/67 to the kobo, snapshots kept, nothing payable yet';
END $$;

-- ------------------------------------------------------------
-- R16 — part-payments for month 2 (an admin records AND confirms)
-- ------------------------------------------------------------
DO $$
DECLARE c UUID := (SELECT v FROM ids WHERE k = 'alpha'); a UUID; b UUID; d maalrise_distributions%ROWTYPE; v_sum BIGINT;
BEGIN
  PERFORM pg_temp.as_user('admin');
  a := maalrise_record_receipt(c, jsonb_build_object('period', 2, 'amount_kobo', 123456789, 'received_on', maalrise_today() - 10, 'reference', 'KZ-0002A'));
  INSERT INTO ids VALUES ('d2', maalrise_confirm_receipt(a));   -- their own entry: allowed
  SELECT * INTO d FROM maalrise_distributions WHERE id = (SELECT v FROM ids WHERE k = 'd2');
  -- fee: round(123,456,789 × 10,000,000 / 200,000,000) = round(6,172,839.45) = 6,172,839
  IF d.applied_kobo <> 123456789 OR d.fee_kobo <> 6172839 OR d.net_kobo <> 117283950 THEN
    RAISE EXCEPTION 'TEST FAIL R16: first part wrong %', row_to_json(d);
  END IF;
  SELECT SUM(amount_kobo) INTO v_sum FROM maalrise_distribution_lines WHERE distribution_id = d.id;
  IF v_sum <> d.net_kobo THEN RAISE EXCEPTION 'TEST FAIL R16: lines (%) do not add up to the net (%)', v_sum, d.net_kobo; END IF;
  -- 117,283,950 × 600/1000 = 70,370,370 exactly; × 333/1000 = 39,055,555.35; × 67/1000 = 7,858,024.65 → 39,055,555 / 7,858,025
  IF (SELECT amount_kobo FROM maalrise_distribution_lines WHERE distribution_id = d.id AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i3')) <> 7858025
     OR (SELECT amount_kobo FROM maalrise_distribution_lines WHERE distribution_id = d.id AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i2')) <> 39055555 THEN
    RAISE EXCEPTION 'TEST FAIL R16: largest remainder not applied';
  END IF;

  -- second part, ₦10,000 more than is outstanding: the excess is HELD
  b := maalrise_record_receipt(c, jsonb_build_object('period', 2, 'amount_kobo', 77543211, 'received_on', maalrise_today() - 2));
  IF maalrise_confirm_receipt(b) <> d.id THEN RAISE EXCEPTION 'TEST FAIL R16: a second open distribution was made for month 2'; END IF;
  SELECT * INTO d FROM maalrise_distributions WHERE id = d.id;
  IF d.applied_kobo <> 200000000 OR d.fee_kobo <> 10000000 OR d.net_kobo <> 190000000 THEN
    RAISE EXCEPTION 'TEST FAIL R16: parts do not add up to the scheduled month %', row_to_json(d);
  END IF;
  IF (SELECT held_kobo FROM maalrise_receipts WHERE id = b) <> 1000000 OR (SELECT applied_kobo FROM maalrise_receipts WHERE id = b) <> 76543211 THEN
    RAISE EXCEPTION 'TEST FAIL R16: the excess was not held';
  END IF;
  IF (SELECT COUNT(*) FROM maalrise_distributions WHERE cycle_id = c AND period = 2) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R16: duplicate distributions for month 2';
  END IF;
  -- more money for a month already fully received: all held, no distribution
  b := maalrise_record_receipt(c, jsonb_build_object('period', 2, 'amount_kobo', 5000, 'received_on', maalrise_today()));
  IF maalrise_confirm_receipt(b) IS NOT NULL OR (SELECT held_kobo FROM maalrise_receipts WHERE id = b) <> 5000 THEN
    RAISE EXCEPTION 'TEST FAIL R16: money beyond the schedule was distributed';
  END IF;
  RAISE NOTICE 'PASS R16: part-payments applied once, fee exact in total (₦100,000), one open distribution, excess held';
END $$;

-- ------------------------------------------------------------
-- R17 — approval
-- ------------------------------------------------------------
DO $$
DECLARE v_err TEXT; d2 UUID := (SELECT v FROM ids WHERE k = 'd2'); i2 UUID := (SELECT v FROM ids WHERE k = 'i2');
BEGIN
  FOREACH v_err IN ARRAY ARRAY['fin', 'ops', 'officer', 'cs'] LOOP
    PERFORM pg_temp.as_user(v_err);
    IF NOT pg_temp.fails(format('SELECT maalrise_approve_distribution(%L)', (SELECT v FROM ids WHERE k = 'd1'))) THEN
      RAISE EXCEPTION 'TEST FAIL R17: % approved a distribution', v_err; END IF;
  END LOOP;
  -- the admin who prepared month 1 may approve it
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_distribution((SELECT v FROM ids WHERE k = 'd1'));
  IF EXISTS (SELECT 1 FROM maalrise_distribution_lines WHERE distribution_id = (SELECT v FROM ids WHERE k = 'd1') AND status <> 'payable') THEN
    RAISE EXCEPTION 'TEST FAIL R17: approved lines are not payable'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_approve_distribution(%L)', (SELECT v FROM ids WHERE k = 'd1'))) THEN
    RAISE EXCEPTION 'TEST FAIL R17: approved twice'; END IF;

  -- investor two changes bank: unconfirmed → approval refused
  PERFORM pg_temp.as_user('ops');
  PERFORM maalrise_set_bank_details(i2, 'Kuda', 'Investor Two', '2000000002');
  PERFORM pg_temp.as_user('sa');
  v_err := pg_temp.err(format('SELECT maalrise_approve_distribution(%L)', d2));
  IF v_err IS NULL OR v_err NOT LIKE '%Investor Two%' THEN RAISE EXCEPTION 'TEST FAIL R17: approved with an unconfirmed account (%)', v_err; END IF;
  -- confirmed, but the snapshot is the OLD account → still refused until refreshed
  PERFORM pg_temp.as_user('ops');
  PERFORM maalrise_confirm_bank_details(i2);
  PERFORM pg_temp.as_user('sa');
  IF NOT pg_temp.fails(format('SELECT maalrise_approve_distribution(%L)', d2)) THEN
    RAISE EXCEPTION 'TEST FAIL R17: approved against an outdated account snapshot'; END IF;
  PERFORM maalrise_refresh_distribution(d2);
  PERFORM maalrise_approve_distribution(d2);
  IF (SELECT account_number FROM maalrise_distribution_lines WHERE distribution_id = d2 AND maalrise_investor_id = i2) <> '2000000002' THEN
    RAISE EXCEPTION 'TEST FAIL R17: refreshed snapshot not used'; END IF;
  -- month 1 (approved earlier) keeps the account it was approved for
  IF (SELECT account_number FROM maalrise_distribution_lines WHERE distribution_id = (SELECT v FROM ids WHERE k = 'd1') AND maalrise_investor_id = i2) <> '1000000002' THEN
    RAISE EXCEPTION 'TEST FAIL R17: an approved payment''s account changed'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_refresh_distribution(%L)', d2)) THEN
    RAISE EXCEPTION 'TEST FAIL R17: an approved distribution was recalculated'; END IF;
  RAISE NOTICE 'PASS R17: admins approve (preparer allowed); unconfirmed/changed accounts block approval; approved accounts frozen';
END $$;

-- ------------------------------------------------------------
-- R18 — part-payment after approval → follow-on distribution
-- ------------------------------------------------------------
DO $$
DECLARE c UUID := (SELECT v FROM ids WHERE k = 'alpha'); a UUID; d3 UUID; d3b UUID;
BEGIN
  PERFORM pg_temp.as_user('fin');
  a := maalrise_record_receipt(c, jsonb_build_object('period', 3, 'amount_kobo', 50000000, 'received_on', maalrise_today()));
  PERFORM pg_temp.as_user('sa');
  d3 := maalrise_confirm_receipt(a);
  PERFORM maalrise_approve_distribution(d3);
  PERFORM pg_temp.as_user('fin2');
  a := maalrise_record_receipt(c, jsonb_build_object('period', 3, 'amount_kobo', 150000000, 'received_on', maalrise_today()));
  PERFORM pg_temp.as_user('sa');
  d3b := maalrise_confirm_receipt(a);
  IF d3b = d3 THEN RAISE EXCEPTION 'TEST FAIL R18: new money was added to an approved distribution'; END IF;
  IF (SELECT sequence FROM maalrise_distributions WHERE id = d3b) <> 2
     OR (SELECT fee_kobo FROM maalrise_distributions WHERE id = d3) <> 2500000
     OR (SELECT fee_kobo FROM maalrise_distributions WHERE id = d3b) <> 7500000
     OR (SELECT SUM(net_kobo) FROM maalrise_distributions WHERE cycle_id = c AND period = 3) <> 190000000 THEN
    RAISE EXCEPTION 'TEST FAIL R18: follow-on distribution wrong';
  END IF;
  INSERT INTO ids VALUES ('d3b', d3b);
  RAISE NOTICE 'PASS R18: money confirmed after approval goes into a follow-on distribution of the new money only';
END $$;

-- ------------------------------------------------------------
-- R19 — rejecting a wrong entry
-- ------------------------------------------------------------
DO $$
DECLARE c UUID := (SELECT v FROM ids WHERE k = 'alpha'); a UUID;
BEGIN
  PERFORM pg_temp.as_user('fin');
  a := maalrise_record_receipt(c, jsonb_build_object('period', 4, 'amount_kobo', 999, 'received_on', maalrise_today(), 'reference', 'TYPO'));
  IF NOT pg_temp.fails(format('SELECT maalrise_reject_receipt(%L, %L)', a, 'typo')) THEN
    RAISE EXCEPTION 'TEST FAIL R19: finance rejected an entry'; END IF;
  PERFORM pg_temp.as_user('admin');
  IF NOT pg_temp.fails(format('SELECT maalrise_reject_receipt(%L, %L)', a, '  ')) THEN
    RAISE EXCEPTION 'TEST FAIL R19: rejected without a reason'; END IF;
  PERFORM maalrise_reject_receipt(a, 'Typing error');
  IF NOT pg_temp.fails(format('SELECT maalrise_confirm_receipt(%L)', a)) THEN
    RAISE EXCEPTION 'TEST FAIL R19: a rejected entry was confirmed'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_reject_receipt(%L, %L)', (SELECT v FROM ids WHERE k = 'r1'), 'late')) THEN
    RAISE EXCEPTION 'TEST FAIL R19: a confirmed entry was rejected'; END IF;
  -- the reference of a rejected entry can be used again
  PERFORM pg_temp.as_user('fin');
  PERFORM maalrise_record_receipt(c, jsonb_build_object('period', 4, 'amount_kobo', 1, 'received_on', maalrise_today(), 'reference', 'typo'));
  RAISE NOTICE 'PASS R19: admins reject with a reason; rejected entries are final; confirmed entries cannot be rejected';
END $$;

-- ------------------------------------------------------------
-- R20 — paying
-- ------------------------------------------------------------
DO $$
DECLARE l UUID; l2 UUID; v_n INTEGER; v_status TEXT; p TEXT;
BEGIN
  SELECT id INTO l FROM maalrise_distribution_lines
   WHERE distribution_id = (SELECT v FROM ids WHERE k = 'd1') AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i1');
  SELECT id INTO l2 FROM maalrise_distribution_lines
   WHERE distribution_id = (SELECT v FROM ids WHERE k = 'd3b') AND maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i1');

  FOREACH p IN ARRAY ARRAY['fin', 'ops', 'cs', 'inv1'] LOOP
    PERFORM pg_temp.as_user(p);
    IF NOT pg_temp.fails(format('SELECT maalrise_mark_line_paid(%L, %L, %L)', l, maalrise_today(), 'X')) THEN
      RAISE EXCEPTION 'TEST FAIL R20: % marked a payment paid', p; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('officer');
  IF NOT pg_temp.fails(format('SELECT maalrise_mark_line_paid(%L, %L, %L)', l2, maalrise_today(), 'X')) THEN
    RAISE EXCEPTION 'TEST FAIL R20: an unapproved line was marked paid'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_mark_line_paid(%L, %L, %L)', l, maalrise_today() + 1, 'X')) THEN
    RAISE EXCEPTION 'TEST FAIL R20: a future transfer date was accepted'; END IF;

  -- the investor does not see "paid" before the transfer is recorded
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  SELECT status INTO v_status FROM maalrise_distribution_lines WHERE id = l;
  SELECT COUNT(*) INTO v_n FROM maalrise_distribution_lines;
  RESET ROLE;
  IF v_status <> 'payable' THEN RAISE EXCEPTION 'TEST FAIL R20: investor saw % before payment', v_status; END IF;
  IF v_n <> (SELECT COUNT(*) FROM maalrise_distribution_lines WHERE maalrise_investor_id = (SELECT v FROM ids WHERE k = 'i1') AND status IN ('payable', 'paid')) THEN
    RAISE EXCEPTION 'TEST FAIL R20: an investor saw lines that are not their own approved ones'; END IF;

  PERFORM pg_temp.as_user('officer');
  PERFORM maalrise_mark_line_paid(l, maalrise_today(), 'TRF-778');
  IF NOT pg_temp.fails(format('SELECT maalrise_mark_line_paid(%L, %L, %L)', l, maalrise_today(), 'TRF-779')) THEN
    RAISE EXCEPTION 'TEST FAIL R20: paid twice'; END IF;

  -- one central status, read by investor, officer and staff alike
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('inv1');
  SELECT status INTO v_status FROM maalrise_distribution_lines WHERE id = l;
  IF v_status <> 'paid' THEN RESET ROLE; RAISE EXCEPTION 'TEST FAIL R20: investor does not see paid'; END IF;
  PERFORM pg_temp.as_user('officer');
  SELECT COUNT(*) INTO v_n FROM maalrise_distribution_lines WHERE status = 'pending_approval';
  RESET ROLE;
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL R20: officer saw lines awaiting approval'; END IF;

  -- investor notified (portal later) and an email DRAFT prepared
  IF NOT EXISTS (SELECT 1 FROM maalrise_notifications WHERE user_id = '10000000-0000-0000-0000-00000000f001' AND kind = 'payment_paid'
                 AND message LIKE '%TRF-778%') THEN RAISE EXCEPTION 'TEST FAIL R20: investor not notified'; END IF;
  IF NOT EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE to_email = 'inv1@d.com' AND kind = 'payment_paid' AND status = 'draft') THEN
    RAISE EXCEPTION 'TEST FAIL R20: no email draft'; END IF;

  -- reversal: super admin only, reason required
  FOREACH p IN ARRAY ARRAY['officer', 'admin', 'fin'] LOOP
    PERFORM pg_temp.as_user(p);
    IF NOT pg_temp.fails(format('SELECT maalrise_reverse_line_payment(%L, %L)', l, 'wrong')) THEN
      RAISE EXCEPTION 'TEST FAIL R20: % reversed a payment', p; END IF;
  END LOOP;
  PERFORM pg_temp.as_user('sa');
  IF NOT pg_temp.fails(format('SELECT maalrise_reverse_line_payment(%L, %L)', l, '')) THEN
    RAISE EXCEPTION 'TEST FAIL R20: reversed without a reason'; END IF;
  PERFORM maalrise_reverse_line_payment(l, 'Transfer bounced');
  IF (SELECT status FROM maalrise_distribution_lines WHERE id = l) <> 'payable' THEN RAISE EXCEPTION 'TEST FAIL R20: not payable after reversal'; END IF;
  PERFORM pg_temp.as_user('officer');
  PERFORM maalrise_mark_line_paid(l, maalrise_today(), 'TRF-780');
  IF (SELECT string_agg(event || ':' || COALESCE(reference, ''), ',' ORDER BY created_at) FROM maalrise_payment_events WHERE line_id = l)
     <> 'marked_paid:TRF-778,reversed:TRF-778,marked_paid:TRF-780' THEN
    RAISE EXCEPTION 'TEST FAIL R20: history incomplete: %', (SELECT string_agg(event || ':' || COALESCE(reference, ''), ',') FROM maalrise_payment_events WHERE line_id = l);
  END IF;
  IF NOT pg_temp.fails('UPDATE maalrise_payment_events SET reason = ''x'' WHERE true')
     OR NOT pg_temp.fails('DELETE FROM maalrise_payment_events WHERE true') THEN
    RAISE EXCEPTION 'TEST FAIL R20: payment history could be changed'; END IF;
  IF NOT pg_temp.fails(format('UPDATE maalrise_distribution_lines SET amount_kobo = 1 WHERE id = %L', l)) THEN
    RAISE EXCEPTION 'TEST FAIL R20: an approved line''s amount could be changed'; END IF;
  RAISE NOTICE 'PASS R20: only officer/admins mark paid; investor sees paid only after; super admin reverses with reason; history append-only';
END $$;

-- ------------------------------------------------------------
-- R21 — unsubscribed units stay unallocated
--       (an under-funded Cycle is forced active here, which the real
--        activation checks never allow, purely to test the arithmetic)
-- ------------------------------------------------------------
DO $$
DECLARE c UUID; t UUID; f UUID; d maalrise_distributions%ROWTYPE; v_start DATE := (maalrise_today() - INTERVAL '1 month')::DATE;
BEGIN
  PERFORM pg_temp.as_user('ops');
  c := maalrise_create_cycle(jsonb_build_object('name', 'Dist Test Beta', 'transaction_name', 'Murabaha',
    'counterparty_id', (SELECT v FROM ids WHERE k = 'cp'), 'start_date', v_start, 'duration_months', 6, 'unit_price_kobo', 10000000));
  t := maalrise_save_terms(c, pg_temp.terms(), pg_temp.schedule());
  PERFORM maalrise_submit_terms(t);
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(t);
  PERFORM pg_temp.as_user('fin');
  f := maalrise_record_funding(c, (SELECT v FROM ids WHERE k = 'i1'), 700, 7000000000, v_start - 1, 'DB-1');
  PERFORM pg_temp.as_user('sa');
  PERFORM maalrise_confirm_funding(f);
  UPDATE maalrise_cycles SET status = 'active' WHERE id = c;   -- test-only shortcut

  f := maalrise_record_receipt(c, jsonb_build_object('period', 1, 'amount_kobo', 200000000, 'received_on', maalrise_today()));
  t := maalrise_confirm_receipt(f);
  SELECT * INTO d FROM maalrise_distributions WHERE id = t;
  IF d.allocated_kobo <> 133000000 OR d.unallocated_kobo <> 57000000 THEN
    RAISE EXCEPTION 'TEST FAIL R21: 700 of 1000 units should get ₦1,330,000 with ₦570,000 unallocated, got % / %', d.allocated_kobo, d.unallocated_kobo;
  END IF;
  RAISE NOTICE 'PASS R21: the unsubscribed 30%% share (₦570,000) stays unallocated';
END $$;

-- ------------------------------------------------------------
-- R22 — no direct writes; helpers not callable
-- ------------------------------------------------------------
DO $$
DECLARE t TEXT; p TEXT; v_line UUID;
BEGIN
  SELECT schedule_line_id INTO v_line FROM maalrise_receipts LIMIT 1;
  SET LOCAL ROLE authenticated;
  FOREACH p IN ARRAY ARRAY['sa', 'admin', 'fin', 'officer', 'inv1'] LOOP
    PERFORM pg_temp.as_user(p);
    FOREACH t IN ARRAY ARRAY[
      format('INSERT INTO maalrise_receipts (cycle_id, schedule_line_id, period, amount_kobo, received_on, recorded_by) VALUES (%L, %L, 1, 1, CURRENT_DATE, auth.uid())',
             (SELECT v FROM ids WHERE k = 'alpha'), v_line),
      'UPDATE maalrise_distribution_lines SET status = ''paid'' WHERE true',
      'UPDATE maalrise_distributions SET net_kobo = 0 WHERE true',
      'DELETE FROM maalrise_receipts WHERE true',
      'INSERT INTO maalrise_notifications (user_id, kind, title, message) VALUES (auth.uid(), ''x'', ''x'', ''x'')',
      'UPDATE maalrise_email_outbox SET status = ''sent'' WHERE true',
      format('SELECT maalrise_build_distribution_lines(%L)', (SELECT v FROM ids WHERE k = 'd3b')),
      'SELECT maalrise_notify_roles(ARRAY[''investor''], ''x'', ''x'', ''x'', NULL, NULL, ''spam'')',
      'SELECT maalrise_sync_reminders()'] LOOP
      -- a write that "succeeds" on zero visible rows is also a refusal
      IF NOT pg_temp.fails(t) AND (t LIKE 'SELECT%' OR t LIKE 'INSERT%') THEN
        RESET ROLE; RAISE EXCEPTION 'TEST FAIL R22: % could run: %', p, t;
      END IF;
    END LOOP;
  END LOOP;
  RESET ROLE;
  IF EXISTS (SELECT 1 FROM maalrise_distribution_lines WHERE status = 'paid' AND paid_by IS NULL)
     OR EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE status <> 'draft')
     OR (SELECT COUNT(*) FROM maalrise_receipts) < 8 THEN
    RAISE EXCEPTION 'TEST FAIL R22: a direct write got through';
  END IF;
  RAISE NOTICE 'PASS R22: no direct writes for anyone; internal helpers refused';
END $$;

-- ------------------------------------------------------------
-- R23 — MaalGrow untouched, everything audited, drafts only
-- ------------------------------------------------------------
DO $$
DECLARE b before_counts%ROWTYPE; a TEXT;
BEGIN
  SELECT * INTO b FROM before_counts;
  IF (SELECT COUNT(*) FROM investors) <> b.investors OR (SELECT COUNT(*) FROM payment_requests) <> b.payment_requests
     OR (SELECT COUNT(*) FROM notifications) <> b.notifications OR (SELECT COUNT(*) FROM investments) <> b.investments THEN
    RAISE EXCEPTION 'TEST FAIL R23: a MaalGrow table changed';
  END IF;
  FOREACH a IN ARRAY ARRAY['maalrise_record_receipt', 'maalrise_confirm_receipt', 'maalrise_reject_receipt',
                           'maalrise_approve_distribution', 'maalrise_refresh_distribution',
                           'maalrise_mark_line_paid', 'maalrise_reverse_line_payment'] LOOP
    IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = a) THEN RAISE EXCEPTION 'TEST FAIL R23: % not audited', a; END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE status <> 'draft' OR sent_at IS NOT NULL) THEN
    RAISE EXCEPTION 'TEST FAIL R23: an email was marked sent'; END IF;
  RAISE NOTICE 'PASS R23: MaalGrow tables unchanged; every action audited; % email drafts, none sent',
    (SELECT COUNT(*) FROM maalrise_email_outbox);
END $$;

ROLLBACK;
