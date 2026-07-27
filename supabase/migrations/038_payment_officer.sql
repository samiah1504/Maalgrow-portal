-- ============================================================
-- 038 — the Payment Officer
--
-- WHAT WAS ASKED FOR. Someone who can work the payment queue and
-- nothing else: see who is owed, see the account to pay into, and mark
-- it paid. Not approve — not for now — with a switch to turn that on
-- later.
--
-- ── WHY THIS IS NOT A SIXTH ADMIN ROLE ───────────────────────
--
-- Every write policy in this portal is is_admin(), and is_admin() is
-- one flat list of five roles. Adding 'payment_officer' to it would
-- hand the accountant database-level write access to investors,
-- investments, cycles, KYC, chats and announcements — no matter what
-- the sidebar shows them. Hiding a menu item is not access control;
-- anyone who opens the browser console holds the same key.
--
-- So payment_officer is deliberately NOT an admin. It gets no table
-- policies at all. Everything it can do goes through the four
-- SECURITY DEFINER functions below, and those are the entire surface
-- area of the role. There is nothing else to reach.
--
-- ── APPROVING IS A SEPARATE PERMISSION ───────────────────────
--
-- Approving authorises the money; marking paid records that it left.
-- They are different controls, and by default one person does not
-- hold both — the officer can only confirm what somebody else
-- authorised. portal_settings.payment_officer_can_approve turns that
-- on when you want it, and the audit log records every change either
-- way.
--
-- ── ACCOUNT NUMBERS ARE SHOWN IN FULL ────────────────────────
--
-- Deliberately, and only here. The officer cannot pay an account they
-- cannot read. The queue function returns the bank details already on
-- the request; it does not open the investors table, so nothing else
-- about the investor — phone, email, KYC documents, holdings — is
-- reachable through this role.
--
-- ── ONE READ PATH ────────────────────────────────────────────
--
-- Administrators and officers both read the queue through the same
-- function. A screen that showed one of them something different
-- would be a screen where a bug could hide.
--
-- Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The role.
--
--    Compared as ::text everywhere below. A literal cast to the enum
--    would be parsed in the same transaction that adds the value,
--    which Postgres refuses — the same reason migration 014 compares
--    investment status as text.
-- ------------------------------------------------------------
ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'payment_officer';

-- ------------------------------------------------------------
-- 2. Settings that actually persist.
--
--    The settings page has been a mock since it was built; this is
--    the first setting with a row behind it. Key/value so the next
--    one does not need a migration of its own.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS portal_settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by UUID REFERENCES profiles(id)
);

ALTER TABLE portal_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Admins read settings"
    ON portal_settings FOR SELECT
    USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Super admins write settings"
    ON portal_settings FOR ALL
    USING (get_my_role()::TEXT = 'super_admin');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Off by default. Turning it on is a decision somebody has to make.
INSERT INTO portal_settings (key, value)
VALUES ('payment_officer_can_approve', 'false'::JSONB)
ON CONFLICT (key) DO NOTHING;

-- ------------------------------------------------------------
-- 3. Who approved, and who paid — two people, two columns.
--
--    reviewed_by was being overwritten on every transition, so the
--    person who approved was erased by the person who marked it
--    paid. It stays as the "last touched by" it has always been;
--    these two are the record that matters.
-- ------------------------------------------------------------
ALTER TABLE payment_requests
  ADD COLUMN IF NOT EXISTS approved_by   UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS approved_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS paid_by       UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS payment_ref   TEXT;

-- ------------------------------------------------------------
-- 4. Who is who.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_payment_officer()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(role::TEXT = 'payment_officer', FALSE)
  FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

/** Anyone allowed to work the queue at all. */
CREATE OR REPLACE FUNCTION can_process_payments()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(is_admin(), FALSE) OR COALESCE(is_payment_officer(), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

/** The switch. Read by the functions AND by the page, so the button
    that is hidden is exactly the button that would be refused. */
CREATE OR REPLACE FUNCTION payment_officer_can_approve()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(
    (SELECT value::TEXT = 'true' FROM portal_settings
      WHERE key = 'payment_officer_can_approve'),
    FALSE
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

/** Authorising the money: approving it, or refusing it. */
CREATE OR REPLACE FUNCTION can_authorise_payments()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(is_admin(), FALSE)
      OR (COALESCE(is_payment_officer(), FALSE) AND payment_officer_can_approve());
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ------------------------------------------------------------
-- 5. Approve.
--
--    Only from pending. A rejected request is finished with, and a
--    paid one has had money leave against it — neither can be
--    approved into something else.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION approve_payment_request(p_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_req payment_requests%ROWTYPE;
BEGIN
  IF NOT can_authorise_payments() THEN
    IF is_payment_officer() THEN
      RAISE EXCEPTION 'Approving payments is switched off for the Payment Officer role. A super admin can turn it on in Settings.';
    END IF;
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_req FROM payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request not found';
  END IF;

  IF v_req.status::TEXT = 'approved' THEN
    RETURN jsonb_build_object('id', p_id, 'status', 'approved', 'changed', FALSE);
  END IF;

  IF v_req.status::TEXT <> 'pending' THEN
    RAISE EXCEPTION 'Only a pending request can be approved (% is %)',
      v_req.request_code, v_req.status;
  END IF;

  UPDATE payment_requests SET
    status      = 'approved',
    approved_by = auth.uid(),
    approved_at = NOW(),
    reviewed_by = auth.uid(),
    reviewed_at = NOW(),
    updated_at  = NOW()
  WHERE id = p_id;

  PERFORM create_audit_log(
    'approve_payment_request', 'payment_request', p_id::TEXT,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', 'approved', 'amount', v_req.amount)
  );

  RETURN jsonb_build_object('id', p_id, 'status', 'approved', 'changed', TRUE,
                            'requestCode', v_req.request_code);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 6. Reject. Also an authorising decision, so the same permission.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION reject_payment_request(p_id UUID, p_reason TEXT)
RETURNS JSONB AS $$
DECLARE
  v_req payment_requests%ROWTYPE;
  v_inv investors%ROWTYPE;
BEGIN
  IF NOT can_authorise_payments() THEN
    IF is_payment_officer() THEN
      RAISE EXCEPTION 'Rejecting payments is switched off for the Payment Officer role. A super admin can turn it on in Settings.';
    END IF;
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  IF p_reason IS NULL OR LENGTH(TRIM(p_reason)) = 0 THEN
    RAISE EXCEPTION 'A reason is required — the investor is told why';
  END IF;

  SELECT * INTO v_req FROM payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request not found';
  END IF;

  -- Money that has already left cannot be un-sent by a status change.
  IF v_req.status::TEXT = 'paid' THEN
    RAISE EXCEPTION 'Request % has already been paid and cannot be rejected', v_req.request_code;
  END IF;

  UPDATE payment_requests SET
    status           = 'rejected',
    rejection_reason = p_reason,
    reviewed_by      = auth.uid(),
    reviewed_at      = NOW(),
    updated_at       = NOW()
  WHERE id = p_id;

  SELECT * INTO v_inv FROM investors WHERE id = v_req.investor_id;
  IF FOUND AND v_inv.profile_id IS NOT NULL THEN
    PERFORM create_notification(
      v_inv.profile_id,
      'Payment Request Not Approved',
      FORMAT('Your %s payment request (%s) was not approved. Reason: %s',
        CASE WHEN v_req.type::TEXT = 'roi' THEN 'profit' ELSE 'capital' END,
        v_req.request_code, p_reason),
      'payment', '/payment-requests'
    );
  END IF;

  PERFORM create_audit_log(
    'reject_payment_request', 'payment_request', p_id::TEXT,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', 'rejected', 'reason', p_reason)
  );

  RETURN jsonb_build_object('id', p_id, 'status', 'rejected', 'changed', TRUE,
                            'requestCode', v_req.request_code);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 7. Mark as paid. THE PAYMENT OFFICER'S JOB.
--
--    Records the date and the person, notifies the investor, and
--    refuses anything that has not been authorised first. That
--    refusal IS the separation of duties: with approving switched
--    off, an officer cannot both authorise and pay.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mark_payment_request_paid(
  p_id        UUID,
  p_paid_on   DATE DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_req payment_requests%ROWTYPE;
  v_inv investors%ROWTYPE;
  v_at  TIMESTAMPTZ;
BEGIN
  IF NOT can_process_payments() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  SELECT * INTO v_req FROM payment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment request not found';
  END IF;

  IF v_req.status::TEXT = 'paid' THEN
    RETURN jsonb_build_object('id', p_id, 'status', 'paid', 'changed', FALSE);
  END IF;

  IF v_req.status::TEXT NOT IN ('approved', 'processing') THEN
    RAISE EXCEPTION 'Request % is % — only an approved request can be marked paid',
      v_req.request_code, v_req.status;
  END IF;

  -- Backdating is allowed, because the transfer often happened before
  -- anyone got to the portal. The future is not.
  v_at := COALESCE(p_paid_on::TIMESTAMPTZ, NOW());
  IF v_at > NOW() THEN
    RAISE EXCEPTION 'A payment cannot be dated in the future';
  END IF;

  UPDATE payment_requests SET
    status      = 'paid',
    paid_at     = v_at,
    paid_by     = auth.uid(),
    payment_ref = COALESCE(NULLIF(TRIM(COALESCE(p_reference, '')), ''), payment_ref),
    reviewed_by = auth.uid(),
    reviewed_at = NOW(),
    updated_at  = NOW()
  WHERE id = p_id;

  SELECT * INTO v_inv FROM investors WHERE id = v_req.investor_id;
  IF FOUND AND v_inv.profile_id IS NOT NULL THEN
    PERFORM create_notification(
      v_inv.profile_id,
      CASE WHEN v_req.type::TEXT = 'roi' THEN 'Your Profit Has Been Paid'
           ELSE 'Your Capital Has Been Paid' END,
      FORMAT('₦%s has been sent to your %s account ending %s.',
        TO_CHAR(v_req.amount, 'FM999,999,999,990.00'),
        v_req.bank_name,
        RIGHT(v_req.account_number, 4)),
      'payment', '/payment-requests'
    );
  END IF;

  PERFORM create_audit_log(
    'mark_payment_request_paid', 'payment_request', p_id::TEXT,
    jsonb_build_object('status', v_req.status),
    jsonb_build_object('status', 'paid', 'amount', v_req.amount, 'paidAt', v_at)
  );

  RETURN jsonb_build_object('id', p_id, 'status', 'paid', 'changed', TRUE,
                            'requestCode', v_req.request_code);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 8. Many at once — the whole point of the redesign.
--
--    Paying 38 investors one click at a time is the thing being
--    fixed. Each request is attempted independently: one bad row
--    reports its own reason and the other 37 still go through.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION process_payment_requests(
  p_ids       UUID[],
  p_action    TEXT,
  p_reason    TEXT DEFAULT NULL,
  p_paid_on   DATE DEFAULT NULL,
  p_reference TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_id      UUID;
  v_one     JSONB;
  v_ok      INTEGER := 0;
  v_failed  INTEGER := 0;
  v_results JSONB := '[]'::JSONB;
BEGIN
  IF p_action NOT IN ('approve', 'reject', 'paid') THEN
    RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;
  IF p_ids IS NULL OR array_length(p_ids, 1) IS NULL THEN
    RETURN jsonb_build_object('succeeded', 0, 'failed', 0, 'results', '[]'::JSONB);
  END IF;

  FOREACH v_id IN ARRAY p_ids LOOP
    BEGIN
      v_one := CASE p_action
                 WHEN 'approve' THEN approve_payment_request(v_id)
                 WHEN 'reject'  THEN reject_payment_request(v_id, p_reason)
                 ELSE mark_payment_request_paid(v_id, p_paid_on, p_reference)
               END;
      v_ok := v_ok + 1;
      v_results := v_results || (v_one || jsonb_build_object('ok', TRUE));
    EXCEPTION WHEN OTHERS THEN
      v_failed := v_failed + 1;
      v_results := v_results || jsonb_build_object(
        'id', v_id, 'ok', FALSE, 'error', SQLERRM
      );
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'succeeded', v_ok, 'failed', v_failed, 'results', v_results
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 9. The queue.
--
--    The ONE read path, for administrators and officers alike. It
--    returns the bank details already on the request — the officer
--    must be able to read the account they are paying — and nothing
--    else about the investor. The investors table itself stays shut.
--
--    No search parameter: the page filters the returned set in
--    memory, which is instant and costs no round trip.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_request_queue(
  p_status TEXT DEFAULT NULL,
  p_limit  INTEGER DEFAULT 500
)
RETURNS TABLE (
  id              UUID,
  request_code    TEXT,
  type            TEXT,
  amount          NUMERIC,
  status          TEXT,
  bank_name       TEXT,
  account_name    TEXT,
  account_number  TEXT,
  notes           TEXT,
  rejection_reason TEXT,
  payment_ref     TEXT,
  created_at      TIMESTAMPTZ,
  approved_at     TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,
  investor_name   TEXT,
  investor_code   TEXT,
  investment_code TEXT,
  series_name     TEXT,
  cycle_label     TEXT,
  approved_by_name TEXT,
  paid_by_name    TEXT
) AS $$
  SELECT
    pr.id, pr.request_code, pr.type::TEXT, pr.amount, pr.status::TEXT,
    pr.bank_name, pr.account_name, pr.account_number,
    pr.notes, pr.rejection_reason, pr.payment_ref,
    pr.created_at, pr.approved_at, pr.paid_at,
    inv.full_name, inv.investor_code,
    i.investment_code, s.name::TEXT, c.cycle_label,
    ap.full_name, pb.full_name
  FROM payment_requests pr
  JOIN investors  inv ON inv.id = pr.investor_id
  LEFT JOIN investments i ON i.id = pr.investment_id
  LEFT JOIN series     s ON s.id = i.series_id
  LEFT JOIN cycles     c ON c.id = i.cycle_id
  LEFT JOIN profiles  ap ON ap.id = pr.approved_by
  LEFT JOIN profiles  pb ON pb.id = pr.paid_by
  WHERE can_process_payments()
    AND (p_status IS NULL OR pr.status::TEXT = p_status)
  -- Oldest first: whoever has waited longest is paid first.
  ORDER BY pr.created_at ASC
  LIMIT GREATEST(COALESCE(p_limit, 500), 1);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ------------------------------------------------------------
-- 10. The counts behind the tabs and the sidebar badge.
--
--     One round trip instead of five, and it works for an officer
--     who has no SELECT policy on the table at all.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_request_counts()
RETURNS JSONB AS $$
  SELECT CASE WHEN can_process_payments() THEN
    jsonb_build_object(
      'pending',    COUNT(*) FILTER (WHERE status::TEXT = 'pending'),
      'approved',   COUNT(*) FILTER (WHERE status::TEXT = 'approved'),
      'processing', COUNT(*) FILTER (WHERE status::TEXT = 'processing'),
      'paid',       COUNT(*) FILTER (WHERE status::TEXT = 'paid'),
      'rejected',   COUNT(*) FILTER (WHERE status::TEXT = 'rejected'),
      'pendingAmount',  COALESCE(SUM(amount) FILTER (WHERE status::TEXT = 'pending'), 0),
      'approvedAmount', COALESCE(SUM(amount) FILTER (WHERE status::TEXT = 'approved'), 0)
    )
  ELSE '{}'::JSONB END
  FROM payment_requests;
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ------------------------------------------------------------
-- 11. What the page is allowed to show this user.
--
--     The page hides the Approve button using the same predicate the
--     function refuses on, so a visible button is never a button
--     that would fail.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION my_payment_permissions()
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'canProcess',        can_process_payments(),
    'canAuthorise',      can_authorise_payments(),
    'isPaymentOfficer',  COALESCE(is_payment_officer(), FALSE),
    'officerCanApprove', payment_officer_can_approve()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ------------------------------------------------------------
-- 12. The switch itself. Super admin only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_payment_officer_can_approve(p_enabled BOOLEAN)
RETURNS JSONB AS $$
DECLARE
  v_was BOOLEAN;
BEGIN
  IF get_my_role()::TEXT <> 'super_admin' THEN
    RAISE EXCEPTION 'Only a super admin can change who may approve payments';
  END IF;

  v_was := payment_officer_can_approve();

  INSERT INTO portal_settings (key, value, updated_at, updated_by)
  VALUES ('payment_officer_can_approve', to_jsonb(p_enabled), NOW(), auth.uid())
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by;

  PERFORM create_audit_log(
    'set_payment_officer_can_approve', 'setting', 'payment_officer_can_approve',
    jsonb_build_object('enabled', v_was),
    jsonb_build_object('enabled', p_enabled)
  );

  RETURN jsonb_build_object('enabled', p_enabled, 'wasEnabled', v_was);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 13. Grants.
--
--     The queue and the actions are reachable by any signed-in user
--     — and refuse everyone who is not an administrator or an
--     officer, from inside. The check lives in one place rather than
--     being duplicated into a grant that can drift from it.
--
--     payment_officer gets NO table policies anywhere. These
--     functions are the whole of what the role can do.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION payment_request_queue(TEXT, INTEGER) TO authenticated;
    GRANT EXECUTE ON FUNCTION payment_request_counts()             TO authenticated;
    GRANT EXECUTE ON FUNCTION my_payment_permissions()             TO authenticated;
    GRANT EXECUTE ON FUNCTION approve_payment_request(UUID)        TO authenticated;
    GRANT EXECUTE ON FUNCTION reject_payment_request(UUID, TEXT)   TO authenticated;
    GRANT EXECUTE ON FUNCTION mark_payment_request_paid(UUID, DATE, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION process_payment_requests(UUID[], TEXT, TEXT, DATE, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION set_payment_officer_can_approve(BOOLEAN) TO authenticated;
  END IF;
END $$;
