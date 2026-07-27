-- ============================================================
-- The next cycle, and instructions that are final — migration 036
--
-- Settling a cycle used to leave nothing waiting on the other side of
-- it: create_next_cycle existed but only a super admin pressing a
-- button ever called it, and it started the new cycle on the SAME day
-- the old one ended. An investor who chose to continue was not put
-- anywhere until an administrator processed the whole cycle in bulk.
--
--   N1  the successor starts the DAY AFTER, not the same day
--   N2  ensure_next_cycle is idempotent — no duplicate on a rerun
--   N3  a cycle created under the OLD same-day rule still resolves
--   N4  choosing to continue enrols you immediately
--   N5  the carried capital is recorded, so the new cycle is FUNDED
--   N6  the decision is final — a second attempt is refused
--   N7  a partial exit carries only the slots that stayed
--   N8  an exit enrols nobody, and is final too
--   N9  nothing is enrolled before the cycle settles
--   N10 the bulk rollover does not enrol an investor twice
--   N11 a super admin can still correct a locked instruction
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-0000000dd001','na@t.com'),
 ('10000000-0000-0000-0000-0000000dd001','n1@t.com'),
 ('10000000-0000-0000-0000-0000000dd002','n2@t.com'),
 ('10000000-0000-0000-0000-0000000dd003','n3@t.com'),
 ('10000000-0000-0000-0000-0000000dd004','n4@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-0000000dd001','na@t.com','N Admin','super_admin'),
 ('10000000-0000-0000-0000-0000000dd001','n1@t.com','N One','investor'),
 ('10000000-0000-0000-0000-0000000dd002','n2@t.com','N Two','investor'),
 ('10000000-0000-0000-0000-0000000dd003','n3@t.com','N Three','investor'),
 ('10000000-0000-0000-0000-0000000dd004','n4@t.com','N Four','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
INSERT INTO investors (id,profile_id,investor_code,full_name,email,bank_name,account_name,account_number) VALUES
 ('20000000-0000-0000-0000-0000000dd001','10000000-0000-0000-0000-0000000dd001','MGN001','N One','n1@t.com','GTB','N One','0000000001'),
 ('20000000-0000-0000-0000-0000000dd002','10000000-0000-0000-0000-0000000dd002','MGN002','N Two','n2@t.com','GTB','N Two','0000000002'),
 ('20000000-0000-0000-0000-0000000dd003','10000000-0000-0000-0000-0000000dd003','MGN003','N Three','n3@t.com','GTB','N Three','0000000003'),
 ('20000000-0000-0000-0000-0000000dd004','10000000-0000-0000-0000-0000000dd004','MGN004','N Four','n4@t.com','GTB','N Four','0000000004')
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-0000000dd001','C','Series C',0,500000,0.50)
ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;

-- The source cycle: settled, ending today.
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
 VALUES ('40000000-0000-0000-0000-0000000dd001',(SELECT id FROM series WHERE name='C'),
   9901,'N-9901', CURRENT_DATE - 90, CURRENT_DATE, 'completed', 500000);

-- Four settled enrolments. 10% withheld, so ₦90,000 of every
-- ₦100,000 declared is actually due.
INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,
  investment_date,maturity_date,status,declared_profit,declared_wht,declared_profit_net)
VALUES
 ('N-1','20000000-0000-0000-0000-0000000dd001',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-0000000dd001',6,500000,3000000,CURRENT_DATE-90,CURRENT_DATE,'matured',300000,30000,270000),
 ('N-2','20000000-0000-0000-0000-0000000dd002',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-0000000dd001',4,500000,2000000,CURRENT_DATE-90,CURRENT_DATE,'matured',200000,20000,180000),
 ('N-3','20000000-0000-0000-0000-0000000dd003',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-0000000dd001',2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'matured',100000,10000,90000),
 ('N-4','20000000-0000-0000-0000-0000000dd004',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-0000000dd001',2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'matured',100000,10000,90000);

-- Settled, so the rollover's own precondition is satisfied too.
INSERT INTO cycle_profit_declarations (cycle_id,total_revenue,total_expenses,net_profit,
  investor_profit_share,company_profit_share,profit_per_slot,total_slots,wht_rate,
  wht_per_slot,profit_per_slot_net,total_wht)
VALUES ('40000000-0000-0000-0000-0000000dd001',1400000,0,1400000,700000,700000,50000,14,0.10,5000,45000,70000);

-- ------------------------------------------------------------
-- N1 — the successor begins the day AFTER the source ends
-- ------------------------------------------------------------
DO $$ DECLARE v_id UUID; v_start DATE; v_end DATE; BEGIN
  v_id := mudarabah_ensure_next_cycle('40000000-0000-0000-0000-0000000dd001');
  SELECT start_date, end_date INTO v_start, v_end FROM cycles WHERE id = v_id;

  IF v_start <> CURRENT_DATE + 1 THEN
    RAISE EXCEPTION 'TEST FAIL N1: next cycle starts %, expected % (the day after)',
      v_start, CURRENT_DATE + 1;
  END IF;
  IF v_end <> (CURRENT_DATE + 1 + INTERVAL '3 months' - INTERVAL '1 day')::DATE THEN
    RAISE EXCEPTION 'TEST FAIL N1: next cycle ends %, expected a three-month cycle', v_end;
  END IF;
  RAISE NOTICE 'PASS N1 — successor runs % to %', v_start, v_end;
END $$;

-- ------------------------------------------------------------
-- N2 — calling it again returns the SAME cycle, not a second one
-- ------------------------------------------------------------
DO $$ DECLARE v_a UUID; v_b UUID; v_n INT; BEGIN
  v_a := mudarabah_ensure_next_cycle('40000000-0000-0000-0000-0000000dd001');
  v_b := mudarabah_ensure_next_cycle('40000000-0000-0000-0000-0000000dd001');
  IF v_a <> v_b THEN
    RAISE EXCEPTION 'TEST FAIL N2: two calls produced different cycles % and %', v_a, v_b;
  END IF;

  SELECT COUNT(*) INTO v_n FROM cycles
   WHERE series_id = (SELECT id FROM series WHERE name='C') AND cycle_number = 9902;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL N2: % successor cycles exist, expected 1', v_n;
  END IF;
  RAISE NOTICE 'PASS N2 — idempotent';
END $$;

-- ------------------------------------------------------------
-- N3 — a cycle created under the OLD same-day rule still resolves.
--
--      This is the whole reason the lookup moved from an exact date
--      equality into a function. Every cycle in production today
--      starts on its predecessor's end date.
-- ------------------------------------------------------------
DO $$ DECLARE v_id UUID; BEGIN
  INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
  VALUES ('40000000-0000-0000-0000-0000000dd09a',(SELECT id FROM series WHERE name='C'),
    9801,'N-9801-legacy', CURRENT_DATE - 200, CURRENT_DATE - 110, 'completed', 500000);
  -- Legacy convention: starts ON the predecessor's end date.
  INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
  VALUES ('40000000-0000-0000-0000-0000000dd09b',(SELECT id FROM series WHERE name='C'),
    9802,'N-9802-legacy', CURRENT_DATE - 110, CURRENT_DATE - 20, 'completed', 500000);

  v_id := mudarabah_next_cycle('40000000-0000-0000-0000-0000000dd09a');
  IF v_id IS DISTINCT FROM '40000000-0000-0000-0000-0000000dd09b' THEN
    RAISE EXCEPTION 'TEST FAIL N3: a same-day successor no longer resolves (got %)', v_id;
  END IF;
  RAISE NOTICE 'PASS N3 — both conventions resolve';
END $$;

-- ------------------------------------------------------------
-- N4 / N5 — continuing enrols you, and the enrolment is FUNDED
-- ------------------------------------------------------------
SELECT set_config('test.uid','10000000-0000-0000-0000-0000000dd001',false);

DO $$
DECLARE
  v_old UUID; v_new UUID; v_units NUMERIC; v_capital NUMERIC;
  v_paid NUMERIC; v_dest UUID; v_gaps INT;
BEGIN
  SELECT id INTO v_old FROM investments WHERE investment_code='N-1';
  PERFORM submit_rollover_decision(v_old, 'continue'::maturity_decision);

  SELECT next_investment_id INTO v_new FROM investments WHERE id = v_old;
  IF v_new IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL N4: continuing did not enrol the investor anywhere';
  END IF;

  SELECT units, capital, cycle_id INTO v_units, v_capital, v_dest
    FROM investments WHERE id = v_new;
  IF v_units <> 6 THEN
    RAISE EXCEPTION 'TEST FAIL N4: carried % slots, expected 6', v_units;
  END IF;
  IF v_capital <> 3000000 THEN
    RAISE EXCEPTION 'TEST FAIL N4: new capital is %, expected 3000000', v_capital;
  END IF;
  IF v_dest <> mudarabah_next_cycle('40000000-0000-0000-0000-0000000dd001') THEN
    RAISE EXCEPTION 'TEST FAIL N4: enrolled into the wrong cycle';
  END IF;

  -- N5. Without the carry-forward record this enrolment has capital
  -- and no money behind it, and the whole cycle reads as unfunded.
  v_paid := investment_confirmed_paid(v_new);
  IF v_paid <> 3000000 THEN
    RAISE EXCEPTION 'TEST FAIL N5: carried-forward payment is %, expected 3000000', v_paid;
  END IF;

  SELECT COUNT(*) INTO v_gaps FROM investment_funding_gaps(v_dest);
  IF v_gaps <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL N5: the new cycle reports % funding gap(s)', v_gaps;
  END IF;

  RAISE NOTICE 'PASS N4/N5 — 6 slots carried and fully funded';
END $$;

-- ------------------------------------------------------------
-- N6 — and that decision is FINAL
-- ------------------------------------------------------------
DO $$ DECLARE v_old UUID; v_msg TEXT; BEGIN
  SELECT id INTO v_old FROM investments WHERE investment_code='N-1';
  BEGIN
    PERFORM submit_rollover_decision(v_old, 'exit'::maturity_decision);
    RAISE EXCEPTION 'TEST FAIL N6: the instruction was changed after submission';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;

  IF NOT (SELECT locked FROM rollover_decisions WHERE investment_id = v_old) THEN
    RAISE EXCEPTION 'TEST FAIL N6: the decision was not marked locked';
  END IF;
  RAISE NOTICE 'PASS N6 — refused with: %', v_msg;
END $$;

-- ------------------------------------------------------------
-- N7 — a partial exit carries only the slots that stayed
-- ------------------------------------------------------------
SELECT set_config('test.uid','10000000-0000-0000-0000-0000000dd002',false);

DO $$
DECLARE v_old UUID; v_new UUID; v_units NUMERIC; v_capital NUMERIC; v_cap_req NUMERIC;
BEGIN
  SELECT id INTO v_old FROM investments WHERE investment_code='N-2';
  PERFORM submit_rollover_decision(v_old, 'partial_exit'::maturity_decision,
    NULL, NULL, NULL, NULL, FALSE, 1.5);

  SELECT next_investment_id INTO v_new FROM investments WHERE id = v_old;
  SELECT units, capital INTO v_units, v_capital FROM investments WHERE id = v_new;

  IF v_units <> 2.5 THEN
    RAISE EXCEPTION 'TEST FAIL N7: carried % slots, expected 2.5 (4 less 1.5)', v_units;
  END IF;
  IF v_capital <> 1250000 THEN
    RAISE EXCEPTION 'TEST FAIL N7: carried capital is %, expected 1250000', v_capital;
  END IF;
  IF investment_confirmed_paid(v_new) <> 1250000 THEN
    RAISE EXCEPTION 'TEST FAIL N7: carried-forward payment is %, expected 1250000',
      investment_confirmed_paid(v_new);
  END IF;

  -- The withdrawn slots are still requested as cash.
  SELECT amount INTO v_cap_req FROM payment_requests
   WHERE investment_id = v_old AND type = 'capital';
  IF v_cap_req <> 750000 THEN
    RAISE EXCEPTION 'TEST FAIL N7: capital request is %, expected 750000', v_cap_req;
  END IF;
  RAISE NOTICE 'PASS N7 — 2.5 slots continue, 1.5 paid out';
END $$;

-- ------------------------------------------------------------
-- N8 — an exit enrols nobody, and is final all the same.
--
--      Nothing sets next_investment_id here, so the locked flag is
--      the only thing making it final. That is why it is set.
-- ------------------------------------------------------------
SELECT set_config('test.uid','10000000-0000-0000-0000-0000000dd003',false);

DO $$ DECLARE v_old UUID; v_msg TEXT; BEGIN
  SELECT id INTO v_old FROM investments WHERE investment_code='N-3';
  PERFORM submit_rollover_decision(v_old, 'exit'::maturity_decision);

  IF (SELECT next_investment_id FROM investments WHERE id = v_old) IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL N8: an exit was enrolled into the next cycle';
  END IF;

  BEGIN
    PERFORM submit_rollover_decision(v_old, 'continue'::maturity_decision);
    RAISE EXCEPTION 'TEST FAIL N8: an exit was changed after submission';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS N8 — refused with: %', v_msg;
END $$;

-- ------------------------------------------------------------
-- N9 — nothing is enrolled before the cycle settles
-- ------------------------------------------------------------
DO $$ DECLARE v_id UUID; v_res JSONB; BEGIN
  INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
  VALUES ('40000000-0000-0000-0000-0000000dd0ff',(SELECT id FROM series WHERE name='C'),
    9701,'N-9701-unsettled', CURRENT_DATE - 30, CURRENT_DATE + 60, 'active', 500000);

  INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,
    investment_date,maturity_date,status)
  VALUES ('N-9','20000000-0000-0000-0000-0000000dd001',(SELECT id FROM series WHERE name='C'),
    '40000000-0000-0000-0000-0000000dd0ff',1,500000,500000,CURRENT_DATE-30,CURRENT_DATE+60,'active')
  RETURNING id INTO v_id;

  v_res := mudarabah_enrol_next_cycle(v_id);
  IF (v_res->>'enrolled')::BOOLEAN THEN
    RAISE EXCEPTION 'TEST FAIL N9: enrolled out of an unsettled cycle';
  END IF;
  IF v_res->>'reason' <> 'cycle not settled yet' THEN
    RAISE EXCEPTION 'TEST FAIL N9: refused for the wrong reason — %', v_res->>'reason';
  END IF;
  RAISE NOTICE 'PASS N9 — %', v_res->>'reason';
END $$;

-- ------------------------------------------------------------
-- N10 — the bulk rollover does not enrol anyone a second time.
--
--       N-1 and N-2 already went across on submission; N-4 never
--       decided, so silence continues their capital. N-3 exited.
-- ------------------------------------------------------------
SELECT set_config('test.uid','a0000000-0000-0000-0000-0000000dd001',false);

DO $$
DECLARE v_res JSONB; v_n INT; v_units NUMERIC; v_dest UUID;
BEGIN
  v_dest := mudarabah_next_cycle('40000000-0000-0000-0000-0000000dd001');
  v_res  := process_cycle_rollover('40000000-0000-0000-0000-0000000dd001');

  -- One new enrolment per investor in the destination, never two.
  SELECT COUNT(*) INTO v_n FROM investments
   WHERE cycle_id = v_dest
     AND investor_id = '20000000-0000-0000-0000-0000000dd001';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL N10: investor one has % enrolments in the next cycle, expected 1', v_n;
  END IF;

  -- The silent one is carried by the bulk run, as before.
  SELECT COALESCE(SUM(units),0) INTO v_units FROM investments
   WHERE cycle_id = v_dest AND investor_id = '20000000-0000-0000-0000-0000000dd004';
  IF v_units <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL N10: the investor who never decided carried % slots, expected 2', v_units;
  END IF;

  -- The one who exited is not in the next cycle at all.
  SELECT COUNT(*) INTO v_n FROM investments
   WHERE cycle_id = v_dest AND investor_id = '20000000-0000-0000-0000-0000000dd003';
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL N10: an investor who withdrew appears in the next cycle';
  END IF;

  RAISE NOTICE 'PASS N10 — %', v_res::TEXT;
END $$;

-- ------------------------------------------------------------
-- N11 — a super admin can still correct a locked instruction
-- ------------------------------------------------------------
DO $$ DECLARE v_old UUID; BEGIN
  SELECT id INTO v_old FROM investments WHERE investment_code='N-3';
  PERFORM submit_rollover_decision(v_old, 'continue'::maturity_decision,
    NULL, NULL, NULL, 'Investor rang to change their mind', TRUE);

  IF (SELECT decision FROM rollover_decisions WHERE investment_id = v_old)::TEXT <> 'continue' THEN
    RAISE EXCEPTION 'TEST FAIL N11: a super admin could not correct the instruction';
  END IF;
  RAISE NOTICE 'PASS N11 — a super admin override still works';
END $$;

ROLLBACK;
