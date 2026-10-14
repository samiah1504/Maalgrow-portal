-- ============================================================
-- MaalRise 056 — ROLLBACK. Puts back the 051 rule (a second person
-- always approves) exactly.
--
-- REFUSES once any super-admin self-approval has been recorded.
-- ============================================================
BEGIN;

DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT (SELECT COUNT(*) FROM maalrise_cycle_terms WHERE self_approval_reason IS NOT NULL)
       + (SELECT COUNT(*) FROM maalrise_investor_fundings WHERE self_confirm_reason IS NOT NULL) INTO v_n;
  IF v_n > 0 THEN RAISE EXCEPTION 'Rollback refused: % self-approval(s) recorded.', v_n; END IF;
END $$;

DROP FUNCTION maalrise_approve_terms(UUID, TEXT);
DROP FUNCTION maalrise_confirm_funding(UUID, TEXT);
ALTER TABLE maalrise_cycle_terms DROP CONSTRAINT maalrise_terms_separate_approver;
ALTER TABLE maalrise_cycle_terms DROP COLUMN self_approval_reason;
ALTER TABLE maalrise_investor_fundings DROP COLUMN self_confirm_reason;
ALTER TABLE maalrise_cycle_terms ADD CONSTRAINT maalrise_cycle_terms_check2
  CHECK (approved_by IS NULL OR (approved_by <> prepared_by AND approved_by IS DISTINCT FROM submitted_by));

-- Exactly as migration 051 defined them
CREATE OR REPLACE FUNCTION maalrise_approve_terms(p_terms UUID)
RETURNS VOID AS $$
DECLARE
  v_t     maalrise_cycle_terms%ROWTYPE;
  v_cycle maalrise_cycles%ROWTYPE;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_t FROM maalrise_cycle_terms WHERE id = p_terms FOR UPDATE;
  IF NOT FOUND OR v_t.status <> 'submitted' THEN RAISE EXCEPTION 'Only submitted terms can be approved'; END IF;
  IF auth.uid() = v_t.prepared_by OR auth.uid() = v_t.submitted_by THEN
    RAISE EXCEPTION 'Terms cannot be approved by the person who prepared or submitted them';
  END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = v_t.cycle_id FOR UPDATE;

  -- The previous approved version, if any, is superseded — kept, never edited.
  UPDATE maalrise_cycle_terms SET status = 'superseded'
   WHERE cycle_id = v_t.cycle_id AND status = 'approved';

  UPDATE maalrise_cycle_terms SET status = 'approved', approved_by = auth.uid(), approved_at = NOW()
   WHERE id = p_terms;
  UPDATE maalrise_cycles
     SET approved_terms_id = p_terms,
         status = CASE WHEN status IN ('draft', 'terms_submitted') THEN 'terms_approved' ELSE status END,
         updated_at = NOW()
   WHERE id = v_t.cycle_id;
  PERFORM create_audit_log('maalrise_approve_terms', 'maalrise_cycle_terms', p_terms::TEXT,
    jsonb_build_object('status', 'submitted'),
    jsonb_build_object('status', 'approved', 'version', v_t.version, 'investor_pool_kobo', v_t.investor_pool_kobo));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

COMMIT;
