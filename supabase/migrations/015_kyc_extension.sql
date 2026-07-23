-- ============================================================
-- Migration 015 – KYC Extension + Bulk Approval
--
-- Extends the EXISTING KYC (which lives on the investors table —
-- there is no separate KYC table) with gender, nationality,
-- occupation and a linked next_of_kin table. No identity documents
-- or uploads are added.
--
-- Status model (no enum change needed):
--   • kyc_status stays pending / approved / rejected
--   • "Update Required" is DERIVED: an approved record missing any
--     newly-required field. Existing approved investors therefore
--     become Update Required automatically, without being rejected
--     and without losing any stored data.
--   • When the investor completes the missing fields the form
--     resubmits (kyc_status → pending) for (bulk) re-approval.
--
-- Apply AFTER migration 014.
-- ============================================================

-- ------------------------------------------------------------
-- 1. New personal fields on investors + approval metadata
-- ------------------------------------------------------------
ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS gender          TEXT,
  ADD COLUMN IF NOT EXISTS nationality     TEXT,
  ADD COLUMN IF NOT EXISTS occupation      TEXT,
  ADD COLUMN IF NOT EXISTS kyc_approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS kyc_approved_by UUID REFERENCES profiles(id);

DO $$ BEGIN
  ALTER TABLE investors
    ADD CONSTRAINT investors_gender_check
    CHECK (gender IS NULL OR gender IN ('female', 'male', 'prefer_not_to_say'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 2. Next of kin (one primary contact per investor)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS next_of_kin (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_id       UUID NOT NULL UNIQUE REFERENCES investors(id) ON DELETE CASCADE,
  full_name         TEXT NOT NULL,
  relationship      TEXT NOT NULL,
  phone             TEXT NOT NULL,
  alternative_phone TEXT,
  email             TEXT,
  address           TEXT NOT NULL,
  city              TEXT NOT NULL,
  state             TEXT NOT NULL,
  country           TEXT NOT NULL DEFAULT 'Nigeria',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DROP TRIGGER IF EXISTS update_next_of_kin_updated_at ON next_of_kin;
CREATE TRIGGER update_next_of_kin_updated_at
  BEFORE UPDATE ON next_of_kin
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE next_of_kin ENABLE ROW LEVEL SECURITY;

-- Admins manage all next-of-kin records
DO $$ BEGIN
  CREATE POLICY "Admins manage next of kin"
    ON next_of_kin FOR ALL
    USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Investors read and maintain only their own next of kin
DO $$ BEGIN
  CREATE POLICY "Investors view own next of kin"
    ON next_of_kin FOR SELECT
    USING (investor_id IN (SELECT id FROM investors WHERE profile_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Investors insert own next of kin"
    ON next_of_kin FOR INSERT
    WITH CHECK (investor_id IN (SELECT id FROM investors WHERE profile_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Investors update own next of kin"
    ON next_of_kin FOR UPDATE
    USING (investor_id IN (SELECT id FROM investors WHERE profile_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 3. Protect the new approval metadata from self-service edits
--    (extends the migration-011 trigger; service role and admins
--    are unaffected)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION protect_investor_sensitive_fields()
RETURNS TRIGGER AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT is_admin() THEN
    IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status THEN
      RAISE EXCEPTION 'kyc_status can only be changed by an administrator';
    END IF;
    IF NEW.investor_code IS DISTINCT FROM OLD.investor_code THEN
      RAISE EXCEPTION 'investor_code cannot be changed';
    END IF;
    IF NEW.kyc_submitted_at IS DISTINCT FROM OLD.kyc_submitted_at THEN
      RAISE EXCEPTION 'kyc_submitted_at can only be set by the platform';
    END IF;
    IF NEW.kyc_approved_at IS DISTINCT FROM OLD.kyc_approved_at
       OR NEW.kyc_approved_by IS DISTINCT FROM OLD.kyc_approved_by THEN
      RAISE EXCEPTION 'KYC approval details can only be set by the platform';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Completeness check — the single source of truth used by the
--    bulk approver (the UI mirrors the same rules).
--    Returns an array of missing-field labels; empty = complete.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION kyc_missing_fields(p_investor_id UUID)
RETURNS TEXT[] AS $$
DECLARE
  v_inv     investors%ROWTYPE;
  v_nok     next_of_kin%ROWTYPE;
  v_missing TEXT[] := '{}';
BEGIN
  SELECT * INTO v_inv FROM investors WHERE id = p_investor_id;
  IF NOT FOUND THEN
    RETURN ARRAY['Investor not found'];
  END IF;

  IF COALESCE(TRIM(v_inv.full_name), '') = ''      THEN v_missing := array_append(v_missing, 'Full name'); END IF;
  IF COALESCE(TRIM(v_inv.email), '') = ''          THEN v_missing := array_append(v_missing, 'Email'); END IF;
  IF COALESCE(TRIM(v_inv.phone), '') = ''          THEN v_missing := array_append(v_missing, 'Phone number'); END IF;
  IF COALESCE(TRIM(v_inv.address), '') = ''        THEN v_missing := array_append(v_missing, 'Address'); END IF;
  IF COALESCE(TRIM(v_inv.bank_name), '') = ''
     OR COALESCE(TRIM(v_inv.account_name), '') = ''
     OR COALESCE(TRIM(v_inv.account_number), '') = '' THEN
    v_missing := array_append(v_missing, 'Bank details');
  END IF;
  IF COALESCE(TRIM(v_inv.gender), '') = ''         THEN v_missing := array_append(v_missing, 'Gender'); END IF;
  IF COALESCE(TRIM(v_inv.nationality), '') = ''    THEN v_missing := array_append(v_missing, 'Nationality'); END IF;
  IF COALESCE(TRIM(v_inv.occupation), '') = ''     THEN v_missing := array_append(v_missing, 'Occupation'); END IF;

  SELECT * INTO v_nok FROM next_of_kin WHERE investor_id = p_investor_id;
  IF NOT FOUND
     OR COALESCE(TRIM(v_nok.full_name), '') = ''
     OR COALESCE(TRIM(v_nok.relationship), '') = ''
     OR COALESCE(TRIM(v_nok.phone), '') = ''
     OR COALESCE(TRIM(v_nok.address), '') = ''
     OR COALESCE(TRIM(v_nok.city), '') = ''
     OR COALESCE(TRIM(v_nok.state), '') = ''
     OR COALESCE(TRIM(v_nok.country), '') = '' THEN
    v_missing := array_append(v_missing, 'Next-of-kin details');
  END IF;

  RETURN v_missing;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ------------------------------------------------------------
-- 5. bulk_approve_kyc — server-side, transactional, partial
--    success. Revalidates every record; approves only eligible
--    ones; audit-logs each approval plus one campaign event.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION bulk_approve_kyc(p_investor_ids UUID[])
RETURNS JSONB AS $$
DECLARE
  v_actor    UUID := auth.uid();
  v_role     TEXT;
  v_id       UUID;
  v_inv      investors%ROWTYPE;
  v_missing  TEXT[];
  v_reasons  TEXT[];
  v_approved INTEGER := 0;
  v_excluded JSONB := '[]'::jsonb;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT role::text INTO v_role FROM profiles WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
    RAISE EXCEPTION 'You do not have permission to approve KYC records';
  END IF;

  IF p_investor_ids IS NULL OR array_length(p_investor_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No investors selected';
  END IF;

  FOREACH v_id IN ARRAY p_investor_ids LOOP
    v_reasons := '{}';

    SELECT * INTO v_inv FROM investors WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      v_excluded := v_excluded || jsonb_build_object(
        'investor_id', v_id, 'investor_code', NULL, 'full_name', NULL,
        'reasons', ARRAY['Investor not found']
      );
      CONTINUE;
    END IF;

    IF v_inv.kyc_status = 'approved' THEN
      v_reasons := array_append(v_reasons, 'Already approved');
    END IF;
    IF v_inv.kyc_status = 'rejected' THEN
      v_reasons := array_append(v_reasons, 'Rejected — awaiting correction and resubmission');
    END IF;
    IF v_inv.kyc_submitted_at IS NULL THEN
      v_reasons := array_append(v_reasons, 'KYC not submitted');
    END IF;

    v_missing := kyc_missing_fields(v_id);
    IF array_length(v_missing, 1) IS NOT NULL THEN
      v_reasons := v_reasons || (SELECT array_agg('Missing: ' || m) FROM unnest(v_missing) AS m);
    END IF;

    IF array_length(v_reasons, 1) IS NOT NULL THEN
      v_excluded := v_excluded || jsonb_build_object(
        'investor_id', v_id,
        'investor_code', v_inv.investor_code,
        'full_name', v_inv.full_name,
        'reasons', v_reasons
      );
      CONTINUE;
    END IF;

    UPDATE investors SET
      kyc_status      = 'approved',
      kyc_approved_at = NOW(),
      kyc_approved_by = v_actor,
      updated_at      = NOW()
    WHERE id = v_id;

    -- Per-investor audit event
    PERFORM create_audit_log(
      'kyc_approved', 'investor', v_id::text,
      jsonb_build_object('kyc_status', v_inv.kyc_status),
      jsonb_build_object('kyc_status', 'approved', 'bulk', true)
    );

    -- Welcome notification
    INSERT INTO notifications (user_id, title, message, type, action_url)
    VALUES (
      v_inv.profile_id,
      'KYC Approved',
      'Your KYC has been approved. You have full access to your MaalGrow portal.',
      'system',
      '/dashboard'
    );

    v_approved := v_approved + 1;
  END LOOP;

  -- Campaign-level audit event
  PERFORM create_audit_log(
    'kyc_bulk_approved', 'investor', NULL,
    NULL,
    jsonb_build_object(
      'selected', array_length(p_investor_ids, 1),
      'approved', v_approved,
      'excluded', jsonb_array_length(v_excluded)
    )
  );

  RETURN jsonb_build_object(
    'selected', array_length(p_investor_ids, 1),
    'approved', v_approved,
    'excluded_count', jsonb_array_length(v_excluded),
    'excluded', v_excluded
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
