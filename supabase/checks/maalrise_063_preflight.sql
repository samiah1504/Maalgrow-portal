-- ============================================================
-- MaalRise 063 — PREFLIGHT. READ ONLY. Run BEFORE applying.
-- Run Query 1 and Query 2 SEPARATELY (the SQL Editor shows only the
-- last result). Query 1 must end ready_to_apply = true; keep Query 2's
-- fingerprint: maalrise_063_postapply.sql must print the same.
-- ============================================================

-- Query 1
WITH checks(check_name, ok) AS (VALUES
('MaalRise 062 is applied', to_regprocedure('public.maalrise_release_held_payments(uuid)') IS NOT NULL),
('063 not applied yet', to_regprocedure('public.maalrise_bank_from_maalgrow_edit(uuid,uuid)') IS NULL),
('No two MaalRise investors would end up with the same email', NOT EXISTS (SELECT 1 FROM maalrise_investors m
JOIN profiles p ON p.id = m.profile_id
WHERE p.email LIKE '%@%' AND m.email <> lower(trim(p.email))
AND EXISTS (SELECT 1 FROM maalrise_investors o WHERE o.id <> m.id AND o.email = lower(trim(p.email)))))
)
SELECT check_name, ok::TEXT AS ok FROM checks
UNION ALL SELECT 'MaalRise emails that will be corrected (info)', (SELECT COUNT(*) FROM maalrise_investors m
JOIN profiles p ON p.id = m.profile_id WHERE p.email LIKE '%@%' AND m.email <> lower(trim(p.email)))::TEXT
UNION ALL SELECT '>>> ready_to_apply', (NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok))::TEXT;

-- Query 2 — fingerprint of everything else. Record it.
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
