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
PARTS=supabase/checks/054_parts
for i in 1 2; do
  awk '/^-- >>> 054 BODY START/{f=1;next} /^-- <<< 054 BODY END/{f=0} f' "$PARTS/054_part_${i}_of_2.sql"
done | cmp -s - <(awk '/^BEGIN;$/{f=1;next} /^COMMIT;$/{f=0} f' supabase/migrations/054_maalrise_investor_portal.sql) \
  || { echo "FAIL: 054 parts differ from the migration"; exit 1; }
echo "PASS: 054 parts 1–2 are identical to the migration body"
awk '/^-- >>> 055 BODY START/{f=1;next} /^-- <<< 055 BODY END/{f=0} f' supabase/checks/055_parts/055_part_1_of_1.sql \
  | cmp -s - <(awk '/^BEGIN;$/{f=1;next} /^COMMIT;$/{f=0} f' supabase/migrations/055_maalrise_go_live.sql) \
  || { echo "FAIL: the 055 part differs from the migration"; exit 1; }
echo "PASS: the 055 part is identical to the migration body"
awk '/^-- >>> 056 BODY START/{f=1;next} /^-- <<< 056 BODY END/{f=0} f' supabase/checks/056_parts/056_part_1_of_1.sql \
  | cmp -s - <(awk '/^BEGIN;$/{f=1;next} /^COMMIT;$/{f=0} f' supabase/migrations/056_maalrise_super_admin_self_approval.sql) \
  || { echo "FAIL: the 056 part differs from the migration"; exit 1; }
echo "PASS: the 056 part is identical to the migration body"
awk '/^-- >>> 057 BODY START/{f=1;next} /^-- <<< 057 BODY END/{f=0} f' supabase/checks/057_parts/057_part_1_of_1.sql \
  | cmp -s - <(awk '/^BEGIN;$/{f=1;next} /^COMMIT;$/{f=0} f' supabase/migrations/057_maalrise_cycle_emails.sql) \
  || { echo "FAIL: the 057 part differs from the migration"; exit 1; }
echo "PASS: the 057 part is identical to the migration body"
awk '/^-- >>> 058 BODY START/{f=1;next} /^-- <<< 058 BODY END/{f=0} f' supabase/checks/058_parts/058_part_1_of_1.sql \
  | cmp -s - <(awk '/^BEGIN;$/{f=1;next} /^COMMIT;$/{f=0} f' supabase/migrations/058_maalrise_activation_warnings.sql) \
  || { echo "FAIL: the 058 part differs from the migration"; exit 1; }
echo "PASS: the 058 part is identical to the migration body"

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
  [[ "$f" == *051_maalrise_core.sql || "$f" == *052_maalrise_distributions.sql || "$f" == *053_maalrise_capital_settlement.sql || "$f" == *054_maalrise_investor_portal.sql || "$f" == *055_maalrise_go_live.sql || "$f" == *056_maalrise_super_admin_self_approval.sql || "$f" == *057_maalrise_cycle_emails.sql || "$f" == *058_maalrise_activation_warnings.sql ]] && continue
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

# 054 (Phase 6), rehearsed the same way
[ "$(summary_of supabase/checks/maalrise_054_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 054 preflight not ready"; q -f supabase/checks/maalrise_054_preflight.sql; exit 1; }
K0=$(fingerprint_of supabase/checks/maalrise_054_preflight.sql)
echo "PASS: 054 preflight ready_to_apply; fingerprint ${K0}"
# The five policies 054 drops, so the rollback can be proved to restore them exactly.
touched54() {
  q -c "SELECT md5(string_agg(tablename || policyname || coalesce(qual, '') || cmd || array_to_string(roles, ','), E'\n' ORDER BY policyname))
          FROM pg_policies WHERE schemaname = 'public' AND policyname LIKE 'Investor reads%'"
}
U0=$(touched54)
q -q -f supabase/migrations/054_maalrise_investor_portal.sql
[ "$(summary_of supabase/checks/maalrise_054_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 054 post-apply checks"; q -f supabase/checks/maalrise_054_postapply.sql; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_054_postapply.sql)" = "$K0" ] || { echo "FAIL: 054 changed an object it should not touch"; exit 1; }
echo "PASS: 054 post-apply checks all true; fingerprint of everything else unchanged"
[ "$(summary_of supabase/checks/maalrise_054_preflight.sql ready_to_apply)" = "f" ] || { echo "FAIL: 054 preflight should refuse a second apply"; exit 1; }
if q -q -f supabase/migrations/054_maalrise_investor_portal.sql >/dev/null 2>&1; then echo "FAIL: 054 applied twice"; exit 1; fi
q -q -f supabase/checks/maalrise_054_rollback.sql
[ "$(fingerprint_of supabase/checks/maalrise_054_preflight.sql)" = "$K0" ] || { echo "FAIL: 054 rollback left the schema different"; exit 1; }
[ "$(summary_of supabase/checks/maalrise_054_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 054 preflight not ready after rollback"; exit 1; }
[ "$(touched54)" = "$U0" ] || { echo "FAIL: 054 rollback did not restore the five investor read policies exactly"; exit 1; }
echo "PASS: 054 cannot be applied twice; rollback restores the five investor read policies exactly"
P54=supabase/checks/054_parts
if q -q -f $P54/054_part_2_of_2.sql >/dev/null 2>&1; then echo "FAIL: 054 part 2 ran before part 1"; exit 1; fi
q -q -f $P54/054_part_1_of_2.sql >/dev/null
if q -q -f $P54/054_part_1_of_2.sql >/dev/null 2>&1; then echo "FAIL: 054 part 1 ran twice"; exit 1; fi
q -q -f $P54/054_part_2_of_2.sql >/dev/null
if q -q -f $P54/054_part_2_of_2.sql >/dev/null 2>&1; then echo "FAIL: 054 part 2 ran twice"; exit 1; fi
[ "$(summary_of supabase/checks/maalrise_054_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 054 post-apply after parts"; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_054_postapply.sql)" = "$K0" ] || { echo "FAIL: 054 parts changed an object they should not touch"; exit 1; }
echo "PASS: 054 applied in parts 1–2; out-of-order and repeat runs refused; post-apply true; fingerprint unchanged"

# 055 (Phase 7), rehearsed the same way
[ "$(summary_of supabase/checks/maalrise_055_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 055 preflight not ready"; q -f supabase/checks/maalrise_055_preflight.sql; exit 1; }
M0=$(fingerprint_of supabase/checks/maalrise_055_preflight.sql)
echo "PASS: 055 preflight ready_to_apply; fingerprint ${M0}"
touched55() {
  q -c "SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
          SELECT pg_get_functiondef(oid) AS x FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN ('maalrise_review_bank_change', 'maalrise_my_access')
          UNION ALL SELECT column_name || data_type || is_nullable || coalesce(column_default, '') FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'maalrise_email_outbox'
          UNION ALL SELECT conname || pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid = 'public.maalrise_email_outbox'::regclass) s"
}
V0=$(touched55)
q -q -f supabase/migrations/055_maalrise_go_live.sql
[ "$(summary_of supabase/checks/maalrise_055_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 055 post-apply checks"; q -f supabase/checks/maalrise_055_postapply.sql; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_055_postapply.sql)" = "$M0" ] || { echo "FAIL: 055 changed an object it should not touch"; exit 1; }
echo "PASS: 055 post-apply checks all true; fingerprint of everything else unchanged"
[ "$(summary_of supabase/checks/maalrise_055_preflight.sql ready_to_apply)" = "f" ] || { echo "FAIL: 055 preflight should refuse a second apply"; exit 1; }
if q -q -f supabase/migrations/055_maalrise_go_live.sql >/dev/null 2>&1; then echo "FAIL: 055 applied twice"; exit 1; fi
q -q -f supabase/checks/maalrise_055_rollback.sql
[ "$(fingerprint_of supabase/checks/maalrise_055_preflight.sql)" = "$M0" ] || { echo "FAIL: 055 rollback left the schema different"; exit 1; }
[ "$(touched55)" = "$V0" ] || { echo "FAIL: 055 rollback did not restore the outbox and maalrise_review_bank_change exactly"; exit 1; }
echo "PASS: 055 cannot be applied twice; rollback restores the outbox and the two 054 functions exactly"
P55=supabase/checks/055_parts/055_part_1_of_1.sql
q -q -f $P55 >/dev/null
if q -q -f $P55 >/dev/null 2>&1; then echo "FAIL: the 055 part ran twice"; exit 1; fi
[ "$(summary_of supabase/checks/maalrise_055_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 055 post-apply after the part"; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_055_postapply.sql)" = "$M0" ] || { echo "FAIL: the 055 part changed an object it should not touch"; exit 1; }
echo "PASS: 055 applied as one SQL Editor part; repeat refused; post-apply true; fingerprint unchanged"

# 056 (super admin self-approval), rehearsed the same way
[ "$(summary_of supabase/checks/maalrise_056_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 056 preflight not ready"; q -f supabase/checks/maalrise_056_preflight.sql; exit 1; }
N0=$(fingerprint_of supabase/checks/maalrise_056_preflight.sql)
touched56() {
  q -c "SELECT md5(string_agg(x, E'\n' ORDER BY x)) FROM (
          SELECT pg_get_functiondef(oid) AS x FROM pg_proc WHERE pronamespace = 'public'::regnamespace
            AND proname IN ('maalrise_approve_terms', 'maalrise_confirm_funding')
          UNION ALL SELECT table_name || column_name || data_type || is_nullable || coalesce(column_default, '') FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name IN ('maalrise_cycle_terms', 'maalrise_investor_fundings')
          UNION ALL SELECT conname || pg_get_constraintdef(oid) FROM pg_constraint
            WHERE conrelid IN ('public.maalrise_cycle_terms'::regclass, 'public.maalrise_investor_fundings'::regclass)) s"
}
W0=$(touched56)
q -q -f supabase/migrations/056_maalrise_super_admin_self_approval.sql
[ "$(summary_of supabase/checks/maalrise_056_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 056 post-apply"; q -f supabase/checks/maalrise_056_postapply.sql; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_056_postapply.sql)" = "$N0" ] || { echo "FAIL: 056 changed an object it should not touch"; exit 1; }
echo "PASS: 056 preflight ready; post-apply all true; fingerprint of everything else unchanged"
if q -q -f supabase/migrations/056_maalrise_super_admin_self_approval.sql >/dev/null 2>&1; then echo "FAIL: 056 applied twice"; exit 1; fi
q -q -f supabase/checks/maalrise_056_rollback.sql
[ "$(fingerprint_of supabase/checks/maalrise_056_preflight.sql)" = "$N0" ] || { echo "FAIL: 056 rollback left the schema different"; exit 1; }
[ "$(touched56)" = "$W0" ] || { echo "FAIL: 056 rollback did not restore the 051 rule exactly"; exit 1; }
q -q -f supabase/checks/056_parts/056_part_1_of_1.sql >/dev/null
if q -q -f supabase/checks/056_parts/056_part_1_of_1.sql >/dev/null 2>&1; then echo "FAIL: the 056 part ran twice"; exit 1; fi
[ "$(summary_of supabase/checks/maalrise_056_postapply.sql all_ok)" = "t" ] && [ "$(fingerprint_of supabase/checks/maalrise_056_postapply.sql)" = "$N0" ] \
  || { echo "FAIL: 056 part"; exit 1; }
echo "PASS: 056 cannot be applied twice; rollback restores the 051 rule exactly; applied as one SQL Editor part"

# 057 (Cycle emails)
[ "$(summary_of supabase/checks/maalrise_057_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 057 preflight not ready"; exit 1; }
O0=$(fingerprint_of supabase/checks/maalrise_057_preflight.sql)
q -q -f supabase/migrations/057_maalrise_cycle_emails.sql
[ "$(summary_of supabase/checks/maalrise_057_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 057 post-apply"; q -f supabase/checks/maalrise_057_postapply.sql; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_057_postapply.sql)" = "$O0" ] || { echo "FAIL: 057 changed an object it should not touch"; exit 1; }
q -q -f supabase/checks/maalrise_057_rollback.sql
[ "$(fingerprint_of supabase/checks/maalrise_057_preflight.sql)" = "$O0" ] && [ "$(summary_of supabase/checks/maalrise_057_preflight.sql ready_to_apply)" = "t" ] \
  || { echo "FAIL: 057 rollback"; exit 1; }
q -q -f supabase/checks/057_parts/057_part_1_of_1.sql >/dev/null
if q -q -f supabase/checks/057_parts/057_part_1_of_1.sql >/dev/null 2>&1; then echo "FAIL: the 057 part ran twice"; exit 1; fi
[ "$(summary_of supabase/checks/maalrise_057_postapply.sql all_ok)" = "t" ] && [ "$(fingerprint_of supabase/checks/maalrise_057_postapply.sql)" = "$O0" ] \
  || { echo "FAIL: 057 part"; exit 1; }
echo "PASS: 057 preflight, post-apply, fingerprint, rollback and one SQL Editor part (repeat refused)"

# 058 (KYC and bank confirmation become activation warnings)
[ "$(summary_of supabase/checks/maalrise_058_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 058 preflight not ready"; exit 1; }
P0=$(fingerprint_of supabase/checks/maalrise_058_preflight.sql)
touched58() { q -c "SELECT md5(string_agg(pg_get_functiondef(oid), E'\n' ORDER BY proname)) FROM pg_proc
                    WHERE pronamespace = 'public'::regnamespace AND proname IN ('maalrise_activation_checks', 'maalrise_activate_cycle')"; }
X0=$(touched58)
q -q -f supabase/migrations/058_maalrise_activation_warnings.sql
[ "$(summary_of supabase/checks/maalrise_058_postapply.sql all_ok)" = "t" ] || { echo "FAIL: 058 post-apply"; q -f supabase/checks/maalrise_058_postapply.sql; exit 1; }
[ "$(fingerprint_of supabase/checks/maalrise_058_postapply.sql)" = "$P0" ] || { echo "FAIL: 058 changed an object it should not touch"; exit 1; }
q -q -f supabase/checks/maalrise_058_rollback.sql
[ "$(fingerprint_of supabase/checks/maalrise_058_preflight.sql)" = "$P0" ] && [ "$(touched58)" = "$X0" ] \
  && [ "$(summary_of supabase/checks/maalrise_058_preflight.sql ready_to_apply)" = "t" ] || { echo "FAIL: 058 rollback did not restore the 051 rule exactly"; exit 1; }
q -q -f supabase/checks/058_parts/058_part_1_of_1.sql >/dev/null
if q -q -f supabase/checks/058_parts/058_part_1_of_1.sql >/dev/null 2>&1; then echo "FAIL: the 058 part ran twice"; exit 1; fi
[ "$(summary_of supabase/checks/maalrise_058_postapply.sql all_ok)" = "t" ] && [ "$(fingerprint_of supabase/checks/maalrise_058_postapply.sql)" = "$P0" ] \
  || { echo "FAIL: 058 part"; exit 1; }
echo "PASS: 058 preflight, post-apply, fingerprint, rollback restores the 051 rule exactly, one SQL Editor part (repeat refused)"

# 6. scenarios
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_core_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_distribution_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*|ERROR:.*"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_capital_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*|ERROR:.*"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_portal_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*|ERROR:.*"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_golive_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*|ERROR:.*"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_selfapproval_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*|ERROR:.*"
psql -d "$DB" -v ON_ERROR_STOP=1 -f supabase/tests/maalrise_cycle_emails_scenarios.sql 2>&1 | grep -oE "(PASS|FAIL) R[0-9]+b?:.*|ERROR:.*"
npx tsx scripts/test-maalrise-sql-contract.ts "$DB" | grep -E "PASS|FAIL"
npx tsx scripts/check-unfiltered-writes.ts "$DB"

psql -d postgres -qc "ALTER DATABASE $DB WITH is_template true"
n=0
for t in supabase/tests/*_scenarios.sql; do
  [[ "$t" == *maalrise* ]] && continue
  s=$(basename "$t" .sql)
  dropdb --if-exists "mr_$s"; createdb -T "$DB" "mr_$s"
  psql -d "mr_$s" -v ON_ERROR_STOP=1 -q -f "$t" >/dev/null 2>&1 || { echo "FAIL: MaalGrow $s with 051–058 applied"; exit 1; }
  dropdb "mr_$s"; n=$((n + 1))
done
psql -d postgres -qc "ALTER DATABASE $DB WITH is_template false"
echo "PASS: all $n existing MaalGrow scenarios pass with 051–058 applied"
