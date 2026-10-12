-- ============================================================
-- MaalRise 052 — PART 1 OF 3
-- Receipts, distributions, payment lines, payment history, notifications, email outbox, guards
--
-- The three parts together are exactly the body of
-- supabase/migrations/052_maalrise_distributions.sql, split so each
-- can be pasted and run on its own in the Supabase SQL Editor.
--
-- Run the parts IN ORDER, 1 to 3, each in its own Run.
-- Each part is its own transaction: if it fails, it leaves nothing
-- behind, and the earlier parts stay as they were. It refuses to run
-- out of order, or twice.
--
-- Success = the final result row reads "Part 1 of 3 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT (to_regclass('public.maalrise_allocations') IS NOT NULL) THEN
    RAISE EXCEPTION 'STOP: run migration 051 first (MaalRise core is missing).';
  END IF;
  IF to_regclass('public.maalrise_receipts') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: part 1 of 3 has already been applied (maalrise_receipts exists). Do not run it again.';
  END IF;
END $$;

-- >>> 052 BODY START (part 1)

-- ------------------------------------------------------------
-- 0. Roles and dates
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_can_pay()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(maalrise_caller_role() IN ('payment_officer', 'super_admin', 'administrator'), FALSE);
$$ LANGUAGE sql SECURITY DEFINER STABLE;

/** "Today" for due dates is the business's day in Lagos, not the server's UTC day. */
CREATE OR REPLACE FUNCTION maalrise_today()
RETURNS DATE AS $$
  SELECT (NOW() AT TIME ZONE 'Africa/Lagos')::DATE;
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 1. Receipts from the counterparty
-- ------------------------------------------------------------
CREATE TABLE maalrise_receipts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id          UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  schedule_line_id  UUID NOT NULL REFERENCES maalrise_schedule_lines(id) ON DELETE RESTRICT,
  period            INTEGER NOT NULL CHECK (period >= 1),
  amount_kobo       BIGINT NOT NULL CHECK (amount_kobo > 0),
  received_on       DATE NOT NULL,
  reference         TEXT,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'recorded' CHECK (status IN ('recorded', 'confirmed', 'rejected')),
  -- Set when confirmed: how the money was used.
  applied_kobo      BIGINT CHECK (applied_kobo >= 0),
  held_kobo         BIGINT CHECK (held_kobo >= 0),
  fee_kobo          BIGINT CHECK (fee_kobo >= 0),
  net_kobo          BIGINT CHECK (net_kobo >= 0),
  distribution_id   UUID,
  recorded_by       UUID NOT NULL REFERENCES profiles(id),
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  confirmed_by      UUID REFERENCES profiles(id),
  confirmed_at      TIMESTAMPTZ,
  rejected_by       UUID REFERENCES profiles(id),
  rejected_at       TIMESTAMPTZ,
  reject_reason     TEXT,
  CHECK (status <> 'confirmed' OR (applied_kobo IS NOT NULL AND held_kobo IS NOT NULL AND fee_kobo IS NOT NULL
                                   AND net_kobo IS NOT NULL AND applied_kobo + held_kobo = amount_kobo
                                   AND fee_kobo + net_kobo = applied_kobo)),
  CHECK (status <> 'rejected' OR length(trim(COALESCE(reject_reason, ''))) > 0)
);
CREATE INDEX maalrise_receipts_cycle_period ON maalrise_receipts (cycle_id, period);
-- A reference, when given, identifies one transfer: it cannot be entered twice.
CREATE UNIQUE INDEX maalrise_receipts_reference_uq
  ON maalrise_receipts (cycle_id, lower(trim(reference)))
  WHERE status <> 'rejected' AND reference IS NOT NULL AND length(trim(reference)) > 0;

-- ------------------------------------------------------------
-- 2. Distributions and investor payment lines
-- ------------------------------------------------------------
CREATE TABLE maalrise_distributions (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cycle_id            UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  terms_id            UUID NOT NULL REFERENCES maalrise_cycle_terms(id) ON DELETE RESTRICT,
  schedule_line_id    UUID NOT NULL REFERENCES maalrise_schedule_lines(id) ON DELETE RESTRICT,
  period              INTEGER NOT NULL CHECK (period >= 1),
  sequence            INTEGER NOT NULL DEFAULT 1 CHECK (sequence >= 1),
  due_date            DATE NOT NULL,
  -- Snapshots, so a payment screen needs no other table.
  cycle_name          TEXT NOT NULL,
  counterparty_name   TEXT NOT NULL,
  -- Money: received and applied to this month, the fee taken from it,
  -- tax (none until configured), what investors share, and the
  -- unsubscribed units' share that stays unallocated.
  applied_kobo        BIGINT NOT NULL DEFAULT 0 CHECK (applied_kobo >= 0),
  fee_kobo            BIGINT NOT NULL DEFAULT 0 CHECK (fee_kobo >= 0),
  tax_kobo            BIGINT NOT NULL DEFAULT 0 CHECK (tax_kobo = 0),
  net_kobo            BIGINT NOT NULL DEFAULT 0 CHECK (net_kobo >= 0),
  allocated_kobo      BIGINT NOT NULL DEFAULT 0 CHECK (allocated_kobo >= 0),
  unallocated_kobo    BIGINT NOT NULL DEFAULT 0 CHECK (unallocated_kobo >= 0),
  status              TEXT NOT NULL DEFAULT 'prepared' CHECK (status IN ('prepared', 'approved')),
  prepared_by         UUID NOT NULL REFERENCES profiles(id),
  prepared_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_by         UUID REFERENCES profiles(id),
  approved_at         TIMESTAMPTZ,
  CHECK (applied_kobo = fee_kobo + tax_kobo + net_kobo),
  CHECK (net_kobo = allocated_kobo + unallocated_kobo),
  CHECK (status <> 'approved' OR (approved_by IS NOT NULL AND approved_at IS NOT NULL)),
  UNIQUE (cycle_id, period, sequence)
);
-- No two open distributions for the same Cycle and month.
CREATE UNIQUE INDEX maalrise_distributions_one_open
  ON maalrise_distributions (cycle_id, period) WHERE status = 'prepared';

ALTER TABLE maalrise_receipts
  ADD CONSTRAINT maalrise_receipts_distribution_fk
  FOREIGN KEY (distribution_id) REFERENCES maalrise_distributions(id);

CREATE TABLE maalrise_distribution_lines (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  distribution_id       UUID NOT NULL REFERENCES maalrise_distributions(id) ON DELETE RESTRICT,
  cycle_id              UUID NOT NULL REFERENCES maalrise_cycles(id) ON DELETE RESTRICT,
  period                INTEGER NOT NULL,
  maalrise_investor_id  UUID NOT NULL REFERENCES maalrise_investors(id) ON DELETE RESTRICT,
  investor_name         TEXT NOT NULL,
  investor_code         TEXT NOT NULL,
  units                 INTEGER NOT NULL CHECK (units > 0),
  amount_kobo           BIGINT NOT NULL CHECK (amount_kobo > 0),
  tax_kobo              BIGINT NOT NULL DEFAULT 0 CHECK (tax_kobo = 0),
  -- The confirmed account this payment is for, as it stood when the
  -- line was (re)built. NULL when the investor had none confirmed —
  -- approval is refused until it is.
  bank_name             TEXT,
  account_name          TEXT,
  account_number        TEXT,
  -- THE payment status. Admin screens, the payment officer and (Phase 6)
  -- the investor portal all read this one column.
  status                TEXT NOT NULL DEFAULT 'pending_approval'
                          CHECK (status IN ('pending_approval', 'payable', 'paid')),
  paid_on               DATE,
  paid_reference        TEXT,
  paid_by               UUID REFERENCES profiles(id),
  paid_at               TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status <> 'paid' OR (paid_on IS NOT NULL AND paid_by IS NOT NULL AND paid_at IS NOT NULL)),
  CHECK (status = 'paid' OR (paid_on IS NULL AND paid_by IS NULL AND paid_at IS NULL)),
  UNIQUE (distribution_id, maalrise_investor_id)
);
CREATE INDEX maalrise_lines_status ON maalrise_distribution_lines (status);
CREATE INDEX maalrise_lines_investor ON maalrise_distribution_lines (maalrise_investor_id);

-- Append-only history of every paid / reversed event.
CREATE TABLE maalrise_payment_events (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_id           UUID NOT NULL REFERENCES maalrise_distribution_lines(id) ON DELETE RESTRICT,
  event             TEXT NOT NULL CHECK (event IN ('marked_paid', 'reversed')),
  amount_kobo       BIGINT NOT NULL,
  paid_on           DATE,
  reference         TEXT,
  bank_name         TEXT,
  account_name      TEXT,
  account_number    TEXT,
  reason            TEXT,
  actor             UUID NOT NULL REFERENCES profiles(id),
  -- Wall-clock time, so events keep their exact order.
  created_at        TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  CHECK (event <> 'reversed' OR length(trim(COALESCE(reason, ''))) > 0)
);

-- ------------------------------------------------------------
-- 3. Notifications (in-app) and the email outbox (drafts only)
-- ------------------------------------------------------------
CREATE TABLE maalrise_notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL,
  title       TEXT NOT NULL,
  message     TEXT NOT NULL,
  link        TEXT,
  dedupe_key  TEXT,
  read_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX maalrise_notifications_dedupe ON maalrise_notifications (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
CREATE INDEX maalrise_notifications_user ON maalrise_notifications (user_id, created_at DESC);

CREATE TABLE maalrise_email_outbox (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL,
  to_user_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  to_email    TEXT NOT NULL,
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  dedupe_key  TEXT,
  -- 'draft' until sending is approved. A failed send stays retryable
  -- and never touches the payment it is about.
  status      TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'queued', 'sent', 'failed')),
  attempts    INTEGER NOT NULL DEFAULT 0,
  last_error  TEXT,
  sent_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX maalrise_outbox_dedupe ON maalrise_email_outbox (to_email, dedupe_key) WHERE dedupe_key IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Guards
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_payment_events_append_only()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Payment history cannot be changed or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_payment_events_append_only
  BEFORE UPDATE OR DELETE ON maalrise_payment_events
  FOR EACH ROW EXECUTE FUNCTION maalrise_payment_events_append_only();

-- Lines are rebuilt only while their distribution is still open.
CREATE OR REPLACE FUNCTION maalrise_lines_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM maalrise_distributions WHERE id = OLD.distribution_id;
  IF TG_OP = 'DELETE' AND v_status <> 'prepared' THEN
    RAISE EXCEPTION 'Lines of an approved distribution cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND v_status = 'approved'
     AND (NEW.amount_kobo <> OLD.amount_kobo OR NEW.units <> OLD.units
          OR NEW.maalrise_investor_id <> OLD.maalrise_investor_id
          OR NEW.account_number IS DISTINCT FROM OLD.account_number) THEN
    RAISE EXCEPTION 'An approved payment line''s amount and account are frozen';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_lines_guard
  BEFORE UPDATE OR DELETE ON maalrise_distribution_lines
  FOR EACH ROW EXECUTE FUNCTION maalrise_lines_guard();

CREATE OR REPLACE FUNCTION maalrise_distribution_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Distributions cannot be deleted'; END IF;
  IF OLD.status = 'approved' AND (NEW.status <> 'approved' OR NEW.net_kobo <> OLD.net_kobo
                                  OR NEW.applied_kobo <> OLD.applied_kobo) THEN
    RAISE EXCEPTION 'An approved distribution is frozen';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_distribution_guard
  BEFORE UPDATE OR DELETE ON maalrise_distributions
  FOR EACH ROW EXECUTE FUNCTION maalrise_distribution_guard();

CREATE OR REPLACE FUNCTION maalrise_receipt_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Receipts cannot be deleted; reject a wrong entry instead'; END IF;
  IF OLD.status <> 'recorded' AND (NEW.status <> OLD.status OR NEW.amount_kobo <> OLD.amount_kobo
                                   OR NEW.applied_kobo IS DISTINCT FROM OLD.applied_kobo) THEN
    RAISE EXCEPTION 'A confirmed or rejected receipt cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER maalrise_receipt_guard
  BEFORE UPDATE OR DELETE ON maalrise_receipts
  FOR EACH ROW EXECUTE FUNCTION maalrise_receipt_guard();

-- <<< 052 BODY END (part 1)

COMMIT;

SELECT 'Part 1 of 3 applied' AS result;
