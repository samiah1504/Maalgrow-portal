-- ============================================================
-- 051 — MaalRise core (Phase 2)
--
-- APPLY ONLY AFTER supabase/checks/maalrise_preflight.sql reports
-- ready_to_apply = true AND a recoverable backup is confirmed. Then run
-- supabase/checks/maalrise_postapply.sql and compare fingerprints.
-- To undo: supabase/checks/maalrise_rollback.sql (refuses if MaalRise
-- holds data). Rehearsed end to end by supabase/tests/run_maalrise_tests.sh.
--
-- WHAT THIS ADDS
--
--   MaalRise is a separate Murabaha product. Every object here is new
--   and prefixed maalrise_. Nothing existing is altered: no ALTER on a
--   MaalGrow table, no CREATE OR REPLACE of a MaalGrow function. It
--   READS three existing things — profiles, investors (to reuse
--   verified MaalGrow KYC and pre-fill bank details) and is_admin() —
--   and writes to the existing audit_logs through create_audit_log().
--
-- WHAT IT DOES NOT ADD (Phase 3+)
--
--   Receipts, distributions, payments, capital settlement payouts,
--   notifications and the email outbox. Nothing here moves money or
--   sends anything.
--
-- MONEY is BIGINT kobo; RATES are INTEGER basis points. The figures
-- are calculated by src/lib/maalrise/compute.ts and RE-CALCULATED
-- here: terms are refused unless the database's own arithmetic agrees
-- with what was submitted, to the kobo. A client cannot store a
-- schedule that does not reconcile.
--
-- WRITES go only through the SECURITY DEFINER functions below, which
-- check the caller's role themselves. There are no INSERT, UPDATE or
-- DELETE policies on any maalrise_ table.
--
-- Supabase's safeupdate guard refuses an UPDATE or DELETE without a
-- WHERE, inside functions too; every one here has a WHERE.
-- ============================================================

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

-- ------------------------------------------------------------
-- 6. Frozen means frozen
--
--    Approved terms and their schedule cannot be edited or deleted by
--    anyone, including these functions: a change needs a new version.
--    The only update allowed on an approved version is being marked
--    superseded by its successor's approval.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_terms_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'superseded') THEN
      RAISE EXCEPTION 'Approved MaalRise terms cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'Superseded MaalRise terms are read-only';
  END IF;
  IF OLD.status = 'approved' THEN
    IF NEW.status = 'superseded'
       AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Approved MaalRise terms are frozen; create a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maalrise_terms_guard
  BEFORE UPDATE OR DELETE ON maalrise_cycle_terms
  FOR EACH ROW EXECUTE FUNCTION maalrise_terms_guard();

CREATE OR REPLACE FUNCTION maalrise_schedule_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM maalrise_cycle_terms
   WHERE id = COALESCE(OLD.terms_id, NEW.terms_id);
  IF v_status IN ('approved', 'superseded') THEN
    RAISE EXCEPTION 'The schedule of approved MaalRise terms is frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maalrise_schedule_guard
  BEFORE INSERT OR UPDATE OR DELETE ON maalrise_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION maalrise_schedule_guard();

-- Staff are not investors (D10). Checked at the table, not only in the
-- function, so no other path can add one.
CREATE OR REPLACE FUNCTION maalrise_investor_not_staff()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::TEXT INTO v_role FROM profiles WHERE id = NEW.profile_id;
  IF v_role IS DISTINCT FROM 'investor' THEN
    RAISE EXCEPTION 'Only investor accounts can hold MaalRise access (this account is %)', COALESCE(v_role, 'unknown');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maalrise_investor_not_staff
  BEFORE INSERT OR UPDATE OF profile_id ON maalrise_investors
  FOR EACH ROW EXECUTE FUNCTION maalrise_investor_not_staff();

-- ------------------------------------------------------------
-- 7. Row level security — read paths only
-- ------------------------------------------------------------
ALTER TABLE maalrise_counterparties        ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_investors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_kyc_submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_bank_details_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_cycles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_cycle_terms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_schedule_lines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_investor_fundings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_allocations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_documents             ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_my_maalrise_investor_id()
RETURNS UUID AS $$
  SELECT id FROM maalrise_investors WHERE profile_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- An investor sees a Cycle only once it has been activated with
-- approved terms, and only if they hold an allocation in it.
CREATE OR REPLACE FUNCTION maalrise_cycle_visible_to_me(p_cycle UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM maalrise_cycles c
    JOIN maalrise_allocations a ON a.cycle_id = c.id
    WHERE c.id = p_cycle
      AND c.status IN ('active', 'matured', 'closed')
      AND c.approved_terms_id IS NOT NULL
      AND a.maalrise_investor_id = get_my_maalrise_investor_id()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY "Staff read counterparties" ON maalrise_counterparties FOR SELECT USING (is_admin());

CREATE POLICY "Staff read MaalRise investors" ON maalrise_investors FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own MaalRise record" ON maalrise_investors FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "Staff read KYC submissions" ON maalrise_kyc_submissions FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own KYC submissions" ON maalrise_kyc_submissions
  FOR SELECT USING (maalrise_investor_id = get_my_maalrise_investor_id());

CREATE POLICY "Staff read bank history" ON maalrise_bank_details_history FOR SELECT USING (is_admin());

CREATE POLICY "Staff read cycles" ON maalrise_cycles FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own visible cycles" ON maalrise_cycles FOR SELECT USING (maalrise_cycle_visible_to_me(id));

CREATE POLICY "Staff read terms" ON maalrise_cycle_terms FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads approved terms of own cycles" ON maalrise_cycle_terms
  FOR SELECT USING (status = 'approved' AND maalrise_cycle_visible_to_me(cycle_id));

CREATE POLICY "Staff read schedule" ON maalrise_schedule_lines FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads approved schedule of own cycles" ON maalrise_schedule_lines
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM maalrise_cycle_terms t
    WHERE t.id = terms_id AND t.status = 'approved' AND maalrise_cycle_visible_to_me(t.cycle_id)));

CREATE POLICY "Staff read fundings" ON maalrise_investor_fundings FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own confirmed fundings" ON maalrise_investor_fundings
  FOR SELECT USING (status = 'confirmed' AND maalrise_investor_id = get_my_maalrise_investor_id());

CREATE POLICY "Staff read allocations" ON maalrise_allocations FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own allocations in visible cycles" ON maalrise_allocations
  FOR SELECT USING (maalrise_investor_id = get_my_maalrise_investor_id() AND maalrise_cycle_visible_to_me(cycle_id));

CREATE POLICY "Staff read documents" ON maalrise_documents FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads visible documents" ON maalrise_documents
  FOR SELECT USING (
    visible_to_investors
    AND (
      (cycle_id IS NOT NULL AND maalrise_cycle_visible_to_me(cycle_id))
      OR (cycle_id IS NULL AND maalrise_investor_id = get_my_maalrise_investor_id())
    )
  );

-- ------------------------------------------------------------
-- 8. Arithmetic — the database's own check of the terms engine
-- ------------------------------------------------------------
/** amount × bps / 10 000, rounded half away from zero, to the kobo. */
CREATE OR REPLACE FUNCTION maalrise_apply_bps(p_amount BIGINT, p_bps INTEGER)
RETURNS BIGINT AS $$
  SELECT round((p_amount::NUMERIC * p_bps) / 10000)::BIGINT;
$$ LANGUAGE sql IMMUTABLE;

-- ------------------------------------------------------------
-- 9. Writes
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION maalrise_create_counterparty(p JSONB)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  INSERT INTO maalrise_counterparties (name, registration_no, contact_email, contact_phone, address, created_by)
  VALUES (trim(p->>'name'), NULLIF(trim(p->>'registration_no'), ''), NULLIF(trim(p->>'contact_email'), ''),
          NULLIF(trim(p->>'contact_phone'), ''), NULLIF(trim(p->>'address'), ''), auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_create_counterparty', 'maalrise_counterparty', v_id::TEXT, NULL, p);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_create_cycle(p JSONB)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  INSERT INTO maalrise_cycles (name, transaction_name, description, counterparty_id, start_date,
                               duration_months, stated_maturity_date, unit_price_kobo, created_by)
  VALUES (trim(p->>'name'), trim(p->>'transaction_name'), NULLIF(trim(p->>'description'), ''),
          (p->>'counterparty_id')::UUID, (p->>'start_date')::DATE, (p->>'duration_months')::INTEGER,
          NULLIF(p->>'stated_maturity_date', '')::DATE, (p->>'unit_price_kobo')::BIGINT, auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_create_cycle', 'maalrise_cycle', v_id::TEXT, NULL, p);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * Save the open draft of a Cycle's terms, verifying every figure.
 *
 * p_terms carries the inputs as entered and the engine's figures;
 * p_schedule is the per-month array. Nothing is stored unless the
 * database's own arithmetic reaches the same numbers to the kobo.
 */
CREATE OR REPLACE FUNCTION maalrise_save_terms(p_cycle UUID, p_terms JSONB, p_schedule JSONB)
RETURNS UUID AS $$
DECLARE
  v_cycle      maalrise_cycles%ROWTYPE;
  v_open       maalrise_cycle_terms%ROWTYPE;
  v_id         UUID;
  v_version    INTEGER;
  v_cost       BIGINT := (p_terms->>'cost_kobo')::BIGINT;
  v_mtype      TEXT   := p_terms->>'markup_type';
  v_mbps       INTEGER := NULLIF(p_terms->>'markup_bps', '')::INTEGER;
  v_mamt       BIGINT := NULLIF(p_terms->>'markup_amount_kobo', '')::BIGINT;
  v_stated     BIGINT := NULLIF(p_terms->>'stated_sale_price_kobo', '')::BIGINT;
  v_fbasis     TEXT   := p_terms->>'fee_basis';
  v_fbps       INTEGER := NULLIF(p_terms->>'fee_bps', '')::INTEGER;
  v_famt       BIGINT := NULLIF(p_terms->>'fee_amount_kobo', '')::BIGINT;
  v_ftreat     TEXT   := p_terms->>'fee_treatment';
  v_smode      TEXT   := p_terms->>'schedule_mode';
  v_markup     BIGINT;
  v_sale       BIGINT;
  v_fee        BIGINT := 0;
  v_pool       BIGINT;
  v_cp_total   BIGINT;
  v_n          INTEGER;
  v_line       JSONB;
  v_i          INTEGER := 0;
  v_net_sum    BIGINT := 0;
  v_fee_sum    BIGINT := 0;
  v_net        BIGINT;
  v_lfee       BIGINT;
  v_round      BIGINT;
  v_exp_fee    BIGINT;
  v_exp_net    BIGINT;
  v_exp_round  BIGINT;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status NOT IN ('draft', 'terms_approved') THEN
    RAISE EXCEPTION 'Terms can only be prepared for a draft Cycle or as a new version of approved terms (Cycle is %)', v_cycle.status;
  END IF;
  v_n := v_cycle.duration_months;

  -- Markup, sale price
  IF v_mtype = 'percent' THEN
    v_markup := maalrise_apply_bps(v_cost, v_mbps);
  ELSIF v_mtype = 'amount' THEN
    v_markup := v_mamt;
  ELSE
    RAISE EXCEPTION 'Unknown markup type %', v_mtype;
  END IF;
  v_sale := v_cost + v_markup;
  IF v_stated IS NOT NULL AND v_stated <> v_sale THEN
    RAISE EXCEPTION 'Stated sale price % does not equal cost + markup %', v_stated, v_sale;
  END IF;

  -- Fee: separate from markup, basis and treatment from the contract
  IF v_ftreat IS NULL OR v_ftreat NOT IN ('deducted_from_investors', 'charged_to_counterparty', 'waived') THEN
    RAISE EXCEPTION 'Fee treatment must be stated explicitly';
  END IF;
  IF v_ftreat <> 'waived' THEN
    v_fee := CASE v_fbasis
               WHEN 'fixed'  THEN v_famt
               WHEN 'cost'   THEN maalrise_apply_bps(v_cost, v_fbps)
               WHEN 'markup' THEN maalrise_apply_bps(v_markup, v_fbps)
             END;
    IF v_fee IS NULL THEN RAISE EXCEPTION 'Fee rate or amount is missing'; END IF;
  ELSE
    v_fbps := NULL; v_famt := NULL;
  END IF;

  v_pool := CASE WHEN v_ftreat = 'deducted_from_investors' THEN v_markup - v_fee ELSE v_markup END;
  v_cp_total := CASE WHEN v_ftreat = 'charged_to_counterparty' THEN v_sale + v_fee ELSE v_sale END;
  IF v_pool < 0 THEN RAISE EXCEPTION 'The fee deducted from investors exceeds the markup'; END IF;

  -- The engine's headline figures must match ours exactly
  IF (p_terms->>'markup_kobo')::BIGINT IS DISTINCT FROM v_markup
     OR (p_terms->>'sale_price_kobo')::BIGINT IS DISTINCT FROM v_sale
     OR (p_terms->>'fee_kobo')::BIGINT IS DISTINCT FROM v_fee
     OR (p_terms->>'investor_pool_kobo')::BIGINT IS DISTINCT FROM v_pool
     OR (p_terms->>'counterparty_total_kobo')::BIGINT IS DISTINCT FROM v_cp_total THEN
    RAISE EXCEPTION 'Submitted figures do not reconcile with the database calculation (markup %, sale %, fee %, pool %, counterparty %)',
      v_markup, v_sale, v_fee, v_pool, v_cp_total;
  END IF;

  -- Schedule
  IF jsonb_typeof(p_schedule) <> 'array' OR jsonb_array_length(p_schedule) <> v_n THEN
    RAISE EXCEPTION 'The schedule must have exactly % months', v_n;
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_schedule) LOOP
    v_i := v_i + 1;
    v_net := (v_line->>'investor_net_kobo')::BIGINT;
    v_lfee := (v_line->>'fee_kobo')::BIGINT;
    v_round := COALESCE((v_line->>'rounding_adjustment_kobo')::BIGINT, 0);
    IF (v_line->>'period')::INTEGER <> v_i THEN RAISE EXCEPTION 'Schedule periods must run 1..% in order', v_n; END IF;
    IF v_net IS NULL OR v_net < 0 OR v_lfee IS NULL OR v_lfee < 0 THEN
      RAISE EXCEPTION 'Month %: amounts must be zero or more', v_i;
    END IF;
    IF (v_line->>'counterparty_gross_kobo')::BIGINT IS DISTINCT FROM v_net + v_lfee THEN
      RAISE EXCEPTION 'Month %: gross must equal net + fee', v_i;
    END IF;
    -- Fee shown evenly with the remainder on the final month (A7 provisional);
    -- an equal schedule likewise. Computed first: inside an IF, a CASE's
    -- own THEN would be read as the IF's.
    v_exp_fee := (v_fee / v_n) + (CASE WHEN v_i = v_n THEN v_fee % v_n ELSE 0 END);
    v_exp_net := (v_pool / v_n) + (CASE WHEN v_i = v_n THEN v_pool % v_n ELSE 0 END);
    v_exp_round := CASE WHEN v_i < v_n THEN 0
                        WHEN v_smode = 'equal' THEN v_pool % v_n + v_fee % v_n
                        ELSE v_fee % v_n END;
    IF v_lfee <> v_exp_fee THEN
      RAISE EXCEPTION 'Month %: fee portion should be % (even split)', v_i, v_exp_fee;
    END IF;
    IF v_smode = 'equal' AND v_net <> v_exp_net THEN
      RAISE EXCEPTION 'Month %: equal instalment should be %', v_i, v_exp_net;
    END IF;
    IF v_round <> v_exp_round THEN
      RAISE EXCEPTION 'Month %: rounding adjustment should be %', v_i, v_exp_round;
    END IF;
    v_net_sum := v_net_sum + v_net;
    v_fee_sum := v_fee_sum + v_lfee;
  END LOOP;
  IF v_net_sum <> v_pool THEN
    RAISE EXCEPTION 'Monthly amounts total % but the investor profit pool is %', v_net_sum, v_pool;
  END IF;
  IF v_fee_sum <> v_fee THEN
    RAISE EXCEPTION 'Monthly fees total % but the fee is %', v_fee_sum, v_fee;
  END IF;

  -- Replace the open draft, or start a new version
  SELECT * INTO v_open FROM maalrise_cycle_terms
   WHERE cycle_id = p_cycle AND status IN ('draft', 'submitted') FOR UPDATE;
  IF FOUND AND v_open.status = 'submitted' THEN
    RAISE EXCEPTION 'These terms are awaiting approval; return them before editing';
  END IF;
  IF FOUND THEN
    DELETE FROM maalrise_schedule_lines WHERE terms_id = v_open.id;
    DELETE FROM maalrise_cycle_terms WHERE id = v_open.id;
    v_version := v_open.version;
  ELSE
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version FROM maalrise_cycle_terms WHERE cycle_id = p_cycle;
  END IF;

  INSERT INTO maalrise_cycle_terms (
    cycle_id, version, status, cost_kobo, markup_type, markup_bps, markup_amount_kobo, stated_sale_price_kobo,
    fee_basis, fee_bps, fee_amount_kobo, fee_treatment, schedule_mode,
    markup_kobo, sale_price_kobo, fee_kobo, investor_pool_kobo, counterparty_total_kobo,
    computed, engine_version, prepared_by)
  VALUES (
    p_cycle, v_version, 'draft', v_cost, v_mtype,
    CASE WHEN v_mtype = 'percent' THEN v_mbps END, CASE WHEN v_mtype = 'amount' THEN v_mamt END, v_stated,
    v_fbasis,
    CASE WHEN v_ftreat <> 'waived' AND v_fbasis <> 'fixed' THEN v_fbps END,
    CASE WHEN v_ftreat <> 'waived' AND v_fbasis = 'fixed' THEN v_famt END,
    v_ftreat, v_smode,
    v_markup, v_sale, v_fee, v_pool, v_cp_total,
    p_terms, COALESCE(p_terms->>'engine_version', 'unknown'), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO maalrise_schedule_lines (terms_id, period, due_date, counterparty_gross_kobo, fee_kobo,
                                       investor_net_kobo, rounding_adjustment_kobo)
  SELECT v_id, (l->>'period')::INTEGER,
         (v_cycle.start_date + make_interval(months => (l->>'period')::INTEGER))::DATE,
         (l->>'counterparty_gross_kobo')::BIGINT, (l->>'fee_kobo')::BIGINT,
         (l->>'investor_net_kobo')::BIGINT, COALESCE((l->>'rounding_adjustment_kobo')::BIGINT, 0)
  FROM jsonb_array_elements(p_schedule) l;

  PERFORM create_audit_log('maalrise_save_terms', 'maalrise_cycle_terms', v_id::TEXT, NULL,
    jsonb_build_object('cycle_id', p_cycle, 'version', v_version, 'investor_pool_kobo', v_pool, 'fee_kobo', v_fee));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

/**
 * Review MaalRise KYC. Verifying requires a submission to have been
 * made (bank details alone are never KYC); MaalGrow-verified KYC is
 * recorded at add time and needs no review here.
 */
CREATE OR REPLACE FUNCTION maalrise_review_kyc(p_investor UUID, p_decision TEXT, p_notes TEXT)
RETURNS VOID AS $$
DECLARE
  v_sub maalrise_kyc_submissions%ROWTYPE;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_decision NOT IN ('verified', 'rejected') THEN RAISE EXCEPTION 'Decision must be verified or rejected'; END IF;
  IF p_decision = 'rejected' AND (p_notes IS NULL OR length(trim(p_notes)) = 0) THEN
    RAISE EXCEPTION 'A reason is required to reject KYC';
  END IF;
  SELECT * INTO v_sub FROM maalrise_kyc_submissions
   WHERE maalrise_investor_id = p_investor AND status = 'pending_review'
   ORDER BY submitted_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'There is no KYC submission awaiting review'; END IF;

  UPDATE maalrise_kyc_submissions
     SET status = p_decision, reviewed_by = auth.uid(), reviewed_at = NOW(), review_notes = NULLIF(trim(p_notes), '')
   WHERE id = v_sub.id;
  UPDATE maalrise_investors
     SET kyc_status = p_decision, kyc_source = CASE WHEN p_decision = 'verified' THEN 'maalrise' ELSE kyc_source END,
         kyc_reviewed_by = auth.uid(), kyc_reviewed_at = NOW(), kyc_notes = NULLIF(trim(p_notes), ''), updated_at = NOW()
   WHERE id = p_investor;
  PERFORM create_audit_log('maalrise_review_kyc', 'maalrise_investor', p_investor::TEXT,
    NULL, jsonb_build_object('decision', p_decision, 'submission_id', v_sub.id));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Phase 2 records a submission made on the investor's behalf; the investor form arrives in Phase 5. */
CREATE OR REPLACE FUNCTION maalrise_record_kyc_submission(p_investor UUID, p_details JSONB)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT (maalrise_can_prepare() OR p_investor = get_my_maalrise_investor_id()) THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_details IS NULL OR p_details = '{}'::JSONB THEN RAISE EXCEPTION 'KYC details are required'; END IF;
  INSERT INTO maalrise_kyc_submissions (maalrise_investor_id, details) VALUES (p_investor, p_details)
  RETURNING id INTO v_id;
  UPDATE maalrise_investors SET kyc_status = 'pending_review', updated_at = NOW()
   WHERE id = p_investor AND kyc_status IN ('not_started', 'rejected');
  PERFORM create_audit_log('maalrise_record_kyc_submission', 'maalrise_investor', p_investor::TEXT, NULL,
    jsonb_build_object('submission_id', v_id));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_record_funding(p_cycle UUID, p_investor UUID, p_units INTEGER,
                                                   p_amount_kobo BIGINT, p_received_on DATE, p_reference TEXT)
RETURNS UUID AS $$
DECLARE
  v_cycle maalrise_cycles%ROWTYPE;
  v_id    UUID;
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status NOT IN ('draft', 'terms_submitted', 'terms_approved') THEN
    RAISE EXCEPTION 'Funding can only be recorded before the Cycle is activated';
  END IF;
  IF p_amount_kobo <> p_units::BIGINT * v_cycle.unit_price_kobo THEN
    RAISE EXCEPTION 'Amount % is not % units × unit price %', p_amount_kobo, p_units, v_cycle.unit_price_kobo;
  END IF;
  IF p_received_on > CURRENT_DATE THEN RAISE EXCEPTION 'Funding cannot be dated in the future'; END IF;
  INSERT INTO maalrise_investor_fundings (cycle_id, maalrise_investor_id, units, amount_kobo, received_on, reference, recorded_by)
  VALUES (p_cycle, p_investor, p_units, p_amount_kobo, p_received_on, trim(p_reference), auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_record_funding', 'maalrise_investor_funding', v_id::TEXT, NULL,
    jsonb_build_object('cycle_id', p_cycle, 'investor_id', p_investor, 'units', p_units, 'amount_kobo', p_amount_kobo));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Confirming funding is what creates or tops up the allocation. */
CREATE OR REPLACE FUNCTION maalrise_confirm_funding(p_funding UUID)
RETURNS VOID AS $$
DECLARE
  v_f        maalrise_investor_fundings%ROWTYPE;
  v_cycle    maalrise_cycles%ROWTYPE;
  v_required INTEGER;
  v_funded   INTEGER;
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_f FROM maalrise_investor_fundings WHERE id = p_funding FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding not found'; END IF;
  IF v_f.status = 'confirmed' THEN RETURN; END IF;
  IF v_f.status <> 'recorded' THEN RAISE EXCEPTION 'Only recorded funding can be confirmed'; END IF;
  IF auth.uid() = v_f.recorded_by THEN
    RAISE EXCEPTION 'Funding must be confirmed by someone other than the person who recorded it';
  END IF;

  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = v_f.cycle_id FOR UPDATE;
  IF v_cycle.status NOT IN ('draft', 'terms_submitted', 'terms_approved') THEN
    RAISE EXCEPTION 'Funding can only be confirmed before the Cycle is activated';
  END IF;

  -- Never over-subscribe the cost of the transaction.
  SELECT COALESCE(SUM(units), 0) INTO v_funded FROM maalrise_allocations WHERE cycle_id = v_f.cycle_id;
  SELECT CEIL(t.cost_kobo::NUMERIC / v_cycle.unit_price_kobo)::INTEGER INTO v_required
    FROM maalrise_cycle_terms t
   WHERE t.cycle_id = v_f.cycle_id AND t.status IN ('approved', 'submitted', 'draft')
   ORDER BY (t.status = 'approved') DESC, t.version DESC LIMIT 1;
  IF v_required IS NOT NULL AND v_funded + v_f.units > v_required THEN
    RAISE EXCEPTION 'Confirming % units would exceed the % units the transaction cost requires (% already funded)',
      v_f.units, v_required, v_funded;
  END IF;

  UPDATE maalrise_investor_fundings SET status = 'confirmed', confirmed_by = auth.uid(), confirmed_at = NOW()
   WHERE id = p_funding;

  INSERT INTO maalrise_allocations (cycle_id, maalrise_investor_id, units, capital_kobo)
  VALUES (v_f.cycle_id, v_f.maalrise_investor_id, v_f.units, v_f.amount_kobo)
  ON CONFLICT (cycle_id, maalrise_investor_id) DO UPDATE
    SET units = maalrise_allocations.units + EXCLUDED.units,
        capital_kobo = maalrise_allocations.capital_kobo + EXCLUDED.capital_kobo,
        updated_at = NOW();

  PERFORM create_audit_log('maalrise_confirm_funding', 'maalrise_investor_funding', p_funding::TEXT,
    jsonb_build_object('status', 'recorded'), jsonb_build_object('status', 'confirmed', 'units', v_f.units));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_reject_funding(p_funding UUID, p_reason TEXT)
RETURNS VOID AS $$
BEGIN
  IF NOT maalrise_can_finance() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF p_reason IS NULL OR length(trim(p_reason)) = 0 THEN RAISE EXCEPTION 'A reason is required'; END IF;
  UPDATE maalrise_investor_fundings
     SET status = 'rejected', rejected_by = auth.uid(), rejected_at = NOW(), reject_reason = trim(p_reason)
   WHERE id = p_funding AND status = 'recorded';
  IF NOT FOUND THEN RAISE EXCEPTION 'Only recorded (unconfirmed) funding can be rejected'; END IF;
  PERFORM create_audit_log('maalrise_reject_funding', 'maalrise_investor_funding', p_funding::TEXT,
    jsonb_build_object('status', 'recorded'), jsonb_build_object('status', 'rejected', 'reason', p_reason));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 10. Activation (D3): every check must pass
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_activation_checks(p_cycle UUID)
RETURNS JSONB AS $$
DECLARE
  v_cycle    maalrise_cycles%ROWTYPE;
  v_terms    maalrise_cycle_terms%ROWTYPE;
  v_funded   BIGINT;
  v_alloc    BIGINT;
  v_checks   JSONB := '[]'::JSONB;
  v_pending  INTEGER;
BEGIN
  IF NOT is_admin() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  SELECT * INTO v_terms FROM maalrise_cycle_terms WHERE id = v_cycle.approved_terms_id;

  SELECT COALESCE(SUM(amount_kobo), 0) INTO v_funded
    FROM maalrise_investor_fundings WHERE cycle_id = p_cycle AND status = 'confirmed';
  SELECT COALESCE(SUM(capital_kobo), 0) INTO v_alloc FROM maalrise_allocations WHERE cycle_id = p_cycle;
  SELECT COUNT(*) INTO v_pending FROM maalrise_investor_fundings WHERE cycle_id = p_cycle AND status = 'recorded';

  v_checks := v_checks || jsonb_build_object('key', 'terms_approved',
    'ok', v_terms.id IS NOT NULL, 'detail', 'Terms approved by a second authorised person');
  v_checks := v_checks || jsonb_build_object('key', 'fully_funded',
    'ok', v_terms.id IS NOT NULL AND v_funded = v_terms.cost_kobo,
    'detail', CASE WHEN v_terms.id IS NULL THEN 'No approved terms'
                   WHEN v_funded < v_terms.cost_kobo THEN 'Funding shortfall of ' || (v_terms.cost_kobo - v_funded) || ' kobo'
                   WHEN v_funded > v_terms.cost_kobo THEN 'Funding exceeds cost by ' || (v_funded - v_terms.cost_kobo) || ' kobo'
                   ELSE 'Fully funded' END);
  v_checks := v_checks || jsonb_build_object('key', 'no_unconfirmed_funding',
    'ok', v_pending = 0, 'detail', v_pending || ' funding record(s) awaiting confirmation');
  v_checks := v_checks || jsonb_build_object('key', 'allocations_reconcile',
    'ok', v_alloc = v_funded AND v_alloc > 0, 'detail', 'Allocations equal confirmed funding');
  v_checks := v_checks || jsonb_build_object('key', 'kyc_complete',
    'ok', NOT EXISTS (SELECT 1 FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
                      WHERE a.cycle_id = p_cycle AND i.kyc_status <> 'verified'),
    'detail', 'Every investor has completed KYC');
  v_checks := v_checks || jsonb_build_object('key', 'bank_confirmed',
    'ok', NOT EXISTS (SELECT 1 FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
                      WHERE a.cycle_id = p_cycle AND i.bank_confirmed_at IS NULL),
    'detail', 'Every investor''s bank details are confirmed');
  v_checks := v_checks || jsonb_build_object('key', 'investors_active',
    'ok', NOT EXISTS (SELECT 1 FROM maalrise_allocations a JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
                      WHERE a.cycle_id = p_cycle AND i.status = 'suspended'),
    'detail', 'No allocated investor is suspended');
  v_checks := v_checks || jsonb_build_object('key', 'contract_uploaded',
    'ok', EXISTS (SELECT 1 FROM maalrise_documents WHERE cycle_id = p_cycle AND category = 'contract'),
    'detail', 'Original contract uploaded');
  v_checks := v_checks || jsonb_build_object('key', 'maturity_consistent',
    'ok', v_cycle.stated_maturity_date IS NULL
          OR v_cycle.stated_maturity_date = (v_cycle.start_date + make_interval(months => v_cycle.duration_months))::DATE,
    'detail', 'Contract maturity date agrees with start + duration');

  RETURN jsonb_build_object('cycle_id', p_cycle,
    'all_ok', NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_checks) c WHERE NOT (c->>'ok')::BOOLEAN),
    'checks', v_checks);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_activate_cycle(p_cycle UUID)
RETURNS JSONB AS $$
DECLARE
  v_cycle  maalrise_cycles%ROWTYPE;
  v_result JSONB;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status <> 'terms_approved' THEN
    RAISE EXCEPTION 'Only a Cycle with approved terms can be activated (this one is %)', v_cycle.status;
  END IF;

  v_result := maalrise_activation_checks(p_cycle);
  IF NOT (v_result->>'all_ok')::BOOLEAN THEN
    RAISE EXCEPTION 'Activation refused — checks failed: %',
      (SELECT string_agg(c->>'detail', '; ') FROM jsonb_array_elements(v_result->'checks') c WHERE NOT (c->>'ok')::BOOLEAN);
  END IF;

  UPDATE maalrise_cycles SET status = 'active', activated_by = auth.uid(), activated_at = NOW(), updated_at = NOW()
   WHERE id = p_cycle;
  PERFORM create_audit_log('maalrise_activate_cycle', 'maalrise_cycle', p_cycle::TEXT,
    jsonb_build_object('status', 'terms_approved'), jsonb_build_object('status', 'active', 'checks', v_result->'checks'));
  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/** Metadata only: the file is uploaded to the private bucket by the server first. */
CREATE OR REPLACE FUNCTION maalrise_register_document(p JSONB)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  INSERT INTO maalrise_documents (cycle_id, maalrise_investor_id, category, name, storage_path, mime_type,
                                  size_bytes, visible_to_investors, uploaded_by)
  VALUES (NULLIF(p->>'cycle_id', '')::UUID, NULLIF(p->>'maalrise_investor_id', '')::UUID, p->>'category',
          trim(p->>'name'), p->>'storage_path', p->>'mime_type', (p->>'size_bytes')::BIGINT,
          COALESCE((p->>'visible_to_investors')::BOOLEAN, FALSE), auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_register_document', 'maalrise_document', v_id::TEXT, NULL, p);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 11. Grants. Staff and investors reach these tables only through
--     RLS (reads) and the functions above (writes).
-- ------------------------------------------------------------
REVOKE ALL ON FUNCTION maalrise_terms_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_schedule_guard() FROM PUBLIC;
REVOKE ALL ON FUNCTION maalrise_investor_not_staff() FROM PUBLIC;
