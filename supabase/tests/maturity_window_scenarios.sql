-- ============================================================
-- Maturity instruction window scenarios — migration 027
--
-- The form always existed; nothing ever asked. The window is the
-- period in which the portal interrupts, and the prompt disappears
-- the moment an instruction is recorded.
--
--   M1  before the window opens, nobody is asked
--   M2  inside it, exactly the silent investors are asked
--   M3  answering removes the prompt with no further state
--   M4  after it closes, everyone goes quiet again
--   M5  an investor is never told about anyone else's holdings
--   M6  the deadline follows the window, so a prompt is never shown
--       for something submission would refuse
--
-- Run against a DB with 001–027 applied.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-0000000000d1','wa@t.com'),
 ('10000000-0000-0000-0000-0000000000d1','w1@t.com'),
 ('10000000-0000-0000-0000-0000000000d2','w2@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-0000000000d1','wa@t.com','Window Admin','super_admin'),
 ('10000000-0000-0000-0000-0000000000d1','w1@t.com','Silent Investor','investor'),
 ('10000000-0000-0000-0000-0000000000d2','w2@t.com','Answered Investor','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
INSERT INTO investors (id,profile_id,investor_code,full_name,email,bank_name,account_name,account_number) VALUES
 ('20000000-0000-0000-0000-0000000000d1','10000000-0000-0000-0000-0000000000d1','MGD001','Silent Investor','w1@t.com','GTB','Silent Investor','0123456789'),
 ('20000000-0000-0000-0000-0000000000d2','10000000-0000-0000-0000-0000000000d2','MGD002','Answered Investor','w2@t.com','GTB','Answered Investor','0123456788')
ON CONFLICT (id) DO NOTHING;
INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-0000000000d1','C','Series C',0,500000,0.50)
ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;

-- One cycle ending TODAY (window open), one ending in 90 days (not yet)
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value) VALUES
 ('40000000-0000-0000-0000-0000000000d1',(SELECT id FROM series WHERE name='C'),961,'W-NOW',
   CURRENT_DATE - 90, CURRENT_DATE, 'active', 500000),
 ('40000000-0000-0000-0000-0000000000d2',(SELECT id FROM series WHERE name='C'),962,'W-LATER',
   CURRENT_DATE, CURRENT_DATE + 90, 'active', 500000);

INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status) VALUES
 ('W-NOW-1','20000000-0000-0000-0000-0000000000d1',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-0000000000d1',2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'active'),
 ('W-NOW-2','20000000-0000-0000-0000-0000000000d2',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-0000000000d1',3,500000,1500000,CURRENT_DATE-90,CURRENT_DATE,'active'),
 ('W-LATER-1','20000000-0000-0000-0000-0000000000d1',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-0000000000d2',1,500000,500000,CURRENT_DATE,CURRENT_DATE+90,'active');

-- M1 / M2 / M5
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_config('test.uid','10000000-0000-0000-0000-0000000000d1',false);
  v := my_maturity_prompts();

  IF jsonb_array_length(v) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL M1/M2: expected exactly the maturing holding, got %', v;
  END IF;
  IF v->0->>'investmentCode' <> 'W-NOW-1' THEN
    RAISE EXCEPTION 'TEST FAIL M1: a cycle 90 days out was included: %', v;
  END IF;
  IF (v->0->>'closesAt')::DATE <> CURRENT_DATE + 5 THEN
    RAISE EXCEPTION 'TEST FAIL M2: the window should close five days after end_date, got %', v->0->>'closesAt';
  END IF;
  RAISE NOTICE 'PASS M1/M2: only the cycle inside its window, and only that investor''s holding';
END $$;

-- M3 — answering silences it, with no extra state
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_config('test.uid','10000000-0000-0000-0000-0000000000d2',false);
  IF jsonb_array_length(my_maturity_prompts()) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL M3: the second investor should start out being asked';
  END IF;

  PERFORM submit_rollover_decision(
    (SELECT id FROM investments WHERE investment_code='W-NOW-2'),
    'continue'::maturity_decision);

  v := my_maturity_prompts();
  IF jsonb_array_length(v) <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL M3: still asked after answering: %', v;
  END IF;

  -- and the other investor is untouched by it
  PERFORM set_config('test.uid','10000000-0000-0000-0000-0000000000d1',false);
  IF jsonb_array_length(my_maturity_prompts()) <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL M5: one investor answering silenced another''s prompt';
  END IF;
  RAISE NOTICE 'PASS M3/M5: answering silences that investor only, with no dismissed flag';
END $$;

-- M6 — submission is accepted for as long as the prompt is shown
DO $$ DECLARE v_deadline DATE; BEGIN
  v_deadline := rollover_decision_deadline('40000000-0000-0000-0000-0000000000d1');
  IF v_deadline < CURRENT_DATE THEN
    RAISE EXCEPTION 'TEST FAIL M6: the deadline (%) is already behind the open window', v_deadline;
  END IF;
  IF v_deadline <> CURRENT_DATE + 5 THEN
    RAISE EXCEPTION 'TEST FAIL M6: expected the deadline to follow the window, got %', v_deadline;
  END IF;

  PERFORM set_config('test.uid','10000000-0000-0000-0000-0000000000d1',false);
  PERFORM submit_rollover_decision(
    (SELECT id FROM investments WHERE investment_code='W-NOW-1'),
    'exit'::maturity_decision);
  RAISE NOTICE 'PASS M6: what the window invites, submission accepts';
END $$;

-- M7 — and it stops asking the person who answered.
--
--     THE REPORTED FAULT. The gold "Investment Matured — Action
--     Required" banner keyed on status = 'matured', and settling
--     matures EVERY investment in the cycle. So an investor who had
--     already given a locked instruction was still shown a pulsing
--     demand for a decision they could no longer change. The banner
--     now counts these prompts instead, so this is what makes it go.
DO $$ DECLARE v JSONB; BEGIN
  PERFORM set_config('test.uid','10000000-0000-0000-0000-0000000000d1',false);

  IF NOT (SELECT locked FROM rollover_decisions
           WHERE investment_id=(SELECT id FROM investments WHERE investment_code='W-NOW-1')) THEN
    RAISE EXCEPTION 'TEST FAIL M7: the submitted instruction was not locked';
  END IF;

  v := my_maturity_prompts();
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(v) e
     WHERE e->>'investmentCode' = 'W-NOW-1'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL M7: still being asked about a locked instruction: %', v;
  END IF;

  -- The holding is still MATURED. That is the whole point: the
  -- status has not changed and must not be what the banner reads.
  IF (SELECT status::TEXT FROM investments WHERE investment_code='W-NOW-1')
     NOT IN ('active','matured') THEN
    RAISE EXCEPTION 'TEST FAIL M7: the fixture no longer reproduces the reported case';
  END IF;

  RAISE NOTICE 'PASS M7: locked and answered, so nothing is asked — though still matured';
END $$;

-- M4 — a closed window asks nothing of anybody
DO $$ DECLARE v JSONB; BEGIN
  DELETE FROM rollover_decisions
  WHERE investment_id IN (SELECT id FROM investments WHERE investment_code IN ('W-NOW-1','W-NOW-2'));
  UPDATE investments SET maturity_decision = NULL
  WHERE investment_code IN ('W-NOW-1','W-NOW-2');

  UPDATE cycles SET instruction_closes_at = CURRENT_DATE - 1
  WHERE id = '40000000-0000-0000-0000-0000000000d1';

  PERFORM set_config('test.uid','10000000-0000-0000-0000-0000000000d1',false);
  v := my_maturity_prompts();
  IF jsonb_array_length(v) <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL M4: still being asked after the window closed: %', v;
  END IF;
  RAISE NOTICE 'PASS M4: a closed window goes quiet, even for those who never answered';
END $$;

-- ------------------------------------------------------------
-- M8 — the deadline is the FUNCTION's, not the columns'
--
--     THE REPORTED FAULT. The statement email, the investor's
--     investment page and the admin rollover page each rebuilt the
--     deadline in TypeScript as the greatest of the cycle's stored
--     date columns:
--
--         GREATEST(instruction_closes_at, rollover_deadline, end_date)
--
--     Nothing in the portal ever SETS instruction_closes_at — it is
--     the override, and it is NULL on every real cycle. So that
--     expression collapses to end_date, the five-day default is never
--     applied, and an investor was told the window shut on 30 July
--     while submit_rollover_decision went on accepting until the 4th.
--
--     This is the assertion those three screens now depend on: with
--     no override set, the deadline is FIVE DAYS AFTER the cycle
--     ends, and it is strictly later than the greatest stored column.
-- ------------------------------------------------------------
DO $$
DECLARE
  v_end      DATE;
  v_deadline DATE;
  v_columns  DATE;
BEGIN
  -- Put the fixture back to a cycle with no override of any kind.
  UPDATE cycles SET instruction_closes_at = NULL, rollover_deadline = NULL
  WHERE id = '40000000-0000-0000-0000-0000000000d1';

  SELECT end_date INTO v_end FROM cycles
   WHERE id = '40000000-0000-0000-0000-0000000000d1';

  v_deadline := rollover_decision_deadline('40000000-0000-0000-0000-0000000000d1');

  -- Exactly what the three screens used to compute.
  SELECT GREATEST(
           COALESCE(c.instruction_closes_at, '-infinity'::DATE),
           COALESCE(c.rollover_deadline,     '-infinity'::DATE),
           c.end_date)
    INTO v_columns
    FROM cycles c WHERE c.id = '40000000-0000-0000-0000-0000000000d1';

  IF v_deadline <> v_end + 5 THEN
    RAISE EXCEPTION 'TEST FAIL M8: the deadline is %, expected % (end date + 5 days)',
      v_deadline, v_end + 5;
  END IF;

  -- The part that makes this a regression test rather than a
  -- restatement: the old expression is genuinely EARLIER. If these
  -- two ever agree, the screens could go back to guessing and nothing
  -- here would notice.
  IF v_columns >= v_deadline THEN
    RAISE EXCEPTION
      'TEST FAIL M8: the columns give % and the function %, so this no longer reproduces the fault',
      v_columns, v_deadline;
  END IF;

  RAISE NOTICE 'PASS M8: columns say %, the function says % — the five days are real', v_columns, v_deadline;
END $$;

-- ------------------------------------------------------------
-- M9 — and an explicit override still wins
--
--     Setting instruction_closes_at is how an administrator holds
--     people to a different date. The function must follow it, in
--     BOTH directions — later than the default and earlier than it.
-- ------------------------------------------------------------
DO $$
DECLARE v_end DATE; v_deadline DATE; BEGIN
  SELECT end_date INTO v_end FROM cycles
   WHERE id = '40000000-0000-0000-0000-0000000000d1';

  UPDATE cycles SET instruction_closes_at = v_end + 30
  WHERE id = '40000000-0000-0000-0000-0000000000d1';
  v_deadline := rollover_decision_deadline('40000000-0000-0000-0000-0000000000d1');
  IF v_deadline <> v_end + 30 THEN
    RAISE EXCEPTION 'TEST FAIL M9: a later override was ignored — got %', v_deadline;
  END IF;

  -- Earlier than the default. GREATEST() is taken against
  -- rollover_deadline, so with that NULL it falls back to end_date —
  -- an override cannot pull the deadline in front of the day the
  -- cycle ends, and that is the honest answer to report.
  UPDATE cycles SET instruction_closes_at = v_end - 1
  WHERE id = '40000000-0000-0000-0000-0000000000d1';
  v_deadline := rollover_decision_deadline('40000000-0000-0000-0000-0000000000d1');
  IF v_deadline <> v_end THEN
    RAISE EXCEPTION 'TEST FAIL M9: an early override gave %, expected the end date %',
      v_deadline, v_end;
  END IF;

  RAISE NOTICE 'PASS M9: an override moves the deadline, but never before the cycle ends';
END $$;

ROLLBACK;
