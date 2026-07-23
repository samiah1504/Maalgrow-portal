#!/usr/bin/env bash
# Runs the rollover scenario tests against a scratch PostgreSQL database.
# Usage: PGHOST=... PGPORT=... PGUSER=... ./run_tests.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=maalgrow_test
dropdb --if-exists "$DB"
createdb "$DB"
psql -d "$DB" -v ON_ERROR_STOP=1 -q -f supabase/tests/000_supabase_stub.sql
for f in supabase/migrations/0*.sql; do
  psql -d "$DB" -v ON_ERROR_STOP=1 -q -f "$f" >/dev/null
  echo "migrated $f"
done
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/rollover_scenarios.sql
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/payment_allocation_scenarios.sql
