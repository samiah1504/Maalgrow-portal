-- ============================================================
-- Locking what was already submitted — migration 037
--
-- Migration 036 locks an instruction and raises its payment request
-- on submission. The investors who answered BEFORE it was applied got
-- neither: their decision sits unlocked and no request was ever
-- raised, while they wait for money they believe they have asked for.
--
--   R1  an instruction already given is locked
--   R2  and its profit request is raised, for the NET
--   R3  a withdrawal also gets its capital request
--   R4  someone who has not answered is left completely alone
--   R5  running it twice raises nothing a second time
--   R6  an unsettled cycle produces no requests at all
--   R7  no bank details — reported, not invented
--   R8  an enrolment whose capital already moved is not reopened
--   R9  and once locked, the investor cannot change it
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-0000000ee001','ra@t.com'),
 ('10000000-0000-0000-0000-0000000ee001','r1@t.com'),
 ('10000000-0000-0000-0000-0000000ee002','r2@t.com'),
 ('10000000-0000-0000-0000-0000000ee003','r3@t.com'),
 ('10000000-0000-0000-0000-0000000ee004','r4@t.com'),
 ('10000000-0000-0000-0000-0000000ee005','r5@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-0000000ee001','ra@t.com','R Admin','super_admin'),
 ('10000000-0000-0000-0000-0000000ee001','r1@t.com','R One','investor'),
 ('10000000-0000-0000-0000-0000000ee002','r2@t.com','R Two','investor'),
 ('10000000-0000-0000-0000-0000000ee003','r3@t.com','R Three','investor'),
 ('10000000-0000-0000-0000-0000000ee004','r4@t.com','R Four','investor'),
 ('10000000-0000-0000-0000-0000000ee005','r5@t.com','R Five','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;

-- R Four has NO bank details on record. Nothing can be requested for
-- them, and that has to be reported rather than guessed at.
INSERT INTO investors (id,profile_id,investor_code,full_name,email,bank_name,account_name,account_number) VALUES
 ('20000000-0000-0000-0000-0000000ee001','10000000-0000-0000-0000-0000000ee001','MGR001','R One','r1@t.com','GTB','R One','0000000001'),
 ('20000000-0000-0000-0000-0000000ee002','10000000-0000-0000-0000-0000000ee002','MGR002','R Two','r2@t.com','GTB','R Two','0000000002'),
 ('20000000-0000-0000-0000-0000000ee003','10000000-0000-0000-0000-0000000ee003','MGR003','R Three','r3@t.com','GTB','R Three','0000000003'),
 ('20000000-0000-0000-0000-0000000ee004','10000000-0000-0000-0000-0000000ee004','MGR004','R Four','r4@t.com',NULL,NULL,NULL),
 ('20000000-0000-0000-0000-0000000ee005','10000000-0000-0000-0000-0000000ee005','MGR005','R Five','r5@t.com','GTB','R Five','0000000005')
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-0000000ee001','C','Series C',0,500000,0.50)
ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;

-- A settled cycle, and an unsettled one.
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value) VALUES
 ('40000000-0000-0000-0000-0000000ee001',(SELECT id FROM series WHERE name='C'),
   9601,'R-SETTLED', CURRENT_DATE - 90, CURRENT_DATE, 'completed', 500000),
 ('40000000-0000-0000-0000-0000000ee002',(SELECT id FROM series WHERE name='C'),
   9611,'R-RUNNING', CURRENT_DATE - 30, CURRENT_DATE + 60, 'active', 500000);

INSERT INTO cycle_profit_declarations (cycle_id,total_revenue,total_expenses,net_profit,
  investor_profit_share,company_profit_share,profit_per_slot,total_slots,wht_rate,
  wht_per_slot,profit_per_slot_net,total_wht)
VALUES ('40000000-0000-0000-0000-0000000ee001',1000000,0,1000000,500000,500000,50000,10,0.10,5000,45000,50000);

-- 10% withheld: ₦90,000 due on every ₦100,000 declared.
INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,
  investment_date,maturity_date,status,declared_profit,declared_wht,declared_profit_net)
VALUES
 ('R-1','20000000-0000-0000-0000-0000000ee001',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-0000000ee001',4,500000,2000000,CURRENT_DATE-90,CURRENT_DATE,'matured',200000,20000,180000),
 ('R-2','20000000-0000-0000-0000-0000000ee002',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-0000000ee001',2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'matured',100000,10000,90000),
 ('R-3','20000000-0000-0000-0000-0000000ee003',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-0000000ee001',2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'matured',100000,10000,90000),
 ('R-4','20000000-0000-0000-0000-0000000ee004',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-0000000ee001',2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'matured',100000,10000,90000),
 ('R-5','20000000-0000-0000-0000-0000000ee005',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-0000000ee002',1,500000,500000,CURRENT_DATE-30,CURRENT_DATE+60,'active',
  NULL,NULL,NULL);

-- Instructions as they stand BEFORE 036 — recorded, unlocked, and
-- with nothing raised against them. Inserted directly, because that
-- is exactly the state the real rows are in.
INSERT INTO rollover_decisions (investment_id,investor_id,source_cycle_id,decision,
  slots_to_withdraw,bank_name,account_name,account_number,deadline,via,locked)
VALUES
 ((SELECT id FROM investments WHERE investment_code='R-1'),
  '20000000-0000-0000-0000-0000000ee001','40000000-0000-0000-0000-0000000ee001',
  'continue',NULL,'GTB','R One','0000000001',CURRENT_DATE+5,'investor',FALSE),
 ((SELECT id FROM investments WHERE investment_code='R-2'),
  '20000000-0000-0000-0000-0000000ee002','40000000-0000-0000-0000-0000000ee001',
  'exit',NULL,'GTB','R Two','0000000002',CURRENT_DATE+5,'investor',FALSE),
 ((SELECT id FROM investments WHERE investment_code='R-4'),
  '20000000-0000-0000-0000-0000000ee004','40000000-0000-0000-0000-0000000ee001',
  'continue',NULL,NULL,NULL,NULL,CURRENT_DATE+5,'investor',FALSE),
 ((SELECT id FROM investments WHERE investment_code='R-5'),
  '20000000-0000-0000-0000-0000000ee005','40000000-0000-0000-0000-0000000ee002',
  'continue',NULL,'GTB','R Five','0000000005',CURRENT_DATE+65,'investor',FALSE);

-- R Three deliberately has NO instruction. Nothing about them should
-- move: their window is still open and they answer in their own time.

-- ------------------------------------------------------------
-- R1 / R2 / R3 / R7 — the correction itself
-- ------------------------------------------------------------
DO $$
DECLARE
  v JSONB; v_amt NUMERIC; v_n INT;
BEGIN
  v := mudarabah_lock_submitted_instructions();

  -- R1
  IF (SELECT COUNT(*) FROM rollover_decisions rd
       JOIN investments i ON i.id = rd.investment_id
      WHERE i.investment_code IN ('R-1','R-2','R-4') AND NOT rd.locked) > 0 THEN
    RAISE EXCEPTION 'TEST FAIL R1: an instruction already given was left unlocked';
  END IF;

  -- R2 — the NET, not the gross. R One is owed 180,000 of 200,000.
  SELECT COUNT(*), MAX(amount) INTO v_n, v_amt FROM payment_requests
   WHERE investment_id=(SELECT id FROM investments WHERE investment_code='R-1') AND type='roi';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R2: expected 1 profit request for R One, got %', v_n;
  END IF;
  IF v_amt <> 180000 THEN
    RAISE EXCEPTION 'TEST FAIL R2: profit request is %, expected 180000 (net of tax)', v_amt;
  END IF;

  -- R3 — a withdrawal gets its capital as well as its profit.
  SELECT amount INTO v_amt FROM payment_requests
   WHERE investment_id=(SELECT id FROM investments WHERE investment_code='R-2') AND type='capital';
  IF v_amt IS DISTINCT FROM 1000000 THEN
    RAISE EXCEPTION 'TEST FAIL R3: capital request for the exit is %, expected 1000000', v_amt;
  END IF;

  -- R7 — R Four has no account to pay into. Reported, not invented.
  IF EXISTS (SELECT 1 FROM payment_requests
             WHERE investment_id=(SELECT id FROM investments WHERE investment_code='R-4')) THEN
    RAISE EXCEPTION 'TEST FAIL R7: a request was raised with no bank details on record';
  END IF;
  IF (v->>'couldNotRaise')::INT < 1 THEN
    RAISE EXCEPTION 'TEST FAIL R7: the missing bank details were not reported — %', v::TEXT;
  END IF;

  RAISE NOTICE 'PASS R1/R2/R3/R7 — locked % , raised % , could not raise %',
    v->>'lockedNow', v->>'requestsRaised', v->>'couldNotRaise';
END $$;

-- ------------------------------------------------------------
-- R4 — someone who never answered is untouched
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM rollover_decisions rd
              JOIN investments i ON i.id = rd.investment_id
             WHERE i.investment_code='R-3') THEN
    RAISE EXCEPTION 'TEST FAIL R4: an instruction was invented for someone who never gave one';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_requests
             WHERE investment_id=(SELECT id FROM investments WHERE investment_code='R-3')) THEN
    RAISE EXCEPTION 'TEST FAIL R4: money was requested for someone who has not answered';
  END IF;
  RAISE NOTICE 'PASS R4 — an investor who has not answered is left alone';
END $$;

-- ------------------------------------------------------------
-- R5 — running it again raises nothing a second time
-- ------------------------------------------------------------
DO $$ DECLARE v JSONB; v_n INT; BEGIN
  v := mudarabah_lock_submitted_instructions();
  IF (v->>'requestsRaised')::INT <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL R5: a rerun raised % more request(s)', v->>'requestsRaised';
  END IF;

  SELECT COUNT(*) INTO v_n FROM payment_requests
   WHERE investment_id=(SELECT id FROM investments WHERE investment_code='R-1');
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL R5: R One now has % requests — they would be paid twice', v_n;
  END IF;
  RAISE NOTICE 'PASS R5 — a rerun is a no-op';
END $$;

-- ------------------------------------------------------------
-- R6 — an unsettled cycle produces nothing
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM payment_requests
             WHERE investment_id=(SELECT id FROM investments WHERE investment_code='R-5')) THEN
    RAISE EXCEPTION 'TEST FAIL R6: money was requested from a cycle that has not settled';
  END IF;
  -- Locked all the same: they gave an instruction, and it is final.
  IF NOT (SELECT locked FROM rollover_decisions
           WHERE investment_id=(SELECT id FROM investments WHERE investment_code='R-5')) THEN
    RAISE EXCEPTION 'TEST FAIL R6: an instruction in a running cycle was left unlocked';
  END IF;
  RAISE NOTICE 'PASS R6 — locked, but nothing requested before settlement';
END $$;

-- ------------------------------------------------------------
-- R8 — an enrolment whose capital already moved is not reopened
-- ------------------------------------------------------------
DO $$ DECLARE v JSONB; v_n INT; BEGIN
  -- Pretend R Three answered and was already carried across.
  INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,
    capital,investment_date,maturity_date,status)
  VALUES ('R-3-NEXT','20000000-0000-0000-0000-0000000ee003',(SELECT id FROM series WHERE name='C'),
    '40000000-0000-0000-0000-0000000ee002',2,500000,1000000,CURRENT_DATE,CURRENT_DATE+60,'active');

  UPDATE investments SET next_investment_id=(SELECT id FROM investments WHERE investment_code='R-3-NEXT')
   WHERE investment_code='R-3';

  INSERT INTO rollover_decisions (investment_id,investor_id,source_cycle_id,decision,
    bank_name,account_name,account_number,deadline,via,locked)
  VALUES ((SELECT id FROM investments WHERE investment_code='R-3'),
    '20000000-0000-0000-0000-0000000ee003','40000000-0000-0000-0000-0000000ee001',
    'continue','GTB','R Three','0000000003',CURRENT_DATE+5,'investor',TRUE);

  v := mudarabah_lock_submitted_instructions();

  SELECT COUNT(*) INTO v_n FROM payment_requests
   WHERE investment_id=(SELECT id FROM investments WHERE investment_code='R-3');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL R8: % request(s) raised against capital that has already moved', v_n;
  END IF;
  RAISE NOTICE 'PASS R8 — a processed enrolment is not reopened';
END $$;

-- ------------------------------------------------------------
-- R9 — and the investor cannot change it now
-- ------------------------------------------------------------
SELECT set_config('test.uid','10000000-0000-0000-0000-0000000ee001',false);

DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM submit_rollover_decision(
      (SELECT id FROM investments WHERE investment_code='R-1'),
      'exit'::maturity_decision);
    RAISE EXCEPTION 'TEST FAIL R9: a retro-locked instruction was changed';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS R9 — refused with: %', v_msg;
END $$;

ROLLBACK;
