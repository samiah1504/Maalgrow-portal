-- ============================================================
-- MaalRise 055 — ROLLBACK. Removes exactly what 055 added and puts
-- maalrise_review_bank_change and maalrise_my_access back as 054 defined them.
--
-- WRITES. Run only if 055 must be undone. MaalGrow and MaalRise
-- 051–054 are not touched; afterwards maalrise_055_preflight.sql must
-- print the original fingerprint.
--
-- REFUSES once any MaalRise email has left the draft state (sent,
-- failed, queued or discarded): that is a record of what was sent.
-- ============================================================
BEGIN;

DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM maalrise_email_outbox WHERE status <> 'draft';
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Rollback refused: % email(s) have been sent, attempted or discarded. Export them first.', v_n;
  END IF;
END $$;

DROP FUNCTION maalrise_sync_from_maalgrow(), maalrise_discard_email(UUID), maalrise_email_result(UUID, BOOLEAN, TEXT, TEXT),
  maalrise_claim_email(UUID), maalrise_can_send_email();
ALTER TABLE maalrise_email_outbox DROP COLUMN queued_at, DROP COLUMN provider_id, DROP COLUMN handled_by, DROP COLUMN discarded_at;
ALTER TABLE maalrise_email_outbox DROP CONSTRAINT maalrise_email_outbox_status_check;
ALTER TABLE maalrise_email_outbox ADD CONSTRAINT maalrise_email_outbox_status_check
  CHECK (status IN ('draft', 'queued', 'sent', 'failed'));

-- Exactly as migration 054 defined it
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
      'bank_change_approved:' || p_request, NULL);
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
      'bank_change_rejected:' || p_request, NULL);
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_my_access()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'maalrise', EXISTS (SELECT 1 FROM maalrise_investors WHERE profile_id = auth.uid()),
    'maalgrow', EXISTS (SELECT 1 FROM investors WHERE profile_id = auth.uid()));
$$ LANGUAGE sql STABLE SECURITY DEFINER;

COMMIT;
