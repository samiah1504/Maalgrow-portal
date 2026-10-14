-- ============================================================
-- 060 — MaalRise: reopen an activated Cycle for correction (14 Oct 2026)
--
-- APPLY ONLY AFTER supabase/checks/maalrise_060_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_060_postapply.sql.
-- To undo: supabase/checks/maalrise_060_rollback.sql.
--
-- A Cycle activated by mistake — wrong cost, an investor's funding
-- missing — can be put back to "terms approved" by a SUPER ADMIN,
-- giving a reason, so the normal screens work again: prepare a new
-- terms version (the old one is kept, superseded), approve it, record
-- and confirm the missing funding, and activate again.
--
-- Refused once any money has moved on the Cycle since activation: a
-- payment received from the counterparty, capital received, a profit
-- distribution or a capital settlement (any status, even rejected or
-- cancelled). Then the Cycle has a history that must not be rewritten.
--
-- Nothing is deleted. Terms, schedules, fundings and allocations stay
-- as they are; the reopening is recorded in the audit log with the
-- reason and who activated it before. While reopened, the Cycle is
-- hidden from its investors (as before activation). MaalRise only.
-- ============================================================
BEGIN;

CREATE OR REPLACE FUNCTION maalrise_reopen_cycle(p_cycle UUID, p_reason TEXT)
RETURNS VOID AS $$
DECLARE
  v_cycle maalrise_cycles%ROWTYPE;
  v_what  TEXT;
BEGIN
  IF maalrise_caller_role() IS DISTINCT FROM 'super_admin' THEN
    RAISE EXCEPTION 'Only a super admin can reopen an activated Cycle';
  END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'Give the reason for reopening this Cycle'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status <> 'active' THEN
    RAISE EXCEPTION 'Only an active Cycle can be reopened (this one is %)', v_cycle.status;
  END IF;

  SELECT string_agg(w, ', ') INTO v_what FROM (
    SELECT 'a payment received from the counterparty' AS w WHERE EXISTS (SELECT 1 FROM maalrise_receipts WHERE cycle_id = p_cycle)
    UNION ALL SELECT 'capital received' WHERE EXISTS (SELECT 1 FROM maalrise_capital_receipts WHERE cycle_id = p_cycle)
    UNION ALL SELECT 'a profit distribution' WHERE EXISTS (SELECT 1 FROM maalrise_distributions WHERE cycle_id = p_cycle)
    UNION ALL SELECT 'a capital settlement' WHERE EXISTS (SELECT 1 FROM maalrise_capital_settlements WHERE cycle_id = p_cycle)
  ) x;
  IF v_what IS NOT NULL THEN
    RAISE EXCEPTION 'This Cycle cannot be reopened: % has already been recorded on it', v_what;
  END IF;

  UPDATE maalrise_cycles SET status = 'terms_approved', activated_by = NULL, activated_at = NULL, updated_at = NOW()
   WHERE id = p_cycle;
  PERFORM create_audit_log('maalrise_reopen_cycle', 'maalrise_cycle', p_cycle::TEXT,
    jsonb_build_object('status', 'active', 'activated_by', v_cycle.activated_by, 'activated_at', v_cycle.activated_at),
    jsonb_build_object('status', 'terms_approved', 'reason', trim(p_reason)));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
