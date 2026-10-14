-- ============================================================
-- MaalRise 056 — POST-APPLY VERIFICATION. READ ONLY.
-- Every row in Query 1 true; Query 2 equal to the 056 preflight.
-- ============================================================

-- Query 1
WITH checks(check_name, ok) AS (VALUES
  ('Super admin self-approval of terms needs a reason', EXISTS (SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.maalrise_approve_terms(uuid,text)') AND prosrc LIKE '%super_admin%' AND prosrc LIKE '%give a reason%')),
  ('Super admin self-confirmation of funding needs a reason', EXISTS (SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.maalrise_confirm_funding(uuid,text)') AND prosrc LIKE '%super_admin%' AND prosrc LIKE '%give a reason%')),
  ('Old one-argument versions are gone', to_regprocedure('public.maalrise_approve_terms(uuid)') IS NULL
     AND to_regprocedure('public.maalrise_confirm_funding(uuid)') IS NULL),
  ('Terms rule allows only a recorded self-approval', EXISTS (SELECT 1 FROM pg_constraint
     WHERE conname = 'maalrise_terms_separate_approver' AND pg_get_constraintdef(oid) LIKE '%self_approval_reason IS NOT NULL%')),
  ('Reason columns added', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND column_name IN ('self_approval_reason', 'self_confirm_reason')) = 2),
  ('No self-approval recorded yet', NOT EXISTS (SELECT 1 FROM maalrise_cycle_terms WHERE self_approval_reason IS NOT NULL))
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the 056 preflight fingerprint exactly
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  WITH touched AS (SELECT '^maalrise_(cycle_terms|investor_fundings)$' AS re),
  dropped(p) AS (VALUES ('-')),
  fns(n) AS (VALUES ('maalrise_approve_terms'), ('maalrise_confirm_funding'))
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
