-- ============================================================
-- MaalRise 058 — POST-APPLY VERIFICATION. READ ONLY.
-- Every row in Query 1 true; Query 2 equal to the 058 preflight.
-- ============================================================

-- Query 1
WITH checks(check_name, ok) AS (VALUES
  ('KYC and bank confirmation are warnings, not blockers', EXISTS (SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.maalrise_activation_checks(uuid)')
       AND prosrc LIKE '%''kyc_complete'', ''blocking'', FALSE%' AND prosrc LIKE '%''bank_confirmed'', ''blocking'', FALSE%')),
  ('Every other check still blocks', EXISTS (SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.maalrise_activation_checks(uuid)')
       AND prosrc LIKE '%''fully_funded'', ''blocking'', TRUE%' AND prosrc LIKE '%''contract_uploaded'', ''blocking'', TRUE%'
       AND prosrc LIKE '%''terms_approved'', ''blocking'', TRUE%')),
  ('Activation refuses on blocking checks only', EXISTS (SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.maalrise_activate_cycle(uuid)') AND prosrc LIKE '%(c->>''blocking'')::BOOLEAN%')),
  ('Payments still need confirmed bank details', EXISTS (SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.maalrise_approve_distribution(uuid)') AND prosrc LIKE '%bank_confirmed_at IS NULL%'))
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the 058 preflight fingerprint exactly
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  WITH touched AS (SELECT '^$' AS re),
  dropped(p) AS (VALUES ('-')),
  fns(n) AS (VALUES ('maalrise_activation_checks'), ('maalrise_activate_cycle'))
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
