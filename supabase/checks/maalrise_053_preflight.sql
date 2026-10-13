-- ============================================================
-- MaalRise 053 — PREFLIGHT. Run BEFORE applying the migration.
--
-- READ ONLY: only SELECTs. Nothing is written.
--
-- 053 may be applied only if Query 1 ends with ready_to_apply = true.
-- Keep the fingerprint from Query 2: maalrise_053_postapply.sql must
-- print the SAME value. It covers every object 053 does not touch —
-- all of MaalGrow, all of MaalRise 051 and the rest of 052.
-- ============================================================

-- Query 1 — is this database what 053 expects?
WITH checks(check_name, ok) AS (VALUES
  ('MaalRise 052 tables are all present', (SELECT COUNT(*) FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
     AND relname ~ '^maalrise_(receipts|distributions|distribution_lines|payment_events|notifications|email_outbox)$') = 6),
  ('052 functions present (record/confirm receipt, approve, pay, notify)',
     (SELECT COUNT(DISTINCT proname) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN
       ('maalrise_record_receipt', 'maalrise_confirm_receipt', 'maalrise_approve_distribution', 'maalrise_mark_line_paid',
        'maalrise_notify_roles', 'maalrise_notify_investor', 'maalrise_build_distribution_lines', 'maalrise_payment_events_append_only',
        'maalrise_reverse_line_payment', 'maalrise_sync_reminders', 'maalrise_receipt_guard', 'maalrise_can_pay', 'maalrise_today', 'maalrise_naira')) = 14),
  ('maalrise_receipts status check is the 052 one', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maalrise_receipts_status_check'
     AND conrelid = 'public.maalrise_receipts'::regclass AND pg_get_constraintdef(oid) NOT LIKE '%reversed%')),
  ('maalrise_receipts reference index present', to_regclass('public.maalrise_receipts_reference_uq') IS NOT NULL),
  ('No 053 table exists yet', NOT EXISTS (SELECT 1 FROM pg_class WHERE relnamespace = 'public'::regnamespace
     AND relname ~ '^maalrise_capital_(receipts|settlements|payments|payment_events)$')),
  ('No 053 function exists yet', NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
     AND proname IN ('maalrise_reverse_receipt', 'maalrise_record_capital', 'maalrise_close_cycle', 'maalrise_close_checks')))
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> ready_to_apply', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — fingerprint of every object 053 does not touch. Record it.
SELECT md5(string_agg(kind || '|' || name || '|' || def, E'\n' ORDER BY kind, name)) AS existing_schema_fingerprint,
       COUNT(*) AS objects
FROM (
  WITH touched AS (SELECT '^maalrise_(receipts|capital_receipts|capital_settlements|capital_payments|capital_payment_events)$' AS re),
  fns(n) AS (VALUES ('maalrise_record_receipt'), ('maalrise_receipt_guard'), ('maalrise_sync_reminders'), ('maalrise_approve_distribution'), ('maalrise_reverse_line_payment'), ('maalrise_reverse_receipt'), ('maalrise_maturity_date'), ('maalrise_capital_due'), ('maalrise_record_capital'), ('maalrise_reject_capital'), ('maalrise_build_capital_payments'), ('maalrise_confirm_capital'), ('maalrise_reverse_capital'), ('maalrise_refresh_capital_settlement'), ('maalrise_approve_capital_settlement'), ('maalrise_mark_capital_paid'), ('maalrise_reverse_capital_payment'), ('maalrise_close_checks'), ('maalrise_close_cycle'), ('maalrise_capital_receipt_guard'), ('maalrise_capital_settlement_guard'), ('maalrise_capital_payments_guard'))
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
