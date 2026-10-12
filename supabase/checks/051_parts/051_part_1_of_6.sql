-- ============================================================
-- MaalRise 051 — PART 1 OF 6
-- Role helpers, counterparties, MaalRise investors, KYC submissions, bank-details history
--
-- The six parts together are byte-for-byte the body of
-- supabase/migrations/051_maalrise_core.sql (lines 42–141 here), split
-- so each can be pasted and run on its own in the Supabase SQL Editor.
--
-- Run the parts IN ORDER, 1 to 6, each in its own Run.
-- Each part is its own transaction: if it fails, it leaves nothing
-- behind, and the earlier parts stay as they were. It refuses to run
-- out of order, or twice.
--
-- Success = the final result row reads "Part 1 of 6 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'maalrise%')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND (proname LIKE 'maalrise%' OR proname = 'get_my_maalrise_investor_id')) THEN
    RAISE EXCEPTION 'STOP: MaalRise objects already exist. Part 1 runs only on a database with no MaalRise objects.';
  END IF;
  IF to_regclass('public.maalrise_bank_details_history') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: part 1 of 6 has already been applied (maalrise_bank_details_history exists). Do not run it again.';
  END IF;
END $$;

-- >>> 051 BODY START (part 1)
-- ------------------------------------------------------------
-- 0. Who may do what (Implementation Plan v2, D8)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_caller_role()
RETURNS TEXT AS $$
  SELECT role::TEXT FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION maalrise_can_prepare()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(maalrise_caller_role() IN ('super_admin', 'administrator', 'operations'), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION maalrise_can_approve()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(maalrise_caller_role() IN ('super_admin', 'administrator'), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION maalrise_can_finance()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(maalrise_caller_role() IN ('super_admin', 'administrator', 'finance'), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ------------------------------------------------------------
-- 1. Counterparties
-- ------------------------------------------------------------
CREATE TABLE maalrise_counterparties (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT NOT NULL CHECK (length(trim(name)) > 0),
  registration_no  TEXT,
  contact_email    TEXT,
  contact_phone    TEXT,
  address          TEXT,
  created_by       UUID REFERENCES profiles(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX maalrise_counterparties_name_uq ON maalrise_counterparties (lower(trim(name)));

-- ------------------------------------------------------------
-- 2. MaalRise investors — separate from MaalGrow's investors table.
--    One login (profiles) may hold either product or both.
-- ------------------------------------------------------------
CREATE TABLE maalrise_investors (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id            UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE RESTRICT,
  investor_code         TEXT NOT NULL UNIQUE CHECK (investor_code ~ '^MR-[A-Z0-9]{6}$'),
  full_name             TEXT NOT NULL CHECK (length(trim(full_name)) > 0),
  email                 TEXT NOT NULL CHECK (email = lower(trim(email)) AND email LIKE '%@%'),
  phone                 TEXT,
  status                TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited', 'active', 'suspended')),

  -- KYC. Bank details never count as KYC; a verified MaalGrow KYC may.
  kyc_status            TEXT NOT NULL DEFAULT 'not_started'
                          CHECK (kyc_status IN ('not_started', 'pending_review', 'verified', 'rejected')),
  kyc_source            TEXT CHECK (kyc_source IN ('maalgrow', 'maalrise')),
  maalgrow_investor_id  UUID REFERENCES investors(id) ON DELETE SET NULL,
  kyc_reviewed_by       UUID REFERENCES profiles(id),
  kyc_reviewed_at       TIMESTAMPTZ,
  kyc_notes             TEXT,
  CHECK (kyc_status <> 'verified' OR kyc_source IS NOT NULL),

  -- Current bank details. Each payment (Phase 3) copies the account it
  -- was actually sent to, so changes here never rewrite history.
  bank_name             TEXT,
  account_name          TEXT,
  account_number        TEXT CHECK (account_number IS NULL OR account_number ~ '^[0-9]{10}$'),
  bank_confirmed_by     UUID REFERENCES profiles(id),
  bank_confirmed_at     TIMESTAMPTZ,
  CHECK (bank_confirmed_at IS NULL OR account_number IS NOT NULL),

  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX maalrise_investors_email_uq ON maalrise_investors (email);

CREATE TABLE maalrise_kyc_submissions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maalrise_investor_id  UUID NOT NULL REFERENCES maalrise_investors(id) ON DELETE CASCADE,
  details               JSONB NOT NULL,
  status                TEXT NOT NULL DEFAULT 'pending_review'
                          CHECK (status IN ('pending_review', 'verified', 'rejected')),
  submitted_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_by           UUID REFERENCES profiles(id),
  reviewed_at           TIMESTAMPTZ,
  review_notes          TEXT
);

CREATE TABLE maalrise_bank_details_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  maalrise_investor_id  UUID NOT NULL REFERENCES maalrise_investors(id) ON DELETE CASCADE,
  event                 TEXT NOT NULL CHECK (event IN ('prefilled_from_maalgrow', 'set', 'confirmed')),
  bank_name             TEXT,
  account_name          TEXT,
  account_number        TEXT,
  actor                 UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- <<< 051 BODY END (part 1)

COMMIT;

SELECT 'Part 1 of 6 applied' AS result;
