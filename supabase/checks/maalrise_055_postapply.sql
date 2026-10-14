-- ============================================================
-- MaalRise 055 — POST-APPLY VERIFICATION. Run straight AFTER applying.
--
-- READ ONLY. Every row in Query 1 must be true, and Query 2 must print
-- the SAME fingerprint as maalrise_055_preflight.sql did.
-- ============================================================

-- Query 1 — the 055 objects are present and locked down
WITH new_fns(n) AS (VALUES ('maalrise_can_send_email'), ('maalrise_claim_email'), ('maalrise_email_result'), ('maalrise_discard_email'), ('maalrise_sync_from_maalgrow')),
checks(check_name, ok) AS (VALUES
  ('All 5 new functions exist', (SELECT COUNT(*) FROM new_fns e WHERE EXISTS (SELECT 1 FROM pg_proc
     WHERE pronamespace = 'public'::regnamespace AND proname = e.n)) = 5),
  ('Emails can be discarded', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maalrise_email_outbox_status_check'
     AND pg_get_constraintdef(oid) LIKE '%discarded%')),
  ('Outbox records the sender result', (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = 'public'
     AND table_name = 'maalrise_email_outbox' AND column_name IN ('queued_at', 'provider_id', 'handled_by', 'discarded_at')) = 4),
  ('Bank-change decisions prepare an email draft', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'maalrise_review_bank_change'
     AND prosrc LIKE '%MaalRise: your bank details were updated%')),
  ('Still no email sent, and every existing draft still a draft', NOT EXISTS (SELECT 1 FROM maalrise_email_outbox WHERE status <> 'draft')),
  ('Read policies only (no INSERT/UPDATE/DELETE policy on any MaalRise table)',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'maalrise%' AND cmd <> 'SELECT')),
  ('Product switch counts MaalGrow investments', EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'maalrise_my_access'
     AND prosrc LIKE '%investments%')),
  ('No trigger was added to any MaalGrow table', NOT EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE NOT t.tgisinternal AND p.proname LIKE 'maalrise%' AND t.tgrelid::regclass::text NOT LIKE 'maalrise%'))
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the 055 preflight fingerprint exactly
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
