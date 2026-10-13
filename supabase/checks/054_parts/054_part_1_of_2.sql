-- ============================================================
-- MaalRise 054 — PART 1 OF 2
-- Investor read policies narrowed; bank detail change requests
--
-- The two parts together are exactly the body of
-- supabase/migrations/054_maalrise_investor_portal.sql, split so
-- each can be pasted and run on its own in the Supabase SQL Editor.
--
-- Run the parts IN ORDER, 1 then 2, each in its own Run.
-- Each part is its own transaction: if it fails, it leaves nothing
-- behind, and the earlier part stays as it was. It refuses to run
-- out of order, or twice.
--
-- Success = the final result row reads "Part 1 of 2 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.maalrise_close_cycle(uuid)') IS NULL THEN
    RAISE EXCEPTION 'STOP: run migration 053 first (MaalRise capital settlement is missing).';
  END IF;
  IF to_regclass('public.maalrise_bank_change_requests') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: part 1 of 2 has already been applied (maalrise_bank_change_requests exists). Do not run it again.';
  END IF;
END $$;

-- >>> 054 BODY START (part 1)

-- ------------------------------------------------------------
-- 1. Investors read through the functions below, not the tables
-- ------------------------------------------------------------
DROP POLICY "Investor reads own MaalRise record" ON maalrise_investors;
DROP POLICY "Investor reads own KYC submissions" ON maalrise_kyc_submissions;
DROP POLICY "Investor reads own visible cycles" ON maalrise_cycles;
DROP POLICY "Investor reads approved terms of own cycles" ON maalrise_cycle_terms;
DROP POLICY "Investor reads approved schedule of own cycles" ON maalrise_schedule_lines;

-- ------------------------------------------------------------
-- 2. Bank detail change requests
-- ------------------------------------------------------------
CREATE TABLE maalrise_bank_change_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maalrise_investor_id  UUID NOT NULL REFERENCES maalrise_investors(id) ON DELETE RESTRICT,
  bank_name             TEXT NOT NULL CHECK (length(trim(bank_name)) > 0),
  account_name          TEXT NOT NULL CHECK (length(trim(account_name)) > 0),
  account_number        TEXT NOT NULL CHECK (account_number ~ '^[0-9]{10}$'),
  status                TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by          UUID NOT NULL REFERENCES profiles(id),
  requested_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by           UUID REFERENCES profiles(id),
  reviewed_at           TIMESTAMPTZ,
  reject_reason         TEXT,
  CHECK (status <> 'rejected' OR length(trim(COALESCE(reject_reason, ''))) > 0),
  CHECK (status NOT IN ('approved', 'rejected') OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL))
);
-- One request waiting at a time.
CREATE UNIQUE INDEX maalrise_bank_change_one_pending
  ON maalrise_bank_change_requests (maalrise_investor_id) WHERE status = 'pending';

CREATE OR REPLACE FUNCTION maalrise_bank_change_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Bank change requests cannot be deleted'; END IF;
  IF OLD.status <> 'pending' THEN RAISE EXCEPTION 'A decided bank change request is final'; END IF;
  IF NEW.bank_name <> OLD.bank_name OR NEW.account_name <> OLD.account_name OR NEW.account_number <> OLD.account_number
     OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id THEN
    RAISE EXCEPTION 'The requested details cannot be edited; cancel and submit a new request';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_bank_change_guard
  BEFORE UPDATE OR DELETE ON maalrise_bank_change_requests
  FOR EACH ROW EXECUTE FUNCTION maalrise_bank_change_guard();

ALTER TABLE maalrise_bank_change_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Staff read bank change requests" ON maalrise_bank_change_requests FOR SELECT USING (is_admin());

/** The investor submits new bank details for staff to review. */
CREATE OR REPLACE FUNCTION maalrise_request_bank_change(p JSONB)
RETURNS UUID AS $$
DECLARE
  v_inv  maalrise_investors%ROWTYPE;
  v_bank TEXT := trim(COALESCE(p->>'bank_name', ''));
  v_name TEXT := trim(COALESCE(p->>'account_name', ''));
  v_no   TEXT := trim(COALESCE(p->>'account_number', ''));
  v_id   UUID;
BEGIN
  SELECT * INTO v_inv FROM maalrise_investors WHERE profile_id = auth.uid() FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF v_bank = '' OR v_name = '' THEN RAISE EXCEPTION 'Bank name and account name are required'; END IF;
  IF v_no !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Account number must be 10 digits'; END IF;
  IF v_inv.bank_confirmed_at IS NOT NULL AND v_inv.account_number = v_no
     AND lower(v_inv.bank_name) = lower(v_bank) AND lower(v_inv.account_name) = lower(v_name) THEN
    RAISE EXCEPTION 'These are already your confirmed bank details';
  END IF;
  IF EXISTS (SELECT 1 FROM maalrise_bank_change_requests WHERE maalrise_investor_id = v_inv.id AND status = 'pending') THEN
    RAISE EXCEPTION 'You already have a change waiting for review. Cancel it first to submit different details.';
  END IF;

  INSERT INTO maalrise_bank_change_requests (maalrise_investor_id, bank_name, account_name, account_number, requested_by)
  VALUES (v_inv.id, v_bank, v_name, v_no, auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_request_bank_change', 'maalrise_bank_change_request', v_id::TEXT, NULL,
    jsonb_build_object('investor_code', v_inv.investor_code, 'account_ending', right(v_no, 4)));
  PERFORM maalrise_notify_roles(ARRAY['super_admin', 'administrator', 'operations'], 'bank_change_requested',
    'Bank details change requested: ' || v_inv.full_name,
    v_inv.full_name || ' (' || v_inv.investor_code || ') asked to change their MaalRise bank details to '
      || v_bank || ', account ending ' || right(v_no, 4) || '. Review and approve or reject the request.',
    '/admin/maalrise/investors/' || v_inv.id || '#bank', 'bank_change_requested:' || v_id, NULL);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** The investor withdraws their own request before it is reviewed. */
CREATE OR REPLACE FUNCTION maalrise_cancel_bank_change(p_request UUID)
RETURNS VOID AS $$
DECLARE
  v_r maalrise_bank_change_requests%ROWTYPE;
BEGIN
  SELECT * INTO v_r FROM maalrise_bank_change_requests WHERE id = p_request FOR UPDATE;
  IF NOT FOUND OR v_r.maalrise_investor_id IS DISTINCT FROM get_my_maalrise_investor_id() THEN
    RAISE EXCEPTION 'Request not found';
  END IF;
  IF v_r.status <> 'pending' THEN RAISE EXCEPTION 'This request has already been %', v_r.status; END IF;
  UPDATE maalrise_bank_change_requests SET status = 'cancelled' WHERE id = p_request;
  PERFORM create_audit_log('maalrise_cancel_bank_change', 'maalrise_bank_change_request', p_request::TEXT,
    jsonb_build_object('status', 'pending'), jsonb_build_object('status', 'cancelled'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * Staff approve (the new details become the CONFIRMED account) or
 * reject with a reason. Payments already approved keep the account
 * they were approved with; prepared ones must be refreshed.
 */
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

-- <<< 054 BODY END (part 1)

COMMIT;

SELECT 'Part 1 of 2 applied' AS result;
