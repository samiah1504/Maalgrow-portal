-- ============================================================
-- MaalRise 054 — POST-APPLY VERIFICATION. Run straight AFTER applying.
--
-- READ ONLY. Every row in Query 1 must be true, and Query 2 must print
-- the SAME fingerprint as maalrise_054_preflight.sql did.
-- ============================================================

-- Query 1 — the 054 objects are present and locked down
WITH new_fns(n) AS (VALUES ('maalrise_bank_change_guard'), ('maalrise_request_bank_change'), ('maalrise_cancel_bank_change'), ('maalrise_review_bank_change'), ('maalrise_investor_share'), ('maalrise_my_access'), ('maalrise_my_profile'), ('maalrise_my_cycle'), ('maalrise_my_cycles'), ('maalrise_my_payments')),
checks(check_name, ok) AS (VALUES
  ('Bank change request table exists', to_regclass('public.maalrise_bank_change_requests') IS NOT NULL),
  ('Row level security is ON for it', COALESCE((SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.maalrise_bank_change_requests')), FALSE)),
  ('All 10 new functions exist', (SELECT COUNT(*) FROM new_fns e WHERE EXISTS (SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace AND proname = e.n)) = 10),
  ('Investors no longer read Cycle terms, schedule, Cycle rows, own record or KYC directly',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND policyname IN
       ('Investor reads own MaalRise record', 'Investor reads own KYC submissions', 'Investor reads own visible cycles',
        'Investor reads approved terms of own cycles', 'Investor reads approved schedule of own cycles'))),
  ('Staff still read terms and schedule', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public'
     AND policyname IN ('Staff read terms', 'Staff read schedule', 'Staff read cycles', 'Staff read MaalRise investors')) = 4),
  ('Investors still read their own payments and allocations', (SELECT COUNT(*) FROM pg_policies WHERE schemaname = 'public'
     AND policyname IN ('Investor reads own approved payment lines', 'Investor reads own approved capital payments',
                        'Investor reads own allocations in visible cycles')) = 3),
  ('Read policies only (no INSERT/UPDATE/DELETE policy on any MaalRise table)',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'maalrise%' AND cmd <> 'SELECT')),
  ('Guard trigger installed', EXISTS (SELECT 1 FROM pg_trigger WHERE NOT tgisinternal AND tgname = 'maalrise_bank_change_guard')),
  ('Internal helper is not callable by signed-in users',
     NOT has_function_privilege('authenticated', 'maalrise_investor_share(uuid,uuid,bigint)', 'EXECUTE')),
  ('Bank change requests table is empty', (SELECT COUNT(*) FROM maalrise_bank_change_requests) = 0)
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the 054 preflight fingerprint exactly
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  WITH touched AS (SELECT '^maalrise_bank_change_requests$' AS re),
  dropped(p) AS (VALUES ('Investor reads own MaalRise record'), ('Investor reads own KYC submissions'), ('Investor reads own visible cycles'), ('Investor reads approved terms of own cycles'), ('Investor reads approved schedule of own cycles')),
  fns(n) AS (VALUES ('maalrise_bank_change_guard'), ('maalrise_request_bank_change'), ('maalrise_cancel_bank_change'), ('maalrise_review_bank_change'), ('maalrise_investor_share'), ('maalrise_my_access'), ('maalrise_my_profile'), ('maalrise_my_cycle'), ('maalrise_my_cycles'), ('maalrise_my_payments'))
  SELECT 'column' AS kind, table_schema||'.'||table_name||'.'||column_name AS name,
         md5(data_type||coalesce(column_default,'')||is_nullable) AS def
    FROM information_schema.columns WHERE table_schema IN ('public','auth') AND table_name !~ (SELECT re FROM touched)
  UNION ALL SELECT 'constraint', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid))
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text !~ (SELECT re FROM touched)
  UNION ALL SELECT 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname !~ (SELECT re FROM touched)
  UNION ALL SELECT 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
    FROM pg_policies WHERE schemaname = 'public' AND tablename !~ (SELECT re FROM touched)
     AND policyname NOT IN (SELECT p FROM dropped)
  UNION ALL SELECT 'trigger', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid))
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text !~ (SELECT re FROM touched)
  UNION ALL SELECT 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
    FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'auth'::regnamespace)
     AND p.proname NOT IN (SELECT n FROM fns) AND p.prokind = 'f'
  UNION ALL SELECT 'rls', relname, relrowsecurity::text
    FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname !~ (SELECT re FROM touched)
  UNION ALL SELECT 'grant', table_name||':'||grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
    FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name !~ (SELECT re FROM touched)
    GROUP BY table_name, grantee
  UNION ALL SELECT 'type', t.typname, md5(coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
                                                     FROM pg_enum WHERE enumtypid = t.oid), ''))
    FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e'
) objects;
