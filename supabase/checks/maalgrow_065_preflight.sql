-- ============================================================
-- MaalGrow 065 — PREFLIGHT. READ ONLY. Run BEFORE applying.
-- Run Query 1, Query 2 and Query 3 SEPARATELY. Query 1 must end
-- ready_to_apply = true; Query 2 lists exactly what will change; keep
-- Query 3's fingerprint: maalgrow_065_postapply.sql must print the same.
-- ============================================================

-- Query 1
WITH checks(check_name, ok) AS (VALUES
('MaalGrow 064 is applied', EXISTS (SELECT 1 FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'series' AND column_name = 'cycle_months')),
('065 not applied yet', NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'maalgrow_065_applied'))
)
SELECT check_name, ok::TEXT AS ok FROM checks
UNION ALL SELECT '>>> ready_to_apply', (NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok))::TEXT;

-- Query 2 — exactly what will change
SELECT 'Becomes ' || s.cycle_months || ' months' AS change, s.name AS series, c.cycle_label, c.start_date, c.end_date AS end_now,
maalgrow_cycle_end(c.start_date, s.cycle_months, GREATEST(EXTRACT(DAY FROM c.start_date)::INTEGER,
COALESCE((SELECT MAX(EXTRACT(DAY FROM o.start_date))::INTEGER FROM cycles o
WHERE o.series_id = c.series_id AND o.status <> 'cancelled' AND o.start_date <= c.start_date), 0))) AS end_after,
(SELECT COUNT(*) FROM investments i WHERE i.cycle_id = c.id AND i.maturity_date = c.end_date) AS investments
FROM cycles c JOIN series s ON s.id = c.series_id
WHERE c.status IN ('draft', 'upcoming', 'subscription_open', 'subscription_closed')
AND c.cycle_months < s.cycle_months
AND NOT EXISTS (SELECT 1 FROM cycles l WHERE l.series_id = c.series_id AND l.id <> c.id
AND l.status <> 'cancelled' AND l.start_date > c.start_date)
AND NOT EXISTS (SELECT 1 FROM mudarabah_months m JOIN mudarabah_ledgers g ON g.id = m.ledger_id WHERE g.cycle_id = c.id)
AND NOT EXISTS (SELECT 1 FROM cycle_profit_declarations d WHERE d.cycle_id = c.id)
UNION ALL
SELECT 'Rollover marked done (no more banner)', s.name, c.cycle_label, c.start_date, c.end_date, NULL, NULL
FROM cycles c JOIN series s ON s.id = c.series_id
WHERE c.status = 'completed' AND c.rollover_processed_at IS NULL
AND EXISTS (SELECT 1 FROM cycle_profit_declarations d WHERE d.cycle_id = c.id)
AND NOT EXISTS (SELECT 1 FROM investments i WHERE i.cycle_id = c.id AND i.status = 'matured' AND i.next_investment_id IS NULL
AND NOT EXISTS (SELECT 1 FROM cycle_rollovers x WHERE x.previous_investment_id = i.id AND x.status IN ('completed', 'withdrawn')))
ORDER BY 1, 2, 4;

-- Query 3 — fingerprint of everything else. Record it.
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
COUNT(*) AS objects
FROM (
SELECT 'column' AS kind, table_schema||'.'||table_name||'.'||column_name AS name,
md5(data_type||coalesce(column_default,'')||is_nullable) AS def
FROM information_schema.columns WHERE table_schema IN ('public','auth')
UNION ALL SELECT 'constraint', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid))
FROM pg_constraint WHERE connamespace = 'public'::regnamespace
UNION ALL SELECT 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
WHERE c.relnamespace = 'public'::regnamespace
UNION ALL SELECT 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
FROM pg_policies WHERE schemaname = 'public'
UNION ALL SELECT 'trigger', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid))
FROM pg_trigger WHERE NOT tgisinternal
UNION ALL SELECT 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'auth'::regnamespace) AND p.prokind = 'f'
UNION ALL SELECT 'rls', relname, relrowsecurity::text
FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
UNION ALL SELECT 'grant', table_name||':'||grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
FROM information_schema.role_table_grants WHERE table_schema = 'public'
GROUP BY table_name, grantee
UNION ALL SELECT 'type', t.typname, md5(coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
FROM pg_enum WHERE enumtypid = t.oid), ''))
FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e'
) objects;
