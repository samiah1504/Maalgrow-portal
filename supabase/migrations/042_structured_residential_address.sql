-- ============================================================
-- 042 — a residential address with parts
--
-- WHAT WAS WRONG WITH ONE BOX. investors.address is a single free
-- text field, and what people put in it is whatever they felt like:
-- "Lagos". "Ilorin". "Behind the mosque". It is the address printed
-- on a withholding tax credit note — a document handed to a tax
-- authority — and a note reading "Abuja" identifies nobody.
--
-- It also cannot be searched, grouped, or checked. There is no way to
-- ask which investors are in Kwara, because "Kwara", "kwara state"
-- and "Ilorin, Kwara" are three unrelated strings.
--
-- ── NOTHING IS DELETED ───────────────────────────────────────
--
-- Every existing address is copied to previous_address_record BEFORE
-- anything else happens, and investors.address itself is left exactly
-- where it is. This migration adds; it does not take away. An
-- investor who never gets round to updating still has both copies of
-- what they originally told us.
--
-- That is the opposite of 040, and deliberately so: 040 destroyed
-- BVNs because holding them was the risk. An address is not a
-- liability, it is a record, and losing it would be the harm.
--
-- ── CODES BESIDE NAMES ───────────────────────────────────────
--
-- Both are stored, and they answer different questions. The code is
-- what joins and filters — it survives Egbado North becoming Yewa
-- North. The name is what the investor actually chose and what a tax
-- document issued in 2026 must still be able to reproduce in 2031,
-- when the list may read differently.
--
-- ── THE ONE INTEGRITY CHECK THE DATABASE CAN MAKE ────────────
--
-- The 774 LGAs live in the application, not in a table here. But
-- because an LGA code is its state's code plus a slug, the database
-- can still refuse Ikeja in Kano: the LGA code must begin with the
-- state code. That is a constraint no form bug can talk its way past.
--
-- ── WHAT THIS BLOCKS, AND WHAT IT DOES NOT ───────────────────
--
-- BLOCKED: issuing a withholding tax credit note. That is the
-- document the address exists for, and one carrying "Lagos" is worse
-- than none. Such an investor is SKIPPED and counted, exactly as an
-- investor with no TIN already is — the batch still issues for
-- everybody else.
--
-- NOT BLOCKED: settling a cycle. Settlement is the money event. Every
-- investor on the books today has only the old single field, so
-- refusing to settle until all of them have updated would stop
-- payouts for a quarter over a data-entry exercise. The settle screen
-- warns; it does not refuse. Say so plainly here so nobody later
-- assumes the gate exists.
--
-- Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The parts.
-- ------------------------------------------------------------
ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS residential_street_address     TEXT,
  ADD COLUMN IF NOT EXISTS residential_state_code         TEXT,
  ADD COLUMN IF NOT EXISTS residential_state_name         TEXT,
  ADD COLUMN IF NOT EXISTS residential_lga_code           TEXT,
  ADD COLUMN IF NOT EXISTS residential_lga_name           TEXT,
  ADD COLUMN IF NOT EXISTS residential_city               TEXT,
  ADD COLUMN IF NOT EXISTS residential_address_verified   BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS residential_address_updated_at TIMESTAMPTZ,
  -- What they told us before there were parts. Kept forever.
  ADD COLUMN IF NOT EXISTS previous_address_record        TEXT;

COMMENT ON COLUMN investors.previous_address_record IS
  'The single free-text address held before migration 042. Never overwritten once set, and never cleared — it is the only record of what an investor originally gave us.';
COMMENT ON COLUMN investors.residential_address_verified IS
  'An administrator has checked this address against something. Independent of completeness: a complete address is not a verified one.';

-- ------------------------------------------------------------
-- 2. Preserve what is there. FIRST, before anything else can
--    touch these rows.
--
--    Guarded on previous_address_record IS NULL so a second run
--    cannot overwrite a preserved value with a later edit of
--    investors.address.
-- ------------------------------------------------------------
UPDATE investors
   SET previous_address_record = btrim(address)
 WHERE previous_address_record IS NULL
   AND COALESCE(btrim(address), '') <> '';

-- ------------------------------------------------------------
-- 3. What the shape of a real address is.
--
--    All NULL-tolerant: every investor on the books has these unset,
--    and they are not rejected for it — they are asked to update.
-- ------------------------------------------------------------

-- A street line has to be more than a place name. Ten characters is
-- not a clever rule, but it is enough to refuse "Lagos", "Abuja" and
-- "Ilorin", which is exactly what was being typed.
DO $$ BEGIN
  ALTER TABLE investors
    ADD CONSTRAINT investors_residential_street_length
    CHECK (
      residential_street_address IS NULL
      OR length(btrim(residential_street_address)) >= 10
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The LGA must belong to the state. An LGA code is the state code
-- plus a slug, so this holds without the database knowing the list.
DO $$ BEGIN
  ALTER TABLE investors
    ADD CONSTRAINT investors_residential_lga_in_state
    CHECK (
      residential_lga_code IS NULL
      OR residential_state_code IS NULL
      OR residential_lga_code LIKE residential_state_code || '-%'
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_investors_residential_state
  ON investors(residential_state_code);
CREATE INDEX IF NOT EXISTS idx_investors_residential_lga
  ON investors(residential_lga_code);

-- ------------------------------------------------------------
-- 4. Which parts are missing.
--
--    Returns the LABELS a person should be shown, in the order the
--    form asks for them, so a caller can say what to go and fix
--    rather than only that something is wrong.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION residential_address_missing(p_investor_id UUID)
RETURNS TEXT[] AS $$
DECLARE
  v_inv     investors%ROWTYPE;
  v_missing TEXT[] := '{}';
BEGIN
  SELECT * INTO v_inv FROM investors WHERE id = p_investor_id;
  IF NOT FOUND THEN
    RETURN ARRAY['Investor not found'];
  END IF;

  IF COALESCE(btrim(v_inv.residential_street_address), '') = ''
     OR length(btrim(v_inv.residential_street_address)) < 10 THEN
    v_missing := array_append(v_missing, 'Street name and full residential address');
  END IF;
  IF COALESCE(btrim(v_inv.residential_state_code), '') = ''
     OR COALESCE(btrim(v_inv.residential_state_name), '') = '' THEN
    v_missing := array_append(v_missing, 'State of residence');
  END IF;
  IF COALESCE(btrim(v_inv.residential_lga_code), '') = ''
     OR COALESCE(btrim(v_inv.residential_lga_name), '') = '' THEN
    v_missing := array_append(v_missing, 'Local government area');
  END IF;
  IF COALESCE(btrim(v_inv.residential_city), '') = '' THEN
    v_missing := array_append(v_missing, 'City or town');
  END IF;

  RETURN v_missing;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION residential_address_complete(p_investor_id UUID)
RETURNS BOOLEAN AS $$
  SELECT COALESCE(array_length(residential_address_missing(p_investor_id), 1), 0) = 0;
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 5. Stamp the update time whenever a part changes.
--
--    A trigger rather than the application, so an address changed
--    from the admin screen, the investor's form or a script all
--    record it the same way. residential_address_verified is CLEARED
--    by a change: an address somebody verified last month is not the
--    address that has just been typed over it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_residential_address()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (
       NEW.residential_street_address IS DISTINCT FROM OLD.residential_street_address
    OR NEW.residential_state_code     IS DISTINCT FROM OLD.residential_state_code
    OR NEW.residential_lga_code       IS DISTINCT FROM OLD.residential_lga_code
    OR NEW.residential_city           IS DISTINCT FROM OLD.residential_city
  ) THEN
    NEW.residential_address_updated_at := NOW();
    -- Unless this very statement is the one marking it verified.
    IF NEW.residential_address_verified IS NOT DISTINCT FROM OLD.residential_address_verified THEN
      NEW.residential_address_verified := FALSE;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS touch_residential_address_trg ON investors;
CREATE TRIGGER touch_residential_address_trg
  BEFORE UPDATE ON investors
  FOR EACH ROW EXECUTE FUNCTION touch_residential_address();

-- ------------------------------------------------------------
-- 6. KYC now asks for the parts.
--
--    'Address' is replaced by the four labels, so an investor is
--    told which one is missing rather than that "Address" is wrong
--    when three quarters of it is fine.
--
--    Everything else in this function is byte-for-byte 015.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION kyc_missing_fields(p_investor_id UUID)
RETURNS TEXT[] AS $$
DECLARE
  v_inv     investors%ROWTYPE;
  v_nok     next_of_kin%ROWTYPE;
  v_missing TEXT[] := '{}';
BEGIN
  SELECT * INTO v_inv FROM investors WHERE id = p_investor_id;
  IF NOT FOUND THEN
    RETURN ARRAY['Investor not found'];
  END IF;

  IF COALESCE(TRIM(v_inv.full_name), '') = ''      THEN v_missing := array_append(v_missing, 'Full name'); END IF;
  IF COALESCE(TRIM(v_inv.email), '') = ''          THEN v_missing := array_append(v_missing, 'Email'); END IF;
  IF COALESCE(TRIM(v_inv.phone), '') = ''          THEN v_missing := array_append(v_missing, 'Phone number'); END IF;

  -- The four parts, in the order the form asks for them.
  v_missing := v_missing || residential_address_missing(p_investor_id);

  IF COALESCE(TRIM(v_inv.bank_name), '') = ''
     OR COALESCE(TRIM(v_inv.account_name), '') = ''
     OR COALESCE(TRIM(v_inv.account_number), '') = '' THEN
    v_missing := array_append(v_missing, 'Bank details');
  END IF;
  IF COALESCE(TRIM(v_inv.gender), '') = ''         THEN v_missing := array_append(v_missing, 'Gender'); END IF;
  IF COALESCE(TRIM(v_inv.nationality), '') = ''    THEN v_missing := array_append(v_missing, 'Nationality'); END IF;
  IF COALESCE(TRIM(v_inv.occupation), '') = ''     THEN v_missing := array_append(v_missing, 'Occupation'); END IF;

  SELECT * INTO v_nok FROM next_of_kin WHERE investor_id = p_investor_id;
  IF NOT FOUND
     OR COALESCE(TRIM(v_nok.full_name), '') = ''
     OR COALESCE(TRIM(v_nok.relationship), '') = ''
     OR COALESCE(TRIM(v_nok.phone), '') = ''
     OR COALESCE(TRIM(v_nok.address), '') = ''
     OR COALESCE(TRIM(v_nok.city), '') = ''
     OR COALESCE(TRIM(v_nok.state), '') = ''
     OR COALESCE(TRIM(v_nok.country), '') = '' THEN
    v_missing := array_append(v_missing, 'Next-of-kin details');
  END IF;

  RETURN v_missing;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- ------------------------------------------------------------
-- 7. Who still has to update, for the admin screen.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION investors_needing_address_update()
RETURNS TABLE (
  investor_id   UUID,
  investor_code TEXT,
  full_name     TEXT,
  email         TEXT,
  phone         TEXT,
  previous_address TEXT,
  missing       TEXT[]
) AS $$
  SELECT i.id, i.investor_code, i.full_name, i.email, i.phone,
         COALESCE(i.previous_address_record, i.address),
         residential_address_missing(i.id)
  FROM investors i
  WHERE NOT residential_address_complete(i.id)
  ORDER BY i.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 8. The credit note carries the parts.
--
--    FROZEN AT ISSUANCE, like every other figure on the note. A note
--    reissued in three years must still show the address the
--    investor lived at when the tax was deducted, not where they
--    live now.
-- ------------------------------------------------------------
ALTER TABLE wht_credit_notes
  ADD COLUMN IF NOT EXISTS investor_street_address TEXT,
  ADD COLUMN IF NOT EXISTS investor_city           TEXT,
  ADD COLUMN IF NOT EXISTS investor_lga_name       TEXT,
  ADD COLUMN IF NOT EXISTS investor_state_name     TEXT;

-- ------------------------------------------------------------
-- 9. Issuance skips an incomplete address.
--
--    The SAME shape as the existing no-TIN skip: counted, reported,
--    and the rest of the batch still issues. Nobody's note is held
--    up by somebody else's missing city.
--
--    This is byte-for-byte the 023 version but for the address
--    check, the four new columns on the INSERT, and the count that
--    reports them.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS mudarabah_issue_credit_notes(UUID, UUID, UUID);

CREATE OR REPLACE FUNCTION mudarabah_issue_credit_notes(
  p_remittance_id UUID,
  p_cycle_id      UUID DEFAULT NULL,
  p_investment_id UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_rem        wht_remittances%ROWTYPE;
  v_row        RECORD;
  v_issued     INTEGER := 0;
  v_existing   INTEGER := 0;
  v_no_tin     INTEGER := 0;
  v_no_address INTEGER := 0;
  v_blocked    TEXT[] := '{}';
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
           i.full_name, i.address, i.tin,
           i.residential_street_address, i.residential_city,
           i.residential_lga_name, i.residential_state_name
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

    -- 042. A tax document has to say where somebody lives. "Lagos"
    -- does not, and neither does a blank.
    IF NOT residential_address_complete(v_row.investor_id) THEN
      v_no_address := v_no_address + 1;
      v_blocked := array_append(v_blocked, v_row.full_name);
      CONTINUE;
    END IF;

    INSERT INTO wht_credit_notes (
      reference, cycle_id, settlement_id, investment_id, investor_id,
      investor_name, investor_address, investor_tin,
      investor_street_address, investor_city, investor_lga_name, investor_state_name,
      period_start, period_end, gross_profit, wht_rate, wht_amount,
      net_paid, deducted_on, remittance_reference, remitted_at,
      filed_on, remittance_id, issued_by
    ) VALUES (
      FORMAT('WHT-%s-%s',
             to_char(COALESCE(v_row.end_date, CURRENT_DATE), 'YYYY'),
             LPAD(nextval('wht_credit_note_seq')::TEXT, 6, '0')),
      v_row.cycle_id, v_row.settlement_id, v_row.investment_id, v_row.investor_id,
      v_row.full_name,
      -- The one-line form, built from the parts rather than from the
      -- old free-text field, so the note and its columns agree.
      concat_ws(', ',
        btrim(v_row.residential_street_address),
        btrim(v_row.residential_city),
        btrim(v_row.residential_lga_name) || ' LGA',
        btrim(v_row.residential_state_name)),
      btrim(v_row.tin),
      btrim(v_row.residential_street_address), btrim(v_row.residential_city),
      btrim(v_row.residential_lga_name), btrim(v_row.residential_state_name),
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

  -- Logged whenever anything happened, issued or skipped. 023 logged
  -- only successes, so a run that issued nothing because six people
  -- had no tax number left no trace of having been attempted.
  IF v_issued > 0 OR v_no_tin > 0 OR v_no_address > 0 THEN
    PERFORM create_audit_log(
      'wht_credit_notes_issued', 'wht_remittance', p_remittance_id::TEXT, NULL,
      jsonb_build_object('issued', v_issued, 'skipped_no_tin', v_no_tin,
                         'skipped_no_address', v_no_address,
                         'reference', v_rem.reference,
                         'single_investment', p_investment_id)
    );
  END IF;

  -- THE SAME KEY NAMES 023 RETURNED. The admin screen reads
  -- skipped_no_tin and reference by name; renaming them to camelCase
  -- would have silently emptied the message it shows after issuing.
  RETURN jsonb_build_object(
    'issued',             v_issued,
    'skipped_no_tin',     v_no_tin,
    'skipped_no_address', v_no_address,
    'blocked_names',      to_jsonb(v_blocked),
    'already_issued',     v_existing,
    'reference',          v_rem.reference
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 10. The issuance preview says who will be skipped, and why.
--
--     An administrator must be able to see the problem BEFORE
--     pressing issue, not discover it in the result.
--
--     Dropped first: CREATE OR REPLACE cannot widen a RETURNS TABLE.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS mudarabah_issuance_preview(UUID);

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
  has_address    BOOLEAN,
  address_missing TEXT[],
  full_address   TEXT,
  already_issued BOOLEAN,
  reference      TEXT
) AS $$
  SELECT
    c.id, c.cycle_label, s.name,
    i.id, h.investment_id, i.full_name, i.investor_code, i.tin,
    h.gross_profit, h.wht, h.net_profit,
    (i.tin IS NOT NULL AND btrim(i.tin) <> ''),
    residential_address_complete(i.id),
    residential_address_missing(i.id),
    concat_ws(', ',
      NULLIF(btrim(COALESCE(i.residential_street_address, '')), ''),
      NULLIF(btrim(COALESCE(i.residential_city, '')), ''),
      CASE WHEN COALESCE(btrim(i.residential_lga_name), '') <> ''
           THEN btrim(i.residential_lga_name) || ' LGA' END,
      NULLIF(btrim(COALESCE(i.residential_state_name, '')), '')),
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
  -- Anything that cannot be issued first, so it is read rather than
  -- scrolled past.
  ORDER BY (residential_address_complete(i.id)),
           (i.tin IS NOT NULL AND btrim(i.tin) <> ''),
           c.start_date, i.full_name;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION residential_address_missing(UUID) TO authenticated;
    GRANT EXECUTE ON FUNCTION residential_address_complete(UUID) TO authenticated;
    REVOKE EXECUTE ON FUNCTION investors_needing_address_update() FROM anon, authenticated;
  END IF;
END $$;
