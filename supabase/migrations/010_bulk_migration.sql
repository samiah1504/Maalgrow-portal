-- ============================================================
-- Migration 010 – Bulk Investor Migration
--
-- Staff import existing investors series-by-series from Google
-- Sheets / Excel / CSV. Uploads are staged in migration_rows,
-- validated and reviewed, then imported row by row. Every row
-- stores its own outcome, which makes imports RESUMABLE: a
-- failed run continues from the first unprocessed row.
-- ============================================================

-- ============================================================
-- 1. migration_batches — one per upload
-- ============================================================

CREATE TABLE IF NOT EXISTS migration_batches (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  series_id      UUID NOT NULL REFERENCES series(id),
  cycle_id       UUID NOT NULL REFERENCES cycles(id),
  source         TEXT NOT NULL,               -- 'google_sheets' | 'xlsx' | 'csv'
  source_name    TEXT,                        -- file name or sheet URL
  status         TEXT NOT NULL DEFAULT 'reviewing',
                 -- 'reviewing' | 'importing' | 'completed' | 'cancelled'
  email_mode     TEXT NOT NULL DEFAULT 'none',-- 'now' | 'queue' | 'none'
  total_rows     INTEGER NOT NULL DEFAULT 0,
  imported_count INTEGER NOT NULL DEFAULT 0,
  failed_count   INTEGER NOT NULL DEFAULT 0,
  skipped_count  INTEGER NOT NULL DEFAULT 0,
  uploaded_by    UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_migration_batches_created
  ON migration_batches(created_at DESC);

-- ============================================================
-- 2. migration_rows — one per spreadsheet line
--    status lifecycle:
--      valid      → ready to import
--      invalid    → blocked until edited (issue explains why)
--      duplicate  → matches an existing investor (email/phone);
--                   admin resolves via action = 'attach' or 'skip'
--      skipped    → excluded by the admin
--      imported   → done (investor_id / investment_id filled)
--      failed     → import error (error filled) — retryable
-- ============================================================

CREATE TABLE IF NOT EXISTS migration_rows (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  batch_id             UUID NOT NULL REFERENCES migration_batches(id) ON DELETE CASCADE,
  row_number           INTEGER NOT NULL,
  full_name            TEXT NOT NULL DEFAULT '',
  phone                TEXT,
  email                TEXT,
  address              TEXT,
  slots                NUMERIC(12,2),
  amount_paid          NUMERIC(20,2) NOT NULL DEFAULT 0,
  payment_date         DATE,
  payment_reference    TEXT,
  notes                TEXT,
  status               TEXT NOT NULL DEFAULT 'valid',
  issue                TEXT,
  action               TEXT,                  -- NULL | 'attach' (add investment to existing investor)
  existing_investor_id UUID REFERENCES investors(id),
  investor_id          UUID REFERENCES investors(id),
  investment_id        UUID REFERENCES investments(id),
  error                TEXT,
  processed_at         TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (batch_id, row_number)
);

CREATE INDEX IF NOT EXISTS idx_migration_rows_batch
  ON migration_rows(batch_id, row_number);
CREATE INDEX IF NOT EXISTS idx_migration_rows_status
  ON migration_rows(batch_id, status);

-- ============================================================
-- 3. Row Level Security — Super Admin only
--    (all writes go through server routes using the service
--    role, but RLS stays enabled and super admins can read)
-- ============================================================

ALTER TABLE migration_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_rows    ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Super admins manage migration batches"
  ON migration_batches FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );

CREATE POLICY "Super admins manage migration rows"
  ON migration_rows FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
        AND profiles.role = 'super_admin'
    )
  );
