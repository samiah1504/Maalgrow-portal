-- ============================================================
-- MaalRise 059 — ROLLBACK. Removes "View as investor" and puts the
-- investor read functions back exactly as migration 054 defined them.
-- ============================================================
BEGIN;

-- Exactly as migration 054 defined them
CREATE OR REPLACE FUNCTION maalrise_my_profile()
RETURNS JSONB AS $$
DECLARE
  v_inv maalrise_investors%ROWTYPE;
  v_req maalrise_bank_change_requests%ROWTYPE;
  v_last maalrise_bank_change_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_inv FROM maalrise_investors WHERE profile_id = auth.uid();
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_req FROM maalrise_bank_change_requests WHERE maalrise_investor_id = v_inv.id AND status = 'pending';
  SELECT * INTO v_last FROM maalrise_bank_change_requests
   WHERE maalrise_investor_id = v_inv.id AND status IN ('approved', 'rejected')
   ORDER BY reviewed_at DESC LIMIT 1;
  RETURN jsonb_build_object(
    'investor_code', v_inv.investor_code,
    'full_name', v_inv.full_name,
    'email', v_inv.email,
    'phone', v_inv.phone,
    'status', v_inv.status,
    'kyc_status', v_inv.kyc_status,
    'bank', CASE WHEN v_inv.account_number IS NULL THEN NULL ELSE jsonb_build_object(
      'bank_name', v_inv.bank_name, 'account_name', v_inv.account_name, 'account_number', v_inv.account_number,
      'confirmed', v_inv.bank_confirmed_at IS NOT NULL) END,
    'pending_request', CASE WHEN v_req.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', v_req.id, 'bank_name', v_req.bank_name, 'account_name', v_req.account_name,
      'account_number', v_req.account_number, 'requested_at', v_req.requested_at) END,
    'last_decision', CASE WHEN v_last.id IS NULL THEN NULL ELSE jsonb_build_object(
      'status', v_last.status, 'reason', v_last.reject_reason, 'reviewed_at', v_last.reviewed_at,
      'account_ending', right(v_last.account_number, 4)) END);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_my_cycle(p_cycle UUID)
RETURNS JSONB AS $$
DECLARE
  v_me     UUID := get_my_maalrise_investor_id();
  v_today  DATE := maalrise_today();
  v_cycle  maalrise_cycles%ROWTYPE;
  v_alloc  maalrise_allocations%ROWTYPE;
  v_cp     TEXT;
  v_mat    DATE;
  v_months JSONB;
  v_cap    JSONB;
  v_cp_row maalrise_capital_payments%ROWTYPE;
BEGIN
  IF v_me IS NULL OR NOT maalrise_cycle_visible_to_me(p_cycle) THEN RETURN NULL; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  SELECT * INTO v_alloc FROM maalrise_allocations WHERE cycle_id = p_cycle AND maalrise_investor_id = v_me;
  SELECT name INTO v_cp FROM maalrise_counterparties WHERE id = v_cycle.counterparty_id;
  v_mat := maalrise_maturity_date(p_cycle);

  WITH m AS (
    SELECT l.period, l.due_date,
           maalrise_investor_share(p_cycle, v_me, l.investor_net_kobo) AS expected,
           COALESCE(SUM(d.amount_kobo) FILTER (WHERE d.status = 'paid'), 0) AS paid,
           COALESCE(SUM(d.amount_kobo) FILTER (WHERE d.status = 'payable'), 0) AS approved,
           COALESCE(SUM(d.amount_kobo) FILTER (WHERE d.status = 'pending_approval'), 0) AS processing,
           MAX(d.paid_on) AS last_paid_on,
           array_remove(array_agg(DISTINCT d.paid_reference) FILTER (WHERE d.status = 'paid'), NULL) AS refs
      FROM maalrise_schedule_lines l
      LEFT JOIN maalrise_distribution_lines d
        ON d.cycle_id = p_cycle AND d.period = l.period AND d.maalrise_investor_id = v_me
     WHERE l.terms_id = v_cycle.approved_terms_id
     GROUP BY l.period, l.due_date, l.investor_net_kobo
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'period', period, 'due_date', due_date, 'expected_kobo', expected, 'paid_kobo', paid,
           'approved_kobo', approved, 'processing_kobo', processing, 'paid_on', last_paid_on,
           'references', to_jsonb(refs),
           'status', CASE WHEN paid > 0 AND paid >= expected THEN 'paid'
                          WHEN paid > 0 THEN 'part_paid'
                          WHEN approved > 0 THEN 'approved'
                          WHEN processing > 0 THEN 'processing'
                          WHEN due_date <= v_today THEN 'due'
                          ELSE 'scheduled' END) ORDER BY period), '[]'::JSONB)
    INTO v_months FROM m;

  SELECT p.* INTO v_cp_row FROM maalrise_capital_payments p
    JOIN maalrise_capital_settlements s ON s.id = p.settlement_id
   WHERE s.cycle_id = p_cycle AND s.status <> 'cancelled' AND p.maalrise_investor_id = v_me;
  v_cap := jsonb_build_object(
    'due_date', v_mat,
    'expected_kobo', v_alloc.capital_kobo,
    'paid_kobo', CASE WHEN v_cp_row.status = 'paid' THEN v_cp_row.amount_kobo ELSE 0 END,
    'paid_on', v_cp_row.paid_on,
    'reference', CASE WHEN v_cp_row.status = 'paid' THEN v_cp_row.paid_reference END,
    'account_ending', CASE WHEN v_cp_row.status = 'paid' THEN right(v_cp_row.account_number, 4) END,
    'status', CASE WHEN v_cp_row.status = 'paid' THEN 'paid'
                   WHEN v_cp_row.status = 'payable' THEN 'approved'
                   WHEN v_cp_row.status = 'pending_approval' THEN 'processing'
                   WHEN v_mat <= v_today THEN 'due'
                   ELSE 'scheduled' END);

  RETURN jsonb_build_object(
    'id', v_cycle.id,
    'name', v_cycle.name,
    'counterparty_name', v_cp,
    'description', v_cycle.description,
    'status', CASE WHEN v_cycle.status = 'closed' THEN 'closed'
                   WHEN v_cycle.status = 'matured' OR v_mat <= v_today THEN 'matured'
                   ELSE 'active' END,
    'start_date', v_cycle.start_date,
    'maturity_date', v_mat,
    'duration_months', v_cycle.duration_months,
    'units', v_alloc.units,
    'unit_price_kobo', v_cycle.unit_price_kobo,
    'capital_kobo', v_alloc.capital_kobo,
    'months', v_months,
    'capital', v_cap);
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_my_cycles()
RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(maalrise_my_cycle(c.id) ORDER BY c.start_date DESC, c.name), '[]'::JSONB)
    FROM maalrise_cycles c
   WHERE get_my_maalrise_investor_id() IS NOT NULL AND maalrise_cycle_visible_to_me(c.id);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_my_payments()
RETURNS JSONB AS $$
  SELECT COALESCE(jsonb_agg(x ORDER BY (x->>'paid_on') DESC NULLS FIRST, (x->>'cycle_name'), (x->>'kind') DESC,
                                       (x->>'period')::INTEGER DESC NULLS FIRST), '[]'::JSONB)
    FROM (
      SELECT jsonb_build_object('id', l.id, 'kind', 'profit', 'cycle_id', l.cycle_id, 'cycle_name', d.cycle_name,
               'period', l.period, 'amount_kobo', l.amount_kobo, 'status', l.status, 'paid_on', l.paid_on,
               'reference', l.paid_reference, 'bank_name', l.bank_name, 'account_ending', right(l.account_number, 4)) AS x
        FROM maalrise_distribution_lines l JOIN maalrise_distributions d ON d.id = l.distribution_id
       WHERE l.maalrise_investor_id = get_my_maalrise_investor_id() AND l.status IN ('payable', 'paid')
      UNION ALL
      SELECT jsonb_build_object('id', p.id, 'kind', 'capital', 'cycle_id', p.cycle_id, 'cycle_name', s.cycle_name,
               'period', NULL, 'amount_kobo', p.amount_kobo, 'status', p.status, 'paid_on', p.paid_on,
               'reference', p.paid_reference, 'bank_name', p.bank_name, 'account_ending', right(p.account_number, 4))
        FROM maalrise_capital_payments p JOIN maalrise_capital_settlements s ON s.id = p.settlement_id
       WHERE p.maalrise_investor_id = get_my_maalrise_investor_id() AND p.status IN ('payable', 'paid')
    ) rows;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DROP FUNCTION maalrise_view_as_investor(UUID);
DROP FUNCTION maalrise_investor_payments_view(UUID);
DROP FUNCTION maalrise_investor_cycles_view(UUID);
DROP FUNCTION maalrise_investor_cycle_view(UUID, UUID);
DROP FUNCTION maalrise_investor_profile_view(UUID);
DROP FUNCTION maalrise_cycle_visible_to(UUID, UUID);

COMMIT;
