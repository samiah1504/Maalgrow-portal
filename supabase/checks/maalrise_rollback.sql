-- ============================================================
-- MaalRise 051 — ROLLBACK. Removes exactly what 051 added.
--
-- WRITES. Run only if the migration must be undone. It touches no
-- MaalGrow object: every statement below names a maalrise_ object
-- (or get_my_maalrise_investor_id), and afterwards
-- maalrise_preflight.sql must show the original fingerprint again.
--
-- It REFUSES to run if any MaalRise table holds data. MaalRise records
-- are financial records; export them and decide deliberately before
-- deleting anything.
-- ============================================================
BEGIN;

DO $$
DECLARE r RECORD; v_n BIGINT;
BEGIN
  FOR r IN SELECT relname FROM pg_class
           WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname LIKE 'maalrise%' LOOP
    EXECUTE format('SELECT COUNT(*) FROM public.%I', r.relname) INTO v_n;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'Rollback refused: % holds % row(s). Export MaalRise data first.', r.relname, v_n;
    END IF;
  END LOOP;
END $$;

-- Functions first (policies depend on some of them), then tables.
DROP TABLE IF EXISTS
  maalrise_documents, maalrise_allocations, maalrise_investor_fundings, maalrise_schedule_lines,
  maalrise_kyc_submissions, maalrise_bank_details_history, maalrise_investors, maalrise_counterparties
  CASCADE;
ALTER TABLE IF EXISTS maalrise_cycles DROP CONSTRAINT IF EXISTS maalrise_cycles_approved_terms_fk;
DROP TABLE IF EXISTS maalrise_cycle_terms, maalrise_cycles CASCADE;

DROP FUNCTION IF EXISTS
  maalrise_create_counterparty(JSONB), maalrise_create_cycle(JSONB), maalrise_save_terms(UUID, JSONB, JSONB),
  maalrise_submit_terms(UUID), maalrise_return_terms(UUID, TEXT), maalrise_approve_terms(UUID),
  maalrise_add_investor(UUID, JSONB), maalrise_set_bank_details(UUID, TEXT, TEXT, TEXT),
  maalrise_confirm_bank_details(UUID), maalrise_review_kyc(UUID, TEXT, TEXT),
  maalrise_record_kyc_submission(UUID, JSONB),
  maalrise_record_funding(UUID, UUID, INTEGER, BIGINT, DATE, TEXT), maalrise_confirm_funding(UUID),
  maalrise_reject_funding(UUID, TEXT), maalrise_activation_checks(UUID), maalrise_activate_cycle(UUID),
  maalrise_register_document(JSONB), maalrise_cycle_visible_to_me(UUID), get_my_maalrise_investor_id(),
  maalrise_apply_bps(BIGINT, INTEGER), maalrise_terms_guard(), maalrise_schedule_guard(),
  maalrise_investor_not_staff(), maalrise_can_prepare(), maalrise_can_approve(), maalrise_can_finance(),
  maalrise_caller_role();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'maalrise%')
     OR EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
                AND (proname LIKE 'maalrise%' OR proname = 'get_my_maalrise_investor_id')) THEN
    RAISE EXCEPTION 'Rollback incomplete: MaalRise objects remain';
  END IF;
END $$;

COMMIT;
