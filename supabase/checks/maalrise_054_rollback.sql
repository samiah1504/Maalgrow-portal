-- ============================================================
-- MaalRise 054 — ROLLBACK. Removes exactly what 054 added and puts the
-- five investor read policies back as 051 defined them.
--
-- WRITES. Run only if 054 must be undone. MaalGrow and MaalRise
-- 051–053 are not touched; afterwards maalrise_054_preflight.sql must
-- print the original fingerprint.
--
-- REFUSES if any bank change request exists: those are records of what
-- investors asked for. Export them first.
-- ============================================================
BEGIN;

DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM maalrise_bank_change_requests;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Rollback refused: % bank change request(s) exist. Export them first.', v_n;
  END IF;
END $$;

DROP TABLE maalrise_bank_change_requests CASCADE;
DROP FUNCTION
  maalrise_my_payments(), maalrise_my_cycles(), maalrise_my_cycle(UUID), maalrise_my_profile(), maalrise_my_access(),
  maalrise_investor_share(UUID, UUID, BIGINT), maalrise_review_bank_change(UUID, BOOLEAN, TEXT),
  maalrise_cancel_bank_change(UUID), maalrise_request_bank_change(JSONB), maalrise_bank_change_guard();

CREATE POLICY "Investor reads own MaalRise record" ON maalrise_investors FOR SELECT USING (profile_id = auth.uid());
CREATE POLICY "Investor reads own KYC submissions" ON maalrise_kyc_submissions
  FOR SELECT USING (maalrise_investor_id = get_my_maalrise_investor_id());
CREATE POLICY "Investor reads own visible cycles" ON maalrise_cycles FOR SELECT USING (maalrise_cycle_visible_to_me(id));
CREATE POLICY "Investor reads approved terms of own cycles" ON maalrise_cycle_terms
  FOR SELECT USING (status = 'approved' AND maalrise_cycle_visible_to_me(cycle_id));
CREATE POLICY "Investor reads approved schedule of own cycles" ON maalrise_schedule_lines
  FOR SELECT USING (EXISTS (
    SELECT 1 FROM maalrise_cycle_terms t
    WHERE t.id = terms_id AND t.status = 'approved' AND maalrise_cycle_visible_to_me(t.cycle_id)));

COMMIT;
