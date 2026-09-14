-- ============================================================
-- One rollover engine — migration 048 draft
--   T1 continue: full capital, funded, both paths
--   T2 partial: remaining capital only; withdrawn part requested
--   T3 exit: NO successor, closed, withdrawn, both requests
--   T4 idempotent: batch re-run rolls 0; engine refuses a repeat
--   T6 batch ≡ individual for continue / partial / rollover_all
--   T7 rollover_all: capital = slots x price, profit in balance, audit reconciles
--   T8 admin reversal restores 'matured' and re-enrolment works
--   T9 individual path still refuses exit; engine exit never creates a successor
--   T10 profit-to-slots flag refused
--   T12 nothing left 'awaiting rollover' after the batch
-- ============================================================
\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;
BEGIN;
UPDATE series SET price_per_unit = 500000 WHERE name = 'A';

INSERT INTO auth.users (id,email)
SELECT ('a0000000-0000-0000-0000-00000000ee0'||n)::uuid, 'eng'||n||'@t.com' FROM generate_series(0,9) n ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role)
SELECT ('a0000000-0000-0000-0000-00000000ee0'||n)::uuid,'eng'||n||'@t.com','Eng '||n,
       CASE WHEN n=0 THEN 'super_admin' ELSE 'investor' END::user_role FROM generate_series(0,9) n
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
SET LOCAL test.uid='a0000000-0000-0000-0000-00000000ee00';
INSERT INTO investors (id,profile_id,investor_code,full_name,email,phone,bank_name,account_name,account_number)
SELECT ('20000000-0000-0000-0000-00000000ee0'||n)::uuid,('a0000000-0000-0000-0000-00000000ee0'||n)::uuid,
       'MG-ENG'||n,'Eng '||n,'eng'||n||'@t.com','0800'||n,'GTBank','Eng '||n,'00000'||n
FROM generate_series(1,9) n ON CONFLICT DO NOTHING;

INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,total_slots,status) VALUES
 ('40000000-0000-0000-0000-00000000ee01',(SELECT id FROM series WHERE name='A'),601,'30 May - 30 Aug','2026-05-30','2026-08-30',100,'active'),
 ('40000000-0000-0000-0000-00000000ee02',(SELECT id FROM series WHERE name='A'),602,'30 Aug - 30 Nov','2026-08-30','2026-11-30',100,'active');

-- n3/n4 hold 2 slots (partial withdraws 1); everyone else 1 slot.
INSERT INTO investments (id,investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status)
SELECT ('50000000-0000-0000-0000-00000000ee0'||n)::uuid,'ENG-'||n,('20000000-0000-0000-0000-00000000ee0'||n)::uuid,
       (SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ee01',
       CASE WHEN n IN (3,4) THEN 2 ELSE 1 END,500000,CASE WHEN n IN (3,4) THEN 1000000 ELSE 500000 END,
       '2026-05-30','2026-08-30','active'
FROM generate_series(1,9) n;

INSERT INTO rollover_decisions (investment_id,investor_id,source_cycle_id,decision,slots_to_withdraw,bank_name,account_name,account_number)
SELECT ('50000000-0000-0000-0000-00000000ee0'||n)::uuid,('20000000-0000-0000-0000-00000000ee0'||n)::uuid,'40000000-0000-0000-0000-00000000ee01',
       d, s, 'GTBank','Eng '||n,'00000'||n
FROM (VALUES (1,'continue'::maturity_decision,NULL::numeric),(2,'continue',NULL),(3,'partial_exit',1),(4,'partial_exit',1),
             (5,'exit',NULL),(6,'rollover_all',NULL),(7,'rollover_all',NULL),(9,'continue',NULL)) v(n,d,s);
-- n8: no decision at all.

SELECT (declare_cycle_profit('40000000-0000-0000-0000-00000000ee01', 2500000, 0, 'engine', NULL, FALSE))->>'profit_per_slot' AS profit_per_slot;

-- INDIVIDUAL path for 1, 3, 6, 9 (and 5, which must refuse)
SELECT mudarabah_enrol_next_cycle('50000000-0000-0000-0000-00000000ee01')->>'outcome' AS i1,
       mudarabah_enrol_next_cycle('50000000-0000-0000-0000-00000000ee03')->>'outcome' AS i3,
       mudarabah_enrol_next_cycle('50000000-0000-0000-0000-00000000ee06')->>'outcome' AS i6,
       mudarabah_enrol_next_cycle('50000000-0000-0000-0000-00000000ee09')->>'outcome' AS i9,
       mudarabah_enrol_next_cycle('50000000-0000-0000-0000-00000000ee05')->>'reason'  AS i5_reason;

DO $$ BEGIN
  IF (mudarabah_enrol_next_cycle('50000000-0000-0000-0000-00000000ee05')->>'reason') <> 'capital withdrawn' THEN
    RAISE EXCEPTION 'TEST FAIL T9a: the individual path no longer refuses an exit';
  END IF;
  RAISE NOTICE 'PASS T9a: individual path still refuses exit with "capital withdrawn"';
END $$;

-- T10
DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM process_cycle_rollover('40000000-0000-0000-0000-00000000ee01','40000000-0000-0000-0000-00000000ee02',TRUE);
    RAISE EXCEPTION 'TEST FAIL T10: convert_profit_to_slots=TRUE was accepted';
  EXCEPTION WHEN OTHERS THEN v_msg := SQLERRM; IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF; END;
  IF v_msg NOT LIKE '%not supported%' THEN RAISE EXCEPTION 'TEST FAIL T10: wrong refusal — %', v_msg; END IF;
  RAISE NOTICE 'PASS T10: profit-to-slots flag refused: %', v_msg;
END $$;

-- BATCH for everyone else (2, 4, 5, 7, 8); 1,3,6,9 already moved.
DO $$ DECLARE r JSONB; BEGIN
  r := process_cycle_rollover('40000000-0000-0000-0000-00000000ee01','40000000-0000-0000-0000-00000000ee02',FALSE);
  PERFORM set_config('t.batch1', r::text, TRUE);
  IF (r->>'failed')::int <> 0 THEN RAISE EXCEPTION 'TEST FAIL batch: % failed — %', r->>'failed', r->'results'; END IF;
  IF (r->>'rolled')::int <> 4 OR (r->>'withdrawn')::int <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL batch: expected 4 rolled / 1 withdrawn, got % / %', r->>'rolled', r->>'withdrawn';
  END IF;
  RAISE NOTICE 'PASS batch: 4 rolled, 1 withdrawn, 0 failed, % skipped', r->>'skipped';
END $$;

-- Per-investor view used by the assertions
CREATE TEMP VIEW v_out AS
SELECT o.investment_code AS old_code, RIGHT(o.investment_code,1)::int AS n, o.status AS old_status,
       o.next_investment_id, rd.decision,
       nw.units AS new_units, nw.price_per_unit AS new_price, nw.capital AS new_capital,
       nw.rollover_balance AS new_balance, nw.investment_date AS new_start, nw.maturity_date AS new_end,
       nw.status AS new_status, nw.parent_investment_id = o.id AS parent_ok,
       COALESCE(investment_confirmed_paid(nw.id),0) AS funded,
       cr.status AS cr_status, cr.method, cr.units AS cr_units, cr.capital_rolled_over, cr.profit_rolled_over,
       cr.total_rollover_amount, cr.rollover_balance AS cr_balance, cr.withdrawal_amount, cr.slots_withdrawn,
       cr.destination_cycle_id AS cr_dest
FROM investments o
LEFT JOIN rollover_decisions rd ON rd.investment_id=o.id
LEFT JOIN investments nw ON nw.id=o.next_investment_id
LEFT JOIN cycle_rollovers cr ON cr.previous_investment_id=o.id
WHERE o.cycle_id='40000000-0000-0000-0000-00000000ee01';

\echo '=== outcome per investor ==='
SELECT n, decision, old_status, new_units, new_capital, new_balance, funded, cr_status, method,
       capital_rolled_over AS cr_cap, profit_rolled_over AS cr_profit, total_rollover_amount AS cr_total, withdrawal_amount AS cr_wd
FROM v_out ORDER BY n;

-- T1
DO $$ DECLARE r v_out%ROWTYPE; BEGIN
  FOR r IN SELECT * FROM v_out WHERE n IN (1,2) LOOP
    IF r.new_capital <> 500000 OR r.funded <> 500000 OR r.new_balance <> 0 OR r.new_units <> 1 THEN
      RAISE EXCEPTION 'TEST FAIL T1 (n=%): capital % funded % balance %', r.n, r.new_capital, r.funded, r.new_balance;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS T1: continue rolls the full 500,000, funded, both paths';
END $$;

-- T2
DO $$ DECLARE r v_out%ROWTYPE; v_cap NUMERIC; BEGIN
  FOR r IN SELECT * FROM v_out WHERE n IN (3,4) LOOP
    IF r.new_units <> 1 OR r.new_capital <> 500000 OR r.funded <> 500000 OR r.new_balance <> 0 THEN
      RAISE EXCEPTION 'TEST FAIL T2 (n=%): units % capital % funded % — must be the REMAINING 500,000 only', r.n, r.new_units, r.new_capital, r.funded;
    END IF;
    IF r.capital_rolled_over <> 500000 OR r.slots_withdrawn <> 1 THEN
      RAISE EXCEPTION 'TEST FAIL T2 (n=%): audit capital_rolled_over % slots_withdrawn %', r.n, r.capital_rolled_over, r.slots_withdrawn;
    END IF;
    SELECT MAX(amount) INTO v_cap FROM payment_requests pr JOIN investments i ON i.id=pr.investment_id
     WHERE i.investment_code = r.old_code AND pr.type='capital';
    IF v_cap <> 500000 THEN RAISE EXCEPTION 'TEST FAIL T2 (n=%): withdrawn capital request is %', r.n, v_cap; END IF;
  END LOOP;
  RAISE NOTICE 'PASS T2: partial exit — 1 of 2 slots paid out (500,000 requested), 500,000 rolls, both paths';
END $$;

-- T3 + T9b
DO $$ DECLARE r v_out%ROWTYPE; v_n INT; BEGIN
  SELECT * INTO r FROM v_out WHERE n=5;
  IF r.next_investment_id IS NOT NULL THEN RAISE EXCEPTION 'TEST FAIL T3: exit got a successor (%)', r.next_investment_id; END IF;
  SELECT COUNT(*) INTO v_n FROM investments WHERE parent_investment_id='50000000-0000-0000-0000-00000000ee05';
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL T3: % successor row(s) exist for the exit', v_n; END IF;
  IF r.old_status::text <> 'completed' THEN RAISE EXCEPTION 'TEST FAIL T3: exit left old status %', r.old_status; END IF;
  IF r.cr_status <> 'withdrawn' OR r.cr_dest IS NOT NULL THEN RAISE EXCEPTION 'TEST FAIL T3: cycle_rollovers status % dest %', r.cr_status, r.cr_dest; END IF;
  IF r.withdrawal_amount <> 500000 + (SELECT declared_profit_net FROM investments WHERE id='50000000-0000-0000-0000-00000000ee05') THEN
    RAISE EXCEPTION 'TEST FAIL T3: withdrawal_amount % must be capital 500,000 + the net profit', r.withdrawal_amount; END IF;
  SELECT COUNT(*) INTO v_n FROM payment_requests WHERE investment_id='50000000-0000-0000-0000-00000000ee05';
  IF v_n <> 2 THEN RAISE EXCEPTION 'TEST FAIL T3: expected roi + capital requests, found %', v_n; END IF;
  RAISE NOTICE 'PASS T3/T9b: exit — no successor, closed, withdrawn, capital+profit requested';
END $$;

-- T7
DO $$ DECLARE r v_out%ROWTYPE; v_net NUMERIC; BEGIN
  FOR r IN SELECT * FROM v_out WHERE n IN (6,7) LOOP
    SELECT declared_profit_net INTO v_net FROM investments WHERE investment_code = r.old_code;
    IF v_net <= 0 THEN RAISE EXCEPTION 'TEST FAIL T7: vacuous — no net profit declared'; END IF;
    IF r.new_capital <> 500000 OR r.new_balance <> v_net OR r.funded <> 500000 THEN
      RAISE EXCEPTION 'TEST FAIL T7 (n=%): capital % balance % funded % — expected 500,000 / % / 500,000', r.n, r.new_capital, r.new_balance, r.funded, v_net;
    END IF;
    IF r.capital_rolled_over <> 500000 OR r.profit_rolled_over <> v_net OR r.total_rollover_amount <> 500000 + v_net
       OR r.capital_rolled_over + r.profit_rolled_over <> r.total_rollover_amount OR r.withdrawal_amount <> 0 THEN
      RAISE EXCEPTION 'TEST FAIL T7 (n=%): audit cap % profit % total % wd % do not reconcile', r.n, r.capital_rolled_over, r.profit_rolled_over, r.total_rollover_amount, r.withdrawal_amount;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS T7: rollover_all — capital 500,000, balance 250,000 (never both), audit reconciles, both paths';
END $$;

-- T6: pairwise identical records for equal decisions via different paths
DO $$ DECLARE a v_out%ROWTYPE; b v_out%ROWTYPE; p INT[]; BEGIN
  FOREACH p SLICE 1 IN ARRAY ARRAY[[1,2],[3,4],[6,7]] LOOP
    SELECT * INTO a FROM v_out WHERE n=p[1]; SELECT * INTO b FROM v_out WHERE n=p[2];
    IF (a.old_status, a.new_units, a.new_price, a.new_capital, a.new_balance, a.new_start, a.new_end, a.new_status, a.parent_ok, a.funded,
        a.cr_status, a.cr_units, a.capital_rolled_over, a.profit_rolled_over, a.total_rollover_amount, a.cr_balance, a.withdrawal_amount, a.slots_withdrawn, a.cr_dest)
       IS DISTINCT FROM
       (b.old_status, b.new_units, b.new_price, b.new_capital, b.new_balance, b.new_start, b.new_end, b.new_status, b.parent_ok, b.funded,
        b.cr_status, b.cr_units, b.capital_rolled_over, b.profit_rolled_over, b.total_rollover_amount, b.cr_balance, b.withdrawal_amount, b.slots_withdrawn, b.cr_dest) THEN
      RAISE EXCEPTION 'TEST FAIL T6: individual (n=%) and batch (n=%) differ for decision %', p[1], p[2], a.decision;
    END IF;
    IF a.method <> 'investor_choice' OR b.method <> 'investor_choice' THEN
      RAISE EXCEPTION 'TEST FAIL T6: method differs (% / %) although both had a submitted decision', a.method, b.method;
    END IF;
  END LOOP;
  RAISE NOTICE 'PASS T6: continue / partial / rollover_all produce IDENTICAL records via either path';
END $$;

-- T12 + status
DO $$ DECLARE v_n INT; BEGIN
  SELECT COUNT(*) INTO v_n FROM investments WHERE cycle_id='40000000-0000-0000-0000-00000000ee01' AND status='matured';
  IF v_n <> 0 THEN RAISE EXCEPTION 'TEST FAIL T12: % investment(s) still read as awaiting rollover', v_n; END IF;
  IF (SELECT rollover_processed_at FROM cycles WHERE id='40000000-0000-0000-0000-00000000ee01') IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL T12: rollover_processed_at not set';
  END IF;
  IF (SELECT method FROM v_out WHERE n=8) <> 'automatic' OR (SELECT new_capital FROM v_out WHERE n=8) <> 500000 THEN
    RAISE EXCEPTION 'TEST FAIL T12: no-decision investor not rolled as automatic/continue';
  END IF;
  RAISE NOTICE 'PASS T12: nothing left matured; no-decision investor rolled as automatic continue (unchanged policy)';
END $$;

-- T4
DO $$ DECLARE r JSONB; v_before INT; v_after INT; BEGIN
  SELECT COUNT(*) INTO v_before FROM investments WHERE cycle_id='40000000-0000-0000-0000-00000000ee02';
  r := process_cycle_rollover('40000000-0000-0000-0000-00000000ee01','40000000-0000-0000-0000-00000000ee02',FALSE);
  SELECT COUNT(*) INTO v_after FROM investments WHERE cycle_id='40000000-0000-0000-0000-00000000ee02';
  IF (r->>'rolled')::int <> 0 OR v_after <> v_before THEN RAISE EXCEPTION 'TEST FAIL T4: re-run rolled % / created %', r->>'rolled', v_after-v_before; END IF;
  -- direct repeat through the engine
  r := mudarabah_roll_one('50000000-0000-0000-0000-00000000ee01','continue',0,'40000000-0000-0000-0000-00000000ee02','investor_choice');
  IF r->>'outcome' <> 'skipped' OR r->>'reason' <> 'already enrolled' THEN RAISE EXCEPTION 'TEST FAIL T4: engine repeat gave %', r; END IF;
  r := mudarabah_roll_one('50000000-0000-0000-0000-00000000ee05','continue',0,'40000000-0000-0000-0000-00000000ee02','automatic');
  IF r->>'outcome' <> 'skipped' OR r->>'reason' <> 'already closed' THEN RAISE EXCEPTION 'TEST FAIL T4: engine on a closed exit gave %', r; END IF;
  SELECT COUNT(*) INTO v_after FROM investments WHERE cycle_id='40000000-0000-0000-0000-00000000ee02';
  IF v_after <> v_before THEN RAISE EXCEPTION 'TEST FAIL T4: engine repeats created rows'; END IF;
  RAISE NOTICE 'PASS T4: batch re-run rolls 0; engine refuses repeats (already enrolled / already closed); % investments in destination', v_after;
END $$;

-- T8: admin reversal round trip on n=9
DO $$ DECLARE r JSONB; s TEXT; nx UUID; BEGIN
  r := mudarabah_unenrol_next_cycle('50000000-0000-0000-0000-00000000ee09');
  IF NOT (r->>'reversed')::boolean THEN RAISE EXCEPTION 'TEST FAIL T8: reversal refused — %', r; END IF;
  SELECT status::text, next_investment_id INTO s, nx FROM investments WHERE id='50000000-0000-0000-0000-00000000ee09';
  IF s <> 'matured' OR nx IS NOT NULL THEN RAISE EXCEPTION 'TEST FAIL T8: after reversal status % next %', s, nx; END IF;
  IF EXISTS (SELECT 1 FROM cycle_rollovers WHERE previous_investment_id='50000000-0000-0000-0000-00000000ee09') THEN
    RAISE EXCEPTION 'TEST FAIL T8: cycle_rollovers row survived reversal'; END IF;
  r := mudarabah_enrol_next_cycle('50000000-0000-0000-0000-00000000ee09');
  IF r->>'outcome' <> 'rolled' THEN RAISE EXCEPTION 'TEST FAIL T8: re-enrolment after reversal gave %', r; END IF;
  SELECT status::text INTO s FROM investments WHERE id='50000000-0000-0000-0000-00000000ee09';
  IF s <> 'completed' THEN RAISE EXCEPTION 'TEST FAIL T8: re-enrolled but status %', s; END IF;
  RAISE NOTICE 'PASS T8: reversal restores matured; re-enrolment succeeds and closes it again';
END $$;

ROLLBACK;
\echo '=== ALL ENGINE SCENARIOS PASSED ==='
