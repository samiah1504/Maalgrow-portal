-- ============================================================
-- Migration 023 – Withholding tax: remittances, and issuance that
--                 can only follow a real filing
--
-- A credit note certifies that tax WAS REMITTED on someone's behalf.
-- At settlement the tax has only been withheld — nothing has been
-- filed and nothing has been paid to the authority. So a note can
-- never be issued automatically, and never from a reference typed
-- into a box: it is issued against a REMITTANCE RECORD, created when
-- the filing actually happened.
--
-- Filings are monthly; cycles run three months and are staggered
-- across series. A single filing will nearly always cover more than
-- one cycle, so a remittance is many-to-many with cycles. Forcing one
-- per cycle would mean inventing remittance records that match no
-- real receipt — and the receipt reference is the one thing on a
-- credit note a tax office can verify.
--
--   withheld  → settled and deducted; nothing filed
--   remitted  → a filing covering this cycle is on record
--   certified → a note has been issued, with its own reference
--
-- Apply AFTER migration 022.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The filing itself
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS wht_remittances (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  -- The receipt or reference from the tax authority. This is what
  -- appears on every note the remittance covers, so it must be the
  -- real one.
  reference    TEXT NOT NULL UNIQUE,
  remitted_on  DATE NOT NULL,
  -- Total remitted, in kobo, as everywhere else in this feature
  amount       BIGINT NOT NULL,
  authority    TEXT,
  notes        TEXT,
  recorded_by  UUID REFERENCES profiles(id),
  recorded_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One filing, several cycles
CREATE TABLE IF NOT EXISTS wht_remittance_cycles (
  remittance_id UUID NOT NULL REFERENCES wht_remittances(id) ON DELETE CASCADE,
  cycle_id      UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  PRIMARY KEY (remittance_id, cycle_id)
);

CREATE INDEX IF NOT EXISTS idx_wht_remittance_cycles_cycle
  ON wht_remittance_cycles(cycle_id);

ALTER TABLE wht_remittances       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wht_remittance_cycles ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Staff read remittances"
    ON wht_remittances FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Staff read remittance cycles"
    ON wht_remittance_cycles FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- A remittance is the company's own tax filing. Investors have no
-- business reading it; what concerns them is their own note.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON wht_remittances, wht_remittance_cycles FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON wht_remittances, wht_remittance_cycles FROM authenticated';
  END IF;
END $$;

-- Which remittance a note was issued against
ALTER TABLE wht_credit_notes
  ADD COLUMN IF NOT EXISTS remittance_id UUID REFERENCES wht_remittances(id);

-- ------------------------------------------------------------
-- 2. Record a filing
--
--    Recording it ISSUES NOTHING. It only makes issuance possible,
--    and moves the cycles it covers from withheld to remitted so an
--    investor can be told the tax has been filed while their note is
--    still being prepared.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_create_remittance(
  p_reference   TEXT,
  p_remitted_on DATE,
  p_amount      BIGINT,
  p_cycle_ids   UUID[],
  p_authority   TEXT DEFAULT NULL,
  p_notes       TEXT DEFAULT NULL
)
RETURNS UUID AS $$
DECLARE
  v_id    UUID;
  v_cycle UUID;
BEGIN
  PERFORM mudarabah_assert_admin();

  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'The reference from the tax authority is required — it appears on every credit note this filing covers';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'The amount remitted is required';
  END IF;
  IF p_cycle_ids IS NULL OR array_length(p_cycle_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'A remittance must cover at least one cycle';
  END IF;

  INSERT INTO wht_remittances (reference, remitted_on, amount, authority, notes, recorded_by)
  VALUES (btrim(p_reference), p_remitted_on, p_amount,
          NULLIF(btrim(COALESCE(p_authority, '')), ''),
          NULLIF(btrim(COALESCE(p_notes, '')), ''), auth.uid())
  RETURNING id INTO v_id;

  FOREACH v_cycle IN ARRAY p_cycle_ids LOOP
    IF NOT EXISTS (SELECT 1 FROM mudarabah_settlements
                   WHERE cycle_id = v_cycle AND is_current) THEN
      RAISE EXCEPTION 'A cycle must be settled before its tax can be remitted';
    END IF;

    INSERT INTO wht_remittance_cycles (remittance_id, cycle_id)
    VALUES (v_id, v_cycle)
    ON CONFLICT DO NOTHING;

    -- Filed, but not yet certified. Only issuing a note does that.
    UPDATE mudarabah_settlement_holders h
    SET wht_state = 'remitted'
    FROM mudarabah_settlements s
    WHERE s.id = h.settlement_id
      AND s.cycle_id = v_cycle
      AND s.is_current
      AND h.wht > 0
      AND h.wht_state = 'withheld';
  END LOOP;

  PERFORM create_audit_log(
    'wht_remittance_recorded', 'wht_remittance', v_id::TEXT, NULL,
    jsonb_build_object('reference', p_reference, 'amount', p_amount,
                       'cycles', array_length(p_cycle_ids, 1))
  );

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. What issuing would do, before it is done
--
--    Every investor the remittance covers, with the figures that
--    would appear on their note, and whether they can be issued one
--    at all. Changes nothing.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_issuance_preview(p_remittance_id UUID)
RETURNS TABLE (
  cycle_id       UUID,
  cycle_label    TEXT,
  series_name    TEXT,
  investor_id    UUID,
  investment_id  UUID,
  investor_name  TEXT,
  investor_code  TEXT,
  investor_tin   TEXT,
  gross_profit   BIGINT,
  wht_amount     BIGINT,
  net_paid       BIGINT,
  has_tin        BOOLEAN,
  already_issued BOOLEAN,
  reference      TEXT
) AS $$
  SELECT
    c.id, c.cycle_label, s.name,
    i.id, h.investment_id, i.full_name, i.investor_code, i.tin,
    h.gross_profit, h.wht, h.net_profit,
    (i.tin IS NOT NULL AND btrim(i.tin) <> ''),
    (n.id IS NOT NULL),
    n.reference
  FROM wht_remittance_cycles rc
  JOIN cycles c  ON c.id = rc.cycle_id
  JOIN series s  ON s.id = c.series_id
  JOIN mudarabah_settlements st ON st.cycle_id = c.id AND st.is_current
  JOIN mudarabah_settlement_holders h ON h.settlement_id = st.id
  JOIN investors i ON i.id = h.investor_id
  LEFT JOIN wht_credit_notes n
    ON n.cycle_id = c.id AND n.investment_id = h.investment_id
  WHERE rc.remittance_id = p_remittance_id
    AND h.wht > 0
  ORDER BY c.start_date, i.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Issue the notes
--
--    ONLY against a remittance. Without one there is nothing true to
--    certify, so there is no way to call this that skips the filing.
--
--    p_investment_id issues for ONE investor — somebody always needs
--    theirs before the rest are ready. Issuing the batch afterwards
--    leaves that note exactly as it was: same reference, same figures,
--    not renumbered.
--
--    An investor with no tax identification number is SKIPPED. A tax
--    document carrying no identifier is worse than no document.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS mudarabah_issue_credit_notes(UUID, TEXT, DATE);

CREATE OR REPLACE FUNCTION mudarabah_issue_credit_notes(
  p_remittance_id UUID,
  p_cycle_id      UUID DEFAULT NULL,
  p_investment_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_rem      wht_remittances%ROWTYPE;
  v_row      RECORD;
  v_issued   INTEGER := 0;
  v_no_tin   INTEGER := 0;
  v_existing INTEGER := 0;
BEGIN
  PERFORM mudarabah_assert_admin();

  SELECT * INTO v_rem FROM wht_remittances WHERE id = p_remittance_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit notes are issued against a recorded remittance. Record the filing first.';
  END IF;

  FOR v_row IN
    SELECT c.id AS cycle_id, c.start_date, c.end_date,
           st.id AS settlement_id, st.wht_rate_used, st.settled_at,
           h.investment_id, h.investor_id, h.gross_profit, h.wht, h.net_profit,
           i.full_name, i.address, i.tin
    FROM wht_remittance_cycles rc
    JOIN cycles c ON c.id = rc.cycle_id
    JOIN mudarabah_settlements st ON st.cycle_id = c.id AND st.is_current
    JOIN mudarabah_settlement_holders h ON h.settlement_id = st.id
    JOIN investors i ON i.id = h.investor_id
    WHERE rc.remittance_id = p_remittance_id
      AND h.wht > 0
      AND (p_cycle_id IS NULL OR c.id = p_cycle_id)
      AND (p_investment_id IS NULL OR h.investment_id = p_investment_id)
    ORDER BY i.full_name
  LOOP
    -- Already issued: left exactly as it is. Not renumbered, not
    -- rewritten. A note that changes after issue is worthless to
    -- whoever is relying on it.
    IF EXISTS (
      SELECT 1 FROM wht_credit_notes
      WHERE cycle_id = v_row.cycle_id AND investment_id = v_row.investment_id
    ) THEN
      v_existing := v_existing + 1;
      CONTINUE;
    END IF;

    IF v_row.tin IS NULL OR btrim(v_row.tin) = '' THEN
      v_no_tin := v_no_tin + 1;
      CONTINUE;
    END IF;

    INSERT INTO wht_credit_notes (
      reference, cycle_id, settlement_id, investment_id, investor_id,
      investor_name, investor_address, investor_tin,
      period_start, period_end, gross_profit, wht_rate, wht_amount,
      net_paid, deducted_on, remittance_reference, remitted_at,
      filed_on, remittance_id, issued_by
    ) VALUES (
      FORMAT('WHT-%s-%s',
             to_char(COALESCE(v_row.end_date, CURRENT_DATE), 'YYYY'),
             LPAD(nextval('wht_credit_note_seq')::TEXT, 6, '0')),
      v_row.cycle_id, v_row.settlement_id, v_row.investment_id, v_row.investor_id,
      v_row.full_name, v_row.address, btrim(v_row.tin),
      v_row.start_date, v_row.end_date,
      v_row.gross_profit, v_row.wht_rate_used, v_row.wht,
      v_row.net_profit, COALESCE(v_row.settled_at::DATE, CURRENT_DATE),
      v_rem.reference, v_rem.recorded_at,
      v_rem.remitted_on, p_remittance_id, auth.uid()
    );

    -- The note exists and carries a reference: certified.
    UPDATE mudarabah_settlement_holders
    SET wht_state = 'certified'
    WHERE settlement_id = v_row.settlement_id
      AND investment_id = v_row.investment_id;

    v_issued := v_issued + 1;
  END LOOP;

  IF v_issued > 0 THEN
    PERFORM create_audit_log(
      'wht_credit_notes_issued', 'wht_remittance', p_remittance_id::TEXT, NULL,
      jsonb_build_object('issued', v_issued, 'skipped_no_tin', v_no_tin,
                         'reference', v_rem.reference,
                         'single_investment', p_investment_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'issued',         v_issued,
    'skipped_no_tin', v_no_tin,
    'already_issued', v_existing,
    'reference',      v_rem.reference
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. The screen an administrator lives on at filing time
--
--    Every settled cycle with tax withheld. Outstanding work first,
--    because that is what the screen is for.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_wht_overview()
RETURNS TABLE (
  cycle_id             UUID,
  series_name          TEXT,
  cycle_label          TEXT,
  end_date             DATE,
  investors_taxed      INTEGER,
  total_withheld       BIGINT,
  notes_due            INTEGER,
  notes_issued         INTEGER,
  without_tin          INTEGER,
  remittance_id        UUID,
  remittance_reference TEXT,
  remitted_on          DATE,
  state                TEXT
) AS $$
  SELECT
    c.id, s.name, c.cycle_label, c.end_date,
    COUNT(*)::INTEGER,
    COALESCE(SUM(h.wht), 0),
    COUNT(*) FILTER (WHERE i.tin IS NOT NULL AND btrim(i.tin) <> '')::INTEGER,
    COUNT(*) FILTER (WHERE n.id IS NOT NULL)::INTEGER,
    COUNT(*) FILTER (WHERE i.tin IS NULL OR btrim(i.tin) = '')::INTEGER,
    MAX(r.id::TEXT)::UUID,
    MAX(r.reference),
    MAX(r.remitted_on),
    CASE
      WHEN COUNT(*) FILTER (WHERE n.id IS NOT NULL) = 0 AND MAX(r.id::TEXT) IS NULL
        THEN 'withheld'
      WHEN COUNT(*) FILTER (WHERE n.id IS NOT NULL)
           < COUNT(*) FILTER (WHERE i.tin IS NOT NULL AND btrim(i.tin) <> '')
        THEN 'remitted'
      ELSE 'certified'
    END
  FROM mudarabah_settlements st
  JOIN cycles c ON c.id = st.cycle_id
  JOIN series s ON s.id = c.series_id
  JOIN mudarabah_settlement_holders h ON h.settlement_id = st.id
  JOIN investors i ON i.id = h.investor_id
  LEFT JOIN wht_credit_notes n
    ON n.cycle_id = c.id AND n.investment_id = h.investment_id
  LEFT JOIN wht_remittance_cycles rc ON rc.cycle_id = c.id
  LEFT JOIN wht_remittances r ON r.id = rc.remittance_id
  WHERE st.is_current AND h.wht > 0
  GROUP BY c.id, s.name, c.cycle_label, c.end_date
  -- Outstanding first: nothing filed, then filed but not issued
  ORDER BY (MAX(r.id::TEXT) IS NULL) DESC, c.end_date DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 6. An investor's own credit note
--
--    Scoped by get_my_investor_id(), like everything else they read.
--    The cycle in the request says which cycle; the session says
--    whose note.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_my_credit_note(p_cycle_id UUID)
RETURNS TABLE (
  note_id       UUID,
  reference     TEXT,
  investment_id UUID,
  wht_amount    BIGINT,
  filed_on      DATE,
  issued_at     TIMESTAMPTZ
) AS $$
  SELECT n.id, n.reference, n.investment_id, n.wht_amount, n.filed_on, n.issued_at
  FROM wht_credit_notes n
  WHERE n.cycle_id = p_cycle_id
    AND n.investor_id = get_my_investor_id()
  LIMIT 1;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$ BEGIN
  CREATE POLICY "Investors read their own credit notes"
    ON wht_credit_notes FOR SELECT
    USING (investor_id = get_my_investor_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
