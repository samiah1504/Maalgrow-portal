-- ============================================================
-- MaalRise 063 — POST-APPLY VERIFICATION. READ ONLY.
-- Run Query 1 and Query 2 SEPARATELY. Every row in Query 1 true;
-- Query 2 equal to the 063 preflight.
-- ============================================================

-- Query 1
WITH checks(check_name, ok) AS (VALUES
('Login email changes reach MaalRise', EXISTS (SELECT 1 FROM pg_trigger
WHERE tgname = 'maalrise_email_from_login' AND tgrelid = 'public.profiles'::regclass)),
('MaalGrow name and phone edits reach MaalRise', EXISTS (SELECT 1 FROM pg_trigger
WHERE tgname = 'maalrise_contact_from_maalgrow' AND tgrelid = 'public.investors'::regclass)),
('A MaalGrow edit can never be stopped by MaalRise', (SELECT COUNT(*) FROM pg_proc
WHERE proname IN ('maalrise_email_from_login_trg', 'maalrise_contact_from_maalgrow_trg') AND prosrc LIKE '%EXCEPTION WHEN OTHERS%') = 2),
('Every MaalRise email matches the login', NOT EXISTS (SELECT 1 FROM maalrise_investors m
JOIN profiles p ON p.id = m.profile_id WHERE p.email LIKE '%@%' AND m.email <> lower(trim(p.email)))),
('Only admins can move MaalRise bank details from the Edit page', EXISTS (SELECT 1 FROM pg_proc
WHERE oid = to_regprocedure('public.maalrise_bank_from_maalgrow_edit(uuid,uuid)') AND prosrc LIKE '%super_admin%administrator%')),
('Bank follower is not callable by the public', NOT has_function_privilege('public', 'maalrise_bank_from_maalgrow_edit(uuid,uuid)', 'EXECUTE'))
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the 063 preflight fingerprint exactly
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
COUNT(*) AS objects
FROM (
WITH touched AS (SELECT '^$' AS re),
fns(n) AS (VALUES ('maalrise_email_from_login_trg'), ('maalrise_contact_from_maalgrow_trg'), ('maalrise_bank_from_maalgrow_edit'))
SELECT 'column' AS kind, table_schema||'.'||table_name||'.'||column_name AS name,
md5(data_type||coalesce(column_default,'')||is_nullable) AS def
FROM information_schema.columns WHERE table_schema IN ('public','auth') AND table_name !~ (SELECT re FROM touched)
UNION ALL SELECT 'constraint', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid))
FROM pg_constraint WHERE connamespace = 'public'::regnamespace
UNION ALL SELECT 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
WHERE c.relnamespace = 'public'::regnamespace
UNION ALL SELECT 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'trigger', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid))
FROM pg_trigger WHERE NOT tgisinternal
AND tgname NOT IN ('maalrise_email_from_login', 'maalrise_contact_from_maalgrow')
UNION ALL SELECT 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'auth'::regnamespace)
AND p.proname NOT IN (SELECT n FROM fns) AND p.prokind = 'f'
UNION ALL SELECT 'rls', relname, relrowsecurity::text
FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
UNION ALL SELECT 'grant', table_name||':'||grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
FROM information_schema.role_table_grants WHERE table_schema = 'public'
GROUP BY table_name, grantee
UNION ALL SELECT 'type', t.typname, md5(coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
FROM pg_enum WHERE enumtypid = t.oid), ''))
FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e'
) objects;
