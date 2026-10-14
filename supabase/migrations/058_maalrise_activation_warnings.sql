-- ============================================================
-- 058 — MaalRise: KYC and bank confirmation no longer block activation
--       (agreed 14 Oct 2026)
--
-- APPLY ONLY AFTER supabase/checks/maalrise_058_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_058_postapply.sql.
-- To undo: supabase/checks/maalrise_058_rollback.sql.
--
-- A Cycle can be activated while some investors have not finished KYC
-- or had their bank details confirmed. Both are still listed, as
-- WARNINGS that name how many investors are affected.
--
-- Money is still protected where it moves: a profit distribution or a
-- capital settlement cannot be approved while any investor in it has
-- unconfirmed bank details (migrations 052 and 053, unchanged).
--
-- Every other check still blocks: approved terms, full funding, no
-- funding awaiting confirmation, allocations reconciling, no suspended
-- investor, the contract uploaded, a consistent maturity date.
-- Each check now carries "blocking"; all_ok looks at blocking checks
-- only. MaalRise only; MaalGrow untouched.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION maalrise_activation_checks(p_cycle UUID)
RETURNS JSONB AS $$
DECLARE
  v_cycle    maalrise_cycles%ROWTYPE;
  v_terms    maalrise_cycle_terms%ROWTYPE;
  v_funded   BIGINT;
  v_alloc    BIGINT;
  v_checks   JSONB := '[]'::JSONB;
  v_pending  INTEGER;
  v_no_kyc   INTEGER;
  v_no_bank  INTEGER;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  SELECT * INTO v_terms FROM maalrise_cycle_terms WHERE id = v_cycle.approved_terms_id;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_funded
    FROM maalrise_investor_fundings WHERE cycle_id = p_cycle AND status = 'confirmed';
  SELECT COALESCE(SUM(capital_kobo), 0) INTO v_alloc FROM maalrise_allocations WHERE cycle_id = p_cycle;
  SELECT COUNT(*) INTO v_pending FROM maalrise_investor_fundings WHERE cycle_id = p_cycle AND status = 'recorded';
  SELECT COUNT(*) INTO v_no_kyc FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
   WHERE a.cycle_id = p_cycle AND i.kyc_status <> 'verified';
  SELECT COUNT(*) INTO v_no_bank FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
   WHERE a.cycle_id = p_cycle AND i.bank_confirmed_at IS NULL;

  v_checks := v_checks || jsonb_build_object('key', 'terms_approved', 'blocking', TRUE,
    'ok', v_terms.id IS NOT NULL, 'detail', 'Terms approved by a second authorised person');
  v_checks := v_checks || jsonb_build_object('key', 'fully_funded', 'blocking', TRUE,
    'ok', v_terms.id IS NOT NULL AND v_funded = v_terms.cost_kobo,
    'detail', CASE WHEN v_terms.id IS NULL THEN 'No approved terms'
                   WHEN v_funded < v_terms.cost_kobo THEN 'Funding shortfall of ' || (v_terms.cost_kobo - v_funded) || ' kobo'
                   WHEN v_funded > v_terms.cost_kobo THEN 'Funding exceeds cost by ' || (v_funded - v_terms.cost_kobo) || ' kobo'
                   ELSE 'Fully funded' END);
  v_checks := v_checks || jsonb_build_object('key', 'no_unconfirmed_funding', 'blocking', TRUE,
    'ok', v_pending = 0, 'detail', v_pending || ' funding record(s) awaiting confirmation');
  v_checks := v_checks || jsonb_build_object('key', 'allocations_reconcile', 'blocking', TRUE,
    'ok', v_alloc = v_funded AND v_alloc > 0, 'detail', 'Allocations equal confirmed funding');
  v_checks := v_checks || jsonb_build_object('key', 'kyc_complete', 'blocking', FALSE,
    'ok', v_no_kyc = 0,
    'detail', CASE WHEN v_no_kyc = 0 THEN 'Every investor has completed KYC'
                   ELSE v_no_kyc || ' investor(s) have not completed KYC yet (does not block activation)' END);
  v_checks := v_checks || jsonb_build_object('key', 'bank_confirmed', 'blocking', FALSE,
    'ok', v_no_bank = 0,
    'detail', CASE WHEN v_no_bank = 0 THEN 'Every investor''s bank details are confirmed'
                   ELSE v_no_bank || ' investor(s) without confirmed bank details (does not block activation; '
                        || 'their payments cannot be approved until confirmed)' END);
  v_checks := v_checks || jsonb_build_object('key', 'investors_active', 'blocking', TRUE,
    'ok', NOT EXISTS (SELECT 1 FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
                      WHERE a.cycle_id = p_cycle AND i.status = 'suspended'),
    'detail', 'No allocated investor is suspended');
  v_checks := v_checks || jsonb_build_object('key', 'contract_uploaded', 'blocking', TRUE,
    'ok', EXISTS (SELECT 1 FROM maalrise_documents WHERE cycle_id = p_cycle AND category = 'contract'),
    'detail', 'Original contract uploaded');
  v_checks := v_checks || jsonb_build_object('key', 'maturity_consistent', 'blocking', TRUE,
    'ok', v_cycle.stated_maturity_date IS NULL
          OR v_cycle.stated_maturity_date = (v_cycle.start_date + make_interval(months => v_cycle.duration_months))::DATE,
    'detail', 'Contract maturity date agrees with start + duration');

  RETURN jsonb_build_object('cycle_id', p_cycle,
    'all_ok', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checks) c
                          WHERE (c->>'blocking')::BOOLEAN AND NOT (c->>'ok')::BOOLEAN),
    'warnings', (SELECT COUNT(*) FROM jsonb_array_elements(v_checks) c
                  WHERE NOT (c->>'blocking')::BOOLEAN AND NOT (c->>'ok')::BOOLEAN),
    'checks', v_checks);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_activate_cycle(p_cycle UUID)
RETURNS JSONB AS $$
DECLARE
  v_cycle  maalrise_cycles%ROWTYPE;
  v_result JSONB;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status <> 'terms_approved' THEN
    RAISE EXCEPTION 'Only a Cycle with approved terms can be activated (this one is %)', v_cycle.status;
  END IF;

  v_result := maalrise_activation_checks(p_cycle);
  IF NOT (v_result->>'all_ok')::BOOLEAN THEN
    RAISE EXCEPTION 'Activation refused — checks failed: %',
      (SELECT string_agg(c->>'detail', '; ') FROM jsonb_array_elements(v_result->'checks') c
        WHERE (c->>'blocking')::BOOLEAN AND NOT (c->>'ok')::BOOLEAN);
  END IF;

  UPDATE maalrise_cycles SET status = 'active', activated_by = auth.uid(), activated_at = NOW(), updated_at = NOW()
   WHERE id = p_cycle;
  -- The warnings at the moment of activation are kept with the checks.
  PERFORM create_audit_log('maalrise_activate_cycle', 'maalrise_cycle', p_cycle::TEXT,
    jsonb_build_object('status', 'terms_approved'), jsonb_build_object('status', 'active', 'checks', v_result->'checks'));
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
