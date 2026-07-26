-- ============================================================
-- Migration 019 – Withholding tax credit notes
--
-- Investors need documentation of the tax withheld on their behalf so
-- they can claim it against their own tax. A credit note is a separate
-- single-page document, NOT a section of the investment report:
-- investors hand it to an accountant or a tax office, and they should
-- not have to disclose their whole investment report to do so.
--
-- Behaviour:
--   • generated at settlement, one per investor per cycle, FROM THE
--     FROZEN SNAPSHOT — never recalculated
--   • a reference number that is sequential, stable and never reused
--   • reissuing produces the SAME reference and the SAME figures.
--     A credit note that changes after issue is worthless.
--   • the remittance reference is filled in after remitting, and doing
--     so counts as a REISSUE, not an amendment
--
-- Money is integer kobo, as elsewhere in this feature.
--
-- Apply AFTER migration 018.
-- ============================================================

-- Issuer details, held once. Editable by an administrator so the
-- wording and identifiers can be corrected without a migration.
CREATE TABLE IF NOT EXISTS wht_issuer_settings (
  id                INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  company_name      TEXT NOT NULL DEFAULT 'MaalVest Limited',
  company_address   TEXT,
  company_tin       TEXT,
  signatory_name    TEXT,
  signatory_title   TEXT,
  seal_url          TEXT,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO wht_issuer_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Sequential, stable, never reused
CREATE SEQUENCE IF NOT EXISTS wht_credit_note_seq START 1;

CREATE TABLE IF NOT EXISTS wht_credit_notes (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference            TEXT NOT NULL UNIQUE,
  cycle_id             UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  settlement_id        UUID NOT NULL REFERENCES mudarabah_settlements(id) ON DELETE CASCADE,
  investment_id        UUID NOT NULL REFERENCES investments(id),
  investor_id          UUID NOT NULL REFERENCES investors(id),

  -- Snapshot of the investor as they were when the note was issued.
  -- A note must render even when the TIN is absent — as "not
  -- provided", never by breaking.
  investor_name        TEXT NOT NULL,
  investor_address     TEXT,
  investor_tin         TEXT,

  -- The figures, frozen. Never recalculated.
  period_start         DATE NOT NULL,
  period_end           DATE NOT NULL,
  gross_profit         BIGINT NOT NULL,   -- amount subject to deduction
  wht_rate             NUMERIC(5,4) NOT NULL,
  wht_amount           BIGINT NOT NULL,
  net_paid             BIGINT NOT NULL,
  deducted_on          DATE NOT NULL,

  -- Filled in when remittance happens; blank until then
  remittance_reference TEXT,
  remitted_at          TIMESTAMPTZ,

  issued_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  issued_by            UUID REFERENCES profiles(id),
  -- Reissuing keeps the reference and the figures; this only counts
  -- how many times the document has been produced.
  reissue_count        INTEGER NOT NULL DEFAULT 0,
  last_reissued_at     TIMESTAMPTZ,

  -- One note per investor per cycle
  UNIQUE (cycle_id, investment_id)
);

CREATE INDEX IF NOT EXISTS idx_wht_credit_notes_investor
  ON wht_credit_notes(investor_id);
CREATE INDEX IF NOT EXISTS idx_wht_credit_notes_settlement
  ON wht_credit_notes(settlement_id);

ALTER TABLE wht_credit_notes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE wht_issuer_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  CREATE POLICY "Staff read credit notes"
    ON wht_credit_notes FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Permanently downloadable from the investor's own portal
DO $$ BEGIN
  CREATE POLICY "Investors read their own credit notes"
    ON wht_credit_notes FOR SELECT
    USING (investor_id = get_my_investor_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff read issuer settings"
    ON wht_issuer_settings FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- Issue the notes for a settlement, from the frozen holder rows.
--
-- IDEMPOTENT: a note that already exists is left exactly as it is,
-- reference and figures untouched. Only holders who actually had tax
-- withheld get a note.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_issue_credit_notes(p_settlement_id UUID)
RETURNS INTEGER AS $$
DECLARE
  v_settle  mudarabah_settlements%ROWTYPE;
  v_cycle   cycles%ROWTYPE;
  v_holder  RECORD;
  v_count   INTEGER := 0;
BEGIN
  PERFORM mudarabah_assert_admin();

  SELECT * INTO v_settle FROM mudarabah_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such settlement';
  END IF;
  SELECT * INTO v_cycle FROM cycles WHERE id = v_settle.cycle_id;

  FOR v_holder IN
    SELECT h.*, i.full_name, i.address, i.nin
    FROM mudarabah_settlement_holders h
    JOIN investors i ON i.id = h.investor_id
    WHERE h.settlement_id = p_settlement_id AND h.wht > 0
  LOOP
    -- Already issued for this cycle: leave it alone entirely
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM wht_credit_notes
      WHERE cycle_id = v_settle.cycle_id AND investment_id = v_holder.investment_id
    );

    INSERT INTO wht_credit_notes (
      reference, cycle_id, settlement_id, investment_id, investor_id,
      investor_name, investor_address, investor_tin,
      period_start, period_end, gross_profit, wht_rate, wht_amount,
      net_paid, deducted_on, issued_by
    ) VALUES (
      FORMAT('WHT-%s-%s',
             to_char(COALESCE(v_cycle.end_date, CURRENT_DATE), 'YYYY'),
             LPAD(nextval('wht_credit_note_seq')::TEXT, 6, '0')),
      v_settle.cycle_id, p_settlement_id, v_holder.investment_id, v_holder.investor_id,
      v_holder.full_name, v_holder.address, NULLIF(btrim(COALESCE(v_holder.nin, '')), ''),
      v_cycle.start_date, v_cycle.end_date,
      v_holder.gross_profit, v_settle.wht_rate_used, v_holder.wht,
      v_holder.net_profit, COALESCE(v_settle.settled_at::DATE, CURRENT_DATE),
      auth.uid()
    );

    v_count := v_count + 1;
  END LOOP;

  IF v_count > 0 THEN
    PERFORM create_audit_log(
      'wht_credit_notes_issued', 'mudarabah_settlement', p_settlement_id::TEXT, NULL,
      jsonb_build_object('notes_issued', v_count)
    );
  END IF;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- Record the remittance and reissue.
--
-- The reference and every figure stay exactly as issued; only the
-- remittance reference is added, and the reissue is counted.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_record_remittance(
  p_note_id   UUID,
  p_reference TEXT
)
RETURNS VOID AS $$
BEGIN
  PERFORM mudarabah_assert_admin();

  IF p_reference IS NULL OR btrim(p_reference) = '' THEN
    RAISE EXCEPTION 'A remittance reference is required';
  END IF;

  UPDATE wht_credit_notes SET
    remittance_reference = p_reference,
    remitted_at          = NOW(),
    reissue_count        = reissue_count + 1,
    last_reissued_at     = NOW()
  WHERE id = p_note_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such credit note';
  END IF;

  PERFORM create_audit_log(
    'wht_credit_note_reissued', 'wht_credit_note', p_note_id::TEXT, NULL,
    jsonb_build_object('remittance_reference', p_reference)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- The per-cycle summary an administrator remits from
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_wht_summary(p_cycle_id UUID)
RETURNS TABLE (
  investor_name        TEXT,
  investor_code        TEXT,
  investor_tin         TEXT,
  reference            TEXT,
  gross_profit         BIGINT,
  wht_amount           BIGINT,
  net_paid             BIGINT,
  remittance_reference TEXT
) AS $$
  SELECT n.investor_name, i.investor_code, n.investor_tin, n.reference,
         n.gross_profit, n.wht_amount, n.net_paid, n.remittance_reference
  FROM wht_credit_notes n
  JOIN investors i ON i.id = n.investor_id
  WHERE n.cycle_id = p_cycle_id
  ORDER BY n.investor_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON wht_credit_notes, wht_issuer_settings FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON wht_credit_notes, wht_issuer_settings FROM authenticated';
  END IF;
END $$;
