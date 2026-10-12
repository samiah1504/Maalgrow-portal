-- ============================================================
-- MaalRise 051 — POST-APPLY VERIFICATION. Run straight AFTER applying.
--
-- READ ONLY. Every row must be true, and the fingerprint in Query 2
-- must equal the one maalrise_preflight.sql printed before applying —
-- that is the proof that no existing MaalGrow object changed.
-- ============================================================

-- Query 1 — the MaalRise objects are all present and locked down
WITH t AS (
  SELECT c.relname, c.relrowsecurity FROM pg_class c
  WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r' AND c.relname LIKE 'maalrise%'
),
expected_tables(n) AS (VALUES ('maalrise_counterparties'), ('maalrise_investors'), ('maalrise_kyc_submissions'),
  ('maalrise_bank_details_history'), ('maalrise_cycles'), ('maalrise_cycle_terms'), ('maalrise_schedule_lines'),
  ('maalrise_investor_fundings'), ('maalrise_allocations'), ('maalrise_documents')),
expected_fns(n) AS (VALUES ('maalrise_caller_role'), ('maalrise_can_prepare'), ('maalrise_can_approve'),
  ('maalrise_can_finance'), ('get_my_maalrise_investor_id'), ('maalrise_cycle_visible_to_me'), ('maalrise_apply_bps'),
  ('maalrise_create_counterparty'), ('maalrise_create_cycle'), ('maalrise_save_terms'), ('maalrise_submit_terms'),
  ('maalrise_return_terms'), ('maalrise_approve_terms'), ('maalrise_add_investor'), ('maalrise_set_bank_details'),
  ('maalrise_confirm_bank_details'), ('maalrise_review_kyc'), ('maalrise_record_kyc_submission'),
  ('maalrise_record_funding'), ('maalrise_confirm_funding'), ('maalrise_reject_funding'),
  ('maalrise_activation_checks'), ('maalrise_activate_cycle'), ('maalrise_register_document'),
  ('maalrise_terms_guard'), ('maalrise_schedule_guard'), ('maalrise_investor_not_staff')),
checks(check_name, ok) AS (VALUES
  ('All 10 MaalRise tables exist', (SELECT COUNT(*) FROM expected_tables e JOIN t ON t.relname = e.n) = 10),
  ('No unexpected MaalRise tables', (SELECT COUNT(*) FROM t) = 10),
  ('Row level security is ON for every MaalRise table', NOT EXISTS (SELECT 1 FROM t WHERE NOT relrowsecurity)),
  ('All 27 MaalRise functions exist',
     (SELECT COUNT(*) FROM expected_fns e WHERE EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = e.n)) = 27),
  ('MaalRise tables have read policies only (no INSERT/UPDATE/DELETE policy)',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'maalrise%' AND cmd <> 'SELECT')),
  ('Every MaalRise table has a staff read policy',
     (SELECT COUNT(DISTINCT tablename) FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'maalrise%' AND qual LIKE '%is_admin()%') = 10),
  ('Freeze and staff-guard triggers are installed',
     (SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('maalrise_terms_guard', 'maalrise_schedule_guard', 'maalrise_investor_not_staff')) = 3),
  ('MaalRise tables are empty (nothing was created as a side effect)',
     (SELECT COUNT(*) FROM maalrise_cycles) + (SELECT COUNT(*) FROM maalrise_investors) + (SELECT COUNT(*) FROM maalrise_counterparties) = 0)
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the preflight fingerprint exactly
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS maalgrow_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  SELECT 'column' AS kind, table_schema||'.'||table_name||'.'||column_name AS name,
         md5(data_type||coalesce(column_default,'')||is_nullable) AS def
    FROM information_schema.columns WHERE table_schema IN ('public','auth') AND table_name NOT LIKE 'maalrise%'
  UNION ALL SELECT 'constraint', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid))
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text NOT LIKE 'maalrise%'
  UNION ALL SELECT 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname NOT LIKE 'maalrise%'
  UNION ALL SELECT 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
    FROM pg_policies WHERE schemaname = 'public' AND tablename NOT LIKE 'maalrise%'
  UNION ALL SELECT 'trigger', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid))
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'maalrise%'
  UNION ALL SELECT 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
    FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'auth'::regnamespace)
     AND p.proname NOT LIKE 'maalrise%' AND p.proname <> 'get_my_maalrise_investor_id' AND p.prokind = 'f'
  UNION ALL SELECT 'rls', relname, relrowsecurity::text
    FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname NOT LIKE 'maalrise%'
  UNION ALL SELECT 'grant', table_name||':'||grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
    FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name NOT LIKE 'maalrise%'
    GROUP BY table_name, grantee
  UNION ALL SELECT 'type', t.typname, md5(coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
                                                     FROM pg_enum WHERE enumtypid = t.oid), ''))
    FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e'
) objects;
