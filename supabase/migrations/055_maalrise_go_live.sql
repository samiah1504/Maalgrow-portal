-- ============================================================
-- 055 — MaalRise go-live readiness (Phase 7)
--
-- APPLY ONLY AFTER supabase/checks/maalrise_055_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_055_postapply.sql.
-- To undo: supabase/checks/maalrise_055_rollback.sql (refuses once any
-- MaalRise email has been sent or discarded). Rehearsed by
-- supabase/tests/run_maalrise_tests.sh.
--
-- WHAT THIS ADDS (agreed 14 Oct 2026)
--
--   * Sending MaalRise emails. Emails stay drafts until a super admin
--     or administrator presses Send (or Discard) for each one. The app
--     sends through the same email service as MaalGrow and records the
--     result here; a failed send can be retried and never touches the
--     payment it is about. Nothing is ever sent automatically.
--   * One person, one investor record. MaalRise investors use the
--     MaalGrow investor record for their login invitation, the KYC
--     form, chat and the Communication Centre. maalrise_sync_from_maalgrow()
--     carries the MaalGrow KYC result (and, where MaalRise has none yet,
--     the bank details — unconfirmed) across to MaalRise. It only
--     WRITES MaalRise records; MaalGrow is read, never changed.
--   * Bank-change decisions now also prepare an email draft for the
--     investor (in-app notices already existed).
--   * The portal's product switch: "has MaalGrow" now means holding a
--     MaalGrow investment (maalrise_my_access replaced).
--
-- Nothing in MaalGrow is touched.
-- ============================================================
BEGIN;

-- ------------------------------------------------------------
-- 1. Email outbox: send on a person's press, or discard
-- ------------------------------------------------------------
ALTER TABLE maalrise_email_outbox DROP CONSTRAINT maalrise_email_outbox_status_check;
ALTER TABLE maalrise_email_outbox ADD CONSTRAINT maalrise_email_outbox_status_check
  CHECK (status IN ('draft', 'queued', 'sent', 'failed', 'discarded'));
ALTER TABLE maalrise_email_outbox
  ADD COLUMN queued_at    TIMESTAMPTZ,
  ADD COLUMN provider_id  TEXT,
  ADD COLUMN handled_by   UUID REFERENCES profiles(id),
  ADD COLUMN discarded_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION maalrise_can_send_email()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(maalrise_caller_role() IN ('super_admin', 'administrator'), FALSE);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

/**
 * Take one draft (or a failed email, to retry) for sending. Returns
 * what to send. A queued email cannot be taken twice, so pressing Send
 * twice never sends twice; one stuck in 'queued' for ten minutes (the
 * sender stopped part-way) may be taken again.
 */
CREATE OR REPLACE FUNCTION maalrise_claim_email(p_email UUID)
RETURNS JSONB AS $$
DECLARE
  v_e maalrise_email_outbox%ROWTYPE;
BEGIN
  IF NOT maalrise_can_send_email() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_e FROM maalrise_email_outbox WHERE id = p_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Email not found'; END IF;
  IF NOT (v_e.status IN ('draft', 'failed')
          OR (v_e.status = 'queued' AND v_e.queued_at < NOW() - INTERVAL '10 minutes')) THEN
    RAISE EXCEPTION 'This email is already %', v_e.status;
  END IF;
  UPDATE maalrise_email_outbox
     SET status = 'queued', queued_at = NOW(), attempts = attempts + 1, last_error = NULL, handled_by = auth.uid()
   WHERE id = p_email;
  RETURN jsonb_build_object('id', v_e.id, 'kind', v_e.kind, 'to_email', v_e.to_email, 'subject', v_e.subject, 'body', v_e.body);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Record what the email service said. */
CREATE OR REPLACE FUNCTION maalrise_email_result(p_email UUID, p_ok BOOLEAN, p_provider_id TEXT, p_error TEXT)
RETURNS VOID AS $$
DECLARE
  v_e maalrise_email_outbox%ROWTYPE;
BEGIN
  IF NOT maalrise_can_send_email() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_e FROM maalrise_email_outbox WHERE id = p_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Email not found'; END IF;
  IF v_e.status <> 'queued' THEN RAISE EXCEPTION 'This email is not being sent (it is %)', v_e.status; END IF;
  IF p_ok THEN
    UPDATE maalrise_email_outbox SET status = 'sent', sent_at = NOW(), provider_id = NULLIF(trim(p_provider_id), ''),
           last_error = NULL WHERE id = p_email;
  ELSE
    UPDATE maalrise_email_outbox SET status = 'failed', last_error = left(COALESCE(NULLIF(trim(p_error), ''), 'Unknown error'), 500)
     WHERE id = p_email;
  END IF;
  PERFORM create_audit_log(CASE WHEN p_ok THEN 'maalrise_email_sent' ELSE 'maalrise_email_failed' END,
    'maalrise_email', p_email::TEXT, NULL,
    jsonb_build_object('kind', v_e.kind, 'to', v_e.to_email, 'attempt', v_e.attempts, 'error', CASE WHEN p_ok THEN NULL ELSE p_error END));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_discard_email(p_email UUID)
RETURNS VOID AS $$
DECLARE
  v_e maalrise_email_outbox%ROWTYPE;
BEGIN
  IF NOT maalrise_can_send_email() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_e FROM maalrise_email_outbox WHERE id = p_email FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Email not found'; END IF;
  IF v_e.status NOT IN ('draft', 'failed') THEN RAISE EXCEPTION 'This email is already %', v_e.status; END IF;
  UPDATE maalrise_email_outbox SET status = 'discarded', discarded_at = NOW(), handled_by = auth.uid() WHERE id = p_email;
  PERFORM create_audit_log('maalrise_email_discarded', 'maalrise_email', p_email::TEXT, NULL,
    jsonb_build_object('kind', v_e.kind, 'to', v_e.to_email));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 2. One person, one investor record: carry MaalGrow KYC across
-- ------------------------------------------------------------
/**
 * Bring MaalRise records in line with the MaalGrow investor record:
 *
 *   - MaalGrow KYC approved → MaalRise KYC verified (source MaalGrow)
 *   - MaalGrow KYC submitted, awaiting review → MaalRise pending review
 *   - MaalGrow KYC rejected, where MaalRise relied on MaalGrow → rejected
 *   - no MaalRise bank details yet → MaalGrow's, UNCONFIRMED
 *
 * Staff sync everyone; an investor syncs only themselves. MaalGrow
 * tables are only read. Returns how many investors changed.
 */
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

/**
 * Which products the signed-in person holds (replaces 054's). Every
 * MaalRise investor now has the MaalGrow investor record, so holding
 * MaalGrow means holding a MaalGrow investment — any status, so past
 * investments stay viewable.
 */
CREATE OR REPLACE FUNCTION maalrise_my_access()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'maalrise', EXISTS (SELECT 1 FROM maalrise_investors WHERE profile_id = auth.uid()),
    'maalgrow', EXISTS (SELECT 1 FROM investors i JOIN investments v ON v.investor_id = i.id WHERE i.profile_id = auth.uid()));
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. Bank-change decisions: also an email draft for the investor
--    (unchanged from 054 except the two email subjects)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_review_bank_change(p_request UUID, p_approve BOOLEAN, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_r maalrise_bank_change_requests%ROWTYPE;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_r FROM maalrise_bank_change_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Request not found'; END IF;
  IF v_r.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been %', v_r.status; END IF;

  IF p_approve THEN
    UPDATE maalrise_bank_change_requests SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = NOW()
     WHERE id = p_request;
    UPDATE maalrise_investors
       SET bank_name = v_r.bank_name, account_name = v_r.account_name, account_number = v_r.account_number,
           bank_confirmed_by = auth.uid(), bank_confirmed_at = NOW(), updated_at = NOW()
     WHERE id = v_r.maalrise_investor_id;
    INSERT INTO maalrise_bank_details_history (maalrise_investor_id, event, bank_name, account_name, account_number, actor)
    VALUES (v_r.maalrise_investor_id, 'set', v_r.bank_name, v_r.account_name, v_r.account_number, v_r.requested_by),
           (v_r.maalrise_investor_id, 'confirmed', v_r.bank_name, v_r.account_name, v_r.account_number, auth.uid());
    PERFORM create_audit_log('maalrise_approve_bank_change', 'maalrise_bank_change_request', p_request::TEXT,
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'approved', 'account_ending', right(v_r.account_number, 4)));
    PERFORM maalrise_notify_investor(v_r.maalrise_investor_id, 'bank_change_approved',
      'Bank details updated',
      'Your new MaalRise bank details (' || v_r.bank_name || ', account ending ' || right(v_r.account_number, 4)
        || ') were confirmed. Future payments will go to this account.',
      'bank_change_approved:' || p_request, 'MaalRise: your bank details were updated');
  ELSE
    IF length(trim(COALESCE(p_reason, ''))) = 0 THEN RAISE EXCEPTION 'A reason is required to reject a request'; END IF;
    UPDATE maalrise_bank_change_requests
       SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = NOW(), reject_reason = trim(p_reason)
     WHERE id = p_request;
    PERFORM create_audit_log('maalrise_reject_bank_change', 'maalrise_bank_change_request', p_request::TEXT,
      jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'rejected', 'reason', trim(p_reason)));
    PERFORM maalrise_notify_investor(v_r.maalrise_investor_id, 'bank_change_rejected',
      'Bank details change not approved',
      'Your request to change your MaalRise bank details was not approved: ' || trim(p_reason)
        || '. Payments continue to go to your confirmed account.',
      'bank_change_rejected:' || p_request, 'MaalRise: your bank details change was not approved');
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
