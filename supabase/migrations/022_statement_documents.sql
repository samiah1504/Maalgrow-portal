-- ============================================================
-- Migration 022 – Statement documents
--
-- The PDF an investor downloads and the PDF attached to their email
-- must be THE SAME FILE, not two renders that ought to agree. Two
-- renders can diverge — a change to the renderer, a font that loads
-- differently — and then what someone received by email contradicts
-- what their portal shows. So a statement is generated once, stored,
-- and served from storage thereafter.
--
-- Generation is NOT part of the settlement transaction. Settlement is
-- the money event and must not fail because a browser timed out. The
-- cycle settles and commits; the documents are queued and generated
-- afterwards, with retries. If generation fails the settlement still
-- stands, an administrator sees the failure, and the investor is told
-- their statement is being prepared.
--
-- Keyed on the SETTLEMENT, not the cycle: re-settling produces a new
-- snapshot and therefore new documents, while the superseded ones stay
-- attached to the snapshot they were rendered from. Regenerating
-- rebuilds the file for an existing row and never touches the figures.
--
-- Apply AFTER migration 021.
-- ============================================================

-- ------------------------------------------------------------
-- 1. One row per document
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_statements (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id      UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  settlement_id UUID NOT NULL REFERENCES mudarabah_settlements(id) ON DELETE CASCADE,
  investment_id UUID NOT NULL REFERENCES investments(id),
  investor_id   UUID NOT NULL REFERENCES investors(id),

  -- 'statement' now; 'credit_note' when part B issues them. The same
  -- generate-once-and-store rule governs both.
  kind          TEXT NOT NULL DEFAULT 'statement'
                CHECK (kind IN ('statement', 'credit_note')),

  -- Path within the private bucket. Never a URL: what is handed out is
  -- a short-lived signed URL, minted server-side after the same
  -- authorisation check as the on-screen view.
  storage_path  TEXT,

  state         TEXT NOT NULL DEFAULT 'pending'
                CHECK (state IN ('pending', 'ready', 'failed')),
  attempts      INTEGER NOT NULL DEFAULT 0,
  last_error    TEXT,
  bytes         INTEGER,

  generated_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE (settlement_id, investment_id, kind)
);

CREATE INDEX IF NOT EXISTS idx_mud_statements_cycle
  ON mudarabah_statements(cycle_id);
CREATE INDEX IF NOT EXISTS idx_mud_statements_investor
  ON mudarabah_statements(investor_id);
-- The queue an administrator and any retry job read
CREATE INDEX IF NOT EXISTS idx_mud_statements_outstanding
  ON mudarabah_statements(state) WHERE state <> 'ready';

ALTER TABLE mudarabah_statements ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Staff read statements"
    ON mudarabah_statements FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An investor sees only their own, and only for a settlement that is
-- still the current one. A document belonging to a superseded snapshot
-- describes a cycle as it was before it was reopened.
DO $$ BEGIN
  CREATE POLICY "Investors read their own statements"
    ON mudarabah_statements FOR SELECT
    USING (
      investor_id = get_my_investor_id()
      AND settlement_id IN (SELECT id FROM mudarabah_settlements WHERE is_current)
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Nothing writes here except the functions below, which are
-- SECURITY DEFINER and check the caller themselves.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON mudarabah_statements FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON mudarabah_statements FROM authenticated';
  END IF;
END $$;

-- ------------------------------------------------------------
-- 2. The private bucket
--
--    Guarded, because the local test harness stubs Supabase and has
--    no storage schema. On a real project this creates the bucket
--    once; `public = false` is the whole point.
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('mudarabah-statements', 'mudarabah-statements', FALSE)
    ON CONFLICT (id) DO UPDATE SET public = FALSE;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 3. Queue the documents for a settlement
--
--    Called AFTER the settlement transaction has committed. Every
--    holder gets a row in 'pending'; the renderer picks them up.
--    Idempotent: queueing twice leaves one row per holder, and never
--    resets one that is already ready.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_queue_statements(p_settlement_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_cycle UUID;
  v_n     INTEGER;
BEGIN
  PERFORM mudarabah_assert_admin();

  SELECT cycle_id INTO v_cycle FROM mudarabah_settlements WHERE id = p_settlement_id;
  IF v_cycle IS NULL THEN
    RAISE EXCEPTION 'No such settlement';
  END IF;

  INSERT INTO mudarabah_statements (
    cycle_id, settlement_id, investment_id, investor_id, kind, state
  )
  SELECT v_cycle, p_settlement_id, h.investment_id, h.investor_id, 'statement', 'pending'
  FROM mudarabah_settlement_holders h
  WHERE h.settlement_id = p_settlement_id
  ON CONFLICT (settlement_id, investment_id, kind) DO NOTHING;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Record the outcome of a generation attempt
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_mark_statement(
  p_id     UUID,
  p_state  TEXT,
  p_path   TEXT DEFAULT NULL,
  p_bytes  INTEGER DEFAULT NULL,
  p_error  TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  PERFORM mudarabah_assert_admin();

  IF p_state NOT IN ('pending', 'ready', 'failed') THEN
    RAISE EXCEPTION 'Unknown statement state: %', p_state;
  END IF;

  UPDATE mudarabah_statements SET
    state        = p_state,
    storage_path = COALESCE(p_path, storage_path),
    bytes        = COALESCE(p_bytes, bytes),
    -- A success clears the previous error; a failure records the new one
    last_error   = CASE WHEN p_state = 'ready' THEN NULL ELSE p_error END,
    attempts     = attempts + 1,
    generated_at = CASE WHEN p_state = 'ready' THEN NOW() ELSE generated_at END,
    updated_at   = NOW()
  WHERE id = p_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such statement';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. Mark a cycle's documents for rebuilding
--
--    For when a rendering fault is found after the fact. The figures
--    are frozen and are NOT touched — only the document is rebuilt,
--    from the same snapshot it was always rendered from.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_requeue_statements(p_cycle_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_settlement UUID;
  v_n          INTEGER;
BEGIN
  PERFORM mudarabah_assert_admin();

  SELECT id INTO v_settlement FROM mudarabah_settlements
  WHERE cycle_id = p_cycle_id AND is_current;
  IF v_settlement IS NULL THEN
    RAISE EXCEPTION 'This cycle has no current settlement, so it has no documents to rebuild';
  END IF;

  -- Catch up any holder who has no row at all
  PERFORM mudarabah_queue_statements(v_settlement);

  UPDATE mudarabah_statements
  SET state = 'pending', last_error = NULL, updated_at = NOW()
  WHERE settlement_id = v_settlement;

  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM create_audit_log(
    'mudarabah_statements_requeued', 'cycle', p_cycle_id::TEXT, NULL,
    jsonb_build_object('settlement_id', v_settlement, 'documents', v_n)
  );

  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 6. What an investor's own statement looks like to them
--
--    Scoped by get_my_investor_id(), so the session decides — not the
--    cycle id in the request. An investor asking about a cycle they
--    do not hold gets no row, exactly as if it did not exist.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_my_statement(p_cycle_id UUID)
RETURNS TABLE (
  statement_id  UUID,
  investment_id UUID,
  state         TEXT,
  storage_path  TEXT,
  generated_at  TIMESTAMPTZ
) AS $$
  SELECT s.id, s.investment_id, s.state, s.storage_path, s.generated_at
  FROM mudarabah_statements s
  JOIN mudarabah_settlements st ON st.id = s.settlement_id
  WHERE s.cycle_id = p_cycle_id
    AND s.kind = 'statement'
    AND st.is_current
    AND s.investor_id = get_my_investor_id()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 7. The administrator's view of what is outstanding
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_statement_status(p_cycle_id UUID)
RETURNS TABLE (
  statement_id  UUID,
  investor_name TEXT,
  investor_code TEXT,
  investment_id UUID,
  state         TEXT,
  attempts      INTEGER,
  last_error    TEXT,
  generated_at  TIMESTAMPTZ
) AS $$
  SELECT s.id, i.full_name, i.investor_code, s.investment_id,
         s.state, s.attempts, s.last_error, s.generated_at
  FROM mudarabah_statements s
  JOIN investors i ON i.id = s.investor_id
  JOIN mudarabah_settlements st ON st.id = s.settlement_id
  WHERE s.cycle_id = p_cycle_id AND st.is_current
  ORDER BY (s.state <> 'ready') DESC, i.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;
