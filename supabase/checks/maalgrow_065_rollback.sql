-- ============================================================
-- MaalGrow 065 — ROLLBACK. Puts back the dates and rollover marks 065
-- changed, from the audit log. Refuses once a lengthened cycle has
-- been opened, or once investors have been rolled into it.
-- ============================================================
BEGIN;
DO $$
DECLARE v_t TIMESTAMPTZ;
BEGIN
SELECT MAX(created_at) INTO v_t FROM audit_logs WHERE action = 'maalgrow_065_applied';
IF v_t IS NULL THEN RAISE EXCEPTION 'Rollback refused: 065 is not applied.'; END IF;
IF EXISTS (SELECT 1 FROM audit_logs a JOIN cycles c ON c.id::TEXT = a.entity_id
WHERE a.action = 'cycle_lengthened_before_rollover' AND a.created_at >= v_t
AND (c.status NOT IN ('draft', 'upcoming', 'subscription_open', 'subscription_closed')
OR EXISTS (SELECT 1 FROM investments i WHERE i.cycle_id = c.id AND i.created_at > v_t))) THEN
RAISE EXCEPTION 'Rollback refused: a lengthened cycle has been opened or rolled into.';
END IF;
END $$;
DO $$
DECLARE r RECORD; v_t TIMESTAMPTZ;
BEGIN
SELECT MAX(created_at) INTO v_t FROM audit_logs WHERE action = 'maalgrow_065_applied';
FOR r IN SELECT entity_id, old_values, new_values FROM audit_logs
WHERE action = 'cycle_lengthened_before_rollover' AND created_at >= v_t LOOP
UPDATE investments SET maturity_date = (r.old_values->>'end_date')::DATE, updated_at = NOW()
WHERE cycle_id::TEXT = r.entity_id AND maturity_date = (r.new_values->>'end_date')::DATE;
UPDATE cycles SET end_date = (r.old_values->>'end_date')::DATE, cycle_months = (r.old_values->>'cycle_months')::INTEGER,
cycle_label = r.old_values->>'cycle_label', updated_at = NOW() WHERE id::TEXT = r.entity_id;
END LOOP;
UPDATE cycles SET rollover_processed_at = NULL, updated_at = NOW()
WHERE id::TEXT IN (SELECT entity_id FROM audit_logs WHERE action = 'rollover_marked_complete' AND created_at >= v_t);
DELETE FROM audit_logs WHERE action = 'maalgrow_065_applied';
END $$;
COMMIT;
SELECT '065 rolled back' AS result;
