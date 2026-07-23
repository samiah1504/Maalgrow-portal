-- ============================================================
-- Migration 011 – Mandatory KYC Gate
--
-- Investors must complete their KYC form before using the
-- portal. kyc_submitted_at records the submission; the portal
-- redirects investors to /kyc until it is set (or when their
-- KYC was rejected and needs resubmission).
-- ============================================================

-- 1. Track when the investor submitted their KYC form
ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS kyc_submitted_at TIMESTAMPTZ NULL;

-- Backfill: investors already approved by an admin are considered
-- submitted so they are not locked out after this deploys.
UPDATE investors
SET kyc_submitted_at = NOW()
WHERE kyc_submitted_at IS NULL
  AND kyc_status = 'approved';

-- 2. Protect sensitive fields from self-service updates.
--    RLS lets investors UPDATE their own row (bank details, KYC
--    data), but kyc_status and investor_code must only change via
--    an admin session or the service role (auth.uid() IS NULL).
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
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS protect_investor_sensitive_fields_trg ON investors;
CREATE TRIGGER protect_investor_sensitive_fields_trg
  BEFORE UPDATE ON investors
  FOR EACH ROW EXECUTE FUNCTION protect_investor_sensitive_fields();
