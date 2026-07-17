-- ============================================================
-- Migration 006 – Cycle Management
-- Adds admin-editable cycle fields, new statuses, and audit log
-- ============================================================

-- ============================================================
-- 1. New cycle_status enum values
-- ============================================================

ALTER TYPE cycle_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE cycle_status ADD VALUE IF NOT EXISTS 'subscription_open';
ALTER TYPE cycle_status ADD VALUE IF NOT EXISTS 'subscription_closed';
ALTER TYPE cycle_status ADD VALUE IF NOT EXISTS 'maturity_window';
ALTER TYPE cycle_status ADD VALUE IF NOT EXISTS 'cancelled';

-- ============================================================
-- 2. New columns on cycles
-- ============================================================

ALTER TABLE cycles
  ADD COLUMN IF NOT EXISTS subscription_open_date  DATE NULL,
  ADD COLUMN IF NOT EXISTS subscription_close_date DATE NULL,
  ADD COLUMN IF NOT EXISTS unit_value              NUMERIC(20,2) NULL,
  ADD COLUMN IF NOT EXISTS notes                   TEXT NULL;

-- Backfill unit_value from series.price_per_unit for existing rows
UPDATE cycles c
SET unit_value = s.price_per_unit
FROM series s
WHERE c.series_id = s.id
  AND c.unit_value IS NULL;

-- ============================================================
-- 3. cycle_audit_log table
-- ============================================================

CREATE TABLE IF NOT EXISTS cycle_audit_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id    UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  changed_by  UUID REFERENCES profiles(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action      TEXT NOT NULL,          -- 'create' | 'update'
  changes     JSONB NOT NULL DEFAULT '{}'::JSONB
);

CREATE INDEX IF NOT EXISTS idx_cycle_audit_log_cycle_id
  ON cycle_audit_log(cycle_id);

CREATE INDEX IF NOT EXISTS idx_cycle_audit_log_changed_at
  ON cycle_audit_log(changed_at DESC);

-- RLS
ALTER TABLE cycle_audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins read cycle audit log"
  ON cycle_audit_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role IN (
          'super_admin', 'administrator', 'finance',
          'operations', 'customer_support'
        )
    )
  );

CREATE POLICY "Service role manages cycle audit log"
  ON cycle_audit_log FOR ALL
  USING (auth.role() = 'service_role');
