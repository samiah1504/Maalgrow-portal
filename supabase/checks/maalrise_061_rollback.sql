-- ============================================================
-- MaalRise 061 — ROLLBACK. Removes the move function. Moves already
-- made stay as they are (they are ordinary funding entries).
-- ============================================================
BEGIN;
DROP FUNCTION maalrise_move_funding(UUID, UUID, INTEGER, TEXT);
COMMIT;
