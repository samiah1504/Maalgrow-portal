-- ============================================================
-- MaalGrow 064 — POST-APPLY VERIFICATION. READ ONLY.
-- Run Query 1 and Query 2 SEPARATELY. Every row in Query 1 true;
-- Query 2 equal to the 064 preflight's Query 3.
-- ============================================================

-- Query 1
WITH checks(check_name, ok) AS (VALUES
('Every series runs 6-month cycles', NOT EXISTS (SELECT 1 FROM series WHERE cycle_months <> 6)),
('Every cycle records its length', NOT EXISTS (SELECT 1 FROM cycles WHERE cycle_months IS NULL)),
('Only cycles not started yet were lengthened', NOT EXISTS (SELECT 1 FROM audit_logs a JOIN cycles c ON c.id::TEXT = a.entity_id
WHERE a.action = 'cycle_lengthened_to_series_length' AND (c.status <> 'upcoming' OR c.start_date <= (a.created_at AT TIME ZONE 'Africa/Lagos')::DATE))),
('Investments in a lengthened cycle mature with it', NOT EXISTS (SELECT 1 FROM audit_logs a JOIN investments i ON i.cycle_id::TEXT = a.entity_id
WHERE a.action = 'cycle_lengthened_to_series_length' AND i.maturity_date = (a.old_values->>'end_date')::DATE)),
('The rollover uses the series length', EXISTS (SELECT 1 FROM pg_proc
WHERE oid = to_regprocedure('public.create_next_cycle(uuid)') AND prosrc LIKE '%v_series.cycle_months%')),
('The ledger holds as many months as its cycle', EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'mudarabah_month_within_cycle')
AND EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'mudarabah_months_month_index_check' AND pg_get_constraintdef(oid) LIKE '%<= 12%')),
('The ledger page is told the cycle length', EXISTS (SELECT 1 FROM pg_proc
WHERE oid = to_regprocedure('public.mudarabah_get_ledger(uuid)') AND prosrc LIKE '%cycleMonths%'))
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the 064 preflight's Query 3 exactly
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
COUNT(*) AS objects
FROM (
WITH fns(n) AS (VALUES ('create_next_cycle'), ('mudarabah_get_ledger'), ('maalgrow_cycle_end'),
('maalgrow_cycle_months_default_trg'), ('mudarabah_month_within_cycle_trg'))
SELECT 'column' AS kind, table_schema||'.'||table_name||'.'||column_name AS name,
md5(data_type||coalesce(column_default,'')||is_nullable) AS def
FROM information_schema.columns WHERE table_schema IN ('public','auth')
AND NOT (table_schema = 'public' AND table_name IN ('series', 'cycles') AND column_name = 'cycle_months')
UNION ALL SELECT 'constraint', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid))
FROM pg_constraint WHERE connamespace = 'public'::regnamespace
AND conname NOT IN ('series_cycle_months_check', 'cycles_cycle_months_check', 'mudarabah_months_month_index_check')
UNION ALL SELECT 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
WHERE c.relnamespace = 'public'::regnamespace
UNION ALL SELECT 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'trigger', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid))
FROM pg_trigger WHERE NOT tgisinternal
AND tgname NOT IN ('maalgrow_cycle_months_default', 'mudarabah_month_within_cycle')
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
