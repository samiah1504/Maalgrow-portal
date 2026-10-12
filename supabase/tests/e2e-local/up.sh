# Rebuild the LOCAL e2e database and start PostgREST + gateway. Scratch only.
set -e
S=$(cd "$(dirname "$0")" && pwd)
: "${PGHOST:?Set PGHOST/PGPORT to a LOCAL scratch Postgres — never staging or production}"
export PGPORT=${PGPORT:-55432} PGUSER=${PGUSER:-postgres}
case "$PGHOST" in /*|localhost|127.0.0.1) ;; *) echo "Refusing: PGHOST must be a local socket or localhost" >&2; exit 1;; esac
cd "$S/../../.."
for f in $S/pgrst.pid $S/gateway.pid; do [ -f $f ] && kill $(cat $f) 2>/dev/null || true; done; sleep 0.5
dropdb --if-exists mr_e2e; createdb mr_e2e
psql -d mr_e2e -q -v ON_ERROR_STOP=1 -f supabase/tests/000_supabase_stub.sql >/dev/null
psql -d mr_e2e -q -v ON_ERROR_STOP=1 -f $S/supabase_roles_pre.sql >/dev/null
for f in supabase/migrations/0*.sql; do psql -d mr_e2e -q -v ON_ERROR_STOP=1 -f "$f" >/dev/null; done
psql -d mr_e2e -q -v ON_ERROR_STOP=1 -f $S/supabase_roles.sql >/dev/null
psql -d mr_e2e -q -v ON_ERROR_STOP=1 -f $S/seed.sql >/dev/null
cat > $S/pgrst.conf <<CONF
db-uri = "postgres://authenticator@/mr_e2e?host=$PGHOST&port=$PGPORT"
db-schemas = "public"
db-anon-role = "anon"
jwt-secret = "local-e2e-only-secret-local-e2e-only-secret-0123"
server-port = 3001
server-host = "127.0.0.1"
CONF
setsid nohup ${POSTGREST:-postgrest} $S/pgrst.conf > $S/pgrst.log 2>&1 < /dev/null &
echo $! > $S/pgrst.pid
EMAILS=$(psql -d mr_e2e -Atc "select json_object_agg(id, email) from auth.users")
rm -rf "$S/storage"; mkdir -p "$S/storage"
E2E_STORAGE="$S/storage" E2E_EMAILS="$EMAILS" setsid nohup node $S/gateway.mjs > $S/gateway.log 2>&1 < /dev/null &
echo $! > $S/gateway.pid
sleep 2
curl -s -o /dev/null -w "postgrest %{http_code}\n" http://127.0.0.1:3001/
