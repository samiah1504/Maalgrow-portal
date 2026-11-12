-- ============================================================
-- 062 — MaalRise: approve payments without waiting for everyone's bank
--       details; MaalGrow KYC approval counts in MaalRise at once
--       (agreed 12 Nov 2026)
--
-- APPLY ONLY AFTER supabase/checks/maalrise_062_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_062_postapply.sql.
-- To undo: supabase/checks/maalrise_062_rollback.sql (refuses while any
-- payment is on hold).
--
-- 1. Approving a month's profit or a capital settlement no longer needs
--    every investor's bank details confirmed. Investors with confirmed
--    details are payable at once; the others are ON HOLD (amount
--    reserved) and are told what is needed. Their payment is released
--    automatically the moment their bank details are confirmed — by
--    staff, by a bank-change approval or by MaalGrow KYC (below).
--    Money still only ever goes to a confirmed account.
--
-- 2. The moment KYC is approved in MaalGrow (any screen, bulk or one
--    by one) the person is KYC-verified in MaalRise, and the bank
--    details on that approved KYC are confirmed for MaalRise — unless
--    MaalRise already holds different confirmed details, which are
--    kept. This can never stop a MaalGrow approval. Everyone already
--    approved in MaalGrow is brought up to date now.
--
-- MaalGrow data is only read: one trigger is added on investors that
-- writes to MaalRise tables only.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. A payment can be on hold
-- ------------------------------------------------------------
ALTER TABLE maalrise_distribution_lines DROP CONSTRAINT maalrise_distribution_lines_status_check;
ALTER TABLE maalrise_distribution_lines ADD CONSTRAINT maalrise_distribution_lines_status_check
  CHECK (status IN ('pending_approval', 'on_hold', 'payable', 'paid'));
ALTER TABLE maalrise_capital_payments DROP CONSTRAINT maalrise_capital_payments_status_check;
ALTER TABLE maalrise_capital_payments ADD CONSTRAINT maalrise_capital_payments_status_check
  CHECK (status IN ('pending_approval', 'on_hold', 'payable', 'paid'));

CREATE OR REPLACE FUNCTION maalrise_lines_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM maalrise_distributions WHERE id = OLD.distribution_id;
  IF TG_OP = 'DELETE' AND v_status <> 'prepared' THEN
    RAISE EXCEPTION 'Lines of an approved distribution cannot be deleted';
  END IF;
  -- 062: a line on hold is released once — its confirmed account filled in, and it becomes payable.
  IF TG_OP = 'UPDATE' AND OLD.status = 'on_hold' AND NEW.status NOT IN ('on_hold', 'payable') THEN
    RAISE EXCEPTION 'A payment on hold can only be released (made payable)';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'approved' AND OLD.status <> 'on_hold'
     AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.units <> OLD.units
          OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id
          OR NEW.account_number IS DISTINCT FROM OLD.account_number) THEN
    RAISE EXCEPTION 'An approved payment line''s amount and account are frozen';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'approved' AND OLD.status = 'on_hold'
     AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.units <> OLD.units OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id) THEN
    RAISE EXCEPTION 'An approved payment line''s amount is frozen';
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
  IF TG_OP = 'UPDATE' AND OLD.status = 'on_hold' AND NEW.status NOT IN ('on_hold', 'payable') THEN
    RAISE EXCEPTION 'A capital payment on hold can only be released (made payable)';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'approved' AND OLD.status <> 'on_hold'
     AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id
          OR NEW.account_number IS DISTINCT FROM OLD.account_number) THEN
    RAISE EXCEPTION 'An approved capital payment''s amount and account are frozen';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'approved' AND OLD.status = 'on_hold'
     AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id) THEN
    RAISE EXCEPTION 'An approved capital payment''s amount is frozen';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

-- ------------------------------------------------------------
-- 2. Approving: payable where confirmed, on hold otherwise
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_approve_distribution(p_dist UUID)
RETURNS VOID AS $$
DECLARE
  v_d   maalrise_distributions%ROWTYPE;
  v_n    INTEGER;
  v_hold INTEGER;
  v_held TEXT;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_d FROM maalrise_distributions WHERE id = p_dist FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Distribution not found'; END IF;
  IF v_d.status <> 'prepared' THEN RAISE EXCEPTION 'This distribution is already approved'; END IF;
  IF v_d.net_kobo = 0 OR NOT EXISTS (SELECT 1 FROM maalrise_distribution_lines WHERE distribution_id = p_dist) THEN
    RAISE EXCEPTION 'Nothing to approve: this distribution has no confirmed money';
  END IF;

  -- 062: each payment goes to the investor's CURRENT confirmed account.
  -- Investors without confirmed bank details no longer hold up everyone
  -- else: their payment is approved but ON HOLD, and is released the
  -- moment their bank details are confirmed (maalrise_release_held_payments).
  UPDATE maalrise_distribution_lines l
     SET bank_name      = CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.bank_name END,
         account_name   = CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.account_name END,
         account_number = CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.account_number END,
         status         = CASE WHEN i.bank_confirmed_at IS NOT NULL AND i.account_number IS NOT NULL THEN 'payable' ELSE 'on_hold' END,
         updated_at     = NOW()
    FROM maalrise_investors i
   WHERE i.id = l.maalrise_investor_id AND l.distribution_id = p_dist;
  SELECT COUNT(*) FILTER (WHERE status = 'payable'), COUNT(*) FILTER (WHERE status = 'on_hold'),
         string_agg(investor_name, ', ' ORDER BY investor_name) FILTER (WHERE status = 'on_hold')
    INTO v_n, v_hold, v_held
    FROM maalrise_distribution_lines WHERE distribution_id = p_dist;
  UPDATE maalrise_distributions SET status = 'approved', approved_by = auth.uid(), approved_at = NOW() WHERE id = p_dist;

  -- Each investor on hold is told what is needed (an email draft too, sent only when staff press Send).
  PERFORM maalrise_notify_investor(l.maalrise_investor_id, 'bank_details_needed', 'Your payment is waiting for your bank details',
            'Your MaalRise profit for ' || v_d.cycle_name || ', month ' || v_d.period || ' (' || maalrise_naira(l.amount_kobo)
              || ') is approved. It will be paid as soon as your bank details are confirmed: complete them in the KYC form or contact us.',
            'bank_needed:' || l.id, 'MaalRise: your payment is waiting for your bank details')
     FROM maalrise_distribution_lines l WHERE l.distribution_id = p_dist AND l.status = 'on_hold';

  PERFORM create_audit_log('maalrise_approve_distribution', 'maalrise_distribution', p_dist::TEXT,
    jsonb_build_object('status', 'prepared'),
    jsonb_build_object('status', 'approved', 'net_kobo', v_d.net_kobo, 'lines', v_n, 'on_hold', v_hold));
  PERFORM maalrise_notify_roles(ARRAY['payment_officer', 'super_admin', 'administrator'], 'distribution_approved',
    'Investor payments approved: ' || v_d.cycle_name || ', month ' || v_d.period,
    v_n || ' investor payment(s) are ready to pay. Make the bank transfers, then mark each one paid.'
      || CASE WHEN v_hold > 0 THEN ' ' || v_hold || ' more on hold until bank details are confirmed: ' || v_held || '.' ELSE '' END,
    '/admin/payment-requests/maalrise', 'distribution_approved:' || p_dist, 'MaalRise: investor payments approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_approve_capital_settlement(p_settlement UUID)
RETURNS VOID AS $$
DECLARE
  v_s   maalrise_capital_settlements%ROWTYPE;
  v_n    INTEGER;
  v_hold INTEGER;
  v_held TEXT;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_s FROM maalrise_capital_settlements WHERE id = p_settlement FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Capital settlement not found'; END IF;
  IF v_s.status <> 'prepared' THEN RAISE EXCEPTION 'This capital settlement is already %', v_s.status; END IF;
  -- 062: as for profit — confirmed accounts are payable now, the rest on hold until confirmed.
  UPDATE maalrise_capital_payments l
     SET bank_name      = CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.bank_name END,
         account_name   = CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.account_name END,
         account_number = CASE WHEN i.bank_confirmed_at IS NOT NULL THEN i.account_number END,
         status         = CASE WHEN i.bank_confirmed_at IS NOT NULL AND i.account_number IS NOT NULL THEN 'payable' ELSE 'on_hold' END,
         updated_at     = NOW()
    FROM maalrise_investors i
   WHERE i.id = l.maalrise_investor_id AND l.settlement_id = p_settlement;
  SELECT COUNT(*) FILTER (WHERE status = 'payable'), COUNT(*) FILTER (WHERE status = 'on_hold'),
         string_agg(investor_name, ', ' ORDER BY investor_name) FILTER (WHERE status = 'on_hold')
    INTO v_n, v_hold, v_held
    FROM maalrise_capital_payments WHERE settlement_id = p_settlement;
  UPDATE maalrise_capital_settlements SET status = 'approved', approved_by = auth.uid(), approved_at = NOW() WHERE id = p_settlement;

  PERFORM maalrise_notify_investor(l.maalrise_investor_id, 'bank_details_needed', 'Your capital repayment is waiting for your bank details',
            'Your MaalRise capital repayment for ' || v_s.cycle_name || ' (' || maalrise_naira(l.amount_kobo)
              || ') is approved. It will be paid as soon as your bank details are confirmed: complete them in the KYC form or contact us.',
            'bank_needed:' || l.id, 'MaalRise: your capital repayment is waiting for your bank details')
     FROM maalrise_capital_payments l WHERE l.settlement_id = p_settlement AND l.status = 'on_hold';
  PERFORM create_audit_log('maalrise_approve_capital_settlement', 'maalrise_capital_settlement', p_settlement::TEXT,
    jsonb_build_object('status', 'prepared'), jsonb_build_object('status', 'approved', 'capital_kobo', v_s.capital_kobo, 'payments', v_n, 'on_hold', v_hold));
  PERFORM maalrise_notify_roles(ARRAY['payment_officer', 'super_admin', 'administrator'], 'capital_settlement_approved',
    'Capital repayments approved: ' || v_s.cycle_name,
    v_n || ' capital repayment(s) are ready to pay. Make the bank transfers, then mark each one paid.'
      || CASE WHEN v_hold > 0 THEN ' ' || v_hold || ' more on hold until bank details are confirmed: ' || v_held || '.' ELSE '' END,
    '/admin/payment-requests/maalrise', 'capital_settlement_approved:' || p_settlement, 'MaalRise: capital repayments approved');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. MaalGrow KYC -> MaalRise, for one MaalRise investor (internal)
--
--    KYC: approved in MaalGrow -> verified here (as 055). Rejected in
--    MaalGrow -> rejected here only where MaalRise relied on MaalGrow.
--    Bank: when the MaalGrow KYC is APPROVED and its bank details are
--    complete, those details are CONFIRMED here — unless MaalRise
--    already holds confirmed details, which are kept. When the KYC is
--    not approved, empty MaalRise details are pre-filled unconfirmed
--    (as 055). Returns whether anything changed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_apply_maalgrow_kyc(p_inv UUID)
RETURNS BOOLEAN AS $$
DECLARE
  m        maalrise_investors%ROWTYPE;
  g        investors%ROWTYPE;
  v_kyc    TEXT;
  v_src    TEXT;
  v_done   BOOLEAN := FALSE;
  v_full   BOOLEAN;
  v_actor  UUID;
BEGIN
  SELECT * INTO m FROM maalrise_investors WHERE id = p_inv FOR UPDATE;
  IF NOT FOUND THEN RETURN FALSE; END IF;
  SELECT * INTO g FROM investors
   WHERE id = m.maalgrow_investor_id OR (m.maalgrow_investor_id IS NULL AND profile_id = m.profile_id)
   LIMIT 1;
  IF NOT FOUND THEN RETURN FALSE; END IF;

  v_kyc := m.kyc_status;
  v_src := m.kyc_source;
  IF g.kyc_status::TEXT = 'approved' AND m.kyc_status <> 'verified' THEN
    v_kyc := 'verified'; v_src := 'maalgrow';
  ELSIF g.kyc_status::TEXT = 'rejected' AND m.kyc_source = 'maalgrow' AND m.kyc_status = 'verified' THEN
    v_kyc := 'rejected';
  ELSIF g.kyc_status::TEXT = 'pending' AND g.kyc_submitted_at IS NOT NULL AND m.kyc_status IN ('not_started', 'rejected')
        AND COALESCE(m.kyc_source, 'maalgrow') = 'maalgrow' THEN
    v_kyc := 'pending_review';
  END IF;
  IF v_kyc IS DISTINCT FROM m.kyc_status THEN
    UPDATE maalrise_investors
       SET kyc_status = v_kyc, kyc_source = CASE WHEN v_kyc = 'verified' THEN v_src ELSE kyc_source END,
           kyc_reviewed_at = CASE WHEN v_kyc IN ('verified', 'rejected') THEN NOW() ELSE kyc_reviewed_at END,
           kyc_reviewed_by = CASE WHEN v_kyc IN ('verified', 'rejected') THEN NULL ELSE kyc_reviewed_by END,
           maalgrow_investor_id = g.id, updated_at = NOW()
     WHERE id = m.id;
    PERFORM create_audit_log('maalrise_sync_kyc_from_maalgrow', 'maalrise_investor', m.id::TEXT,
      jsonb_build_object('kyc_status', m.kyc_status), jsonb_build_object('kyc_status', v_kyc, 'maalgrow_kyc', g.kyc_status::TEXT));
    v_done := TRUE;
  END IF;

  v_full := COALESCE(g.account_number ~ '^[0-9]{10}$', FALSE) AND NULLIF(trim(g.bank_name), '') IS NOT NULL
            AND NULLIF(trim(g.account_name), '') IS NOT NULL;
  IF v_full AND g.kyc_status::TEXT = 'approved' THEN
    -- Details already confirmed in MaalRise are kept as they are.
    IF m.bank_confirmed_at IS NULL THEN
      v_actor := COALESCE(g.kyc_approved_by, auth.uid());
      UPDATE maalrise_investors
         SET bank_name = trim(g.bank_name), account_name = trim(g.account_name), account_number = g.account_number,
             bank_confirmed_by = v_actor, bank_confirmed_at = NOW(), maalgrow_investor_id = g.id, updated_at = NOW()
       WHERE id = m.id;
      INSERT INTO maalrise_bank_details_history (maalrise_investor_id, event, bank_name, account_name, account_number, actor)
      VALUES (m.id, 'confirmed', trim(g.bank_name), trim(g.account_name), g.account_number, v_actor);
      PERFORM create_audit_log('maalrise_bank_confirmed_via_maalgrow_kyc', 'maalrise_investor', m.id::TEXT,
        jsonb_build_object('account_ending', right(m.account_number, 4), 'confirmed', FALSE),
        jsonb_build_object('account_ending', right(g.account_number, 4), 'confirmed', TRUE, 'kyc_approved_by', g.kyc_approved_by));
      v_done := TRUE;
    END IF;
  ELSIF v_full AND m.account_number IS NULL THEN
    UPDATE maalrise_investors
       SET bank_name = trim(g.bank_name), account_name = trim(g.account_name), account_number = g.account_number,
           bank_confirmed_by = NULL, bank_confirmed_at = NULL, maalgrow_investor_id = g.id, updated_at = NOW()
     WHERE id = m.id;
    INSERT INTO maalrise_bank_details_history (maalrise_investor_id, event, bank_name, account_name, account_number, actor)
    VALUES (m.id, 'prefilled_from_maalgrow', trim(g.bank_name), trim(g.account_name), g.account_number, NULL);
    PERFORM create_audit_log('maalrise_sync_bank_from_maalgrow', 'maalrise_investor', m.id::TEXT, NULL,
      jsonb_build_object('account_ending', right(g.account_number, 4), 'confirmed', FALSE));
    v_done := TRUE;
  END IF;
  RETURN v_done;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- The page-load sync (055) now uses the same rule.
CREATE OR REPLACE FUNCTION maalrise_sync_from_maalgrow()
RETURNS INTEGER AS $$
DECLARE
  r   RECORD;
  v_n INTEGER := 0;
BEGIN
  IF auth.uid() IS NULL OR NOT (is_admin() OR get_my_maalrise_investor_id() IS NOT NULL) THEN RETURN 0; END IF;
  FOR r IN SELECT m.id FROM maalrise_investors m WHERE is_admin() OR m.profile_id = auth.uid() LOOP
    IF maalrise_apply_maalgrow_kyc(r.id) THEN v_n := v_n + 1; END IF;
  END LOOP;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. The moment KYC is decided in MaalGrow (any screen, bulk or one
--    by one), MaalRise follows. This can never stop the MaalGrow
--    change: any problem is caught and left for the page-load sync.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_kyc_from_maalgrow_trg()
RETURNS TRIGGER AS $$
DECLARE r RECORD;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.kyc_status IS NOT DISTINCT FROM OLD.kyc_status THEN RETURN NULL; END IF;
  BEGIN
    FOR r IN SELECT id FROM maalrise_investors
              WHERE maalgrow_investor_id = NEW.id OR (maalgrow_investor_id IS NULL AND profile_id = NEW.profile_id) LOOP
      PERFORM maalrise_apply_maalgrow_kyc(r.id);
    END LOOP;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'MaalRise could not follow the MaalGrow KYC decision for investor % (%); the next page load retries', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER maalrise_kyc_from_maalgrow
  AFTER INSERT OR UPDATE OF kyc_status ON investors
  FOR EACH ROW EXECUTE FUNCTION maalrise_kyc_from_maalgrow_trg();

-- A person added to MaalRise whose MaalGrow KYC is already approved is verified, with confirmed bank details, at once.
CREATE OR REPLACE FUNCTION maalrise_kyc_on_add_trg()
RETURNS TRIGGER AS $$
BEGIN
  BEGIN
    PERFORM maalrise_apply_maalgrow_kyc(NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'MaalRise could not copy MaalGrow KYC for % (%); the next page load retries', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER maalrise_kyc_on_add
  AFTER INSERT ON maalrise_investors
  FOR EACH ROW EXECUTE FUNCTION maalrise_kyc_on_add_trg();

-- ------------------------------------------------------------
-- 5. Releasing payments on hold (internal): the investor's confirmed
--    account is filled in and the payments become payable.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_release_held_payments(p_inv UUID)
RETURNS INTEGER AS $$
DECLARE
  v_i maalrise_investors%ROWTYPE;
  v_p INTEGER;
  v_c INTEGER;
BEGIN
  SELECT * INTO v_i FROM maalrise_investors WHERE id = p_inv;
  IF NOT FOUND OR v_i.bank_confirmed_at IS NULL OR v_i.account_number IS NULL THEN RETURN 0; END IF;
  UPDATE maalrise_distribution_lines
     SET status = 'payable', bank_name = v_i.bank_name, account_name = v_i.account_name, account_number = v_i.account_number,
         updated_at = NOW()
   WHERE maalrise_investor_id = p_inv AND status = 'on_hold';
  GET DIAGNOSTICS v_p = ROW_COUNT;
  UPDATE maalrise_capital_payments
     SET status = 'payable', bank_name = v_i.bank_name, account_name = v_i.account_name, account_number = v_i.account_number,
         updated_at = NOW()
   WHERE maalrise_investor_id = p_inv AND status = 'on_hold';
  GET DIAGNOSTICS v_c = ROW_COUNT;
  IF v_p + v_c > 0 THEN
    PERFORM create_audit_log('maalrise_release_held_payments', 'maalrise_investor', p_inv::TEXT, NULL,
      jsonb_build_object('profit_payments', v_p, 'capital_payments', v_c, 'account_ending', right(v_i.account_number, 4)));
    PERFORM maalrise_notify_roles(ARRAY['payment_officer', 'super_admin', 'administrator'], 'payments_released',
      'Payments released: ' || v_i.full_name,
      'Bank details for ' || v_i.full_name || ' are now confirmed: ' || (v_p + v_c)
        || ' payment(s) on hold are ready to pay. Make the transfer(s), then mark each one paid.',
      '/admin/payment-requests/maalrise', 'released:' || p_inv || ':' || extract(epoch FROM clock_timestamp())::TEXT,
      'MaalRise: payments released for ' || v_i.full_name);
  END IF;
  RETURN v_p + v_c;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_release_on_bank_trg()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.bank_confirmed_at IS NOT NULL THEN PERFORM maalrise_release_held_payments(NEW.id); END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
CREATE TRIGGER maalrise_release_on_bank
  AFTER UPDATE OF bank_confirmed_at, bank_name, account_name, account_number ON maalrise_investors
  FOR EACH ROW EXECUTE FUNCTION maalrise_release_on_bank_trg();

-- ------------------------------------------------------------
-- 6. What investors see: a payment on hold shows as approved, waiting
--    for their bank details (059's view, two fields added)
-- ------------------------------------------------------------
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
           COALESCE(SUM(d.amount_kobo) FILTER (WHERE d.status = 'on_hold'), 0) AS on_hold,
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
           'approved_kobo', approved, 'on_hold_kobo', on_hold, 'processing_kobo', processing, 'paid_on', last_paid_on,
           'references', to_jsonb(refs),
           'status', CASE WHEN paid > 0 AND paid >= expected THEN 'paid'
                          WHEN paid > 0 THEN 'part_paid'
                          WHEN approved > 0 OR on_hold > 0 THEN 'approved'
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
    'on_hold', COALESCE(v_cp_row.status = 'on_hold', FALSE),
    'status', CASE WHEN v_cp_row.status = 'paid' THEN 'paid'
                   WHEN v_cp_row.status IN ('payable', 'on_hold') THEN 'approved'
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

-- ------------------------------------------------------------
-- 7. Internal helpers are not callable from the API
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION maalrise_apply_maalgrow_kyc(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_release_held_payments(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_kyc_from_maalgrow_trg() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_kyc_on_add_trg() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_release_on_bank_trg() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION maalrise_apply_maalgrow_kyc(UUID) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION maalrise_release_held_payments(UUID) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION maalrise_kyc_from_maalgrow_trg() FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION maalrise_kyc_on_add_trg() FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION maalrise_release_on_bank_trg() FROM anon, authenticated;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 8. Bring everyone already approved in MaalGrow up to date
-- ------------------------------------------------------------
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT id FROM maalrise_investors LOOP PERFORM maalrise_apply_maalgrow_kyc(r.id); END LOOP;
END $$;

COMMIT;
