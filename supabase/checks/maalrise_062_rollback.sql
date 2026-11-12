-- ============================================================
-- MaalRise 062 — ROLLBACK. Puts the 052/053 approval rule (every
-- investor's bank details confirmed first), the 055 page-load KYC copy
-- and 059's investor view back exactly. REFUSES while any payment is
-- on hold. KYC verifications and bank confirmations already made stay.
-- ============================================================
BEGIN;

DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT (SELECT COUNT(*) FROM maalrise_distribution_lines WHERE status = 'on_hold')
       + (SELECT COUNT(*) FROM maalrise_capital_payments WHERE status = 'on_hold') INTO v_n;
  IF v_n > 0 THEN RAISE EXCEPTION 'Rollback refused: % payment(s) are on hold.', v_n; END IF;
END $$;

DROP TRIGGER maalrise_kyc_from_maalgrow ON investors;
DROP TRIGGER maalrise_kyc_on_add ON maalrise_investors;
DROP TRIGGER maalrise_release_on_bank ON maalrise_investors;
DROP FUNCTION maalrise_kyc_from_maalgrow_trg();
DROP FUNCTION maalrise_kyc_on_add_trg();
DROP FUNCTION maalrise_release_on_bank_trg();

-- Exactly as 052, 053, 055 and 059 defined them
CREATE OR REPLACE FUNCTION maalrise_lines_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM maalrise_distributions WHERE id = OLD.distribution_id;
  IF TG_OP = 'DELETE' AND v_status <> 'prepared' THEN
    RAISE EXCEPTION 'Lines of an approved distribution cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'approved'
     AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.units <> OLD.units
          OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id
          OR NEW.account_number IS DISTINCT FROM OLD.account_number) THEN
    RAISE EXCEPTION 'An approved payment line''s amount and account are frozen';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION maalrise_capital_payments_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM maalrise_capital_settlements WHERE id = OLD.settlement_id;
  IF TG_OP = 'DELETE' AND v_status <> 'prepared' THEN
    RAISE EXCEPTION 'Payments of an approved capital settlement cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'approved'
     AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id
          OR NEW.account_number IS DISTINCT FROM OLD.account_number) THEN
    RAISE EXCEPTION 'An approved capital payment''s amount and account are frozen';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION maalrise_approve_distribution(p_dist UUID)
RETURNS VOID AS $$
DECLARE
  v_d   maalrise_distributions%ROWTYPE;
  v_bad TEXT;
  v_n   INTEGER;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_d FROM maalrise_distributions WHERE id = p_dist FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribution not found'; END IF;
  IF v_d.status <> 'prepared' THEN RAISE EXCEPTION 'This distribution is already approved'; END IF;
  IF v_d.net_kobo = 0 OR NOT EXISTS (SELECT 1 FROM maalrise_distribution_lines WHERE distribution_id = p_dist) THEN
    RAISE EXCEPTION 'Nothing to approve: this distribution has no confirmed money';
  END IF;

  -- Every payment must go to the investor's CURRENT confirmed account.
  SELECT string_agg(l.investor_name, ', ') INTO v_bad
    FROM maalrise_distribution_lines l JOIN maalrise_investors i ON i.id = l.maalrise_investor_id
   WHERE l.distribution_id = p_dist
     AND (l.account_number IS NULL OR i.bank_confirmed_at IS NULL
          OR i.account_number IS DISTINCT FROM l.account_number
          OR i.bank_name IS DISTINCT FROM l.bank_name OR i.account_name IS DISTINCT FROM l.account_name);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Bank details are unconfirmed or have changed for: %. Confirm them, then refresh the distribution.', v_bad;
  END IF;

  UPDATE maalrise_distributions SET status = 'approved', approved_by = auth.uid(), approved_at = NOW() WHERE id = p_dist;
  UPDATE maalrise_distribution_lines SET status = 'payable', updated_at = NOW() WHERE distribution_id = p_dist;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM create_audit_log('maalrise_approve_distribution', 'maalrise_distribution', p_dist::TEXT,
    jsonb_build_object('status', 'prepared'),
    jsonb_build_object('status', 'approved', 'net_kobo', v_d.net_kobo, 'lines', v_n));
  PERFORM maalrise_notify_roles(ARRAY['payment_officer', 'super_admin', 'administrator'], 'distribution_approved',
    'Investor payments approved: ' || v_d.cycle_name || ', month ' || v_d.period,
    v_n || ' investor payment(s) totalling ' || maalrise_naira(v_d.allocated_kobo)
      || ' are approved. Make the bank transfers, then mark each one paid.',
    '/admin/payment-requests/maalrise', 'distribution_approved:' || p_dist, 'MaalRise: investor payments approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_approve_capital_settlement(p_settlement UUID)
RETURNS VOID AS $$
DECLARE
  v_s   maalrise_capital_settlements%ROWTYPE;
  v_bad TEXT;
  v_n   INTEGER;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_s FROM maalrise_capital_settlements WHERE id = p_settlement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Capital settlement not found'; END IF;
  IF v_s.status <> 'prepared' THEN RAISE EXCEPTION 'This capital settlement is already %', v_s.status; END IF;
  SELECT string_agg(l.investor_name, ', ') INTO v_bad
    FROM maalrise_capital_payments l JOIN maalrise_investors i ON i.id = l.maalrise_investor_id
   WHERE l.settlement_id = p_settlement
     AND (l.account_number IS NULL OR i.bank_confirmed_at IS NULL
          OR i.account_number IS DISTINCT FROM l.account_number
          OR i.bank_name IS DISTINCT FROM l.bank_name OR i.account_name IS DISTINCT FROM l.account_name);
  IF v_bad IS NOT NULL THEN
    RAISE EXCEPTION 'Bank details are unconfirmed or have changed for: %. Confirm them, then refresh the settlement.', v_bad;
  END IF;

  UPDATE maalrise_capital_settlements SET status = 'approved', approved_by = auth.uid(), approved_at = NOW() WHERE id = p_settlement;
  UPDATE maalrise_capital_payments SET status = 'payable', updated_at = NOW() WHERE settlement_id = p_settlement;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM create_audit_log('maalrise_approve_capital_settlement', 'maalrise_capital_settlement', p_settlement::TEXT,
    jsonb_build_object('status', 'prepared'), jsonb_build_object('status', 'approved', 'capital_kobo', v_s.capital_kobo, 'payments', v_n));
  PERFORM maalrise_notify_roles(ARRAY['payment_officer', 'super_admin', 'administrator'], 'capital_settlement_approved',
    'Capital repayments approved: ' || v_s.cycle_name,
    v_n || ' capital repayment(s) totalling ' || maalrise_naira(v_s.capital_kobo)
      || ' are approved. Make the bank transfers, then mark each one paid.',
    '/admin/payment-requests/maalrise', 'capital_settlement_approved:' || p_settlement, 'MaalRise: capital repayments approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_sync_from_maalgrow()
RETURNS INTEGER AS $$
DECLARE
  r     RECORD;
  v_n   INTEGER := 0;
  v_kyc TEXT;
  v_src TEXT;
BEGIN
  IF auth.uid() IS NULL OR NOT (is_admin() OR get_my_maalrise_investor_id() IS NOT NULL) THEN RETURN 0; END IF;
  FOR r IN
    SELECT m.id, m.kyc_status, m.kyc_source, m.account_number AS m_account,
           g.id AS g_id, g.kyc_status::TEXT AS g_kyc, g.kyc_submitted_at AS g_submitted,
           g.bank_name AS g_bank, g.account_name AS g_account_name, g.account_number AS g_account
      FROM maalrise_investors m
      JOIN investors g ON g.id = m.maalgrow_investor_id OR (m.maalgrow_investor_id IS NULL AND g.profile_id = m.profile_id)
     WHERE is_admin() OR m.profile_id = auth.uid()
     FOR UPDATE OF m
  LOOP
    v_kyc := r.kyc_status;
    v_src := r.kyc_source;
    IF r.g_kyc = 'approved' AND r.kyc_status <> 'verified' THEN
      v_kyc := 'verified'; v_src := 'maalgrow';
    ELSIF r.g_kyc = 'rejected' AND r.kyc_source = 'maalgrow' AND r.kyc_status = 'verified' THEN
      v_kyc := 'rejected';
    ELSIF r.g_kyc = 'pending' AND r.g_submitted IS NOT NULL AND r.kyc_status IN ('not_started', 'rejected')
          AND COALESCE(r.kyc_source, 'maalgrow') = 'maalgrow' THEN
      v_kyc := 'pending_review';
    END IF;

    IF v_kyc IS DISTINCT FROM r.kyc_status THEN
      UPDATE maalrise_investors
         SET kyc_status = v_kyc, kyc_source = CASE WHEN v_kyc = 'verified' THEN v_src ELSE kyc_source END,
             kyc_reviewed_at = CASE WHEN v_kyc IN ('verified', 'rejected') THEN NOW() ELSE kyc_reviewed_at END,
             kyc_reviewed_by = CASE WHEN v_kyc IN ('verified', 'rejected') THEN NULL ELSE kyc_reviewed_by END,
             maalgrow_investor_id = r.g_id, updated_at = NOW()
       WHERE id = r.id;
      PERFORM create_audit_log('maalrise_sync_kyc_from_maalgrow', 'maalrise_investor', r.id::TEXT,
        jsonb_build_object('kyc_status', r.kyc_status), jsonb_build_object('kyc_status', v_kyc, 'maalgrow_kyc', r.g_kyc));
      v_n := v_n + 1;
    END IF;

    IF r.m_account IS NULL AND r.g_account ~ '^[0-9]{10}$'
       AND NULLIF(trim(r.g_bank), '') IS NOT NULL AND NULLIF(trim(r.g_account_name), '') IS NOT NULL THEN
      UPDATE maalrise_investors
         SET bank_name = trim(r.g_bank), account_name = trim(r.g_account_name), account_number = r.g_account,
             bank_confirmed_by = NULL, bank_confirmed_at = NULL, maalgrow_investor_id = r.g_id, updated_at = NOW()
       WHERE id = r.id;
      INSERT INTO maalrise_bank_details_history (maalrise_investor_id, event, bank_name, account_name, account_number, actor)
      VALUES (r.id, 'prefilled_from_maalgrow', trim(r.g_bank), trim(r.g_account_name), r.g_account, NULL);
      PERFORM create_audit_log('maalrise_sync_bank_from_maalgrow', 'maalrise_investor', r.id::TEXT, NULL,
        jsonb_build_object('account_ending', right(r.g_account, 4), 'confirmed', FALSE));
      IF v_kyc IS NOT DISTINCT FROM r.kyc_status THEN v_n := v_n + 1; END IF;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_investor_cycle_view(p_cycle UUID, p_inv UUID)
RETURNS JSONB AS $$
DECLARE
  v_me     UUID := p_inv;
  v_today  DATE := maalrise_today();
  v_cycle  maalrise_cycles%ROWTYPE;
  v_alloc  maalrise_allocations%ROWTYPE;
  v_cp     TEXT;
  v_mat    DATE;
  v_months JSONB;
  v_cap    JSONB;
  v_cp_row maalrise_capital_payments%ROWTYPE;
BEGIN
  IF v_me IS NULL OR NOT maalrise_cycle_visible_to(p_cycle, v_me) THEN RETURN NULL; END IF;
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

DROP FUNCTION maalrise_release_held_payments(UUID);
DROP FUNCTION maalrise_apply_maalgrow_kyc(UUID);

ALTER TABLE maalrise_distribution_lines DROP CONSTRAINT maalrise_distribution_lines_status_check;
ALTER TABLE maalrise_distribution_lines ADD CONSTRAINT maalrise_distribution_lines_status_check
  CHECK (status IN ('pending_approval', 'payable', 'paid'));
ALTER TABLE maalrise_capital_payments DROP CONSTRAINT maalrise_capital_payments_status_check;
ALTER TABLE maalrise_capital_payments ADD CONSTRAINT maalrise_capital_payments_status_check
  CHECK (status IN ('pending_approval', 'payable', 'paid'));

COMMIT;
