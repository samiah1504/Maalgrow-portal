-- ============================================================
-- MaalRise 056 — a super admin may approve their own work — scenarios
-- Scratch database only (051–056). Everything ROLLS BACK.
--
--   R43 terms: a super admin who prepared/submitted them approves with
--       a reason (stored, audited); without a reason refused; an
--       administrator still cannot approve their own
--   R44 funding: the same for confirming funding one recorded
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES
 ('a0000000-0000-0000-0000-00000000e801', 'sa@s.com'), ('a0000000-0000-0000-0000-00000000e802', 'admin@s.com'),
 ('10000000-0000-0000-0000-00000000e811', 'inv@s.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES
 ('a0000000-0000-0000-0000-00000000e801', 'sa@s.com', 'S Super', 'super_admin'),
 ('a0000000-0000-0000-0000-00000000e802', 'admin@s.com', 'S Admin', 'administrator'),
 ('10000000-0000-0000-0000-00000000e811', 'inv@s.com', 'S Investor', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
CREATE TEMP TABLE ids (k TEXT PRIMARY KEY, v UUID);
CREATE FUNCTION pg_temp.as_user(p TEXT) RETURNS VOID AS $$
  SELECT set_config('test.uid', CASE p WHEN 'sa' THEN 'a0000000-0000-0000-0000-00000000e801'
    WHEN 'admin' THEN 'a0000000-0000-0000-0000-00000000e802' END, true);
$$ LANGUAGE sql;
CREATE FUNCTION pg_temp.err(p_sql TEXT) RETURNS TEXT AS $$
BEGIN EXECUTE p_sql; RETURN NULL; EXCEPTION WHEN OTHERS THEN RETURN SQLERRM; END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE c UUID; t UUID; t2 UUID; c2 UUID; e TEXT; i UUID; f UUID; terms JSONB; sched JSONB;
BEGIN
  terms := '{"cost_kobo":100000000,"markup_type":"percent","markup_bps":300,"stated_sale_price_kobo":103000000,
    "fee_basis":"markup","fee_bps":333,"fee_treatment":"deducted_from_investors","schedule_mode":"equal",
    "markup_kobo":3000000,"sale_price_kobo":103000000,"fee_kobo":99900,
    "investor_pool_kobo":2900100,"counterparty_total_kobo":103000000,"engine_version":"test"}';
  sched := (SELECT jsonb_agg(jsonb_build_object('period', g, 'investor_net_kobo', 966700, 'fee_kobo', 33300,
       'counterparty_gross_kobo', 1000000, 'rounding_adjustment_kobo', 0) ORDER BY g) FROM generate_series(1, 3) g);

  -- R43: the super admin does everything alone
  PERFORM pg_temp.as_user('sa');
  c := maalrise_create_cycle(jsonb_build_object('name', 'Self Approval Test', 'transaction_name', 'Murabaha',
    'counterparty_id', maalrise_create_counterparty('{"name":"Self Approval Co"}'), 'start_date', CURRENT_DATE,
    'duration_months', 3, 'unit_price_kobo', 100000));
  t := maalrise_save_terms(c, terms, sched);
  PERFORM maalrise_submit_terms(t);
  e := pg_temp.err(format('SELECT maalrise_approve_terms(%L)', t));
  IF e NOT LIKE '%give a reason%' THEN RAISE EXCEPTION 'TEST FAIL R43: self-approval without a reason: %', e; END IF;
  e := pg_temp.err(format('SELECT maalrise_approve_terms(%L, %L)', t, '   '));
  IF e NOT LIKE '%give a reason%' THEN RAISE EXCEPTION 'TEST FAIL R43: blank reason accepted: %', e; END IF;
  PERFORM maalrise_approve_terms(t, 'Sole director; second approver not yet appointed');
  IF (SELECT status || ':' || self_approval_reason FROM maalrise_cycle_terms WHERE id = t)
     <> 'approved:Sole director; second approver not yet appointed' THEN RAISE EXCEPTION 'TEST FAIL R43: not approved with reason'; END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'maalrise_approve_terms' AND entity_id = t::TEXT
                 AND (new_values->>'self_approved')::BOOLEAN AND new_values->>'self_approval_reason' LIKE 'Sole director%') THEN
    RAISE EXCEPTION 'TEST FAIL R43: self-approval not audited'; END IF;
  -- An administrator still cannot approve their own terms, even with a reason.
  PERFORM pg_temp.as_user('admin');
  c2 := maalrise_create_cycle(jsonb_build_object('name', 'Admin Own Terms', 'transaction_name', 'Murabaha',
    'counterparty_id', (SELECT counterparty_id FROM maalrise_cycles WHERE id = c), 'start_date', CURRENT_DATE,
    'duration_months', 3, 'unit_price_kobo', 100000));
  t2 := maalrise_save_terms(c2, terms, sched);
  PERFORM maalrise_submit_terms(t2);
  e := pg_temp.err(format('SELECT maalrise_approve_terms(%L, %L)', t2, 'I want to'));
  IF e NOT LIKE '%cannot be approved by the person%' THEN RAISE EXCEPTION 'TEST FAIL R43: administrator self-approved: %', e; END IF;
  -- A different approver needs no reason, as before.
  PERFORM pg_temp.as_user('sa');
  PERFORM maalrise_approve_terms(t2);
  IF (SELECT self_approval_reason FROM maalrise_cycle_terms WHERE id = t2) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL R43: a normal approval was marked self-approved'; END IF;
  -- The table itself refuses an unrecorded self-approval.
  e := pg_temp.err(format('UPDATE maalrise_cycle_terms SET self_approval_reason = NULL WHERE id = %L', t));
  IF e IS NULL THEN RAISE EXCEPTION 'TEST FAIL R43: the recorded reason could be removed'; END IF;
  RAISE NOTICE 'PASS R43: super admin approves own terms only with a reason (stored, audited); administrators still cannot';

  -- R44: funding recorded and confirmed by the same super admin
  i := maalrise_add_investor('10000000-0000-0000-0000-00000000e811', '{"full_name":"S Investor","bank_name":"GTB","account_name":"S Investor","account_number":"1234567890"}');
  f := maalrise_record_funding(c, i, 10, 1000000, CURRENT_DATE, 'SELF-1');
  e := pg_temp.err(format('SELECT maalrise_confirm_funding(%L)', f));
  IF e NOT LIKE '%give a reason%' THEN RAISE EXCEPTION 'TEST FAIL R44: self-confirmation without a reason: %', e; END IF;
  PERFORM maalrise_confirm_funding(f, 'Transfer seen on the bank statement');
  IF (SELECT status || ':' || self_confirm_reason FROM maalrise_investor_fundings WHERE id = f)
     <> 'confirmed:Transfer seen on the bank statement'
     OR NOT EXISTS (SELECT 1 FROM maalrise_allocations WHERE cycle_id = c AND maalrise_investor_id = i AND units = 10) THEN
    RAISE EXCEPTION 'TEST FAIL R44: funding not confirmed with reason'; END IF;
  PERFORM pg_temp.as_user('admin');
  f := maalrise_record_funding(c2, i, 10, 1000000, CURRENT_DATE, 'SELF-2');
  e := pg_temp.err(format('SELECT maalrise_confirm_funding(%L, %L)', f, 'please'));
  IF e NOT LIKE '%someone other than%' THEN RAISE EXCEPTION 'TEST FAIL R44: administrator self-confirmed: %', e; END IF;
  RAISE NOTICE 'PASS R44: super admin confirms own funding only with a reason; administrators still cannot';
END $$;
ROLLBACK;
