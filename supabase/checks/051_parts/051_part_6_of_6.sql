-- ============================================================
-- MaalRise 051 — PART 6 OF 6
-- KYC review, funding, activation checks, activation, documents, grants
--
-- The six parts together are byte-for-byte the body of
-- supabase/migrations/051_maalrise_core.sql (lines 850–1104 here), split
-- so each can be pasted and run on its own in the Supabase SQL Editor.
--
-- Run the parts IN ORDER, 1 to 6, each in its own Run.
-- Each part is its own transaction: if it fails, it leaves nothing
-- behind, and the earlier parts stay as they were. It refuses to run
-- out of order, or twice.
--
-- Success = the final result row reads "Part 6 of 6 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'maalrise_confirm_bank_details') THEN
    RAISE EXCEPTION 'STOP: run part 5 of 6 first (it creates maalrise_confirm_bank_details).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'maalrise_register_document') THEN
    RAISE EXCEPTION 'STOP: part 6 of 6 has already been applied (maalrise_register_document exists). Do not run it again.';
  END IF;
END $$;

-- >>> 051 BODY START (part 6)
/**
 * Review MaalRise KYC. Verifying requires a submission to have been
 * made (bank details alone are never KYC); MaalGrow-verified KYC is
 * recorded at add time and needs no review here.
 */
CREATE OR REPLACE FUNCTION maalrise_review_kyc(p_investor UUID, p_decision TEXT, p_notes TEXT)
RETURNS VOID AS $$
DECLARE
  v_sub maalrise_kyc_submissions%ROWTYPE;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_decision NOT IN ('verified', 'rejected') THEN RAISE EXCEPTION 'Decision must be verified or rejected'; END IF;
  IF p_decision = 'rejected' AND (p_notes IS NULL OR length(trim(p_notes)) = 0) THEN
    RAISE EXCEPTION 'A reason is required to reject KYC';
  END IF;
  SELECT * INTO v_sub FROM maalrise_kyc_submissions
   WHERE maalrise_investor_id = p_investor AND status = 'pending_review'
   ORDER BY submitted_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no KYC submission awaiting review'; END IF;

  UPDATE maalrise_kyc_submissions
     SET status = p_decision, reviewed_by = auth.uid(), reviewed_at = NOW(), review_notes = NULLIF(trim(p_notes), '')
   WHERE id = v_sub.id;
  UPDATE maalrise_investors
     SET kyc_status = p_decision, kyc_source = CASE WHEN p_decision = 'verified' THEN 'maalrise' ELSE kyc_source END,
         kyc_reviewed_by = auth.uid(), kyc_reviewed_at = NOW(), kyc_notes = NULLIF(trim(p_notes), ''), updated_at = NOW()
   WHERE id = p_investor;
  PERFORM create_audit_log('maalrise_review_kyc', 'maalrise_investor', p_investor::TEXT,
    NULL, jsonb_build_object('decision', p_decision, 'submission_id', v_sub.id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Phase 2 records a submission made on the investor's behalf; the investor form arrives in Phase 5. */
CREATE OR REPLACE FUNCTION maalrise_record_kyc_submission(p_investor UUID, p_details JSONB)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT (maalrise_can_prepare() OR p_investor = get_my_maalrise_investor_id()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_details IS NULL OR p_details = '{}'::JSONB THEN RAISE EXCEPTION 'KYC details are required'; END IF;
  INSERT INTO maalrise_kyc_submissions (maalrise_investor_id, details) VALUES (p_investor, p_details)
  RETURNING id INTO v_id;
  UPDATE maalrise_investors SET kyc_status = 'pending_review', updated_at = NOW()
   WHERE id = p_investor AND kyc_status IN ('not_started', 'rejected');
  PERFORM create_audit_log('maalrise_record_kyc_submission', 'maalrise_investor', p_investor::TEXT, NULL,
    jsonb_build_object('submission_id', v_id));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_record_funding(p_cycle UUID, p_investor UUID, p_units INTEGER,
                                                   p_amount_kobo BIGINT, p_received_on DATE, p_reference TEXT)
RETURNS UUID AS $$
DECLARE
  v_cycle maalrise_cycles%ROWTYPE;
  v_id    UUID;
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status NOT IN ('draft', 'terms_submitted', 'terms_approved') THEN
    RAISE EXCEPTION 'Funding can only be recorded before the Cycle is activated';
  END IF;
  IF p_amount_kobo <> p_units::BIGINT * v_cycle.unit_price_kobo THEN
    RAISE EXCEPTION 'Amount % is not % units × unit price %', p_amount_kobo, p_units, v_cycle.unit_price_kobo;
  END IF;
  IF p_received_on > CURRENT_DATE THEN RAISE EXCEPTION 'Funding cannot be dated in the future'; END IF;
  INSERT INTO maalrise_investor_fundings (cycle_id, maalrise_investor_id, units, amount_kobo, received_on, reference, recorded_by)
  VALUES (p_cycle, p_investor, p_units, p_amount_kobo, p_received_on, trim(p_reference), auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_record_funding', 'maalrise_investor_funding', v_id::TEXT, NULL,
    jsonb_build_object('cycle_id', p_cycle, 'investor_id', p_investor, 'units', p_units, 'amount_kobo', p_amount_kobo));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Confirming funding is what creates or tops up the allocation. */
CREATE OR REPLACE FUNCTION maalrise_confirm_funding(p_funding UUID)
RETURNS VOID AS $$
DECLARE
  v_f        maalrise_investor_fundings%ROWTYPE;
  v_cycle    maalrise_cycles%ROWTYPE;
  v_required INTEGER;
  v_funded   INTEGER;
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_f FROM maalrise_investor_fundings WHERE id = p_funding FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding not found'; END IF;
  IF v_f.status = 'confirmed' THEN RETURN; END IF;
  IF v_f.status <> 'recorded' THEN RAISE EXCEPTION 'Only recorded funding can be confirmed'; END IF;
  IF auth.uid() = v_f.recorded_by THEN
    RAISE EXCEPTION 'Funding must be confirmed by someone other than the person who recorded it';
  END IF;

  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = v_f.cycle_id FOR UPDATE;
  IF v_cycle.status NOT IN ('draft', 'terms_submitted', 'terms_approved') THEN
    RAISE EXCEPTION 'Funding can only be confirmed before the Cycle is activated';
  END IF;

  -- Never over-subscribe the cost of the transaction.
  SELECT COALESCE(SUM(units), 0) INTO v_funded FROM maalrise_allocations WHERE cycle_id = v_f.cycle_id;
  SELECT CEIL(t.cost_kobo::NUMERIC / v_cycle.unit_price_kobo)::INTEGER INTO v_required
    FROM maalrise_cycle_terms t
   WHERE t.cycle_id = v_f.cycle_id AND t.status IN ('approved', 'submitted', 'draft')
   ORDER BY (t.status = 'approved') DESC, t.version DESC LIMIT 1;
  IF v_required IS NOT NULL AND v_funded + v_f.units > v_required THEN
    RAISE EXCEPTION 'Confirming % units would exceed the % units the transaction cost requires (% already funded)',
      v_f.units, v_required, v_funded;
  END IF;

  UPDATE maalrise_investor_fundings SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = NOW()
   WHERE id = p_funding;

  INSERT INTO maalrise_allocations (cycle_id, maalrise_investor_id, units, capital_kobo)
  VALUES (v_f.cycle_id, v_f.maalrise_investor_id, v_f.units, v_f.amount_kobo)
  ON CONFLICT (cycle_id, maalrise_investor_id) DO UPDATE
    SET units = maalrise_allocations.units + EXCLUDED.units,
        capital_kobo = maalrise_allocations.capital_kobo + EXCLUDED.capital_kobo,
        updated_at = NOW();

  PERFORM create_audit_log('maalrise_confirm_funding', 'maalrise_investor_funding', p_funding::TEXT,
    jsonb_build_object('status', 'recorded'), jsonb_build_object('status', 'confirmed', 'units', v_f.units));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_reject_funding(p_funding UUID, p_reason TEXT)
RETURNS VOID AS $$
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE maalrise_investor_fundings
     SET status = 'rejected', rejected_by = auth.uid(), rejected_at = NOW(), reject_reason = trim(p_reason)
   WHERE id = p_funding AND status = 'recorded';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only recorded (unconfirmed) funding can be rejected'; END IF;
  PERFORM create_audit_log('maalrise_reject_funding', 'maalrise_investor_funding', p_funding::TEXT,
    jsonb_build_object('status', 'recorded'), jsonb_build_object('status', 'rejected', 'reason', p_reason));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 10. Activation (D3): every check must pass
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_activation_checks(p_cycle UUID)
RETURNS JSONB AS $$
DECLARE
  v_cycle    maalrise_cycles%ROWTYPE;
  v_terms    maalrise_cycle_terms%ROWTYPE;
  v_funded   BIGINT;
  v_alloc    BIGINT;
  v_checks   JSONB := '[]'::JSONB;
  v_pending  INTEGER;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  SELECT * INTO v_terms FROM maalrise_cycle_terms WHERE id = v_cycle.approved_terms_id;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_funded
    FROM maalrise_investor_fundings WHERE cycle_id = p_cycle AND status = 'confirmed';
  SELECT COALESCE(SUM(capital_kobo), 0) INTO v_alloc FROM maalrise_allocations WHERE cycle_id = p_cycle;
  SELECT COUNT(*) INTO v_pending FROM maalrise_investor_fundings WHERE cycle_id = p_cycle AND status = 'recorded';

  v_checks := v_checks || jsonb_build_object('key', 'terms_approved',
    'ok', v_terms.id IS NOT NULL, 'detail', 'Terms approved by a second authorised person');
  v_checks := v_checks || jsonb_build_object('key', 'fully_funded',
    'ok', v_terms.id IS NOT NULL AND v_funded = v_terms.cost_kobo,
    'detail', CASE WHEN v_terms.id IS NULL THEN 'No approved terms'
                   WHEN v_funded < v_terms.cost_kobo THEN 'Funding shortfall of ' || (v_terms.cost_kobo - v_funded) || ' kobo'
                   WHEN v_funded > v_terms.cost_kobo THEN 'Funding exceeds cost by ' || (v_funded - v_terms.cost_kobo) || ' kobo'
                   ELSE 'Fully funded' END);
  v_checks := v_checks || jsonb_build_object('key', 'no_unconfirmed_funding',
    'ok', v_pending = 0, 'detail', v_pending || ' funding record(s) awaiting confirmation');
  v_checks := v_checks || jsonb_build_object('key', 'allocations_reconcile',
    'ok', v_alloc = v_funded AND v_alloc > 0, 'detail', 'Allocations equal confirmed funding');
  v_checks := v_checks || jsonb_build_object('key', 'kyc_complete',
    'ok', NOT EXISTS (SELECT 1 FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
                      WHERE a.cycle_id = p_cycle AND i.kyc_status <> 'verified'),
    'detail', 'Every investor has completed KYC');
  v_checks := v_checks || jsonb_build_object('key', 'bank_confirmed',
    'ok', NOT EXISTS (SELECT 1 FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
                      WHERE a.cycle_id = p_cycle AND i.bank_confirmed_at IS NULL),
    'detail', 'Every investor''s bank details are confirmed');
  v_checks := v_checks || jsonb_build_object('key', 'investors_active',
    'ok', NOT EXISTS (SELECT 1 FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
                      WHERE a.cycle_id = p_cycle AND i.status = 'suspended'),
    'detail', 'No allocated investor is suspended');
  v_checks := v_checks || jsonb_build_object('key', 'contract_uploaded',
    'ok', EXISTS (SELECT 1 FROM maalrise_documents WHERE cycle_id = p_cycle AND category = 'contract'),
    'detail', 'Original contract uploaded');
  v_checks := v_checks || jsonb_build_object('key', 'maturity_consistent',
    'ok', v_cycle.stated_maturity_date IS NULL
          OR v_cycle.stated_maturity_date = (v_cycle.start_date + make_interval(months => v_cycle.duration_months))::DATE,
    'detail', 'Contract maturity date agrees with start + duration');

  RETURN jsonb_build_object('cycle_id', p_cycle,
    'all_ok', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checks) c WHERE NOT (c->>'ok')::BOOLEAN),
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
      (SELECT string_agg(c->>'detail', '; ') FROM jsonb_array_elements(v_result->'checks') c WHERE NOT (c->>'ok')::BOOLEAN);
  END IF;

  UPDATE maalrise_cycles SET status = 'active', activated_by = auth.uid(), activated_at = NOW(), updated_at = NOW()
   WHERE id = p_cycle;
  PERFORM create_audit_log('maalrise_activate_cycle', 'maalrise_cycle', p_cycle::TEXT,
    jsonb_build_object('status', 'terms_approved'), jsonb_build_object('status', 'active', 'checks', v_result->'checks'));
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Metadata only: the file is uploaded to the private bucket by the server first. */
CREATE OR REPLACE FUNCTION maalrise_register_document(p JSONB)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  INSERT INTO maalrise_documents (cycle_id, maalrise_investor_id, category, name, storage_path, mime_type,
                                  size_bytes, visible_to_investors, uploaded_by)
  VALUES (NULLIF(p->>'cycle_id', '')::UUID, NULLIF(p->>'maalrise_investor_id', '')::UUID, p->>'category',
          trim(p->>'name'), p->>'storage_path', p->>'mime_type', (p->>'size_bytes')::BIGINT,
          COALESCE((p->>'visible_to_investors')::BOOLEAN, FALSE), auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_register_document', 'maalrise_document', v_id::TEXT, NULL, p);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 11. Grants. Staff and investors reach these tables only through
--     RLS (reads) and the functions above (writes).
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION maalrise_terms_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_schedule_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_investor_not_staff() FROM PUBLIC;

-- <<< 051 BODY END (part 6)

COMMIT;

SELECT 'Part 6 of 6 applied' AS result;
