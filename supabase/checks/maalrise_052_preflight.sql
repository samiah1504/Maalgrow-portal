-- ============================================================
-- MaalRise 052 — PREFLIGHT. Run BEFORE applying the migration.
--
-- READ ONLY: only SELECTs from the catalog. Nothing is written.
--
-- 052 may be applied only if Query 1 ends with ready_to_apply = true.
-- Keep the fingerprint from Query 2: maalrise_052_postapply.sql must
-- print the SAME value, proving no existing object — MaalGrow or
-- MaalRise 051 — was changed.
-- ============================================================

-- Query 1 — is this database what 052 expects?
WITH fn AS (
  SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
  FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
),
checks(check_name, ok) AS (VALUES
  ('MaalRise 051 tables are all present',
     (SELECT COUNT(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname IN
       ('maalrise_counterparties', 'maalrise_investors', 'maalrise_kyc_submissions', 'maalrise_bank_details_history',
        'maalrise_cycles', 'maalrise_cycle_terms', 'maalrise_schedule_lines', 'maalrise_investor_fundings',
        'maalrise_allocations', 'maalrise_documents')) = 10),
  ('051 role helpers exist (caller_role, can_approve, can_finance)',
     (SELECT COUNT(*) FROM fn WHERE proname IN ('maalrise_caller_role', 'maalrise_can_approve', 'maalrise_can_finance')) = 3),
  ('get_my_maalrise_investor_id() exists', EXISTS (SELECT 1 FROM fn WHERE proname = 'get_my_maalrise_investor_id')),
  ('is_admin() exists and excludes payment_officer',
     EXISTS (SELECT 1 FROM fn WHERE proname = 'is_admin') AND NOT EXISTS (SELECT 1 FROM fn WHERE proname = 'is_admin' AND prosrc LIKE '%payment_officer%')),
  ('create_audit_log(...) exists', EXISTS (SELECT 1 FROM fn WHERE proname = 'create_audit_log')),
  ('profiles has email and role', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name = 'profiles' AND column_name IN ('email', 'role')) = 2),
  ('Time zone Africa/Lagos is known', EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = 'Africa/Lagos')),
  ('No 052 table exists yet', NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
     AND relname ~ '^maalrise_(receipts|distributions|distribution_lines|payment_events|notifications|email_outbox)$')),
  ('No 052 function exists yet', NOT EXISTS (SELECT 1 FROM fn WHERE proname IN ('maalrise_record_receipt',
     'maalrise_confirm_receipt', 'maalrise_approve_distribution', 'maalrise_mark_line_paid', 'maalrise_can_pay'))),
  ('Storage is available for the documents bucket', to_regclass('storage.buckets') IS NOT NULL)
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> ready_to_apply', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — fingerprint of every existing object. Record it.
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  WITH new_tables AS (SELECT '^maalrise_(receipts|distributions|distribution_lines|payment_events|notifications|email_outbox)$' AS re),
  new_fns(n) AS (VALUES ('maalrise_can_pay'), ('maalrise_today'), ('maalrise_notify_roles'), ('maalrise_notify_investor'),
    ('maalrise_naira'), ('maalrise_sync_reminders'), ('maalrise_my_notifications'), ('maalrise_mark_notifications_read'),
    ('maalrise_record_receipt'), ('maalrise_reject_receipt'), ('maalrise_build_distribution_lines'),
    ('maalrise_confirm_receipt'), ('maalrise_refresh_distribution'), ('maalrise_approve_distribution'),
    ('maalrise_mark_line_paid'), ('maalrise_reverse_line_payment'), ('maalrise_payment_events_append_only'),
    ('maalrise_lines_guard'), ('maalrise_distribution_guard'), ('maalrise_receipt_guard'))
  SELECT 'column' AS kind, table_schema||'.'||table_name||'.'||column_name AS name,
         md5(data_type||coalesce(column_default,'')||is_nullable) AS def
    FROM information_schema.columns WHERE table_schema IN ('public','auth') AND table_name !~ (SELECT re FROM new_tables)
  UNION ALL SELECT 'constraint', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid))
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text !~ (SELECT re FROM new_tables)
  UNION ALL SELECT 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname !~ (SELECT re FROM new_tables)
  UNION ALL SELECT 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
    FROM pg_policies WHERE schemaname = 'public' AND tablename !~ (SELECT re FROM new_tables)
  UNION ALL SELECT 'trigger', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid))
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text !~ (SELECT re FROM new_tables)
  UNION ALL SELECT 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
    FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'auth'::regnamespace)
     AND p.proname NOT IN (SELECT n FROM new_fns) AND p.prokind = 'f'
  UNION ALL SELECT 'rls', relname, relrowsecurity::text
    FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname !~ (SELECT re FROM new_tables)
  UNION ALL SELECT 'grant', table_name||':'||grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
    FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name !~ (SELECT re FROM new_tables)
    GROUP BY table_name, grantee
  UNION ALL SELECT 'type', t.typname, md5(coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
                                                     FROM pg_enum WHERE enumtypid = t.oid), ''))
    FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e'
) objects;
