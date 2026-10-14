-- ============================================================
-- MaalRise 057 — emailing a Cycle's investors at once — scenarios
-- Scratch database only (051–057). Everything ROLLS BACK.
--
--   R45 one email per investor per Cycle: an invitation for someone
--       who never signed in, a notification for an existing login;
--       pressing again adds nothing; sent ones are counted, not resent;
--       only super admins and administrators; needs confirmed funding
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000e901', 'admin@ce.com'), ('a0000000-0000-0000-0000-00000000e902', 'ops@ce.com'),
 ('a0000000-0000-0000-0000-00000000e903', 'fin@ce.com'),
 ('10000000-0000-0000-0000-00000000e911', 'new@ce.com'), ('10000000-0000-0000-0000-00000000e912', 'old@ce.com') ON CONFLICT DO NOTHING;
UPDATE auth.users SET last_sign_in_at = NOW() - INTERVAL '30 days' WHERE id = '10000000-0000-0000-0000-00000000e912';
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000e901', 'admin@ce.com', 'CE Admin', 'administrator'),
 ('a0000000-0000-0000-0000-00000000e902', 'ops@ce.com', 'CE Ops', 'operations'),
 ('a0000000-0000-0000-0000-00000000e903', 'fin@ce.com', 'CE Fin', 'finance'),
 ('10000000-0000-0000-0000-00000000e911', 'new@ce.com', 'New Person', 'investor'),
 ('10000000-0000-0000-0000-00000000e912', 'old@ce.com', 'Old Hand', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;
CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000e901'
    WHEN 'ops' THEN 'a0000000-0000-0000-0000-00000000e902' WHEN 'fin' THEN 'a0000000-0000-0000-0000-00000000e903' END, true);
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE c UUID; t UUID; a UUID; b UUID; f1 UUID; f2 UUID; j JSONB; e TEXT; x UUID;
BEGIN
  PERFORM pg_temp.as_user('ops');
  c := maalrise_create_cycle(jsonb_build_object('name', 'Email Test Cycle', 'transaction_name', 'Murabaha',
    'counterparty_id', maalrise_create_counterparty('{"name":"Email Test Co"}'), 'start_date', '2026-11-01',
    'duration_months', 3, 'unit_price_kobo', 100000));
  t := maalrise_save_terms(c, '{"cost_kobo":100000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":103000000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":3000000,"sale_price_kobo":103000000,"fee_kobo":99900,
    "investor_pool_kobo":2900100,"counterparty_total_kobo":103000000,"engine_version":"test"}'::JSONB,
    (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 966700, 'fee_kobo', 33300,
       'counterparty_gross_kobo', 1000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g));
  PERFORM maalrise_submit_terms(t);
  a := maalrise_add_investor('10000000-0000-0000-0000-00000000e911', '{"full_name":"New Person"}');
  b := maalrise_add_investor('10000000-0000-0000-0000-00000000e912', '{"full_name":"Old Hand"}');
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_approve_terms(t);
  e := pg_temp.err(format('SELECT maalrise_prepare_cycle_emails(%L)', c));
  IF e NOT LIKE '%No confirmed funding yet%' THEN RAISE EXCEPTION 'TEST FAIL R45: emails before any funding: %', e; END IF;
  PERFORM pg_temp.as_user('fin');
  f1 := maalrise_record_funding(c, a, 300, 30000000, CURRENT_DATE, 'CE-1');
  f2 := maalrise_record_funding(c, b, 200, 20000000, CURRENT_DATE, 'CE-2');
  PERFORM pg_temp.as_user('admin');
  PERFORM maalrise_confirm_funding(f1);
  PERFORM maalrise_confirm_funding(f2);

  FOREACH e IN ARRAY ARRAY['ops', 'fin'] LOOP
    PERFORM pg_temp.as_user(e);
    IF pg_temp.err(format('SELECT maalrise_prepare_cycle_emails(%L)', c)) IS NULL THEN
      RAISE EXCEPTION 'TEST FAIL R45: % prepared Cycle emails', e; END IF;
  END LOOP;

  PERFORM pg_temp.as_user('admin');
  j := maalrise_prepare_cycle_emails(c);
  IF (j->>'invitations')::INT <> 1 OR (j->>'notifications')::INT <> 1 OR jsonb_array_length(j->'to_send') <> 2
     OR (j->>'already_sent')::INT <> 0 OR (j->>'pending_funding')::INT <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL R45: first prepare %', j; END IF;
  IF NOT EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE to_email = 'new@ce.com' AND kind = 'cycle_invitation' AND status = 'draft'
                 AND body LIKE '%300 unit(s)%' AND body LIKE '%₦300,000.00%' AND body LIKE '%Set your password%')
     OR NOT EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE to_email = 'old@ce.com' AND kind = 'cycle_added'
                 AND subject = 'MaalRise: you have been added to Email Test Cycle' AND body NOT LIKE '%password%') THEN
    RAISE EXCEPTION 'TEST FAIL R45: wrong email for new or existing login'; END IF;
  IF (SELECT COUNT(*) FROM maalrise_notifications WHERE kind IN ('cycle_invitation', 'cycle_added')) <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL R45: in-app notices missing'; END IF;

  -- Pressing again prepares nothing new.
  j := maalrise_prepare_cycle_emails(c);
  IF jsonb_array_length(j->'to_send') <> 2 OR (SELECT COUNT(*) FROM maalrise_email_outbox WHERE dedupe_key LIKE 'cycle_welcome:%') <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL R45: duplicates prepared %', j; END IF;
  -- Once one is sent it is counted, never offered again.
  x := (j->'to_send'->>0)::UUID;
  PERFORM maalrise_claim_email(x);
  PERFORM maalrise_email_result(x, true, 'p-1', NULL);
  j := maalrise_prepare_cycle_emails(c);
  IF jsonb_array_length(j->'to_send') <> 1 OR (j->>'already_sent')::INT <> 1 OR (j->'to_send'->>0)::UUID = x THEN
    RAISE EXCEPTION 'TEST FAIL R45: after one sent %', j; END IF;
  IF EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE status = 'sent' AND id <> x) THEN
    RAISE EXCEPTION 'TEST FAIL R45: something was sent without a press'; END IF;
  RAISE NOTICE 'PASS R45: one email per investor per Cycle (invitation or notification); repeat presses add nothing; approvers only';
END $$;
ROLLBACK;
