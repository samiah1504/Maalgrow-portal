-- ============================================================
-- 056 — MaalRise: a super admin may approve their own work (14 Oct 2026)
--
-- APPLY ONLY AFTER supabase/checks/maalrise_056_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_056_postapply.sql.
-- To undo: supabase/checks/maalrise_056_rollback.sql (refuses once any
-- self-approval has been recorded).
--
-- Decision D5 (a second person approves) is relaxed for super admins
-- only, at the business's request:
--
--   * A super admin may approve Cycle terms they prepared or submitted,
--     and confirm investor funding they recorded — but must give a
--     reason. The reason is stored on the record and in the audit log.
--   * Everyone else still needs a different authorised person, exactly
--     as before. Nothing else changes.
--
-- MaalRise only. Nothing in MaalGrow is touched.
-- ============================================================
BEGIN;

ALTER TABLE maalrise_cycle_terms ADD COLUMN self_approval_reason TEXT
  CHECK (self_approval_reason IS NULL OR length(trim(self_approval_reason)) > 0);
ALTER TABLE maalrise_investor_fundings ADD COLUMN self_confirm_reason TEXT
  CHECK (self_confirm_reason IS NULL OR length(trim(self_confirm_reason)) > 0);

-- The separate-approver rule on terms, now with the recorded exception.
ALTER TABLE maalrise_cycle_terms DROP CONSTRAINT maalrise_cycle_terms_check2;
ALTER TABLE maalrise_cycle_terms ADD CONSTRAINT maalrise_terms_separate_approver
  CHECK (approved_by IS NULL OR self_approval_reason IS NOT NULL
         OR (approved_by <> prepared_by AND approved_by IS DISTINCT FROM submitted_by));

DROP FUNCTION maalrise_approve_terms(UUID);
CREATE FUNCTION maalrise_approve_terms(p_terms UUID, p_self_reason TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_t     maalrise_cycle_terms%ROWTYPE;
  v_cycle maalrise_cycles%ROWTYPE;
  v_self  TEXT;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_t FROM maalrise_cycle_terms WHERE id = p_terms FOR UPDATE;
  IF NOT FOUND OR v_t.status <> 'submitted' THEN RAISE EXCEPTION 'Only submitted terms can be approved'; END IF;
  IF auth.uid() = v_t.prepared_by OR auth.uid() = v_t.submitted_by THEN
    -- Only a super admin may approve their own terms, and must say why.
    IF maalrise_caller_role() IS DISTINCT FROM 'super_admin' THEN
      RAISE EXCEPTION 'Terms cannot be approved by the person who prepared or submitted them';
    END IF;
    v_self := NULLIF(trim(COALESCE(p_self_reason, '')), '');
    IF v_self IS NULL THEN
      RAISE EXCEPTION 'You prepared or submitted these terms. To approve them yourself, give a reason';
    END IF;
  END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = v_t.cycle_id FOR UPDATE;

  -- The previous approved version, if any, is superseded — kept, never edited.
  UPDATE maalrise_cycle_terms SET status = 'superseded'
   WHERE cycle_id = v_t.cycle_id AND status = 'approved';

  UPDATE maalrise_cycle_terms SET status = 'approved', approved_by = auth.uid(), approved_at = NOW(),
         self_approval_reason = v_self
   WHERE id = p_terms;
  UPDATE maalrise_cycles
     SET approved_terms_id = p_terms,
         status = CASE WHEN status IN ('draft', 'terms_submitted') THEN 'terms_approved' ELSE status END,
         updated_at = NOW()
   WHERE id = v_t.cycle_id;
  PERFORM create_audit_log('maalrise_approve_terms', 'maalrise_cycle_terms', p_terms::TEXT,
    jsonb_build_object('status', 'submitted'),
    jsonb_build_object('status', 'approved', 'version', v_t.version, 'investor_pool_kobo', v_t.investor_pool_kobo,
                       'self_approved', v_self IS NOT NULL, 'self_approval_reason', v_self));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION maalrise_confirm_funding(UUID);
CREATE FUNCTION maalrise_confirm_funding(p_funding UUID, p_self_reason TEXT DEFAULT NULL)
RETURNS VOID AS $$
DECLARE
  v_f        maalrise_investor_fundings%ROWTYPE;
  v_cycle    maalrise_cycles%ROWTYPE;
  v_required INTEGER;
  v_funded   INTEGER;
  v_self     TEXT;
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_f FROM maalrise_investor_fundings WHERE id = p_funding FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding not found'; END IF;
  IF v_f.status = 'confirmed' THEN RETURN; END IF;
  IF v_f.status <> 'recorded' THEN RAISE EXCEPTION 'Only recorded funding can be confirmed'; END IF;
  IF auth.uid() = v_f.recorded_by THEN
    -- Only a super admin may confirm funding they recorded, and must say why.
    IF maalrise_caller_role() IS DISTINCT FROM 'super_admin' THEN
      RAISE EXCEPTION 'Funding must be confirmed by someone other than the person who recorded it';
    END IF;
    v_self := NULLIF(trim(COALESCE(p_self_reason, '')), '');
    IF v_self IS NULL THEN
      RAISE EXCEPTION 'You recorded this funding. To confirm it yourself, give a reason';
    END IF;
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

  UPDATE maalrise_investor_fundings SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = NOW(),
         self_confirm_reason = v_self
   WHERE id = p_funding;

  INSERT INTO maalrise_allocations (cycle_id, maalrise_investor_id, units, capital_kobo)
  VALUES (v_f.cycle_id, v_f.maalrise_investor_id, v_f.units, v_f.amount_kobo)
  ON CONFLICT (cycle_id, maalrise_investor_id) DO UPDATE
    SET units = maalrise_allocations.units + EXCLUDED.units,
        capital_kobo = maalrise_allocations.capital_kobo + EXCLUDED.capital_kobo,
        updated_at = NOW();

  PERFORM create_audit_log('maalrise_confirm_funding', 'maalrise_investor_funding', p_funding::TEXT,
    jsonb_build_object('status', 'recorded'), jsonb_build_object('status', 'confirmed', 'units', v_f.units,
                                                         'self_confirmed', v_self IS NOT NULL, 'self_confirm_reason', v_self));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
