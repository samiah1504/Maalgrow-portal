-- ============================================================
-- MaalRise 055 — PREFLIGHT. Run BEFORE applying the migration.
--
-- READ ONLY: only SELECTs. Nothing is written.
--
-- 055 may be applied only if Query 1 ends with ready_to_apply = true.
-- Keep the fingerprint from Query 2: maalrise_055_postapply.sql must
-- print the SAME value. It covers every object 055 does not touch —
-- all of MaalGrow and all of MaalRise 051–054 except the email outbox
-- table and the two functions 055 replaces.
-- ============================================================

-- Query 1 — is this database what 055 expects?
WITH checks(check_name, ok) AS (VALUES
  ('MaalRise 054 is applied (investor portal functions present)',
     to_regprocedure('public.maalrise_my_payments()') IS NOT NULL
     AND to_regclass('public.maalrise_bank_change_requests') IS NOT NULL),
  ('Email outbox is the 052 one (drafts only so far)',
     EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maalrise_email_outbox_status_check'
       AND pg_get_constraintdef(oid) NOT LIKE '%discarded%')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'maalrise_email_outbox' AND column_name = 'provider_id')),
  ('No email has been sent yet', NOT EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE status <> 'draft')),
  ('MaalGrow investor columns 055 reads are present',
     (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'investors'
        AND column_name IN ('kyc_status', 'kyc_submitted_at', 'bank_name', 'account_name', 'account_number', 'profile_id')) = 6),
  ('No 055 function exists yet', NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('maalrise_claim_email', 'maalrise_email_result', 'maalrise_discard_email', 'maalrise_sync_from_maalgrow', 'maalrise_can_send_email')))
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> ready_to_apply', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — fingerprint of every object 055 does not touch. Record it.
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  WITH touched AS (SELECT '^maalrise_email_outbox$' AS re),
  dropped(p) AS (VALUES ('-')),
  fns(n) AS (VALUES ('maalrise_can_send_email'), ('maalrise_claim_email'), ('maalrise_email_result'), ('maalrise_discard_email'), ('maalrise_sync_from_maalgrow'), ('maalrise_review_bank_change'), ('maalrise_my_access'))
  SELECT 'column' AS kind, table_schema||'.'||table_name||'.'||column_name AS name,
         md5(data_type||coalesce(column_default,'')||is_nullable) AS def
    FROM information_schema.columns WHERE table_schema IN ('public','auth') AND table_name !~ (SELECT re FROM touched)
  UNION ALL SELECT 'constraint', conrelid::regclass::text||'.'||conname, md5(pg_get_constraintdef(oid))
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace AND conrelid::regclass::text !~ (SELECT re FROM touched)
  UNION ALL SELECT 'index', indexrelid::regclass::text, md5(pg_get_indexdef(indexrelid))
    FROM pg_index i JOIN pg_class c ON c.oid = i.indrelid
    WHERE c.relnamespace = 'public'::regnamespace AND c.relname !~ (SELECT re FROM touched)
  UNION ALL SELECT 'policy', tablename||'.'||policyname, md5(coalesce(qual,'')||coalesce(with_check,'')||cmd||array_to_string(roles,','))
    FROM pg_policies WHERE schemaname = 'public' AND tablename !~ (SELECT re FROM touched)
     AND policyname NOT IN (SELECT p FROM dropped)
  UNION ALL SELECT 'trigger', tgrelid::regclass::text||'.'||tgname, md5(pg_get_triggerdef(oid))
    FROM pg_trigger WHERE NOT tgisinternal AND tgrelid::regclass::text !~ (SELECT re FROM touched)
  UNION ALL SELECT 'function', p.oid::regprocedure::text, md5(pg_get_functiondef(p.oid))
    FROM pg_proc p WHERE p.pronamespace IN ('public'::regnamespace,'auth'::regnamespace)
     AND p.proname NOT IN (SELECT n FROM fns) AND p.prokind = 'f'
  UNION ALL SELECT 'rls', relname, relrowsecurity::text
    FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r' AND relname !~ (SELECT re FROM touched)
  UNION ALL SELECT 'grant', table_name||':'||grantee, string_agg(privilege_type, ',' ORDER BY privilege_type)
    FROM information_schema.role_table_grants WHERE table_schema = 'public' AND table_name !~ (SELECT re FROM touched)
    GROUP BY table_name, grantee
  UNION ALL SELECT 'type', t.typname, md5(coalesce((SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder)
                                                     FROM pg_enum WHERE enumtypid = t.oid), ''))
    FROM pg_type t WHERE t.typnamespace = 'public'::regnamespace AND t.typtype = 'e'
) objects;
