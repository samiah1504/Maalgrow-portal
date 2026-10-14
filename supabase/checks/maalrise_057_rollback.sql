-- ============================================================
-- MaalRise 057 — ROLLBACK. Removes the one function 057 added. Emails
-- it already prepared stay in MaalRise Emails as they are.
-- ============================================================
BEGIN;
DROP FUNCTION maalrise_prepare_cycle_emails(UUID);
COMMIT;
