-- ============================================================
-- MaalRise 051 — PART 3 OF 6
-- Freeze and staff-guard triggers; row level security and read policies
--
-- The six parts together are byte-for-byte the body of
-- supabase/migrations/051_maalrise_core.sql (lines 292–438 here), split
-- so each can be pasted and run on its own in the Supabase SQL Editor.
--
-- Run the parts IN ORDER, 1 to 6, each in its own Run.
-- Each part is its own transaction: if it fails, it leaves nothing
-- behind, and the earlier parts stay as they were. It refuses to run
-- out of order, or twice.
--
-- Success = the final result row reads "Part 3 of 6 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT to_regclass('public.maalrise_documents') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: run part 2 of 6 first (it creates maalrise_documents).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'maalrise_cycle_visible_to_me') THEN
    RAISE EXCEPTION 'STOP: part 3 of 6 has already been applied (maalrise_cycle_visible_to_me exists). Do not run it again.';
  END IF;
END $$;

-- >>> 051 BODY START (part 3)
-- ------------------------------------------------------------
-- 6. Frozen means frozen
--
--    Approved terms and their schedule cannot be edited or deleted by
--    anyone, including these functions: a change needs a new version.
--    The only update allowed on an approved version is being marked
--    superseded by its successor's approval.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION maalrise_terms_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status IN ('approved', 'superseded') THEN
      RAISE EXCEPTION 'Approved MaalRise terms cannot be deleted';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'superseded' THEN
    RAISE EXCEPTION 'Superseded MaalRise terms are read-only';
  END IF;
  IF OLD.status = 'approved' THEN
    IF NEW.status = 'superseded'
       AND (to_jsonb(NEW) - 'status') = (to_jsonb(OLD) - 'status') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Approved MaalRise terms are frozen; create a new version instead';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maalrise_terms_guard
  BEFORE UPDATE OR DELETE ON maalrise_cycle_terms
  FOR EACH ROW EXECUTE FUNCTION maalrise_terms_guard();

CREATE OR REPLACE FUNCTION maalrise_schedule_guard()
RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
BEGIN
  SELECT status INTO v_status FROM maalrise_cycle_terms
   WHERE id = COALESCE(OLD.terms_id, NEW.terms_id);
  IF v_status IN ('approved', 'superseded') THEN
    RAISE EXCEPTION 'The schedule of approved MaalRise terms is frozen';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maalrise_schedule_guard
  BEFORE INSERT OR UPDATE OR DELETE ON maalrise_schedule_lines
  FOR EACH ROW EXECUTE FUNCTION maalrise_schedule_guard();

-- Staff are not investors (D10). Checked at the table, not only in the
-- function, so no other path can add one.
CREATE OR REPLACE FUNCTION maalrise_investor_not_staff()
RETURNS TRIGGER AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::TEXT INTO v_role FROM profiles WHERE id = NEW.profile_id;
  IF v_role IS DISTINCT FROM 'investor' THEN
    RAISE EXCEPTION 'Only investor accounts can hold MaalRise access (this account is %)', COALESCE(v_role, 'unknown');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER maalrise_investor_not_staff
  BEFORE INSERT OR UPDATE OF profile_id ON maalrise_investors
  FOR EACH ROW EXECUTE FUNCTION maalrise_investor_not_staff();

-- ------------------------------------------------------------
-- 7. Row level security — read paths only
-- ------------------------------------------------------------
ALTER TABLE maalrise_counterparties        ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_investors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_kyc_submissions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_bank_details_history  ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_cycles                ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_cycle_terms           ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_schedule_lines        ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_investor_fundings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_allocations           ENABLE ROW LEVEL SECURITY;
ALTER TABLE maalrise_documents             ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION get_my_maalrise_investor_id()
RETURNS UUID AS $$
  SELECT id FROM maalrise_investors WHERE profile_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- An investor sees a Cycle only once it has been activated with
-- approved terms, and only if they hold an allocation in it.
CREATE OR REPLACE FUNCTION maalrise_cycle_visible_to_me(p_cycle UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM maalrise_cycles c
    JOIN maalrise_allocations a ON a.cycle_id = c.id
    WHERE c.id = p_cycle
      AND c.status IN ('active', 'matured', 'closed')
      AND c.approved_terms_id IS NOT NULL
      AND a.maalrise_investor_id = get_my_maalrise_investor_id()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

CREATE POLICY "Staff read counterparties" ON maalrise_counterparties FOR SELECT USING (is_admin());

CREATE POLICY "Staff read MaalRise investors" ON maalrise_investors FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own MaalRise record" ON maalrise_investors FOR SELECT USING (profile_id = auth.uid());

CREATE POLICY "Staff read KYC submissions" ON maalrise_kyc_submissions FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own KYC submissions" ON maalrise_kyc_submissions
  FOR SELECT USING (maalrise_investor_id = get_my_maalrise_investor_id());

CREATE POLICY "Staff read bank history" ON maalrise_bank_details_history FOR SELECT USING (is_admin());

CREATE POLICY "Staff read cycles" ON maalrise_cycles FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own visible cycles" ON maalrise_cycles FOR SELECT USING (maalrise_cycle_visible_to_me(id));

CREATE POLICY "Staff read terms" ON maalrise_cycle_terms FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads approved terms of own cycles" ON maalrise_cycle_terms
  FOR SELECT USING (status = 'approved' AND maalrise_cycle_visible_to_me(cycle_id));

CREATE POLICY "Staff read schedule" ON maalrise_schedule_lines FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads approved schedule of own cycles" ON maalrise_schedule_lines
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM maalrise_cycle_terms t
    WHERE t.id = terms_id AND t.status = 'approved' AND maalrise_cycle_visible_to_me(t.cycle_id)));

CREATE POLICY "Staff read fundings" ON maalrise_investor_fundings FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own confirmed fundings" ON maalrise_investor_fundings
  FOR SELECT USING (status = 'confirmed' AND maalrise_investor_id = get_my_maalrise_investor_id());

CREATE POLICY "Staff read allocations" ON maalrise_allocations FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads own allocations in visible cycles" ON maalrise_allocations
  FOR SELECT USING (maalrise_investor_id = get_my_maalrise_investor_id() AND maalrise_cycle_visible_to_me(cycle_id));

CREATE POLICY "Staff read documents" ON maalrise_documents FOR SELECT USING (is_admin());
CREATE POLICY "Investor reads visible documents" ON maalrise_documents
  FOR SELECT USING (
    visible_to_investors
    AND (
      (cycle_id IS NOT NULL AND maalrise_cycle_visible_to_me(cycle_id))
      OR (cycle_id IS NULL AND maalrise_investor_id = get_my_maalrise_investor_id())
    )
  );

-- <<< 051 BODY END (part 3)

COMMIT;

SELECT 'Part 3 of 6 applied' AS result;
