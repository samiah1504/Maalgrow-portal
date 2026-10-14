-- ============================================================
-- MaalRise 061 — ROLLBACK. Puts the funding table back exactly as
-- before 061. REFUSES once any refund has been recorded.
-- ============================================================
BEGIN;

DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_n FROM maalrise_investor_fundings WHERE status = 'refunded';
  IF v_n > 0 THEN RAISE EXCEPTION 'Rollback refused: % refund(s) recorded.', v_n; END IF;
END $$;

DROP FUNCTION maalrise_refund_funding(UUID, JSONB);
ALTER TABLE maalrise_investor_fundings DROP CONSTRAINT maalrise_fundings_refund_complete;
ALTER TABLE maalrise_investor_fundings
  DROP COLUMN refunded_by, DROP COLUMN refunded_at, DROP COLUMN refunded_on,
  DROP COLUMN refund_reference, DROP COLUMN refund_reason;
ALTER TABLE maalrise_investor_fundings DROP CONSTRAINT maalrise_investor_fundings_status_check;
ALTER TABLE maalrise_investor_fundings ADD CONSTRAINT maalrise_investor_fundings_status_check
  CHECK (status IN ('recorded', 'confirmed', 'rejected'));

COMMIT;
