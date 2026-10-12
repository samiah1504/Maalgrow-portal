#!/usr/bin/env bash
# Tests the DRAFT MaalRise migration against a SCRATCH database only.
# Never point PGHOST/PGPORT at staging or production.
#
#   1. Builds a scratch DB from the stub + migrations 001–050.
#   2. Fingerprints every existing object, applies the draft, and
#      proves no existing object changed.
#   3. Runs the MaalRise scenarios, the engine↔SQL contract test,
#      the unfiltered-write check, and every existing MaalGrow scenario
#      with the draft applied.
#
# Usage: PGHOST=... PGPORT=... PGUSER=... supabase/drafts/run_maalrise_draft_tests.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=maalrise_draft_test
FP=$(mktemp -d)
trap 'rm -rf "$FP"' EXIT

fingerprint() {
  psql -d "$DB" -At -F'|' -v ON_ERROR_STOP=1 <<'SQL'
SELECT 'column', table_schema||'.'||table_name||'.'||column_name, md5(data_type||coalesce(column_default,'')||is_nullable)
  FROM information_schema.columns WHERE table_schema IN ('public','auth') AND table_name NOT LIKE 'maalrise%'
UNION ALL SELECT 'constraint', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid))
  FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text NOT LIKE 'maalrise%'
UNION ALL SELECT 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
  FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid WHERE c.relnamespace = 'public'::regnamespace AND c.relname NOT LIKE 'maalrise%'
UNION ALL SELECT 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
  FROM pg_policies WHERE schemaname = 'public' AND tablename NOT LIKE 'maalrise%'
UNION ALL SELECT 'trigger', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid))
  FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'maalrise%'
UNION ALL SELECT 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
  FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'auth'::regnamespace)
   AND p.proname NOT LIKE 'maalrise%' AND p.proname <> 'get_my_maalrise_investor_id' AND p.prokind = 'f'
UNION ALL SELECT 'rls', relname, relrowsecurity::text FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname NOT LIKE 'maalrise%'
UNION ALL SELECT 'grant', table_name||':'||grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
  FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name NOT LIKE 'maalrise%' GROUP BY table_name, grantee
UNION ALL SELECT 'type', t.typname, md5(coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) FROM pg_enum WHERE enumtypid = t.oid), ''))
  FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e'
ORDER BY 1, 2;
SQL
}

dropdb --if-exists "$DB"
createdb "$DB"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/000_supabase_stub.sql
for f in supabase/migrations/0*.sql; do psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null; done
echo "migrations 001–050 applied"

fingerprint > "$FP/before"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/drafts/051_maalrise_core.sql
fingerprint > "$FP/after"
diff "$FP/before" "$FP/after"
echo "PASS: all $(wc -l < "$FP/before") existing objects unchanged by the draft"

psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/drafts/tests/maalrise_core_scenarios.sql 2>&1 | grep -E "PASS|FAIL"
npx tsx scripts/test-maalrise-sql-contract.ts "$DB"
npx tsx scripts/check-unfiltered-writes.ts "$DB"

psql -d postgres -qc "ALTER DATABASE $DB WITH is_template true"
for t in supabase/tests/*_scenarios.sql; do
  n=$(basename "$t" .sql)
  dropdb --if-exists "mrd_$n"; createdb -T "$DB" "mrd_$n"
  psql -d "mrd_$n" -v ON_ERROR_STOP=1 -q -f "$t" >/dev/null 2>&1 || { echo "FAIL: MaalGrow $n with the draft applied"; exit 1; }
  dropdb "mrd_$n"
done
psql -d postgres -qc "ALTER DATABASE $DB WITH is_template false"
echo "PASS: every existing MaalGrow scenario passes with the draft applied"
