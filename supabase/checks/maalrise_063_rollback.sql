-- ============================================================
-- MaalRise 063 — ROLLBACK. Removes everything 063 added. Emails,
-- names, phones and bank details already followed stay as they are.
-- ============================================================
BEGIN;
DROP TRIGGER maalrise_email_from_login ON profiles;
DROP TRIGGER maalrise_contact_from_maalgrow ON investors;
DROP FUNCTION maalrise_email_from_login_trg();
DROP FUNCTION maalrise_contact_from_maalgrow_trg();
DROP FUNCTION maalrise_bank_from_maalgrow_edit(UUID, UUID);
COMMIT;
SELECT '063 rolled back' AS result;
