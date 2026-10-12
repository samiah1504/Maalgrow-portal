-- ============================================================
-- MaalRise 052 — ROLLBACK. Removes exactly what 052 added.
--
-- WRITES. Run only if 052 must be undone. Every statement names a 052
-- object; 051 and MaalGrow are not touched, and afterwards
-- maalrise_052_preflight.sql must print the original fingerprint.
--
-- REFUSES if any receipt, distribution, payment line or payment event
-- exists: those are financial records. (Notifications and email drafts
-- alone do not block it; they are removed with their tables.)
-- The empty documents bucket is left in place; it holds no data.
-- ============================================================
BEGIN;

DO $$
DECLARE v_n BIGINT;
BEGIN
  SELECT (SELECT COUNT(*) FROM maalrise_receipts) + (SELECT COUNT(*) FROM maalrise_distributions)
       + (SELECT COUNT(*) FROM maalrise_distribution_lines) + (SELECT COUNT(*) FROM maalrise_payment_events) INTO v_n;
  IF v_n > 0 THEN
    RAISE EXCEPTION 'Rollback refused: % receipt/distribution/payment row(s) exist. Export them first.', v_n;
  END IF;
END $$;

DROP TABLE IF EXISTS maalrise_payment_events, maalrise_distribution_lines CASCADE;
ALTER TABLE IF EXISTS maalrise_receipts DROP CONSTRAINT IF EXISTS maalrise_receipts_distribution_fk;
DROP TABLE IF EXISTS maalrise_distributions, maalrise_receipts, maalrise_notifications, maalrise_email_outbox CASCADE;

DROP FUNCTION IF EXISTS
  maalrise_reverse_line_payment(UUID, TEXT), maalrise_mark_line_paid(UUID, DATE, TEXT),
  maalrise_approve_distribution(UUID), maalrise_refresh_distribution(UUID), maalrise_confirm_receipt(UUID),
  maalrise_build_distribution_lines(UUID), maalrise_reject_receipt(UUID, TEXT), maalrise_record_receipt(UUID, JSONB),
  maalrise_mark_notifications_read(UUID[]), maalrise_my_notifications(), maalrise_sync_reminders(),
  maalrise_naira(NUMERIC), maalrise_notify_investor(UUID, TEXT, TEXT, TEXT, TEXT, TEXT),
  maalrise_notify_roles(TEXT[], TEXT, TEXT, TEXT, TEXT, TEXT, TEXT), maalrise_today(), maalrise_can_pay(),
  maalrise_payment_events_append_only(), maalrise_lines_guard(), maalrise_distribution_guard(), maalrise_receipt_guard();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
             AND relname ~ '^maalrise_(receipts|distributions|distribution_lines|payment_events|notifications|email_outbox)$')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
                ('maalrise_record_receipt', 'maalrise_confirm_receipt', 'maalrise_mark_line_paid', 'maalrise_can_pay', 'maalrise_today')) THEN
    RAISE EXCEPTION 'Rollback incomplete: 052 objects remain';
  END IF;
END $$;

COMMIT;
