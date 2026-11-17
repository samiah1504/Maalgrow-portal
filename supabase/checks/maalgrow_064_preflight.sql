-- ============================================================
-- MaalGrow 064 — PREFLIGHT. READ ONLY. Run BEFORE applying.
-- Run Query 1, Query 2 and Query 3 SEPARATELY (the SQL Editor shows
-- only the last result). Query 1 must end ready_to_apply = true;
-- Query 2 lists the cycles that will become 6 months; keep Query 3's
-- fingerprint: maalgrow_064_postapply.sql must print the same.
-- ============================================================

-- Query 1
WITH checks(check_name, ok) AS (VALUES
('MaalRise 063 is applied', to_regprocedure('public.maalrise_bank_from_maalgrow_edit(uuid,uuid)') IS NOT NULL),
('064 not applied yet', NOT EXISTS (SELECT 1 FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'series' AND column_name = 'cycle_months')),
('The ledger holds 3 months, as 018 left it', EXISTS (SELECT 1 FROM pg_constraint
WHERE conname = 'mudarabah_months_month_index_check' AND pg_get_constraintdef(oid) LIKE '%<= 3%')),
('Rollover dates are as 049 left them', EXISTS (SELECT 1 FROM pg_proc
WHERE oid = to_regprocedure('public.create_next_cycle(uuid)') AND prosrc LIKE '%049: the series'' anchor day%'))
)
SELECT check_name, ok::TEXT AS ok FROM checks
UNION ALL SELECT 'Series that will be set to 6 months (info)', (SELECT COUNT(*) FROM series)::TEXT
UNION ALL SELECT 'Cycles not started yet that become 6 months (info)', (SELECT COUNT(*) FROM cycles c
WHERE c.status = 'upcoming' AND c.start_date > CURRENT_DATE
AND NOT EXISTS (SELECT 1 FROM cycles l WHERE l.series_id = c.series_id AND l.id <> c.id
AND l.status <> 'cancelled' AND l.start_date > c.start_date))::TEXT
UNION ALL SELECT '>>> ready_to_apply', (NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok))::TEXT;

-- Query 2 — the cycles that have not started yet (they become 6 months). Empty is fine.
SELECT c.cycle_label, c.start_date, c.end_date AS end_date_now,
(SELECT COUNT(*) FROM investments i WHERE i.cycle_id = c.id AND i.maturity_date = c.end_date) AS investments_whose_maturity_moves
FROM cycles c
WHERE c.status = 'upcoming' AND c.start_date > CURRENT_DATE
AND NOT EXISTS (SELECT 1 FROM cycles l WHERE l.series_id = c.series_id AND l.id <> c.id
AND l.status <> 'cancelled' AND l.start_date > c.start_date)
ORDER BY c.start_date;

-- Query 3 — fingerprint of everything else. Record it.
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
