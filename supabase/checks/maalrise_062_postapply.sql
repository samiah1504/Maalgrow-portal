-- ============================================================
-- MaalRise 062 — POST-APPLY VERIFICATION. READ ONLY.
-- Every row in Query 1 true; Query 2 equal to the 062 preflight.
-- ============================================================

-- Query 1
WITH checks(check_name, ok) AS (VALUES
  ('Payments can be on hold', (SELECT COUNT(*) FROM pg_constraint
     WHERE conname IN ('maalrise_distribution_lines_status_check', 'maalrise_capital_payments_status_check')
       AND pg_get_constraintdef(oid) LIKE '%on_hold%') = 2),
  ('Approval no longer refuses for unconfirmed bank details', EXISTS (SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.maalrise_approve_distribution(uuid)') AND prosrc LIKE '%on_hold%'
       AND prosrc NOT LIKE '%Bank details are unconfirmed%')
     AND EXISTS (SELECT 1 FROM pg_proc WHERE oid = to_regprocedure('public.maalrise_approve_capital_settlement(uuid)')
       AND prosrc LIKE '%on_hold%' AND prosrc NOT LIKE '%Bank details are unconfirmed%')),
  ('Held payments are released when bank details are confirmed', EXISTS (SELECT 1 FROM pg_trigger
     WHERE tgname = 'maalrise_release_on_bank' AND tgrelid = 'public.maalrise_investors'::regclass)),
  ('MaalGrow KYC decisions reach MaalRise at once', EXISTS (SELECT 1 FROM pg_trigger
     WHERE tgname = 'maalrise_kyc_from_maalgrow' AND tgrelid = 'public.investors'::regclass)
     AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'maalrise_kyc_on_add' AND tgrelid = 'public.maalrise_investors'::regclass)),
  ('A MaalGrow KYC change can never be stopped by MaalRise', EXISTS (SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.maalrise_kyc_from_maalgrow_trg()') AND prosrc LIKE '%EXCEPTION WHEN OTHERS%')),
  ('Payments still only go to confirmed accounts', EXISTS (SELECT 1 FROM pg_proc
     WHERE oid = to_regprocedure('public.maalrise_release_held_payments(uuid)') AND prosrc LIKE '%bank_confirmed_at IS NULL%')),
  ('Everyone approved in MaalGrow is verified in MaalRise', NOT EXISTS (SELECT 1 FROM maalrise_investors m
     JOIN investors g ON g.id = m.maalgrow_investor_id OR (m.maalgrow_investor_id IS NULL AND g.profile_id = m.profile_id)
     WHERE g.kyc_status::TEXT = 'approved' AND m.kyc_status <> 'verified')),
  ('Internal helpers are not public', NOT has_function_privilege('public', 'maalrise_apply_maalgrow_kyc(uuid)', 'EXECUTE')
     AND NOT has_function_privilege('public', 'maalrise_release_held_payments(uuid)', 'EXECUTE'))
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the 062 preflight fingerprint exactly
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  WITH touched AS (SELECT '^(maalrise_distribution_lines|maalrise_capital_payments)$' AS re),
  dropped(p) AS (VALUES ('-')),
  fns(n) AS (VALUES ('maalrise_approve_distribution'), ('maalrise_approve_capital_settlement'), ('maalrise_lines_guard'),
                    ('maalrise_capital_payments_guard'), ('maalrise_sync_from_maalgrow'), ('maalrise_investor_cycle_view'),
                    ('maalrise_apply_maalgrow_kyc'), ('maalrise_release_held_payments'), ('maalrise_kyc_from_maalgrow_trg'),
                    ('maalrise_kyc_on_add_trg'), ('maalrise_release_on_bank_trg'))
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
     AND tgname NOT IN ('maalrise_kyc_from_maalgrow', 'maalrise_kyc_on_add', 'maalrise_release_on_bank')
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
