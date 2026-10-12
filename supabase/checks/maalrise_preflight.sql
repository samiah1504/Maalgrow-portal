-- ============================================================
-- MaalRise 051 — PREFLIGHT. Run BEFORE applying the migration.
--
-- READ ONLY. Only SELECTs from the catalog and from
-- information_schema. Nothing here writes, updates or deletes.
--
-- Paste into the Supabase SQL Editor for the project you are about to
-- migrate. The migration may be applied only if:
--
--   1. Query 1 ends with  ready_to_apply = true, and
--   2. a recoverable backup exists (see the note at the bottom).
--
-- Keep the fingerprint from Query 2. Run maalrise_postapply.sql after
-- applying: its fingerprint must be IDENTICAL, which proves no
-- existing MaalGrow object was changed.
-- ============================================================

-- ------------------------------------------------------------
-- Query 1 — is this database what the migration expects?
-- ------------------------------------------------------------
WITH
cols AS (
  SELECT table_schema, table_name, column_name FROM information_schema.columns
  WHERE table_schema IN ('public', 'auth')
),
fn AS (
  SELECT n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) AS args, p.prosrc
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname IN ('public', 'auth')
),
enum_labels AS (
  SELECT t.typname, e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
  WHERE t.typnamespace = 'public'::regnamespace
),
checks(required, check_name, ok) AS (VALUES
  (TRUE,  'PostgreSQL 13+ (gen_random_uuid built in)', current_setting('server_version_num')::INT >= 130000),
  (TRUE,  'auth.uid() exists',                          EXISTS (SELECT 1 FROM fn WHERE nspname = 'auth' AND proname = 'uid')),
  (TRUE,  'profiles has id, email, full_name, phone, role',
          (SELECT COUNT(*) FROM cols WHERE table_schema = 'public' AND table_name = 'profiles'
             AND column_name IN ('id', 'email', 'full_name', 'phone', 'role')) = 5),
  (TRUE,  'user_role includes every staff role, investor and payment_officer',
          (SELECT COUNT(*) FROM enum_labels WHERE typname = 'user_role'
             AND enumlabel IN ('super_admin', 'administrator', 'finance', 'operations', 'customer_support',
                               'investor', 'payment_officer')) = 7),
  (TRUE,  'investors has the columns MaalRise reads',
          (SELECT COUNT(*) FROM cols WHERE table_schema = 'public' AND table_name = 'investors'
             AND column_name IN ('id', 'profile_id', 'full_name', 'email', 'phone',
                                 'bank_name', 'account_name', 'account_number', 'kyc_status')) = 9),
  (TRUE,  'kyc_status has an ''approved'' value',
          EXISTS (SELECT 1 FROM enum_labels WHERE enumlabel = 'approved'
                    AND typname = (SELECT udt_name FROM information_schema.columns
                                    WHERE table_schema = 'public' AND table_name = 'investors' AND column_name = 'kyc_status'))),
  (TRUE,  'audit_logs table exists',                    to_regclass('public.audit_logs') IS NOT NULL),
  (TRUE,  'create_audit_log(text, text, text, jsonb, jsonb, ...) exists',
          EXISTS (SELECT 1 FROM fn WHERE nspname = 'public' AND proname = 'create_audit_log'
                    AND args LIKE 'p_action text, p_entity_type text, p_entity_id text, p_old_values jsonb, p_new_values jsonb%')),
  (TRUE,  'is_admin() exists',                          EXISTS (SELECT 1 FROM fn WHERE nspname = 'public' AND proname = 'is_admin')),
  (TRUE,  'is_admin() does not include payment_officer',
          NOT EXISTS (SELECT 1 FROM fn WHERE nspname = 'public' AND proname = 'is_admin' AND prosrc LIKE '%payment_officer%')),
  (TRUE,  'No maalrise_ table exists yet',
          NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relname LIKE 'maalrise%')),
  (TRUE,  'No maalrise_ function exists yet',
          NOT EXISTS (SELECT 1 FROM fn WHERE nspname = 'public' AND (proname LIKE 'maalrise%' OR proname = 'get_my_maalrise_investor_id'))),
  (TRUE,  'No maalrise_ policy exists yet',
          NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'maalrise%')),
  -- Informational: whether the live database is level with the repository.
  -- MaalRise does not depend on these, but a gap means production and the
  -- repository have drifted, which should be understood before any change.
  (FALSE, 'Info: 045 temporary passwords applied',      EXISTS (SELECT 1 FROM cols WHERE table_name = 'profiles' AND column_name = 'must_change_password')),
  (FALSE, 'Info: 047 declare-profit retry applied',      EXISTS (SELECT 1 FROM fn WHERE proname = 'declare_cycle_profit' AND prosrc LIKE '%v_retry_failed%')),
  (FALSE, 'Info: 048 rollover engine applied',           EXISTS (SELECT 1 FROM fn WHERE proname = 'mudarabah_roll_one')),
  (FALSE, 'Info: 049 anchored cycle dates applied',      EXISTS (SELECT 1 FROM fn WHERE proname = 'create_next_cycle' AND prosrc LIKE '%v_anchor_day%')),
  (FALSE, 'Info: 050 rollover top-up applied',           EXISTS (SELECT 1 FROM fn WHERE proname = 'mudarabah_roll_one' AND prosrc LIKE '%v_existing%')),
  (FALSE, 'Info: 046 never applied (expected TRUE)',     NOT EXISTS (SELECT 1 FROM fn WHERE proname = 'backfill_rollover_carry_forward')),
  (FALSE, 'Info: Supabase migration history table exists', to_regclass('supabase_migrations.schema_migrations') IS NOT NULL)
)
SELECT check_name, ok, CASE WHEN required THEN 'required' ELSE 'information' END AS kind
FROM checks
UNION ALL
SELECT '>>> ready_to_apply', NOT EXISTS (SELECT 1 FROM checks WHERE required AND NOT ok), 'summary'
ORDER BY 3 DESC, 1;

-- ------------------------------------------------------------
-- Query 2 — fingerprint of every existing (non-MaalRise) object.
-- Record the value. maalrise_postapply.sql must return the same.
-- ------------------------------------------------------------
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS maalgrow_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  SELECT 'column' AS kind, table_schema||'.'||table_name||'.'||column_name AS name,
         md5(data_type||coalesce(column_default,'')||is_nullable) AS def
    FROM information_schema.columns WHERE table_schema IN ('public','auth') AND table_name NOT LIKE 'maalrise%'
  UNION ALL SELECT 'constraint', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid))
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text NOT LIKE 'maalrise%'
  UNION ALL SELECT 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname NOT LIKE 'maalrise%'
  UNION ALL SELECT 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
    FROM pg_policies WHERE schemaname = 'public' AND tablename NOT LIKE 'maalrise%'
  UNION ALL SELECT 'trigger', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid))
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text NOT LIKE 'maalrise%'
  UNION ALL SELECT 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
    FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'auth'::regnamespace)
     AND p.proname NOT LIKE 'maalrise%' AND p.proname <> 'get_my_maalrise_investor_id' AND p.prokind = 'f'
  UNION ALL SELECT 'rls', relname, relrowsecurity::text
    FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname NOT LIKE 'maalrise%'
  UNION ALL SELECT 'grant', table_name||':'||grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
    FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name NOT LIKE 'maalrise%'
    GROUP BY table_name, grantee
  UNION ALL SELECT 'type', t.typname, md5(coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
                                                     FROM pg_enum WHERE enumtypid = t.oid), ''))
    FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e'
) objects;

-- ------------------------------------------------------------
-- Query 3 — migration history (run only if the last Info row above is true)
-- ------------------------------------------------------------
-- SELECT version, name FROM supabase_migrations.schema_migrations ORDER BY version;

-- ------------------------------------------------------------
-- BACKUP — cannot be verified from SQL. Before applying, confirm in
-- the Supabase dashboard (Database → Backups) that a recent backup or
-- point-in-time recovery exists for THIS project, and note its time.
-- The migration only adds new objects, and maalrise_rollback.sql
-- removes exactly those; the backup is the safety net for everything
-- else.
-- ============================================================
