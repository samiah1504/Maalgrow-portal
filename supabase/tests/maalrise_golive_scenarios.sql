-- ============================================================
-- MaalRise go-live readiness (055) — scenarios
--
-- Run ONLY against a scratch database built from the stub and the
-- migrations (051–055). Everything ROLLS BACK at the end.
--
--   R38 emails: only super admin / administrator send or discard;
--       each draft is sent once; failures are kept and can be retried;
--       sent emails are final; nothing is sent by itself
--   R39 one person, one record: MaalGrow KYC submitted → MaalRise
--       pending review; approved → verified; bank details carried
--       across unconfirmed; MaalGrow rows never changed
--   R40 an investor's sync touches only themselves; a MaalRise-own
--       verification is never undone by MaalGrow
--   R41 bank-change decisions prepare an email draft for the investor
--   R42 the MaalGrow record alone is not MaalGrow access; no direct
--       writes; MaalGrow untouched; audited
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;

INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000f001', 'sa@g.com'),
 ('a0000000-0000-0000-0000-00000000f002', 'admin@g.com'),
 ('a0000000-0000-0000-0000-00000000f003', 'ops@g.com'),
 ('a0000000-0000-0000-0000-00000000f004', 'fin@g.com'),
 ('b0000000-0000-0000-0000-00000000f001', 'officer@g.com'),
 ('10000000-0000-0000-0000-00000000f101', 'new.rise@g.com'),
 ('10000000-0000-0000-0000-00000000f102', 'other.rise@g.com'),
 ('10000000-0000-0000-0000-00000000f103', 'own.kyc@g.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000f001', 'sa@g.com',        'G Super Admin', 'super_admin'),
 ('a0000000-0000-0000-0000-00000000f002', 'admin@g.com',     'G Admin',       'administrator'),
 ('a0000000-0000-0000-0000-00000000f003', 'ops@g.com',       'G Ops',         'operations'),
 ('a0000000-0000-0000-0000-00000000f004', 'fin@g.com',       'G Finance',     'finance'),
 ('b0000000-0000-0000-0000-00000000f001', 'officer@g.com',   'G Officer',     'payment_officer'),
 ('10000000-0000-0000-0000-00000000f101', 'new.rise@g.com',  'New Rise',      'investor'),
 ('10000000-0000-0000-0000-00000000f102', 'other.rise@g.com','Other Rise',    'investor'),
 ('10000000-0000-0000-0000-00000000f103', 'own.kyc@g.com',   'Own Kyc',       'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name, email = EXCLUDED.email;
-- The base investor records, as the MaalRise-only onboarding creates them:
-- nothing submitted, no bank details yet.
INSERT INTO investors (id, profile_id, investor_code, full_name, email, kyc_status) VALUES
 ('20000000-0000-0000-0000-00000000f101', '10000000-0000-0000-0000-00000000f101', 'MG-GL0001', 'New Rise', 'new.rise@g.com', 'pending'),
 ('20000000-0000-0000-0000-00000000f102', '10000000-0000-0000-0000-00000000f102', 'MG-GL0002', 'Other Rise', 'other.rise@g.com', 'pending'),
 ('20000000-0000-0000-0000-00000000f103', '10000000-0000-0000-0000-00000000f103', 'MG-GL0003', 'Own Kyc', 'own.kyc@g.com', 'pending');

CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
GRANT ALL ON ids TO authenticated;
CREATE TEMP TABLE before_counts AS
  SELECT (SELECT COUNT(*) FROM investors) AS investors, (SELECT COUNT(*) FROM payment_requests) AS payment_requests,
         (SELECT COUNT(*) FROM notifications) AS notifications, (SELECT COUNT(*) FROM investments) AS investments;

CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p
    WHEN 'sa' THEN 'a0000000-0000-0000-0000-00000000f001' WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000f002'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000f003' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000f004'
    WHEN 'officer' THEN 'b0000000-0000-0000-0000-00000000f001'
    WHEN 'new' THEN '10000000-0000-0000-0000-00000000f101' WHEN 'other' THEN '10000000-0000-0000-0000-00000000f102'
    WHEN 'own' THEN '10000000-0000-0000-0000-00000000f103' WHEN 'nobody' THEN '' END, true);
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
CREATE FUNCTION pg_temp.mg_row(p UUID) RETURNS TEXT AS $$ SELECT md5(row_to_json(i)::TEXT) FROM investors i WHERE id = p; $$ LANGUAGE sql;

DO $$
BEGIN
  PERFORM pg_temp.as_user('ops');
  INSERT INTO ids VALUES ('new', maalrise_add_investor('10000000-0000-0000-0000-00000000f101', '{}'));
  INSERT INTO ids VALUES ('other', maalrise_add_investor('10000000-0000-0000-0000-00000000f102', '{}'));
  INSERT INTO ids VALUES ('own', maalrise_add_investor('10000000-0000-0000-0000-00000000f103', '{}'));
  -- "Own Kyc" was verified through MaalRise's own review.
  PERFORM maalrise_record_kyc_submission((SELECT v FROM ids WHERE k = 'own'), '{"id_type":"NIN","id_number":"3"}');
  PERFORM maalrise_review_kyc((SELECT v FROM ids WHERE k = 'own'), 'verified', NULL);
END $$;

-- ------------------------------------------------------------
-- R39 — MaalGrow KYC and bank details carried across
-- ------------------------------------------------------------
DO $$
DECLARE n UUID := (SELECT v FROM ids WHERE k = 'new'); s TEXT; g0 TEXT; g1 TEXT; v_n INTEGER;
BEGIN
  IF (SELECT kyc_status || ':' || COALESCE(account_number, '-') FROM maalrise_investors WHERE id = n) <> 'not_started:-' THEN
    RAISE EXCEPTION 'TEST FAIL R39: unexpected starting state'; END IF;
  -- The investor fills the MaalGrow KYC form (bank details included).
  PERFORM pg_temp.as_user('admin');
  UPDATE investors SET kyc_submitted_at = NOW(), bank_name = 'GTB', account_name = 'New Rise', account_number = '1111222233'
   WHERE id = '20000000-0000-0000-0000-00000000f101';
  g0 := pg_temp.mg_row('20000000-0000-0000-0000-00000000f101');
  PERFORM pg_temp.as_user('fin');
  v_n := maalrise_sync_from_maalgrow();
  SELECT kyc_status || ':' || account_number || ':' || (bank_confirmed_at IS NULL) INTO s FROM maalrise_investors WHERE id = n;
  IF s <> 'pending_review:1111222233:true' THEN RAISE EXCEPTION 'TEST FAIL R39: after submission %', s; END IF;
  IF NOT EXISTS (SELECT 1 FROM maalrise_bank_details_history WHERE maalrise_investor_id = n AND event = 'prefilled_from_maalgrow') THEN
    RAISE EXCEPTION 'TEST FAIL R39: bank prefill not in history'; END IF;
  -- Staff approve it in the existing MaalGrow KYC screen.
  PERFORM pg_temp.as_user('admin');
  UPDATE investors SET kyc_status = 'approved' WHERE id = '20000000-0000-0000-0000-00000000f101';
  g0 := pg_temp.mg_row('20000000-0000-0000-0000-00000000f101');
  PERFORM pg_temp.as_user('ops');
  PERFORM maalrise_sync_from_maalgrow();
  g1 := pg_temp.mg_row('20000000-0000-0000-0000-00000000f101');
  SELECT kyc_status || ':' || kyc_source INTO s FROM maalrise_investors WHERE id = n;
  IF s <> 'verified:maalgrow' THEN RAISE EXCEPTION 'TEST FAIL R39: after approval %', s; END IF;
  IF g0 <> g1 THEN RAISE EXCEPTION 'TEST FAIL R39: the sync changed the MaalGrow record'; END IF;
  -- Running it again changes nothing.
  IF maalrise_sync_from_maalgrow() <> 0 THEN RAISE EXCEPTION 'TEST FAIL R39: sync is not idempotent'; END IF;
  -- Bank details already present are never overwritten.
  PERFORM pg_temp.as_user('admin');
  UPDATE investors SET account_number = '9999888877' WHERE id = '20000000-0000-0000-0000-00000000f101';
  PERFORM pg_temp.as_user('ops');
  PERFORM maalrise_sync_from_maalgrow();
  IF (SELECT account_number FROM maalrise_investors WHERE id = n) <> '1111222233' THEN
    RAISE EXCEPTION 'TEST FAIL R39: existing MaalRise bank details overwritten'; END IF;
  RAISE NOTICE 'PASS R39: MaalGrow KYC submitted → pending, approved → verified; bank carried across unconfirmed; MaalGrow untouched';
END $$;

-- ------------------------------------------------------------
-- R40 — scope of a sync; MaalRise's own verification stands
-- ------------------------------------------------------------
DO $$
DECLARE s TEXT;
BEGIN
  PERFORM pg_temp.as_user('admin');
  UPDATE investors SET kyc_submitted_at = NOW(), kyc_status = 'approved' WHERE id = '20000000-0000-0000-0000-00000000f102';
  UPDATE investors SET kyc_status = 'rejected' WHERE id = '20000000-0000-0000-0000-00000000f103';
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('new');
  PERFORM maalrise_sync_from_maalgrow();
  PERFORM pg_temp.as_user('nobody');
  IF maalrise_sync_from_maalgrow() <> 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAIL R40: anonymous sync did something'; END IF;
  PERFORM pg_temp.as_user('officer');
  IF maalrise_sync_from_maalgrow() <> 0 THEN RESET ROLE; RAISE EXCEPTION 'TEST FAIL R40: payment officer sync did something'; END IF;
  RESET ROLE;
  IF (SELECT kyc_status FROM maalrise_investors WHERE id = (SELECT v FROM ids WHERE k = 'other')) <> 'not_started' THEN
    RAISE EXCEPTION 'TEST FAIL R40: one investor''s sync changed another investor'; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('other');
  PERFORM maalrise_sync_from_maalgrow();
  RESET ROLE;
  IF (SELECT kyc_status FROM maalrise_investors WHERE id = (SELECT v FROM ids WHERE k = 'other')) <> 'verified' THEN
    RAISE EXCEPTION 'TEST FAIL R40: an investor''s own sync did not apply'; END IF;
  PERFORM pg_temp.as_user('ops');
  PERFORM maalrise_sync_from_maalgrow();
  SELECT kyc_status || ':' || kyc_source INTO s FROM maalrise_investors WHERE id = (SELECT v FROM ids WHERE k = 'own');
  IF s <> 'verified:maalrise' THEN RAISE EXCEPTION 'TEST FAIL R40: MaalGrow undid a MaalRise verification (%)', s; END IF;
  RAISE NOTICE 'PASS R40: an investor syncs only themselves; others nothing; MaalRise''s own verification stands';
END $$;

-- ------------------------------------------------------------
-- R41 — bank-change decisions prepare an email draft
-- ------------------------------------------------------------
DO $$
DECLARE q UUID;
BEGIN
  PERFORM pg_temp.as_user('ops');
  PERFORM maalrise_confirm_bank_details((SELECT v FROM ids WHERE k = 'new'));
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('new');
  q := maalrise_request_bank_change('{"bank_name":"Opay","account_name":"New Rise","account_number":"2222333344"}');
  RESET ROLE;
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_review_bank_change(q, true, NULL);
  IF NOT EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE kind = 'bank_change_approved' AND to_email = 'new.rise@g.com'
                 AND status = 'draft' AND subject = 'MaalRise: your bank details were updated' AND body LIKE '%ending 3344%') THEN
    RAISE EXCEPTION 'TEST FAIL R41: no approval email draft'; END IF;
  SET LOCAL ROLE authenticated;
  PERFORM pg_temp.as_user('new');
  q := maalrise_request_bank_change('{"bank_name":"Kuda","account_name":"Somebody Else","account_number":"5555666677"}');
  RESET ROLE;
  PERFORM pg_temp.as_user('ops');
  PERFORM maalrise_review_bank_change(q, false, 'Name does not match');
  IF NOT EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE kind = 'bank_change_rejected' AND to_email = 'new.rise@g.com'
                 AND status = 'draft' AND body LIKE '%Name does not match%') THEN
    RAISE EXCEPTION 'TEST FAIL R41: no rejection email draft'; END IF;
  RAISE NOTICE 'PASS R41: bank-change approval and rejection each prepare an email draft for the investor';
END $$;

-- ------------------------------------------------------------
-- R38 — sending and discarding emails
-- ------------------------------------------------------------
DO $$
DECLARE a UUID; b UUID; c UUID; j JSONB; p TEXT; v_err TEXT;
BEGIN
  SELECT id INTO a FROM maalrise_email_outbox WHERE kind = 'bank_change_approved';
  SELECT id INTO b FROM maalrise_email_outbox WHERE kind = 'bank_change_rejected';
  PERFORM maalrise_notify_investor((SELECT v FROM ids WHERE k = 'other'), 'payment_paid', 'Profit payment sent', 'Body C',
    'golive:c', 'MaalRise profit payment sent');
  SELECT id INTO c FROM maalrise_email_outbox WHERE dedupe_key = 'golive:c';

  FOREACH p IN ARRAY ARRAY['ops', 'fin', 'officer', 'new'] LOOP
    PERFORM pg_temp.as_user(p);
    IF NOT pg_temp.fails(format('SELECT maalrise_claim_email(%L)', a)) OR NOT pg_temp.fails(format('SELECT maalrise_discard_email(%L)', a)) THEN
      RAISE EXCEPTION 'TEST FAIL R38: % could send or discard', p; END IF;
  END LOOP;

  PERFORM pg_temp.as_user('admin');
  j := maalrise_claim_email(a);
  IF j->>'to_email' <> 'new.rise@g.com' OR j->>'subject' <> 'MaalRise: your bank details were updated' OR j->>'body' NOT LIKE '%3344%' THEN
    RAISE EXCEPTION 'TEST FAIL R38: claim returned %', j; END IF;
  v_err := pg_temp.err(format('SELECT maalrise_claim_email(%L)', a));
  IF v_err NOT LIKE '%already queued%' THEN RAISE EXCEPTION 'TEST FAIL R38: a queued email was claimed twice (%)', v_err; END IF;
  PERFORM maalrise_email_result(a, true, 'prov-1', NULL);
  IF (SELECT status || ':' || provider_id || ':' || (sent_at IS NOT NULL) FROM maalrise_email_outbox WHERE id = a) <> 'sent:prov-1:true' THEN
    RAISE EXCEPTION 'TEST FAIL R38: sent not recorded'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_claim_email(%L)', a)) OR NOT pg_temp.fails(format('SELECT maalrise_discard_email(%L)', a))
     OR NOT pg_temp.fails(format('SELECT maalrise_email_result(%L, false, NULL, ''x'')', a)) THEN
    RAISE EXCEPTION 'TEST FAIL R38: a sent email could be changed'; END IF;

  -- A failure is kept and can be retried by the other approver role.
  PERFORM pg_temp.as_user('sa');
  PERFORM maalrise_claim_email(b);
  PERFORM maalrise_email_result(b, false, NULL, 'RESEND_API_KEY not configured');
  IF (SELECT status || ':' || last_error || ':' || attempts FROM maalrise_email_outbox WHERE id = b) <> 'failed:RESEND_API_KEY not configured:1' THEN
    RAISE EXCEPTION 'TEST FAIL R38: failure not recorded'; END IF;
  PERFORM maalrise_claim_email(b);
  PERFORM maalrise_email_result(b, true, 'prov-2', NULL);
  IF (SELECT status || ':' || attempts || ':' || (last_error IS NULL) FROM maalrise_email_outbox WHERE id = b) <> 'sent:2:true' THEN
    RAISE EXCEPTION 'TEST FAIL R38: retry not recorded'; END IF;

  -- A send that stopped part-way can be taken again after ten minutes, not before.
  PERFORM maalrise_claim_email(c);
  IF NOT pg_temp.fails(format('SELECT maalrise_claim_email(%L)', c)) THEN RAISE EXCEPTION 'TEST FAIL R38: fresh queued reclaimed'; END IF;
  UPDATE maalrise_email_outbox SET queued_at = NOW() - INTERVAL '11 minutes' WHERE id = c;
  PERFORM maalrise_claim_email(c);
  PERFORM maalrise_email_result(c, false, NULL, 'timeout');
  PERFORM maalrise_discard_email(c);
  IF (SELECT status || ':' || (discarded_at IS NOT NULL) || ':' || handled_by FROM maalrise_email_outbox WHERE id = c)
     <> 'discarded:true:a0000000-0000-0000-0000-00000000f001' THEN RAISE EXCEPTION 'TEST FAIL R38: discard not recorded'; END IF;
  IF NOT pg_temp.fails(format('SELECT maalrise_claim_email(%L)', c)) THEN RAISE EXCEPTION 'TEST FAIL R38: a discarded email was sent'; END IF;
  RAISE NOTICE 'PASS R38: only super admin/administrator send or discard; each sent once; failures kept and retried; sent and discarded are final';
END $$;

-- ------------------------------------------------------------
-- R42 — no direct writes; MaalGrow untouched; audited; nothing automatic
-- ------------------------------------------------------------
DO $$
DECLARE b before_counts%ROWTYPE; t TEXT; p TEXT;
BEGIN
  SET LOCAL ROLE authenticated;
  FOREACH p IN ARRAY ARRAY['sa', 'admin', 'new'] LOOP
    PERFORM pg_temp.as_user(p);
    PERFORM pg_temp.err('UPDATE maalrise_email_outbox SET status = ''sent'' WHERE true');
    PERFORM pg_temp.err('UPDATE maalrise_investors SET kyc_status = ''verified'' WHERE true');
  END LOOP;
  -- Holding the MaalGrow record alone is not holding MaalGrow.
  PERFORM pg_temp.as_user('new');
  IF maalrise_my_access() <> '{"maalrise": true, "maalgrow": false}'::JSONB THEN
    RESET ROLE; RAISE EXCEPTION 'TEST FAIL R42: a MaalRise-only person counted as MaalGrow (%)', maalrise_my_access(); END IF;
  RESET ROLE;
  IF (SELECT kyc_status FROM maalrise_investors WHERE id = (SELECT v FROM ids WHERE k = 'other')) <> 'verified'
     OR EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE status = 'sent' AND provider_id IS NULL) THEN
    RAISE EXCEPTION 'TEST FAIL R42: a direct write got through'; END IF;
  SELECT * INTO b FROM before_counts;
  IF (SELECT COUNT(*) FROM investors) <> b.investors OR (SELECT COUNT(*) FROM payment_requests) <> b.payment_requests
     OR (SELECT COUNT(*) FROM notifications) <> b.notifications OR (SELECT COUNT(*) FROM investments) <> b.investments THEN
    RAISE EXCEPTION 'TEST FAIL R42: a MaalGrow table changed'; END IF;
  FOREACH t IN ARRAY ARRAY['maalrise_email_sent', 'maalrise_email_failed', 'maalrise_email_discarded',
                           'maalrise_sync_kyc_from_maalgrow', 'maalrise_sync_bank_from_maalgrow'] LOOP
    IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = t) THEN RAISE EXCEPTION 'TEST FAIL R42: % not audited', t; END IF;
  END LOOP;
  IF (SELECT COUNT(*) FROM maalrise_email_outbox WHERE status = 'sent') <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL R42: emails sent other than the two pressed'; END IF;
  RAISE NOTICE 'PASS R42: MaalRise-only is not MaalGrow; no direct writes; MaalGrow untouched; every send, failure, discard and sync audited; nothing automatic';
END $$;

ROLLBACK;
