#!/usr/bin/env bash
# Rehearses the MaalRise 051 migration end to end on a SCRATCH database,
# using the same check scripts that are run on the real database.
# Never point PGHOST/PGPORT at staging or production.
#
#   1. scratch DB from the stub + migrations 001–050
#   2. preflight         → ready_to_apply must be true; record fingerprint
#   3. apply 051         → post-apply checks all true; fingerprint unchanged
#   4. rollback          → preflight ready again; fingerprint unchanged;
#                          rollback refuses while MaalRise holds data
#   5. re-apply 051, then the same for 052 (Phase 4): preflight,
#      apply, post-apply, rollback, re-apply — fingerprints unchanged
#   6. MaalRise scenarios (051 and 052), engine↔SQL contract,
#      unfiltered-write check, and every existing MaalGrow scenario
#
# Usage: PGHOST=... PGPORT=... PGUSER=... supabase/tests/run_maalrise_tests.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=maalrise_rehearsal
q() { psql -d "$DB" -v ON_ERROR_STOP=1 -At -F'|' "$@"; }

fingerprint_of() { # prints the fingerprint line from a check script's output
  q -f "$1" | grep -E '^[0-9a-f]{32}\|[0-9]+$'
}
summary_of() {     # prints the value of a '>>>' summary row
  q -f "$1" | grep -F ">>> $2" | cut -d'|' -f2
}

# 0. The six SQL Editor parts must be byte-for-byte the migration body
PARTS=supabase/checks/051_parts
for i in 1 2 3 4 5 6; do
  awk '/^-- >>> 051 BODY START/{f=1;next} /^-- <<< 051 BODY END/{f=0} f' "$PARTS/051_part_${i}_of_6.sql"
done | cmp -s - <(awk '/^BEGIN;$/{f=1;next} /^COMMIT;$/{f=0} f' supabase/migrations/051_maalrise_core.sql | sed '1d') \
  || { echo "FAIL: 051 parts differ from the migration"; exit 1; }
echo "PASS: 051 parts 1–6 are identical to the migration body"
PARTS=supabase/checks/052_parts
for i in 1 2 3; do
  awk '/^-- >>> 052 BODY START/{f=1;next} /^-- <<< 052 BODY END/{f=0} f' "$PARTS/052_part_${i}_of_3.sql"
done | cmp -s - <(awk '/^BEGIN;$/{f=1;next} /^COMMIT;$/{f=0} f' supabase/migrations/052_maalrise_distributions.sql) \
  || { echo "FAIL: 052 parts differ from the migration"; exit 1; }
echo "PASS: 052 parts 1–3 are identical to the migration body"
PARTS=supabase/checks/053_parts
for i in 1 2 3; do
  awk '/^-- >>> 053 BODY START/{f=1;next} /^-- <<< 053 BODY END/{f=0} f' "$PARTS/053_part_${i}_of_3.sql"
done | cmp -s - <(awk '/^BEGIN;$/{f=1;next} /^COMMIT;$/{f=0} f' supabase/migrations/053_maalrise_capital_settlement.sql) \
  || { echo "FAIL: 053 parts differ from the migration"; exit 1; }
echo "PASS: 053 parts 1–3 are identical to the migration body"

dropdb --if-exists "$DB"
createdb "$DB"
q -q -f supabase/tests/000_supabase_stub.sql
# As on Supabase: API roles that receive EXECUTE on every new function
# (so "REVOKE ... FROM PUBLIC" alone would not lock a helper away), and
# a storage schema with a buckets table.
q -q <<'SQL'
DO $$ BEGIN CREATE ROLE anon NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE TABLE IF NOT EXISTS storage.buckets (id TEXT PRIMARY KEY, name TEXT, public BOOLEAN);
SQL
for f in supabase/migrations/0*.sql; do
  [[ "$f" == *051_maalrise_core.sql || "$f" == *052_maalrise_distributions.sql || "$f" == *053_maalrise_capital_settlement.sql ]] && continue
  q -q -f "$f" >/dev/null
done
echo "scratch database: stub + migrations 001–050"

# 2. preflight
[ "$(summary_of supabase/checks/maalrise_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: preflight not ready"; q -f supabase/checks/maalrise_preflight.sql; exit 1; }
FP0=$(fingerprint_of supabase/checks/maalrise_preflight.sql)
echo "PASS: preflight ready_to_apply; fingerprint ${FP0}"

# 3. apply + post-apply
q -q -f supabase/migrations/051_maalrise_core.sql
[ "$(summary_of supabase/checks/maalrise_postapply.sql all_ok)" = "t" ] || { echo "FAIL: post-apply checks"; q -f supabase/checks/maalrise_postapply.sql; exit 1; }
FP1=$(fingerprint_of supabase/checks/maalrise_postapply.sql)
[ "$FP0" = "$FP1" ] || { echo "FAIL: an existing object changed ($FP0 → $FP1)"; exit 1; }
echo "PASS: post-apply checks all true; existing-object fingerprint unchanged"
[ "$(summary_of supabase/checks/maalrise_preflight.sql ready_to_apply)" = "f" ] || { echo "FAIL: preflight should refuse a second apply"; exit 1; }
echo "PASS: preflight refuses to green-light a database that already has MaalRise"

# 4. rollback — refused while data exists, clean when empty
q -q -c "INSERT INTO maalrise_counterparties (name) VALUES ('Rollback guard probe')"
if q -q -f supabase/checks/maalrise_rollback.sql >/dev/null 2>&1; then echo "FAIL: rollback ran with data present"; exit 1; fi
q -q -c "DELETE FROM maalrise_counterparties WHERE name = 'Rollback guard probe'"
echo "PASS: rollback refuses while any MaalRise table holds data"
q -q -f supabase/checks/maalrise_rollback.sql
[ "$(summary_of supabase/checks/maalrise_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: preflight not ready after rollback"; exit 1; }
FP2=$(fingerprint_of supabase/checks/maalrise_preflight.sql)
[ "$FP0" = "$FP2" ] || { echo "FAIL: rollback left the schema different"; exit 1; }
echo "PASS: rollback removes MaalRise completely; schema back to the original fingerprint"

# 5. re-apply 051, then rehearse 052 the same way
q -q -f supabase/migrations/051_maalrise_core.sql
echo "re-applied 051"
[ "$(summary_of supabase/checks/maalrise_052_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 052 preflight not ready"; q -f supabase/checks/maalrise_052_preflight.sql; exit 1; }
G0=$(fingerprint_of supabase/checks/maalrise_052_preflight.sql)
echo "PASS: 052 preflight ready_to_apply; fingerprint ${G0}"
q -q -f supabase/migrations/052_maalrise_distributions.sql
[ "$(summary_of supabase/checks/maalrise_052_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 052 post-apply checks"; q -f supabase/checks/maalrise_052_postapply.sql; exit 1; }
G1=$(fingerprint_of supabase/checks/maalrise_052_postapply.sql)
[ "$G0" = "$G1" ] || { echo "FAIL: 052 changed an existing object ($G0 → $G1)"; exit 1; }
echo "PASS: 052 post-apply checks all true; MaalGrow + 051 fingerprint unchanged"
[ "$(summary_of supabase/checks/maalrise_052_preflight.sql ready_to_apply)" = "f" ] || { echo "FAIL: 052 preflight should refuse a second apply"; exit 1; }
if q -q -f supabase/migrations/052_maalrise_distributions.sql >/dev/null 2>&1; then echo "FAIL: 052 applied twice"; exit 1; fi
echo "PASS: 052 cannot be applied twice"
q -q -f supabase/checks/maalrise_052_rollback.sql
G2=$(fingerprint_of supabase/checks/maalrise_052_preflight.sql)
[ "$G0" = "$G2" ] || { echo "FAIL: 052 rollback left the schema different"; exit 1; }
echo "PASS: 052 rollback removes exactly 052; fingerprint back to the original"
# Re-apply through the three SQL Editor parts, exactly as they will be run
P52=supabase/checks/052_parts
if q -q -f $P52/052_part_2_of_3.sql >/dev/null 2>&1; then echo "FAIL: part 2 ran before part 1"; exit 1; fi
q -q -f $P52/052_part_1_of_3.sql >/dev/null
if q -q -f $P52/052_part_1_of_3.sql >/dev/null 2>&1; then echo "FAIL: part 1 ran twice"; exit 1; fi
if q -q -f $P52/052_part_3_of_3.sql >/dev/null 2>&1; then echo "FAIL: part 3 ran before part 2"; exit 1; fi
q -q -f $P52/052_part_2_of_3.sql >/dev/null
q -q -f $P52/052_part_3_of_3.sql >/dev/null
[ "$(summary_of supabase/checks/maalrise_052_postapply.sql all_ok)" = "t" ] || { echo "FAIL: post-apply after parts"; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_052_postapply.sql)" = "$G0" ] || { echo "FAIL: parts changed an existing object"; exit 1; }
echo "PASS: 052 applied in parts 1–3; out-of-order and repeat runs refused; post-apply true; fingerprint unchanged"

# 053 (Phase 5), rehearsed the same way
[ "$(summary_of supabase/checks/maalrise_053_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 053 preflight not ready"; q -f supabase/checks/maalrise_053_preflight.sql; exit 1; }
H0=$(fingerprint_of supabase/checks/maalrise_053_preflight.sql)
echo "PASS: 053 preflight ready_to_apply; fingerprint ${H0}"
# What 053 replaces or alters, so the rollback can be proved to restore it exactly.
touched53() {
  q -c "SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
          SELECT pg_get_functiondef(oid) AS x FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
            ('maalrise_record_receipt','maalrise_receipt_guard','maalrise_sync_reminders','maalrise_approve_distribution','maalrise_reverse_line_payment')
          UNION ALL SELECT column_name || data_type || is_nullable || coalesce(column_default, '') FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'maalrise_receipts'
          UNION ALL SELECT conname || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.maalrise_receipts'::regclass
          UNION ALL SELECT pg_get_indexdef(indexrelid) FROM pg_index WHERE indrelid = 'public.maalrise_receipts'::regclass) s"
}
T0=$(touched53)
q -q -f supabase/migrations/053_maalrise_capital_settlement.sql
[ "$(summary_of supabase/checks/maalrise_053_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 053 post-apply checks"; q -f supabase/checks/maalrise_053_postapply.sql; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_053_postapply.sql)" = "$H0" ] || { echo "FAIL: 053 changed an object it should not touch"; exit 1; }
echo "PASS: 053 post-apply checks all true; fingerprint of everything else unchanged"
[ "$(summary_of supabase/checks/maalrise_053_preflight.sql ready_to_apply)" = "f" ] || { echo "FAIL: 053 preflight should refuse a second apply"; exit 1; }
if q -q -f supabase/migrations/053_maalrise_capital_settlement.sql >/dev/null 2>&1; then echo "FAIL: 053 applied twice"; exit 1; fi
q -q -f supabase/checks/maalrise_053_rollback.sql
[ "$(fingerprint_of supabase/checks/maalrise_053_preflight.sql)" = "$H0" ] || { echo "FAIL: 053 rollback left the schema different"; exit 1; }
[ "$(summary_of supabase/checks/maalrise_053_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 053 preflight not ready after rollback"; exit 1; }
[ "$(touched53)" = "$T0" ] || { echo "FAIL: 053 rollback did not restore the replaced 052 functions and table exactly"; exit 1; }
echo "PASS: 053 cannot be applied twice; rollback restores the five 052 functions and maalrise_receipts exactly"
P53=supabase/checks/053_parts
if q -q -f $P53/053_part_2_of_3.sql >/dev/null 2>&1; then echo "FAIL: 053 part 2 ran before part 1"; exit 1; fi
q -q -f $P53/053_part_1_of_3.sql >/dev/null
if q -q -f $P53/053_part_1_of_3.sql >/dev/null 2>&1; then echo "FAIL: 053 part 1 ran twice"; exit 1; fi
if q -q -f $P53/053_part_3_of_3.sql >/dev/null 2>&1; then echo "FAIL: 053 part 3 ran before part 2"; exit 1; fi
q -q -f $P53/053_part_2_of_3.sql >/dev/null
q -q -f $P53/053_part_3_of_3.sql >/dev/null
[ "$(summary_of supabase/checks/maalrise_053_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 053 post-apply after parts"; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_053_postapply.sql)" = "$H0" ] || { echo "FAIL: 053 parts changed an object they should not touch"; exit 1; }
echo "PASS: 053 applied in parts 1–3; out-of-order and repeat runs refused; post-apply true; fingerprint unchanged"

# 6. scenarios
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_core_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_distribution_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*|ERROR:.*"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_capital_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*|ERROR:.*"
npx tsx scripts/test-maalrise-sql-contract.ts "$DB" | grep -E "PASS|FAIL"
npx tsx scripts/check-unfiltered-writes.ts "$DB"

psql -d postgres -qc "ALTER DATABASE $DB WITH is_template true"
n=0
for t in supabase/tests/*_scenarios.sql; do
  [[ "$t" == *maalrise* ]] && continue
  s=$(basename "$t" .sql)
  dropdb --if-exists "mr_$s"; createdb -T "$DB" "mr_$s"
  psql -d "mr_$s" -v ON_ERROR_STOP=1 -q -f "$t" >/dev/null 2>&1 || { echo "FAIL: MaalGrow $s with 051, 052 and 053 applied"; exit 1; }
  dropdb "mr_$s"; n=$((n + 1))
done
psql -d postgres -qc "ALTER DATABASE $DB WITH is_template false"
echo "PASS: all $n existing MaalGrow scenarios pass with 051, 052 and 053 applied"
