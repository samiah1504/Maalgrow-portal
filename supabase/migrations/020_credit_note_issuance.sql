-- ============================================================
-- Migration 020 – Credit notes: issuer settings, investor TIN,
--                 and issuance only after the tax is filed
--
-- Three changes to how withholding tax credit notes work:
--
--   1. Issuer details are edited from the app, not by hand in SQL.
--   2. Investors have their own tax identification number. A credit
--      note CANNOT be issued without it — a tax document carrying the
--      wrong identifier, or none, is worse than no document.
--   3. Notes are issued when the tax has actually been FILED, not at
--      settlement. Issuance now requires the remittance reference, so
--      a note can never claim a remittance that has not happened.
--
-- Re-running issuance is how you catch up: investors who since filled
-- in their TIN get their note then, with the same rules.
--
-- Apply AFTER migration 019.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The investor's own tax identification number
--
--    Separate from `nin`, which is the national identity number and
--    a different thing entirely.
-- ------------------------------------------------------------
ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS tin TEXT;

-- ------------------------------------------------------------
-- 2. When the tax was filed, recorded on the note itself
-- ------------------------------------------------------------
ALTER TABLE wht_credit_notes
  ADD COLUMN IF NOT EXISTS filed_on DATE;

-- ------------------------------------------------------------
-- 3. Issuer details, editable from the app
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_update_issuer_settings(
  p_company_name    TEXT,
  p_company_address TEXT DEFAULT NULL,
  p_company_tin     TEXT DEFAULT NULL,
  p_signatory_name  TEXT DEFAULT NULL,
  p_signatory_title TEXT DEFAULT NULL,
  p_seal_url        TEXT DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  PERFORM mudarabah_assert_admin();

  IF p_company_name IS NULL OR btrim(p_company_name) = '' THEN
    RAISE EXCEPTION 'The company name is required — it appears on every credit note';
  END IF;

  INSERT INTO wht_issuer_settings (
    id, company_name, company_address, company_tin,
    signatory_name, signatory_title, seal_url, updated_at
  ) VALUES (
    1, btrim(p_company_name), NULLIF(btrim(COALESCE(p_company_address, '')), ''),
    NULLIF(btrim(COALESCE(p_company_tin, '')), ''),
    NULLIF(btrim(COALESCE(p_signatory_name, '')), ''),
    NULLIF(btrim(COALESCE(p_signatory_title, '')), ''),
    NULLIF(btrim(COALESCE(p_seal_url, '')), ''), NOW()
  )
  ON CONFLICT (id) DO UPDATE SET
    company_name    = EXCLUDED.company_name,
    company_address = EXCLUDED.company_address,
    company_tin     = EXCLUDED.company_tin,
    signatory_name  = EXCLUDED.signatory_name,
    signatory_title = EXCLUDED.signatory_title,
    seal_url        = EXCLUDED.seal_url,
    updated_at      = NOW();

  PERFORM create_audit_log(
    'wht_issuer_settings_updated', 'wht_issuer_settings', '1', NULL,
    jsonb_build_object('company_name', p_company_name, 'company_tin', p_company_tin)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Issue the notes — only once the tax has been filed
--
--    The old single-argument version issued at settlement. It is
--    replaced: issuance now demands the remittance reference, so the
--    note can state truthfully what was remitted and when.
--
--    An investor with no tax identification number is SKIPPED, not
--    failed. Run it again once they have filled theirs in.
--
--    IDEMPOTENT: a note that already exists is left exactly as it is.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS mudarabah_issue_credit_notes(UUID);

CREATE OR REPLACE FUNCTION mudarabah_issue_credit_notes(
  p_settlement_id        UUID,
  p_remittance_reference TEXT,
  p_filed_on             DATE DEFAULT CURRENT_DATE
)
RETURNS JSONB AS $$
DECLARE
  v_settle   mudarabah_settlements%ROWTYPE;
  v_cycle    cycles%ROWTYPE;
  v_holder   RECORD;
  v_issued   INTEGER := 0;
  v_no_tin   INTEGER := 0;
  v_existing INTEGER := 0;
BEGIN
  PERFORM mudarabah_assert_admin();

  IF p_remittance_reference IS NULL OR btrim(p_remittance_reference) = '' THEN
    RAISE EXCEPTION 'A remittance reference is required. Credit notes are issued once the tax has been filed, not before.';
  END IF;

  SELECT * INTO v_settle FROM mudarabah_settlements WHERE id = p_settlement_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such settlement';
  END IF;
  SELECT * INTO v_cycle FROM cycles WHERE id = v_settle.cycle_id;

  FOR v_holder IN
    SELECT h.*, i.full_name, i.address, i.tin
    FROM mudarabah_settlement_holders h
    JOIN investors i ON i.id = h.investor_id
    WHERE h.settlement_id = p_settlement_id AND h.wht > 0
  LOOP
    IF EXISTS (
      SELECT 1 FROM wht_credit_notes
      WHERE cycle_id = v_settle.cycle_id AND investment_id = v_holder.investment_id
    ) THEN
      v_existing := v_existing + 1;
      CONTINUE;
    END IF;

    -- No tax identification number, no credit note. The investor
    -- fills theirs in, then this is run again for them.
    IF v_holder.tin IS NULL OR btrim(v_holder.tin) = '' THEN
      v_no_tin := v_no_tin + 1;
      CONTINUE;
    END IF;

    INSERT INTO wht_credit_notes (
      reference, cycle_id, settlement_id, investment_id, investor_id,
      investor_name, investor_address, investor_tin,
      period_start, period_end, gross_profit, wht_rate, wht_amount,
      net_paid, deducted_on, remittance_reference, remitted_at,
      filed_on, issued_by
    ) VALUES (
      FORMAT('WHT-%s-%s',
             to_char(COALESCE(v_cycle.end_date, CURRENT_DATE), 'YYYY'),
             LPAD(nextval('wht_credit_note_seq')::TEXT, 6, '0')),
      v_settle.cycle_id, p_settlement_id, v_holder.investment_id, v_holder.investor_id,
      v_holder.full_name, v_holder.address, btrim(v_holder.tin),
      v_cycle.start_date, v_cycle.end_date,
      v_holder.gross_profit, v_settle.wht_rate_used, v_holder.wht,
      v_holder.net_profit, COALESCE(v_settle.settled_at::DATE, CURRENT_DATE),
      btrim(p_remittance_reference), NOW(),
      COALESCE(p_filed_on, CURRENT_DATE), auth.uid()
    );

    v_issued := v_issued + 1;
  END LOOP;

  IF v_issued > 0 THEN
    PERFORM create_audit_log(
      'wht_credit_notes_issued', 'mudarabah_settlement', p_settlement_id::TEXT, NULL,
      jsonb_build_object('issued', v_issued, 'skipped_no_tin', v_no_tin,
                         'remittance_reference', p_remittance_reference,
                         'filed_on', p_filed_on)
    );
  END IF;

  RETURN jsonb_build_object(
    'issued',         v_issued,
    'skipped_no_tin', v_no_tin,
    'already_issued', v_existing
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. Who is ready, and who is waiting on a tax number
--
--    The screen an administrator checks before filing: everyone who
--    had tax withheld, whether they can be issued a note yet, and
--    whether one already exists.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_credit_note_readiness(p_cycle_id UUID)
RETURNS TABLE (
  investor_id   UUID,
  investor_name TEXT,
  investor_code TEXT,
  tin           TEXT,
  gross_profit  BIGINT,
  wht_amount    BIGINT,
  net_paid      BIGINT,
  has_tin       BOOLEAN,
  note_issued   BOOLEAN,
  reference     TEXT
) AS $$
  SELECT
    i.id, i.full_name, i.investor_code, i.tin,
    h.gross_profit, h.wht, h.net_profit,
    (i.tin IS NOT NULL AND btrim(i.tin) <> ''),
    (n.id IS NOT NULL),
    n.reference
  FROM mudarabah_settlements s
  JOIN mudarabah_settlement_holders h ON h.settlement_id = s.id
  JOIN investors i ON i.id = h.investor_id
  LEFT JOIN wht_credit_notes n
    ON n.cycle_id = s.cycle_id AND n.investment_id = h.investment_id
  -- The current settlement, or the most recent one if the cycle has
  -- been reopened — an administrator still needs to see who is
  -- waiting on a tax number.
  WHERE s.id = (
    SELECT id FROM mudarabah_settlements
    WHERE cycle_id = p_cycle_id
    ORDER BY is_current DESC, settled_at DESC
    LIMIT 1
  )
  AND h.wht > 0
  ORDER BY i.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Investors may read and set their own tax identification number
-- through the existing profile update path; nothing new is exposed
-- here beyond the column itself.
