-- ============================================================
-- MaalRise 051 — PART 2 OF 6
-- Cycles, versioned terms, schedule lines, funding, allocations, documents
--
-- The six parts together are byte-for-byte the body of
-- supabase/migrations/051_maalrise_core.sql (lines 142–291 here), split
-- so each can be pasted and run on its own in the Supabase SQL Editor.
--
-- Run the parts IN ORDER, 1 to 6, each in its own Run.
-- Each part is its own transaction: if it fails, it leaves nothing
-- behind, and the earlier parts stay as they were. It refuses to run
-- out of order, or twice.
--
-- Success = the final result row reads "Part 2 of 6 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT to_regclass('public.maalrise_bank_details_history') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: run part 1 of 6 first (it creates maalrise_bank_details_history).';
  END IF;
  IF to_regclass('public.maalrise_documents') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: part 2 of 6 has already been applied (maalrise_documents exists). Do not run it again.';
  END IF;
END $$;

-- >>> 051 BODY START (part 2)
-- ------------------------------------------------------------
-- 3. Cycles and their versioned terms
-- ------------------------------------------------------------
CREATE TABLE maalrise_cycles (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  TEXT NOT NULL CHECK (length(trim(name)) > 0),
  transaction_name      TEXT NOT NULL CHECK (length(trim(transaction_name)) > 0),
  description           TEXT,
  counterparty_id       UUID NOT NULL REFERENCES maalrise_counterparties(id),
  start_date            DATE NOT NULL,
  duration_months       INTEGER NOT NULL CHECK (duration_months BETWEEN 1 AND 120),
  stated_maturity_date  DATE,
  -- A11 is open: whole units at a fixed naira price per Cycle.
  unit_price_kobo       BIGINT NOT NULL CHECK (unit_price_kobo > 0),
  status                TEXT NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'terms_submitted', 'terms_approved',
                                            'active', 'matured', 'closed', 'cancelled')),
  approved_terms_id     UUID,
  activated_by          UUID REFERENCES profiles(id),
  activated_at          TIMESTAMPTZ,
  created_by            UUID REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX maalrise_cycles_name_uq ON maalrise_cycles (lower(trim(name)));

CREATE TABLE maalrise_cycle_terms (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id                  UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  version                   INTEGER NOT NULL CHECK (version >= 1),
  status                    TEXT NOT NULL DEFAULT 'draft'
                              CHECK (status IN ('draft', 'submitted', 'approved', 'returned', 'superseded')),

  -- As entered from the contract
  cost_kobo                 BIGINT NOT NULL CHECK (cost_kobo > 0),
  markup_type               TEXT NOT NULL CHECK (markup_type IN ('percent', 'amount')),
  markup_bps                INTEGER CHECK (markup_bps >= 0),
  markup_amount_kobo        BIGINT CHECK (markup_amount_kobo >= 0),
  stated_sale_price_kobo    BIGINT CHECK (stated_sale_price_kobo > 0),
  fee_basis                 TEXT NOT NULL CHECK (fee_basis IN ('cost', 'markup', 'fixed')),
  fee_bps                   INTEGER CHECK (fee_bps >= 0),
  fee_amount_kobo           BIGINT CHECK (fee_amount_kobo >= 0),
  fee_treatment             TEXT NOT NULL CHECK (fee_treatment IN ('deducted_from_investors', 'charged_to_counterparty', 'waived')),
  schedule_mode             TEXT NOT NULL CHECK (schedule_mode IN ('equal', 'contract')),
  -- D4: no withholding until the Nigerian treatment is confirmed.
  tax_treatment             TEXT NOT NULL DEFAULT 'not_configured' CHECK (tax_treatment IN ('not_configured')),
  CHECK ((markup_type = 'percent' AND markup_bps IS NOT NULL AND markup_amount_kobo IS NULL)
      OR (markup_type = 'amount'  AND markup_amount_kobo IS NOT NULL AND markup_bps IS NULL)),
  CHECK (fee_treatment = 'waived'
      OR (fee_basis = 'fixed' AND fee_amount_kobo IS NOT NULL AND fee_bps IS NULL)
      OR (fee_basis <> 'fixed' AND fee_bps IS NOT NULL AND fee_amount_kobo IS NULL)),

  -- As verified by the database's own arithmetic
  markup_kobo               BIGINT NOT NULL,
  sale_price_kobo           BIGINT NOT NULL,
  fee_kobo                  BIGINT NOT NULL,
  investor_pool_kobo        BIGINT NOT NULL CHECK (investor_pool_kobo >= 0),
  counterparty_total_kobo   BIGINT NOT NULL,
  computed                  JSONB NOT NULL,
  engine_version            TEXT NOT NULL,

  -- D5: separate preparation and approval
  prepared_by               UUID NOT NULL REFERENCES profiles(id),
  submitted_by              UUID REFERENCES profiles(id),
  submitted_at              TIMESTAMPTZ,
  approved_by               UUID REFERENCES profiles(id),
  approved_at               TIMESTAMPTZ,
  returned_by               UUID REFERENCES profiles(id),
  returned_at               TIMESTAMPTZ,
  return_reason             TEXT,
  CHECK (approved_by IS NULL OR (approved_by <> prepared_by AND approved_by IS DISTINCT FROM submitted_by)),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),

  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, version)
);
-- At most one approved and one open (draft/submitted) version per Cycle.
CREATE UNIQUE INDEX maalrise_terms_one_approved ON maalrise_cycle_terms (cycle_id) WHERE status = 'approved';
CREATE UNIQUE INDEX maalrise_terms_one_open ON maalrise_cycle_terms (cycle_id) WHERE status IN ('draft', 'submitted');

ALTER TABLE maalrise_cycles
  ADD CONSTRAINT maalrise_cycles_approved_terms_fk
  FOREIGN KEY (approved_terms_id) REFERENCES maalrise_cycle_terms(id);

CREATE TABLE maalrise_schedule_lines (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  terms_id                  UUID NOT NULL REFERENCES maalrise_cycle_terms(id) ON DELETE CASCADE,
  period                    INTEGER NOT NULL CHECK (period >= 1),
  due_date                  DATE NOT NULL,
  counterparty_gross_kobo   BIGINT NOT NULL CHECK (counterparty_gross_kobo >= 0),
  fee_kobo                  BIGINT NOT NULL CHECK (fee_kobo >= 0),
  investor_net_kobo         BIGINT NOT NULL CHECK (investor_net_kobo >= 0),
  rounding_adjustment_kobo  BIGINT NOT NULL DEFAULT 0 CHECK (rounding_adjustment_kobo >= 0),
  CHECK (counterparty_gross_kobo = investor_net_kobo + fee_kobo),
  UNIQUE (terms_id, period)
);

-- ------------------------------------------------------------
-- 4. Funding and allocations
-- ------------------------------------------------------------
CREATE TABLE maalrise_investor_fundings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id              UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  maalrise_investor_id  UUID NOT NULL REFERENCES maalrise_investors(id) ON DELETE RESTRICT,
  units                 INTEGER NOT NULL CHECK (units > 0),
  amount_kobo           BIGINT NOT NULL CHECK (amount_kobo > 0),
  received_on           DATE NOT NULL,
  reference             TEXT NOT NULL CHECK (length(trim(reference)) > 0),
  status                TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'confirmed', 'rejected')),
  recorded_by           UUID NOT NULL REFERENCES profiles(id),
  confirmed_by          UUID REFERENCES profiles(id),
  confirmed_at          TIMESTAMPTZ,
  rejected_by           UUID REFERENCES profiles(id),
  rejected_at           TIMESTAMPTZ,
  reject_reason         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX maalrise_fundings_reference_uq
  ON maalrise_investor_fundings (cycle_id, lower(trim(reference))) WHERE status <> 'rejected';

CREATE TABLE maalrise_allocations (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id              UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  maalrise_investor_id  UUID NOT NULL REFERENCES maalrise_investors(id) ON DELETE RESTRICT,
  units                 INTEGER NOT NULL CHECK (units > 0),
  capital_kobo          BIGINT NOT NULL CHECK (capital_kobo > 0),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, maalrise_investor_id)
);

-- ------------------------------------------------------------
-- 5. Documents (files live in a private bucket, created separately)
-- ------------------------------------------------------------
CREATE TABLE maalrise_documents (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id              UUID REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  maalrise_investor_id  UUID REFERENCES maalrise_investors(id) ON DELETE RESTRICT,
  category              TEXT NOT NULL CHECK (category IN ('contract', 'supporting', 'kyc', 'tax', 'statement', 'other')),
  name                  TEXT NOT NULL,
  storage_path          TEXT NOT NULL UNIQUE,
  mime_type             TEXT NOT NULL,
  size_bytes            BIGINT NOT NULL CHECK (size_bytes > 0),
  visible_to_investors  BOOLEAN NOT NULL DEFAULT FALSE,
  uploaded_by           UUID NOT NULL REFERENCES profiles(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (cycle_id IS NOT NULL OR maalrise_investor_id IS NOT NULL),
  CHECK (category <> 'kyc' OR visible_to_investors = FALSE OR maalrise_investor_id IS NOT NULL)
);

-- <<< 051 BODY END (part 2)

COMMIT;

SELECT 'Part 2 of 6 applied' AS result;
