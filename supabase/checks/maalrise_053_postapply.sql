-- ============================================================
-- MaalRise 053 — POST-APPLY VERIFICATION. Run straight AFTER applying.
--
-- READ ONLY. Every row in Query 1 must be true, and Query 2 must print
-- the SAME fingerprint as maalrise_053_preflight.sql did.
-- ============================================================

-- Query 1 — the 053 objects are present and locked down
WITH t AS (
  SELECT relname, relrowsecurity FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
     AND relname ~ '^maalrise_capital_(receipts|settlements|payments|payment_events)$'
),
new_fns(n) AS (VALUES ('maalrise_reverse_receipt'), ('maalrise_maturity_date'), ('maalrise_capital_due'), ('maalrise_record_capital'), ('maalrise_reject_capital'), ('maalrise_build_capital_payments'), ('maalrise_confirm_capital'), ('maalrise_reverse_capital'), ('maalrise_refresh_capital_settlement'), ('maalrise_approve_capital_settlement'), ('maalrise_mark_capital_paid'), ('maalrise_reverse_capital_payment'), ('maalrise_close_checks'), ('maalrise_close_cycle'), ('maalrise_capital_receipt_guard'), ('maalrise_capital_settlement_guard'), ('maalrise_capital_payments_guard')),
src AS (SELECT proname, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace),
checks(check_name, ok) AS (VALUES
  ('All 4 capital tables exist', (SELECT COUNT(*) FROM t) = 4),
  ('Row level security is ON for each', NOT EXISTS (SELECT 1 FROM t WHERE NOT relrowsecurity)),
  ('All 17 new functions exist', (SELECT COUNT(*) FROM new_fns e WHERE EXISTS (SELECT 1 FROM src WHERE proname = e.n)) = 17),
  ('Monthly entries above what is owed are refused', EXISTS (SELECT 1 FROM src WHERE proname = 'maalrise_record_receipt' AND prosrc LIKE '%still owed for month%')),
  ('Empty distributions cannot be approved', EXISTS (SELECT 1 FROM src WHERE proname = 'maalrise_approve_distribution' AND prosrc LIKE '%Nothing to approve%')),
  ('Reminders include capital at maturity', EXISTS (SELECT 1 FROM src WHERE proname = 'maalrise_sync_reminders' AND prosrc LIKE '%capital_due%')),
  ('Closed Cycles'' profit payments are final', EXISTS (SELECT 1 FROM src WHERE proname = 'maalrise_reverse_line_payment' AND prosrc LIKE '%is closed%')),
  ('Entries can be marked reversed', EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'maalrise_receipts_status_check'
     AND pg_get_constraintdef(oid) LIKE '%reversed%')),
  ('Read policies only (no INSERT/UPDATE/DELETE policy on any MaalRise table)',
     NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename LIKE 'maalrise%' AND cmd <> 'SELECT')),
  ('Guard triggers installed (4)', (SELECT COUNT(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN
     ('maalrise_capital_payment_events_append_only', 'maalrise_capital_receipt_guard', 'maalrise_capital_settlement_guard',
      'maalrise_capital_payments_guard')) = 4),
  ('Internal helper is not callable by signed-in users',
     NOT has_function_privilege('authenticated', 'maalrise_build_capital_payments(uuid)', 'EXECUTE')),
  ('Capital tables are empty', (SELECT COUNT(*) FROM maalrise_capital_receipts) + (SELECT COUNT(*) FROM maalrise_capital_settlements) = 0)
)
SELECT check_name, ok FROM checks
UNION ALL SELECT '>>> all_ok', NOT EXISTS (SELECT 1 FROM checks WHERE NOT ok);

-- Query 2 — must equal the 053 preflight fingerprint exactly
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
