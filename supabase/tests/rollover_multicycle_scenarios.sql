-- ============================================================
-- Repeated rollovers — carried value travels, is counted once, and
-- is paid out on exit. Profit is settled once per cycle, never
-- accumulated.
--
--   A  Cycle A: 500k capital + 125k profit, rollover_all
--        -> Cycle B capital 500k, balance 125k
--   B  Cycle B: +100k profit, rollover_all
--        -> Cycle C capital 500k, balance 225k
--   C  Cycle B: continue instead
--        -> the 100k is PAID, capital 500k, balance still 125k
--   D  Cycle C: exit after the two rollover_all cycles
--        -> requests = 500k capital + 225k carried + C's profit,
--           and equal the engine's withdrawal entitlement
--   E  Legacy row capital 625k / balance 125k / 1 slot, rollover_all
--        -> identical to a correct 500k / 125k row; nothing doubled
--   plus partial after rollover_all, exit in B, and conservation.
-- ============================================================
\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;
BEGIN;
UPDATE series SET price_per_unit = 500000 WHERE name='A';
INSERT INTO auth.users (id,email) SELECT ('a0000000-0000-0000-0000-00000000dd0'||n)::uuid,'mc'||n||'@t.com' FROM generate_series(0,5) n ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) SELECT ('a0000000-0000-0000-0000-00000000dd0'||n)::uuid,'mc'||n||'@t.com','MC '||n,
  CASE WHEN n=0 THEN 'super_admin' ELSE 'investor' END::user_role FROM generate_series(0,5) n ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
SET LOCAL test.uid='a0000000-0000-0000-0000-00000000dd00';
INSERT INTO investors (id,profile_id,investor_code,full_name,email,phone,bank_name,account_name,account_number)
SELECT ('20000000-0000-0000-0000-00000000dd0'||n)::uuid,('a0000000-0000-0000-0000-00000000dd0'||n)::uuid,'MG-MC'||n,
  (ARRAY['','R','K','X','P','L'])[n+1],'mc'||n||'@t.com','080'||n,'GTBank','MC '||n,'0000'||n FROM generate_series(1,5) n ON CONFLICT DO NOTHING;
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,total_slots,status) VALUES
 ('40000000-0000-0000-0000-00000000dd01',(SELECT id FROM series WHERE name='A'),801,'Cycle A','2026-05-30','2026-08-30',100,'active'),
 ('40000000-0000-0000-0000-00000000dd02',(SELECT id FROM series WHERE name='A'),802,'Cycle B','2026-08-30','2026-11-30',100,'active'),
 ('40000000-0000-0000-0000-00000000dd03',(SELECT id FROM series WHERE name='A'),803,'Cycle C','2026-11-30','2027-02-28',100,'active'),
 ('40000000-0000-0000-0000-00000000dd04',(SELECT id FROM series WHERE name='A'),804,'Cycle D','2027-02-28','2027-05-30',100,'active');

-- ── Cycle A: R, K, X, P hold one slot each; all choose rollover_all ──
INSERT INTO investments (id,investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status)
SELECT ('50000000-0000-0000-0000-00000000dd0'||n)::uuid,'A-'||n,('20000000-0000-0000-0000-00000000dd0'||n)::uuid,(SELECT id FROM series WHERE name='A'),
 '40000000-0000-0000-0000-00000000dd01',1,500000,500000,'2026-05-30','2026-08-30','active' FROM generate_series(1,4) n;
INSERT INTO rollover_decisions (investment_id,investor_id,source_cycle_id,decision,bank_name,account_name,account_number)
SELECT ('50000000-0000-0000-0000-00000000dd0'||n)::uuid,('20000000-0000-0000-0000-00000000dd0'||n)::uuid,'40000000-0000-0000-0000-00000000dd01','rollover_all','GTBank','MC '||n,'0000'||n FROM generate_series(1,4) n;
-- 4 slots, ratio 0.5: revenue 1,000,000 -> pot 500,000 -> 125,000 per slot.
SELECT (declare_cycle_profit('40000000-0000-0000-0000-00000000dd01',1000000,0,'A',NULL,FALSE))->>'profit_per_slot_net' AS cycle_a_net_per_slot;
SELECT process_cycle_rollover('40000000-0000-0000-0000-00000000dd01','40000000-0000-0000-0000-00000000dd02',FALSE)->>'rolled' AS a_rolled;

DO $$ DECLARE v_n INT; BEGIN
  SELECT COUNT(*) INTO v_n FROM investments WHERE cycle_id='40000000-0000-0000-0000-00000000dd02' AND (capital<>500000 OR rollover_balance<>125000);
  IF v_n<>0 THEN RAISE EXCEPTION 'TEST FAIL A: % row(s) not capital 500,000 / balance 125,000', v_n; END IF;
  IF EXISTS (SELECT 1 FROM payment_requests) THEN RAISE EXCEPTION 'TEST FAIL A: rollover_all raised a payment request'; END IF;
  RAISE NOTICE 'PASS A: Cycle A rollover_all -> Cycle B capital 500,000 / carried balance 125,000; nothing paid';
END $$;

-- The LEGACY row: what the OLD batch wrote for the same money — balance inside capital AND beside it.
INSERT INTO investments (id,investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,rollover_balance,investment_date,maturity_date,status)
VALUES ('50000000-0000-0000-0000-00000000dd05','B-LEGACY','20000000-0000-0000-0000-00000000dd05',(SELECT id FROM series WHERE name='A'),
 '40000000-0000-0000-0000-00000000dd02',1,500000,625000,125000,'2026-08-30','2026-11-30','active');

-- ── Cycle B decisions: R rollover_all, K continue, X exit, P partial 0.5, L rollover_all ──
INSERT INTO rollover_decisions (investment_id,investor_id,source_cycle_id,decision,slots_to_withdraw,bank_name,account_name,account_number)
SELECT n.id, n.investor_id, n.cycle_id,
       (ARRAY['rollover_all','continue','exit','partial_exit'])[RIGHT(p.investment_code,1)::int]::maturity_decision,
       CASE WHEN RIGHT(p.investment_code,1)='4' THEN 0.5 END, 'GTBank', inv.full_name, '00'||RIGHT(p.investment_code,1)
FROM investments n JOIN investments p ON p.id=n.parent_investment_id JOIN investors inv ON inv.id=n.investor_id
WHERE n.cycle_id='40000000-0000-0000-0000-00000000dd02';
INSERT INTO rollover_decisions (investment_id,investor_id,source_cycle_id,decision,bank_name,account_name,account_number)
VALUES ('50000000-0000-0000-0000-00000000dd05','20000000-0000-0000-0000-00000000dd05','40000000-0000-0000-0000-00000000dd02','rollover_all','GTBank','L','00005');
-- 5 slots: revenue 1,000,000 -> pot 500,000 -> 100,000 per slot.
SELECT (declare_cycle_profit('40000000-0000-0000-0000-00000000dd02',1000000,0,'B',NULL,FALSE))->>'profit_per_slot_net' AS cycle_b_net_per_slot;
DO $$ DECLARE r JSONB; BEGIN
  r := process_cycle_rollover('40000000-0000-0000-0000-00000000dd02','40000000-0000-0000-0000-00000000dd03',FALSE);
  IF (r->>'failed')::int<>0 THEN RAISE EXCEPTION 'TEST FAIL B-batch: % failed — %', r->>'failed', r->'results'; END IF;
  RAISE NOTICE 'PASS B-batch: % rolled, % withdrawn, 0 failed', r->>'rolled', r->>'withdrawn';
END $$;

CREATE TEMP VIEW v_b AS
SELECT inv.full_name AS who, o.id AS b_id, o.capital AS b_capital, o.rollover_balance AS b_balance, o.status AS b_status,
       rd.decision, n.id AS c_id, n.capital AS c_capital, n.rollover_balance AS c_balance, n.units AS c_units,
       COALESCE(investment_confirmed_paid(n.id),0) AS c_funded,
       cr.capital_rolled_over, cr.profit_rolled_over, cr.total_rollover_amount, cr.rollover_balance AS cr_balance,
       cr.withdrawal_amount, cr.status AS cr_status, o.next_investment_id,
       (SELECT COALESCE(SUM(amount),0) FROM payment_requests pr WHERE pr.investment_id=o.id AND pr.type='capital') AS req_capital,
       (SELECT COALESCE(SUM(amount),0) FROM payment_requests pr WHERE pr.investment_id=o.id AND pr.type='roi')     AS req_profit
FROM investments o JOIN investors inv ON inv.id=o.investor_id
LEFT JOIN rollover_decisions rd ON rd.investment_id=o.id
LEFT JOIN investments n ON n.id=o.next_investment_id
LEFT JOIN cycle_rollovers cr ON cr.previous_investment_id=o.id
WHERE o.cycle_id='40000000-0000-0000-0000-00000000dd02';

\echo '=== after Cycle B ==='
SELECT who, decision, b_capital, b_balance, c_capital, c_balance, c_funded, capital_rolled_over AS cr_cap, profit_rolled_over AS cr_profit,
       total_rollover_amount AS cr_total, withdrawal_amount AS cr_wd, cr_status, req_capital, req_profit FROM v_b ORDER BY who;

DO $$ DECLARE r v_b%ROWTYPE; BEGIN
  SELECT * INTO r FROM v_b WHERE who='R';
  IF r.c_capital<>500000 OR r.c_balance<>225000 OR r.c_funded<>500000 THEN RAISE EXCEPTION 'TEST FAIL B: capital % balance % funded %', r.c_capital, r.c_balance, r.c_funded; END IF;
  IF r.capital_rolled_over<>625000 OR r.profit_rolled_over<>100000 OR r.total_rollover_amount<>725000 OR r.withdrawal_amount<>0 OR r.req_capital+r.req_profit<>0 THEN
    RAISE EXCEPTION 'TEST FAIL B audit: cap % profit % total % wd % paid %', r.capital_rolled_over, r.profit_rolled_over, r.total_rollover_amount, r.withdrawal_amount, r.req_capital+r.req_profit; END IF;
  RAISE NOTICE 'PASS B: Cycle B rollover_all -> Cycle C capital 500,000 / carried balance 225,000; audit 625,000 + 100,000 = 725,000; nothing paid';

  SELECT * INTO r FROM v_b WHERE who='K';
  IF r.c_capital<>500000 OR r.c_balance<>125000 THEN RAISE EXCEPTION 'TEST FAIL C: capital % balance %', r.c_capital, r.c_balance; END IF;
  IF r.req_profit<>100000 OR r.req_capital<>0 THEN RAISE EXCEPTION 'TEST FAIL C: requests capital % profit % — the 100,000 must be PAID, not kept', r.req_capital, r.req_profit; END IF;
  IF r.capital_rolled_over<>625000 OR r.profit_rolled_over<>0 OR r.total_rollover_amount<>625000 OR r.withdrawal_amount<>100000 THEN
    RAISE EXCEPTION 'TEST FAIL C audit: cap % profit % total % wd %', r.capital_rolled_over, r.profit_rolled_over, r.total_rollover_amount, r.withdrawal_amount; END IF;
  RAISE NOTICE 'PASS C: continue in Cycle B -> 100,000 profit paid out (not accumulated); capital 500,000 / balance 125,000 continue';

  SELECT * INTO r FROM v_b WHERE who='P';
  IF r.c_units<>0.5 OR r.c_capital<>250000 OR r.c_balance<>125000 OR r.c_funded<>250000 OR r.req_capital<>250000 OR r.req_profit<>100000 OR r.withdrawal_amount<>350000 THEN
    RAISE EXCEPTION 'TEST FAIL P: units % capital % balance % funded % req cap % req profit % wd %', r.c_units, r.c_capital, r.c_balance, r.c_funded, r.req_capital, r.req_profit, r.withdrawal_amount; END IF;
  RAISE NOTICE 'PASS P: partial 0.5 after rollover_all -> 250,000 + 100,000 paid; capital 250,000 / balance 125,000 continue';

  SELECT * INTO r FROM v_b WHERE who='L';
  IF r.c_capital<>500000 OR r.c_balance<>225000 OR r.capital_rolled_over<>625000 OR r.total_rollover_amount<>725000 THEN
    RAISE EXCEPTION 'TEST FAIL E: legacy row -> capital % balance % (audit cap % total %) — expected identical to R', r.c_capital, r.c_balance, r.capital_rolled_over, r.total_rollover_amount; END IF;
  RAISE NOTICE 'PASS E: legacy 625,000 + 125,000 row rolls to exactly what R got — the 125,000 was counted once';

  SELECT * INTO r FROM v_b WHERE who='X';
  IF r.next_investment_id IS NOT NULL OR r.cr_status<>'withdrawn' OR r.b_status::text<>'completed' THEN RAISE EXCEPTION 'TEST FAIL X: successor % status % cr %', r.next_investment_id, r.b_status, r.cr_status; END IF;
  IF r.withdrawal_amount<>725000 OR r.req_capital<>625000 OR r.req_profit<>100000 OR r.req_capital+r.req_profit<>r.withdrawal_amount THEN
    RAISE EXCEPTION 'TEST FAIL X: entitlement % but requests capital % + profit % = %', r.withdrawal_amount, r.req_capital, r.req_profit, r.req_capital+r.req_profit; END IF;
  RAISE NOTICE 'PASS X: exit in Cycle B with a balance -> requests 625,000 capital (500k + 125k carried) + 100,000 profit = entitlement 725,000';
END $$;

-- ── Cycle C: R exits after the two rollover_all cycles (test D) ──
INSERT INTO rollover_decisions (investment_id,investor_id,source_cycle_id,decision,bank_name,account_name,account_number)
SELECT c_id, '20000000-0000-0000-0000-00000000dd01', '40000000-0000-0000-0000-00000000dd03', 'exit', 'GTBank', 'R', '00001' FROM v_b WHERE who='R';
-- Cycle C holds R (1), K (1), P (0.5), L (1) = 3.5 slots: revenue 700,000 -> pot 350,000 -> 100,000 per slot.
SELECT (declare_cycle_profit('40000000-0000-0000-0000-00000000dd03',700000,0,'C',NULL,FALSE))->>'profit_per_slot_net' AS cycle_c_net_per_slot;
DO $$ DECLARE r JSONB; v_cid UUID; v_cap NUMERIC; v_roi NUMERIC; v_wd NUMERIC; v_nx UUID; v_s TEXT; BEGIN
  r := process_cycle_rollover('40000000-0000-0000-0000-00000000dd03','40000000-0000-0000-0000-00000000dd04',FALSE);
  IF (r->>'failed')::int<>0 THEN RAISE EXCEPTION 'TEST FAIL D-batch: %', r->'results'; END IF;
  SELECT c_id INTO v_cid FROM v_b WHERE who='R';
  SELECT COALESCE(SUM(amount) FILTER (WHERE type='capital'),0), COALESCE(SUM(amount) FILTER (WHERE type='roi'),0) INTO v_cap, v_roi FROM payment_requests WHERE investment_id=v_cid;
  SELECT withdrawal_amount INTO v_wd FROM cycle_rollovers WHERE previous_investment_id=v_cid;
  SELECT next_investment_id, status::text INTO v_nx, v_s FROM investments WHERE id=v_cid;
  IF v_cap<>725000 THEN RAISE EXCEPTION 'TEST FAIL D: capital request % — expected 500,000 + 225,000 carried', v_cap; END IF;
  IF v_roi<>100000 THEN RAISE EXCEPTION 'TEST FAIL D: profit request % — expected Cycle C''s 100,000 only', v_roi; END IF;
  IF v_wd<>825000 OR v_cap+v_roi<>v_wd THEN RAISE EXCEPTION 'TEST FAIL D: engine entitlement % vs requests %', v_wd, v_cap+v_roi; END IF;
  IF v_nx IS NOT NULL OR v_s<>'completed' THEN RAISE EXCEPTION 'TEST FAIL D: successor % status %', v_nx, v_s; END IF;
  RAISE NOTICE 'PASS D: exit after two rollover_all cycles -> requests 725,000 capital (500k + 225k carried) + 100,000 profit = engine entitlement 825,000; no successor';
END $$;

-- Conservation: everything that ever went in is either held in Cycle D or requested for payment. Nothing lost, nothing doubled.
DO $$ DECLARE v_in NUMERIC; v_paid NUMERIC; v_held NUMERIC; BEGIN
  -- in: 4 x 500,000 original + legacy L's 625,000 of value; profit: A 4 x 125,000; B 5 x 100,000; C 3.5 slots x 100,000
  v_in   := 4*500000 + 625000 + 4*125000 + 5*100000 + 350000;
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM payment_requests;
  SELECT COALESCE(SUM(capital + rollover_balance),0) INTO v_held FROM investments WHERE cycle_id='40000000-0000-0000-0000-00000000dd04';
  RAISE NOTICE 'value in %  requested %  held in Cycle D %  unaccounted %', v_in, v_paid, v_held, v_in - v_paid - v_held;
  IF v_in - v_paid - v_held <> 0 THEN RAISE EXCEPTION 'TEST FAIL conservation: % unaccounted for', v_in - v_paid - v_held; END IF;
  RAISE NOTICE 'PASS conservation: every naira across four cycles is either held or requested — nothing lost, nothing counted twice';
END $$;
ROLLBACK;
\echo '=== ALL MULTI-CYCLE SCENARIOS PASSED ==='
