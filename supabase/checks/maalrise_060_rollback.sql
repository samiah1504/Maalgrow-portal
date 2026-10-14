-- ============================================================
-- MaalRise 060 — ROLLBACK. Removes the reopen function. Cycles already
-- reopened stay as they are (activate them again as usual).
-- ============================================================
BEGIN;
DROP FUNCTION maalrise_reopen_cycle(UUID, TEXT);
COMMIT;
