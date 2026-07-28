-- ============================================================
-- 039 — emailing the cycle-end statement
--
-- THE GAP THIS CLOSES. Settling a cycle already renders every
-- holder's report, converts it to PDF and stores it — migration 022
-- and generateStatements do all of that today. Nothing sends it. An
-- investor has to log in and go looking for a document that has been
-- sitting there since the day the cycle settled.
--
-- ── ON THE SAME ROW, NOT A NEW TABLE ─────────────────────────
--
-- mudarabah_statements already carries one row per holder per
-- settlement, with UNIQUE (settlement_id, investment_id, kind). That
-- uniqueness is exactly what stops an investor being emailed twice,
-- so the send state belongs beside the document state rather than in
-- a second table that would have to be kept in step with it.
--
-- ── CLAIMED, NOT JUST MARKED ─────────────────────────────────
--
-- mudarabah_claim_statement_email is a conditional UPDATE: it moves a
-- row to 'sending' only if it is still 'unsent' or 'failed', and
-- returns nothing when somebody else got there first. Two people
-- pressing the button at once, or a retry overlapping a run still in
-- flight, therefore cannot both send. The campaign engine already
-- works this way; this is the same discipline for the same reason.
--
-- The window between claiming and sending is the honest risk: if the
-- process dies mid-send a row is left 'sending' and needs an explicit
-- release rather than being silently retried. Better a stuck row an
-- administrator can see than a second copy of a financial statement.
--
-- ── SENDING IS NOT PART OF SETTLING ──────────────────────────
--
-- Settlement must not acquire new ways to fail, and thirty-eight
-- emails firing the instant Settle is pressed removes any chance to
-- read the covering note first. This gives the state and the claim;
-- pressing the button is a separate, deliberate act.
--
-- Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Where a statement's email has got to.
-- ------------------------------------------------------------
ALTER TABLE mudarabah_statements
  ADD COLUMN IF NOT EXISTS email_state      TEXT NOT NULL DEFAULT 'unsent',
  ADD COLUMN IF NOT EXISTS email_to         TEXT,
  ADD COLUMN IF NOT EXISTS email_error      TEXT,
  ADD COLUMN IF NOT EXISTS email_message_id TEXT,
  ADD COLUMN IF NOT EXISTS email_attempts   INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS emailed_at       TIMESTAMPTZ;

DO $$ BEGIN
  ALTER TABLE mudarabah_statements
    ADD CONSTRAINT mudarabah_statements_email_state_check
    CHECK (email_state IN ('unsent', 'sending', 'sent', 'failed', 'skipped'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_mud_statements_email_state
  ON mudarabah_statements(cycle_id, email_state);

-- ------------------------------------------------------------
-- 2. Claim one for sending.
--
--    Returns the row ONLY if this call is the one that moved it out
--    of 'unsent'/'failed'. A second caller gets nothing back and
--    sends nothing — which is the whole point.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_claim_statement_email(
  p_id       UUID,
  p_email_to TEXT
)
RETURNS BOOLEAN AS $$
DECLARE
  v_claimed UUID;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  UPDATE mudarabah_statements SET
    email_state    = 'sending',
    email_to       = p_email_to,
    email_attempts = email_attempts + 1,
    email_error    = NULL,
    updated_at     = NOW()
  WHERE id = p_id
    AND email_state IN ('unsent', 'failed')
    -- Never email a document that does not exist. A "your statement
    -- is attached" email with nothing attached is worse than silence.
    AND state = 'ready'
    AND storage_path IS NOT NULL
  RETURNING id INTO v_claimed;

  RETURN v_claimed IS NOT NULL;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. Record how it went.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_mark_statement_email(
  p_id         UUID,
  p_state      TEXT,
  p_message_id TEXT DEFAULT NULL,
  p_error      TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_state NOT IN ('unsent', 'sending', 'sent', 'failed', 'skipped') THEN
    RAISE EXCEPTION 'Unknown email state: %', p_state;
  END IF;

  UPDATE mudarabah_statements SET
    email_state      = p_state,
    email_message_id = COALESCE(p_message_id, email_message_id),
    email_error      = p_error,
    emailed_at       = CASE WHEN p_state = 'sent' THEN NOW() ELSE emailed_at END,
    updated_at       = NOW()
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Release a row stuck in 'sending'.
--
--    Only when it has genuinely been abandoned — a process that died
--    mid-send. The age check is what stops this being a way to
--    double-send a statement somebody is still in the middle of.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_release_stuck_statement_emails(
  p_cycle_id     UUID,
  p_older_than   INTERVAL DEFAULT INTERVAL '15 minutes'
)
RETURNS INTEGER AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF NOT is_admin() THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;

  WITH released AS (
    UPDATE mudarabah_statements SET
      email_state = 'failed',
      email_error = 'Sending was interrupted — no confirmation was received. Check with the investor before retrying.',
      updated_at  = NOW()
    WHERE cycle_id = p_cycle_id
      AND email_state = 'sending'
      AND updated_at < NOW() - p_older_than
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_n FROM released;

  RETURN v_n;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. What the admin screen shows.
--
--    Replaces the 022 version, adding the email columns and the
--    address — an investor with no email on record is the one case
--    that can never be fixed by retrying, and it has to be visible
--    as its own thing rather than as a failure.
--    Dropped first: CREATE OR REPLACE cannot widen the column list
--    of a RETURNS TABLE function, and the whole point here is the
--    extra columns.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS mudarabah_statement_status(UUID);

CREATE OR REPLACE FUNCTION mudarabah_statement_status(p_cycle_id UUID)
RETURNS TABLE (
  statement_id  UUID,
  investor_name TEXT,
  investor_code TEXT,
  investor_email TEXT,
  investment_id UUID,
  state         TEXT,
  attempts      INTEGER,
  last_error    TEXT,
  generated_at  TIMESTAMPTZ,
  email_state   TEXT,
  email_to      TEXT,
  email_error   TEXT,
  email_attempts INTEGER,
  emailed_at    TIMESTAMPTZ
) AS $$
  SELECT s.id, i.full_name, i.investor_code, i.email, s.investment_id,
         s.state, s.attempts, s.last_error, s.generated_at,
         s.email_state, s.email_to, s.email_error, s.email_attempts, s.emailed_at
  FROM mudarabah_statements s
  JOIN investors i ON i.id = s.investor_id
  JOIN mudarabah_settlements st ON st.id = s.settlement_id
  WHERE s.cycle_id = p_cycle_id AND st.is_current
  -- Anything needing attention first: a document that failed to
  -- build, then an email that failed to send, then the rest.
  ORDER BY (s.state <> 'ready') DESC,
           (s.email_state IN ('failed', 'skipped')) DESC,
           i.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 6. What is left to send, ready to be walked.
--
--    Returns only rows whose DOCUMENT exists. Anything else is a
--    generation problem, not a sending one, and is reported as such.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_statements_to_email(
  p_cycle_id UUID,
  p_retry    BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (
  statement_id   UUID,
  investment_id  UUID,
  investor_id    UUID,
  investor_name  TEXT,
  investor_code  TEXT,
  investor_email TEXT,
  storage_path   TEXT
) AS $$
  SELECT s.id, s.investment_id, s.investor_id,
         i.full_name, i.investor_code, i.email, s.storage_path
  FROM mudarabah_statements s
  JOIN investors i ON i.id = s.investor_id
  JOIN mudarabah_settlements st ON st.id = s.settlement_id
  WHERE s.cycle_id = p_cycle_id
    AND st.is_current
    AND s.kind = 'statement'
    AND s.state = 'ready'
    AND s.storage_path IS NOT NULL
    AND (
      s.email_state = 'unsent'
      OR (p_retry AND s.email_state IN ('failed', 'skipped'))
    )
  ORDER BY i.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 7. The one-line summary above the list.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_statement_email_counts(p_cycle_id UUID)
RETURNS JSONB AS $$
  SELECT jsonb_build_object(
    'documents',      COUNT(*),
    'ready',          COUNT(*) FILTER (WHERE s.state = 'ready'),
    'notBuilt',       COUNT(*) FILTER (WHERE s.state <> 'ready'),
    'unsent',         COUNT(*) FILTER (WHERE s.state = 'ready' AND s.email_state = 'unsent'),
    'sending',        COUNT(*) FILTER (WHERE s.email_state = 'sending'),
    'sent',           COUNT(*) FILTER (WHERE s.email_state = 'sent'),
    'failed',         COUNT(*) FILTER (WHERE s.email_state = 'failed'),
    'skipped',        COUNT(*) FILTER (WHERE s.email_state = 'skipped'),
    'noEmailAddress', COUNT(*) FILTER (WHERE COALESCE(i.email, '') = '')
  )
  FROM mudarabah_statements s
  JOIN investors i ON i.id = s.investor_id
  JOIN mudarabah_settlements st ON st.id = s.settlement_id
  WHERE s.cycle_id = p_cycle_id AND st.is_current AND s.kind = 'statement';
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION mudarabah_claim_statement_email(UUID, TEXT) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION mudarabah_mark_statement_email(UUID, TEXT, TEXT, TEXT) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION mudarabah_release_stuck_statement_emails(UUID, INTERVAL) FROM anon, authenticated;
    REVOKE EXECUTE ON FUNCTION mudarabah_statements_to_email(UUID, BOOLEAN) FROM anon, authenticated;
    GRANT EXECUTE ON FUNCTION mudarabah_statement_email_counts(UUID) TO authenticated;
  END IF;
END $$;
