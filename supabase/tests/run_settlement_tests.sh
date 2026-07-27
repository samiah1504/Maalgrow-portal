#!/usr/bin/env bash
# Runs the settlement scenario tests against a scratch database.
# Kept separate so no existing runner has to change.
# Usage: PGHOST=... PGPORT=... PGUSER=... ./run_settlement_tests.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=maalgrow_settlement_test
dropdb --if-exists "$DB"
createdb "$DB"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/000_supabase_stub.sql
for f in supabase/migrations/0*.sql; do
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
done
echo "migrations applied"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/mudarabah_scenarios.sql
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/settlement_scenarios.sql
