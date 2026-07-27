-- ============================================================
-- Instructions after settlement — migration 034
--
-- Settling matures every investment. submit_rollover_decision
-- refused anything not 'active', so the moment Series B
-- settled nobody could answer — while the portal was still
-- asking twenty-eight of them by dialog and banner.
--
-- Maturing is the profit event. Rolling over is the capital
-- event, and an instruction is about capital.
-- ============================================================
BEGIN;
INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-00000000bb01','za@t.com'),
 ('10000000-0000-0000-0000-00000000bb01','zi@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-00000000bb01','za@t.com','Z Admin','super_admin'),
 ('10000000-0000-0000-0000-00000000bb01','zi@t.com','Z Investor','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
INSERT INTO investors (id,profile_id,investor_code,full_name,email,bank_name,account_name,account_number) VALUES
 ('20000000-0000-0000-0000-00000000bb01','10000000-0000-0000-0000-00000000bb01','MGZ001','Z Investor','zi@t.com','GTB','Z Investor','0123456789')
ON CONFLICT (id) DO NOTHING;
INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-00000000bb01','C','Series C',0,500000,0.50)
ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;
-- A settled cycle: window still open, investments matured
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
 VALUES ('40000000-0000-0000-0000-00000000bb01',(SELECT id FROM series WHERE name='C'),981,'Z-981',
   CURRENT_DATE - 90, CURRENT_DATE, 'completed', 500000);
INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status) VALUES
 ('Z-MAT','20000000-0000-0000-0000-00000000bb01',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-00000000bb01',2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'matured'),
 ('Z-DONE','20000000-0000-0000-0000-00000000bb01',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-00000000bb01',1,500000,500000,CURRENT_DATE-90,CURRENT_DATE,'completed');

SELECT set_config('test.uid','10000000-0000-0000-0000-00000000bb01',false);

DO $$ DECLARE v JSONB; BEGIN
  -- THE REPORTED FAILURE: settled, matured, and the investor answers
  PERFORM submit_rollover_decision(
    (SELECT id FROM investments WHERE investment_code='Z-MAT'),
    'exit'::maturity_decision);

  IF NOT EXISTS (SELECT 1 FROM rollover_decisions rd
                 JOIN investments i ON i.id = rd.investment_id
                 WHERE i.investment_code='Z-MAT' AND rd.decision::text='exit') THEN
    RAISE EXCEPTION 'TEST FAIL: the instruction was not recorded';
  END IF;

  RAISE NOTICE 'PASS: a settled cycle still accepts a maturity instruction';
END $$;

-- 036: and that answer is final. It used to be changeable right up to
-- the deadline; it is now one decision, and only a super admin can
-- revise it afterwards.
DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM submit_rollover_decision(
      (SELECT id FROM investments WHERE investment_code='Z-MAT'),
      'continue'::maturity_decision);
    RAISE EXCEPTION 'TEST FAIL: the investor changed a submitted instruction';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS: a submitted instruction is final — %', v_msg;
END $$;

SELECT set_config('test.uid','a0000000-0000-0000-0000-00000000bb01',false);

DO $$ BEGIN
  PERFORM submit_rollover_decision(
    (SELECT id FROM investments WHERE investment_code='Z-MAT'),
    'continue'::maturity_decision, NULL, NULL, NULL, 'Investor rang', TRUE);
  IF NOT EXISTS (SELECT 1 FROM rollover_decisions rd
                 JOIN investments i ON i.id = rd.investment_id
                 WHERE i.investment_code='Z-MAT' AND rd.decision::text='continue') THEN
    RAISE EXCEPTION 'TEST FAIL: a super admin could not revise the instruction';
  END IF;
  RAISE NOTICE 'PASS: a super admin can still revise it';
END $$;

SELECT set_config('test.uid','10000000-0000-0000-0000-00000000bb01',false);

DO $$ DECLARE v_ok BOOLEAN := FALSE; v_msg TEXT; BEGIN
  -- Once the capital IS done with, it closes
  BEGIN
    PERFORM submit_rollover_decision(
      (SELECT id FROM investments WHERE investment_code='Z-DONE'),
      'exit'::maturity_decision);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; v_msg := SQLERRM; END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL: a completed enrolment still accepted an instruction';
  END IF;
  IF v_msg NOT LIKE '%capital has already been processed%' THEN
    RAISE EXCEPTION 'TEST FAIL: the refusal did not say why: %', v_msg;
  END IF;
  RAISE NOTICE 'PASS: once the capital has moved, the instruction closes';
END $$;

DO $$ DECLARE v JSONB; BEGIN
  -- And the investor is still asked, because the window is open and
  -- they had not answered — the prompt and the form now agree.
  DELETE FROM rollover_decisions rd USING investments i
   WHERE rd.investment_id = i.id AND i.investment_code = 'Z-MAT';
  UPDATE investments SET maturity_decision = NULL WHERE investment_code = 'Z-MAT';
  v := my_maturity_prompts();
  IF jsonb_array_length(v) < 1 THEN
    RAISE EXCEPTION 'TEST FAIL: a settled but undecided holding is no longer asked: %', v;
  END IF;
  RAISE NOTICE 'PASS: what the portal asks for, submission now accepts';
END $$;
ROLLBACK;
