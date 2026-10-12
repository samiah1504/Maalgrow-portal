-- ============================================================
-- MaalRise 051 — PART 5 OF 6
-- Submit, return and approve terms; add investor; set and confirm bank details
--
-- The six parts together are byte-for-byte the body of
-- supabase/migrations/051_maalrise_core.sql (lines 663–849 here), split
-- so each can be pasted and run on its own in the Supabase SQL Editor.
--
-- Run the parts IN ORDER, 1 to 6, each in its own Run.
-- Each part is its own transaction: if it fails, it leaves nothing
-- behind, and the earlier parts stay as they were. It refuses to run
-- out of order, or twice.
--
-- Success = the final result row reads "Part 5 of 6 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'maalrise_save_terms') THEN
    RAISE EXCEPTION 'STOP: run part 4 of 6 first (it creates maalrise_save_terms).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'maalrise_confirm_bank_details') THEN
    RAISE EXCEPTION 'STOP: part 5 of 6 has already been applied (maalrise_confirm_bank_details exists). Do not run it again.';
  END IF;
END $$;

-- >>> 051 BODY START (part 5)
CREATE OR REPLACE FUNCTION maalrise_submit_terms(p_terms UUID)
RETURNS VOID AS $$
DECLARE
  v_t maalrise_cycle_terms%ROWTYPE;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_t FROM maalrise_cycle_terms WHERE id = p_terms FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Terms not found'; END IF;
  IF v_t.status <> 'draft' THEN RAISE EXCEPTION 'Only draft terms can be submitted (these are %)', v_t.status; END IF;

  UPDATE maalrise_cycle_terms SET status = 'submitted', submitted_by = auth.uid(), submitted_at = NOW()
   WHERE id = p_terms;
  UPDATE maalrise_cycles SET status = 'terms_submitted', updated_at = NOW()
   WHERE id = v_t.cycle_id AND status = 'draft';
  PERFORM create_audit_log('maalrise_submit_terms', 'maalrise_cycle_terms', p_terms::TEXT,
    jsonb_build_object('status', 'draft'), jsonb_build_object('status', 'submitted'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_return_terms(p_terms UUID, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_t maalrise_cycle_terms%ROWTYPE;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO v_t FROM maalrise_cycle_terms WHERE id = p_terms FOR UPDATE;
  IF NOT FOUND OR v_t.status <> 'submitted' THEN RAISE EXCEPTION 'Only submitted terms can be returned'; END IF;

  UPDATE maalrise_cycle_terms
     SET status = 'draft', returned_by = auth.uid(), returned_at = NOW(), return_reason = trim(p_reason),
         submitted_by = NULL, submitted_at = NULL
   WHERE id = p_terms;
  UPDATE maalrise_cycles SET status = 'draft', updated_at = NOW()
   WHERE id = v_t.cycle_id AND status = 'terms_submitted';
  PERFORM create_audit_log('maalrise_return_terms', 'maalrise_cycle_terms', p_terms::TEXT,
    jsonb_build_object('status', 'submitted'), jsonb_build_object('status', 'draft', 'reason', p_reason));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** D5: the approver may not be whoever prepared or submitted the terms. */
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

/**
 * Give an existing investor login MaalRise access. The auth account
 * itself is found or created by the server (Phase 2 API route) through
 * the existing provisioning flow; this records the product access.
 *
 * Reuses verified MaalGrow KYC, and pre-fills MaalGrow bank details
 * UNCONFIRMED for an admin to review.
 */
CREATE OR REPLACE FUNCTION maalrise_add_investor(p_profile UUID, p JSONB)
RETURNS UUID AS $$
DECLARE
  v_profile profiles%ROWTYPE;
  v_mg      investors%ROWTYPE;
  v_id      UUID;
  v_code    TEXT;
  v_bank    BOOLEAN := FALSE;
  v_name    TEXT;
  v_email   TEXT;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_profile FROM profiles WHERE id = p_profile;
  IF NOT FOUND THEN RAISE EXCEPTION 'No login exists for this account'; END IF;
  IF v_profile.role::TEXT <> 'investor' THEN
    RAISE EXCEPTION 'Staff accounts cannot be added as MaalRise investors';
  END IF;
  IF EXISTS (SELECT 1 FROM maalrise_investors WHERE profile_id = p_profile) THEN
    RAISE EXCEPTION 'This person already has MaalRise access';
  END IF;

  SELECT * INTO v_mg FROM investors WHERE profile_id = p_profile;

  -- A profile created at sign-up may carry an empty name; the MaalGrow
  -- record, where there is one, is the better source. Never store blanks.
  v_name  := COALESCE(NULLIF(trim(p->>'full_name'), ''), NULLIF(trim(v_mg.full_name), ''), NULLIF(trim(v_profile.full_name), ''));
  v_email := COALESCE(NULLIF(lower(trim(v_profile.email)), ''), NULLIF(lower(trim(v_mg.email)), ''));
  IF v_name IS NULL THEN RAISE EXCEPTION 'A full name is required for this investor'; END IF;
  IF v_email IS NULL THEN RAISE EXCEPTION 'This login has no email address'; END IF;

  LOOP
    -- Built-ins only (no pgcrypto). No 0/O/1/I, which get misread.
    SELECT 'MR-' || string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::INTEGER, 1), '')
      INTO v_code FROM generate_series(1, 6);
    EXIT WHEN NOT EXISTS (SELECT 1 FROM maalrise_investors WHERE investor_code = v_code);
  END LOOP;

  INSERT INTO maalrise_investors (
    profile_id, investor_code, full_name, email, phone,
    kyc_status, kyc_source, maalgrow_investor_id,
    bank_name, account_name, account_number, created_by)
  VALUES (
    p_profile, v_code, v_name, v_email,
    COALESCE(NULLIF(trim(p->>'phone'), ''), v_mg.phone, v_profile.phone),
    CASE WHEN v_mg.id IS NOT NULL AND v_mg.kyc_status::TEXT = 'approved' THEN 'verified' ELSE 'not_started' END,
    CASE WHEN v_mg.id IS NOT NULL AND v_mg.kyc_status::TEXT = 'approved' THEN 'maalgrow' END,
    v_mg.id,
    COALESCE(NULLIF(trim(p->>'bank_name'), ''), v_mg.bank_name),
    COALESCE(NULLIF(trim(p->>'account_name'), ''), v_mg.account_name),
    COALESCE(NULLIF(trim(p->>'account_number'), ''),
             CASE WHEN v_mg.account_number ~ '^[0-9]{10}$' THEN v_mg.account_number END),
    auth.uid())
  RETURNING id INTO v_id;

  SELECT account_number IS NOT NULL INTO v_bank FROM maalrise_investors WHERE id = v_id;
  IF v_bank THEN
    INSERT INTO maalrise_bank_details_history (maalrise_investor_id, event, bank_name, account_name, account_number, actor)
    SELECT id,
           CASE WHEN NULLIF(trim(p->>'account_number'), '') IS NULL AND v_mg.id IS NOT NULL
                THEN 'prefilled_from_maalgrow' ELSE 'set' END,
           bank_name, account_name, account_number, auth.uid()
    FROM maalrise_investors WHERE id = v_id;
  END IF;

  PERFORM create_audit_log('maalrise_add_investor', 'maalrise_investor', v_id::TEXT, NULL,
    jsonb_build_object('profile_id', p_profile, 'investor_code', v_code, 'reused_maalgrow_kyc',
                       v_mg.id IS NOT NULL AND v_mg.kyc_status::TEXT = 'approved'));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Setting bank details always clears any previous confirmation. */
CREATE OR REPLACE FUNCTION maalrise_set_bank_details(p_investor UUID, p_bank TEXT, p_account_name TEXT, p_account_number TEXT)
RETURNS VOID AS $$
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_account_number !~ '^[0-9]{10}$' THEN RAISE EXCEPTION 'Account number must be 10 digits'; END IF;
  UPDATE maalrise_investors
     SET bank_name = trim(p_bank), account_name = trim(p_account_name), account_number = p_account_number,
         bank_confirmed_by = NULL, bank_confirmed_at = NULL, updated_at = NOW()
   WHERE id = p_investor;
  IF NOT FOUND THEN RAISE EXCEPTION 'Investor not found'; END IF;
  INSERT INTO maalrise_bank_details_history (maalrise_investor_id, event, bank_name, account_name, account_number, actor)
  VALUES (p_investor, 'set', trim(p_bank), trim(p_account_name), p_account_number, auth.uid());
  PERFORM create_audit_log('maalrise_set_bank_details', 'maalrise_investor', p_investor::TEXT, NULL,
    jsonb_build_object('account_ending', right(p_account_number, 4)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_confirm_bank_details(p_investor UUID)
RETURNS VOID AS $$
DECLARE
  v_i maalrise_investors%ROWTYPE;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_i FROM maalrise_investors WHERE id = p_investor FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Investor not found'; END IF;
  IF v_i.account_number IS NULL THEN RAISE EXCEPTION 'There are no bank details to confirm'; END IF;
  UPDATE maalrise_investors SET bank_confirmed_by = auth.uid(), bank_confirmed_at = NOW(), updated_at = NOW()
   WHERE id = p_investor;
  INSERT INTO maalrise_bank_details_history (maalrise_investor_id, event, bank_name, account_name, account_number, actor)
  VALUES (p_investor, 'confirmed', v_i.bank_name, v_i.account_name, v_i.account_number, auth.uid());
  PERFORM create_audit_log('maalrise_confirm_bank_details', 'maalrise_investor', p_investor::TEXT, NULL,
    jsonb_build_object('account_ending', right(v_i.account_number, 4)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- <<< 051 BODY END (part 5)

COMMIT;

SELECT 'Part 5 of 6 applied' AS result;
