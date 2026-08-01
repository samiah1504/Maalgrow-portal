-- ============================================================
-- 044 — the investors nobody is chasing
--
-- THE GAP. Every screen in this portal starts from a payment_requests
-- row. An investor who has one is visible: pending, approved, paid.
-- An investor who has NONE is invisible, and that is precisely the
-- person at risk — their profit is settled and sitting there, and
-- nothing on any screen says so.
--
-- ── WHY THEY HAVE NO REQUEST ─────────────────────────────────
--
-- Not because they failed to press a button. There is no button:
-- investors never raise their own requests, and the investor-facing
-- payment-requests page is read-only. Requests are raised by
-- sync_maturity_payment_requests the moment a maturity INSTRUCTION is
-- submitted (035, wired into submit_rollover_decision by 036).
--
-- So "no payment request" always has one of three causes, and they
-- need three different responses:
--
--   no_instruction    they have not answered. Chase the answer — the
--                     request follows on its own. This is the common
--                     one and it is time-limited: after the window
--                     closes they cannot answer at all.
--
--   no_bank_details   they DID answer, and sync_maturity_payment_
--                     requests returned {"skipped": "no bank details
--                     on record"} and raised nothing. SILENTLY — no
--                     screen has ever shown this. These people look
--                     answered and are owed money nobody is tracking.
--                     This is the dangerous one.
--
--   nothing_payable   a legacy rollover_all, which pays out nothing
--                     by design. Listed so it is not mistaken for a
--                     fault, and excluded from the counts.
--
-- Reporting one number for all three would be useless: two of them
-- need a phone call and the third needs a form filled in.
--
-- ── WHAT THIS DOES NOT DO ────────────────────────────────────
--
-- It does not create payment requests. Recording the INSTRUCTION is
-- what creates one, through the function that already does it, with
-- the same figures the settlement froze. A second way to mint a
-- payment request would be a second set of numbers that could
-- disagree with the first.
--
-- Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. What we said, to whom, and when.
--
--    Only email is implemented. The constraint says so rather than
--    accepting a value nothing can send — widening it later is a
--    one-line ALTER, and until then a 'whatsapp' row would be a
--    record of something that never happened.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payment_request_reminders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investment_id UUID NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
  investor_id   UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  channel       TEXT NOT NULL DEFAULT 'email' CHECK (channel IN ('email')),
  to_address    TEXT,
  state         TEXT NOT NULL CHECK (state IN ('sent', 'failed')),
  message_id    TEXT,
  error         TEXT,
  sent_by       UUID REFERENCES profiles(id),
  sent_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_reminders_investment
  ON payment_request_reminders(investment_id, sent_at DESC);

ALTER TABLE payment_request_reminders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Staff read payment reminders"
    ON payment_request_reminders FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- No investor policy at all. This is a record of us chasing them; it
-- is not theirs to read.

-- ------------------------------------------------------------
-- 2. Who is waiting, and why.
--
--    Eligible means: the cycle has SETTLED, so the money is real and
--    frozen, and there is no payment request of any kind for that
--    holding. A rejected request is excluded from "none" on purpose —
--    somebody looked at that one and said no, which is an answer.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION investors_awaiting_payment_request(
  p_cycle_id UUID DEFAULT NULL
)
RETURNS TABLE (
  investment_id    UUID,
  investment_code  TEXT,
  investor_id      UUID,
  investor_code    TEXT,
  full_name        TEXT,
  email            TEXT,
  phone            TEXT,
  cycle_id         UUID,
  cycle_label      TEXT,
  series_name      TEXT,
  units            NUMERIC,
  capital          NUMERIC,
  profit_available NUMERIC,
  capital_available NUMERIC,
  decision         TEXT,
  reason           TEXT,
  available_since  TIMESTAMPTZ,
  days_waiting     INTEGER,
  deadline         DATE,
  has_bank_details BOOLEAN,
  manager_name     TEXT,
  last_login_at    TIMESTAMPTZ,
  last_reminder_at TIMESTAMPTZ,
  reminders_sent   INTEGER
) AS $$
  SELECT
    i.id, i.investment_code,
    inv.id, inv.investor_code, inv.full_name, inv.email, inv.phone,
    c.id, c.cycle_label, s.name::TEXT,
    i.units, i.capital,
    COALESCE(i.declared_profit_net, i.declared_profit, 0),
    -- Only what an EXIT actually releases. A continuing investor's
    -- capital is not "available" — it is already in the next cycle.
    CASE
      WHEN rd.decision::TEXT = 'exit' THEN i.capital
      WHEN rd.decision::TEXT = 'partial_exit'
        THEN ROUND(COALESCE(rd.slots_to_withdraw, 0)
                   * COALESCE(c.unit_value, s.price_per_unit), 2)
      ELSE 0
    END,
    rd.decision::TEXT,
    CASE
      WHEN rd.investment_id IS NULL THEN 'no_instruction'
      WHEN rd.decision::TEXT = 'rollover_all' THEN 'nothing_payable'
      WHEN COALESCE(btrim(inv.bank_name), '') = ''
        OR COALESCE(btrim(inv.account_name), '') = ''
        OR COALESCE(btrim(inv.account_number), '') = '' THEN 'no_bank_details'
      ELSE 'not_raised'
    END,
    COALESCE(st.settled_at, c.end_date::TIMESTAMPTZ),
    GREATEST(0, (CURRENT_DATE - COALESCE(st.settled_at::DATE, c.end_date))),
    rollover_decision_deadline(c.id),
    (COALESCE(btrim(inv.bank_name), '') <> ''
     AND COALESCE(btrim(inv.account_name), '') <> ''
     AND COALESCE(btrim(inv.account_number), '') <> ''),
    mgr.full_name,
    au.last_sign_in_at,
    r.last_sent,
    COALESCE(r.n, 0)::INTEGER
  FROM investments i
  JOIN investors inv ON inv.id = i.investor_id
  JOIN cycles c      ON c.id = i.cycle_id
  JOIN series s      ON s.id = i.series_id
  JOIN mudarabah_settlements st ON st.cycle_id = c.id AND st.is_current
  LEFT JOIN rollover_decisions rd
         ON rd.investment_id = i.id AND rd.source_cycle_id = c.id
  LEFT JOIN profiles mgr ON mgr.id = inv.assigned_manager_id
  LEFT JOIN auth.users au ON au.id = inv.profile_id
  LEFT JOIN LATERAL (
    SELECT MAX(sent_at) AS last_sent, COUNT(*) AS n
    FROM payment_request_reminders pr
    WHERE pr.investment_id = i.id AND pr.state = 'sent'
  ) r ON TRUE
  WHERE is_admin()
    AND (p_cycle_id IS NULL OR c.id = p_cycle_id)
    -- There is money on this holding.
    AND COALESCE(i.declared_profit_net, i.declared_profit, 0) > 0
    -- And nothing has been raised for it.
    AND NOT EXISTS (
      SELECT 1 FROM payment_requests pq
      WHERE pq.investment_id = i.id AND pq.status::TEXT <> 'rejected'
    )
  -- Longest wait first: the person who has been owed money for six
  -- weeks is the one to ring.
  ORDER BY (CURRENT_DATE - COALESCE(st.settled_at::DATE, c.end_date)) DESC,
           inv.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. The card at the top of the screen.
--
--    'nothing_payable' is counted separately and kept OUT of the
--    outstanding figures — a legacy rollover_all is not somebody
--    waiting for money.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_request_gap_counts(p_cycle_id UUID DEFAULT NULL)
RETURNS JSONB AS $$
  SELECT CASE WHEN is_admin() THEN
    jsonb_build_object(
      'awaiting',       COUNT(*) FILTER (WHERE reason <> 'nothing_payable'),
      'noInstruction',  COUNT(*) FILTER (WHERE reason = 'no_instruction'),
      'noBankDetails',  COUNT(*) FILTER (WHERE reason = 'no_bank_details'),
      'notRaised',      COUNT(*) FILTER (WHERE reason = 'not_raised'),
      'nothingPayable', COUNT(*) FILTER (WHERE reason = 'nothing_payable'),
      'over7',          COUNT(*) FILTER (WHERE reason <> 'nothing_payable' AND days_waiting > 7),
      'over30',         COUNT(*) FILTER (WHERE reason <> 'nothing_payable' AND days_waiting > 30),
      'amount',         COALESCE(SUM(profit_available + capital_available)
                                 FILTER (WHERE reason <> 'nothing_payable'), 0),
      -- How many can still answer for themselves. Once this is zero
      -- the only way through is recording it for them.
      'windowOpen',     COUNT(*) FILTER (WHERE reason = 'no_instruction'
                                           AND deadline >= CURRENT_DATE)
    )
  ELSE '{}'::JSONB END
  FROM investors_awaiting_payment_request(p_cycle_id);
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Record that we chased somebody.
--
--    Written whether the send worked or not. A reminder that failed
--    is the thing you most need to know about, and a table that only
--    holds successes reads as though nobody was ever missed.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION record_payment_reminder(
  p_investment_id UUID,
  p_to_address    TEXT,
  p_state         TEXT,
  p_message_id    TEXT DEFAULT NULL,
  p_error         TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_investor UUID;
  v_id       UUID;
BEGIN
  IF NOT (is_admin() OR COALESCE(auth.role(), '') = 'service_role') THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  IF p_state NOT IN ('sent', 'failed') THEN
    RAISE EXCEPTION 'Unknown reminder state: %', p_state;
  END IF;

  SELECT investor_id INTO v_investor FROM investments WHERE id = p_investment_id;
  IF v_investor IS NULL THEN
    RAISE EXCEPTION 'No such investment';
  END IF;

  INSERT INTO payment_request_reminders (
    investment_id, investor_id, channel, to_address, state,
    message_id, error, sent_by
  ) VALUES (
    p_investment_id, v_investor, 'email', p_to_address, p_state,
    p_message_id, LEFT(COALESCE(p_error, ''), 500), auth.uid()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. Every time we chased one investor, for their record.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION payment_reminder_history(p_investment_id UUID)
RETURNS TABLE (
  sent_at     TIMESTAMPTZ,
  channel     TEXT,
  to_address  TEXT,
  state       TEXT,
  error       TEXT,
  sent_by_name TEXT
) AS $$
  SELECT r.sent_at, r.channel, r.to_address, r.state, r.error, p.full_name
  FROM payment_request_reminders r
  LEFT JOIN profiles p ON p.id = r.sent_by
  WHERE r.investment_id = p_investment_id AND is_admin()
  ORDER BY r.sent_at DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION investors_awaiting_payment_request(UUID) TO authenticated;
    GRANT EXECUTE ON FUNCTION payment_request_gap_counts(UUID)         TO authenticated;
    GRANT EXECUTE ON FUNCTION payment_reminder_history(UUID)           TO authenticated;
    -- Written only by the server after a send has been attempted.
    REVOKE EXECUTE ON FUNCTION record_payment_reminder(UUID, TEXT, TEXT, TEXT, TEXT)
      FROM anon, authenticated;
  END IF;
END $$;
