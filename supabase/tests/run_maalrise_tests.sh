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
#   5. re-apply 051, then: MaalRise scenarios, engine↔SQL contract,
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

dropdb --if-exists "$DB"
createdb "$DB"
q -q -f supabase/tests/000_supabase_stub.sql
for f in supabase/migrations/0*.sql; do
  [[ "$f" == *051_maalrise_core.sql ]] && continue
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

# 5. re-apply and test
q -q -f supabase/migrations/051_maalrise_core.sql
echo "re-applied 051"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_core_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*"
npx tsx scripts/test-maalrise-sql-contract.ts "$DB" | grep -E "PASS|FAIL"
npx tsx scripts/check-unfiltered-writes.ts "$DB"

psql -d postgres -qc "ALTER DATABASE $DB WITH is_template true"
n=0
for t in supabase/tests/*_scenarios.sql; do
  [[ "$t" == *maalrise* ]] && continue
  s=$(basename "$t" .sql)
  dropdb --if-exists "mr_$s"; createdb -T "$DB" "mr_$s"
  psql -d "mr_$s" -v ON_ERROR_STOP=1 -q -f "$t" >/dev/null 2>&1 || { echo "FAIL: MaalGrow $s with 051 applied"; exit 1; }
  dropdb "mr_$s"; n=$((n + 1))
done
psql -d postgres -qc "ALTER DATABASE $DB WITH is_template false"
echo "PASS: all $n existing MaalGrow scenarios pass with 051 applied"
