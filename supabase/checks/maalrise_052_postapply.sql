-- ============================================================
-- MaalRise 052 — POST-APPLY VERIFICATION. Run straight AFTER applying.
--
-- READ ONLY. Every row in Query 1 must be true, and Query 2 must print
-- the SAME fingerprint as maalrise_052_preflight.sql did.
-- ============================================================

-- Query 1 — the 052 objects are present and locked down
WITH t AS (
  SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
     AND relname ~ '^maalrise_(receipts|distributions|distribution_lines|payment_events|notifications|email_outbox)$'
),
expected_fns(n) AS (VALUES ('maalrise_can_pay'), ('maalrise_today'), ('maalrise_notify_roles'), ('maalrise_notify_investor'),
  ('maalrise_naira'), ('maalrise_sync_reminders'), ('maalrise_my_notifications'), ('maalrise_mark_notifications_read'),
  ('maalrise_record_receipt'), ('maalrise_reject_receipt'), ('maalrise_build_distribution_lines'),
  ('maalrise_confirm_receipt'), ('maalrise_refresh_distribution'), ('maalrise_approve_distribution'),
  ('maalrise_mark_line_paid'), ('maalrise_reverse_line_payment'), ('maalrise_payment_events_append_only'),
  ('maalrise_lines_guard'), ('maalrise_distribution_guard'), ('maalrise_receipt_guard')),
checks(check_name, ok) AS (VALUES
  ('All 6 new tables exist', (SELECT COUNT(*) FROM t) = 6),
  ('Row level security is ON for each', NOT EXISTS (SELECT 1 FROM t WHERE NOT relrowsecurity)),
  ('All 20 new functions exist', (SELECT COUNT(*) FROM expected_fns e
     WHERE EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = e.n)) = 20),
  ('Read policies only (no INSERT/UPDATE/DELETE policy on any MaalRise table)',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'maalrise%' AND cmd <> 'SELECT')),
  ('Guard triggers installed (4)', (SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
     ('maalrise_payment_events_append_only', 'maalrise_lines_guard', 'maalrise_distribution_guard', 'maalrise_receipt_guard')) = 4),
  ('Internal helpers are not callable by signed-in users',
     NOT has_function_privilege('authenticated', 'maalrise_build_distribution_lines(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'maalrise_notify_roles(text[],text,text,text,text,text,text)', 'EXECUTE')
     AND NOT has_function_privilege('authenticated', 'maalrise_sync_reminders()', 'EXECUTE')),
  ('Private documents bucket exists', EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'maalrise-documents' AND NOT public)),
  ('New tables are empty', (SELECT COUNT(*) FROM maalrise_receipts) + (SELECT COUNT(*) FROM maalrise_distributions)
     + (SELECT COUNT(*) FROM maalrise_notifications) + (SELECT COUNT(*) FROM maalrise_email_outbox) = 0)
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the 052 preflight fingerprint exactly
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
