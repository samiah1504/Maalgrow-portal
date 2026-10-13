-- ============================================================
-- MaalRise 054 — PREFLIGHT. Run BEFORE applying the migration.
--
-- READ ONLY: only SELECTs. Nothing is written.
--
-- 054 may be applied only if Query 1 ends with ready_to_apply = true.
-- Keep the fingerprint from Query 2: maalrise_054_postapply.sql must
-- print the SAME value. It covers every object 054 does not touch —
-- all of MaalGrow and all of MaalRise 051–053 except the five investor
-- read policies 054 removes.
-- ============================================================

-- Query 1 — is this database what 054 expects?
WITH dropped(t, p) AS (VALUES
  ('maalrise_investors', 'Investor reads own MaalRise record'),
  ('maalrise_kyc_submissions', 'Investor reads own KYC submissions'),
  ('maalrise_cycles', 'Investor reads own visible cycles'),
  ('maalrise_cycle_terms', 'Investor reads approved terms of own cycles'),
  ('maalrise_schedule_lines', 'Investor reads approved schedule of own cycles')),
checks(check_name, ok) AS (VALUES
  ('MaalRise 053 is applied (capital tables and closing present)',
     (SELECT COUNT(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
        AND relname ~ '^maalrise_capital_(receipts|settlements|payments|payment_events)$') = 4
     AND to_regprocedure('public.maalrise_close_cycle(uuid)') IS NOT NULL),
  ('Functions 054 builds on are present',
     (SELECT COUNT(DISTINCT proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
       ('get_my_maalrise_investor_id', 'maalrise_cycle_visible_to_me', 'maalrise_maturity_date', 'maalrise_today',
        'maalrise_notify_roles', 'maalrise_notify_investor', 'maalrise_can_prepare', 'create_audit_log')) = 8),
  ('The five investor read policies 054 replaces are present',
     (SELECT COUNT(*) FROM dropped d WHERE EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public'
        AND tablename = d.t AND policyname = d.p)) = 5),
  ('No 054 table exists yet', to_regclass('public.maalrise_bank_change_requests') IS NULL),
  ('No 054 function exists yet', NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('maalrise_my_cycle', 'maalrise_my_cycles', 'maalrise_my_payments', 'maalrise_my_profile', 'maalrise_my_access',
                     'maalrise_request_bank_change', 'maalrise_review_bank_change', 'maalrise_investor_share')))
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> ready_to_apply', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — fingerprint of every object 054 does not touch. Record it.
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  WITH touched AS (SELECT '^maalrise_bank_change_requests$' AS re),
  dropped(p) AS (VALUES ('Investor reads own MaalRise record'), ('Investor reads own KYC submissions'), ('Investor reads own visible cycles'), ('Investor reads approved terms of own cycles'), ('Investor reads approved schedule of own cycles')),
  fns(n) AS (VALUES ('maalrise_bank_change_guard'), ('maalrise_request_bank_change'), ('maalrise_cancel_bank_change'), ('maalrise_review_bank_change'), ('maalrise_investor_share'), ('maalrise_my_access'), ('maalrise_my_profile'), ('maalrise_my_cycle'), ('maalrise_my_cycles'), ('maalrise_my_payments'))
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
