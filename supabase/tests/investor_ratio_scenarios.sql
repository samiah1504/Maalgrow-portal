-- ============================================================
-- Profit-sharing ratio scenarios — migration 026
--
-- The ratio froze when subscriptions closed, which blocked a routine
-- act of generosity in order to prevent something nobody was trying
-- to do. The manager taking LESS than agreed breaks no promise; the
-- manager taking MORE is what the lock is for.
--
--   R1  before subscriptions close the ratio moves either way
--   R2  after they close it may rise — the manager takes less
--   R3  after they close it may not fall, and nothing is written
--   R4  the ratchet holds: having risen, it cannot come back down
--   R5  a settled cycle refuses outright
--   R6  impossible ratios and non-admin sessions are refused
--
-- Run against a DB with 001–026 applied.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-0000000000c1','ra@t.com'),
 ('10000000-0000-0000-0000-0000000000c1','ri@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-0000000000c1','ra@t.com','Ratio Admin','super_admin'),
 ('10000000-0000-0000-0000-0000000000c1','ri@t.com','Ratio Investor','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
INSERT INTO investors (id,profile_id,investor_code,full_name,email) VALUES
 ('20000000-0000-0000-0000-0000000000c1','10000000-0000-0000-0000-0000000000c1','MGC001','Ratio Investor','ri@t.com')
ON CONFLICT DO NOTHING;
INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-0000000000c1','C','Series C',0,500000,0.50)
ON CONFLICT (name) DO UPDATE SET mudarabah_investor_ratio=EXCLUDED.mudarabah_investor_ratio;

-- One cycle still open, one already closed
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value) VALUES
 ('40000000-0000-0000-0000-0000000000c1',(SELECT id FROM series WHERE name='C'),951,'R-OPEN','2026-04-30','2026-07-30','subscription_open',500000),
 ('40000000-0000-0000-0000-0000000000c2',(SELECT id FROM series WHERE name='C'),952,'R-CLOSED','2026-04-30','2026-07-30','active',500000);

SELECT set_config('test.uid','a0000000-0000-0000-0000-0000000000c1',false);

-- R1 — open: free movement, both directions
DO $$ BEGIN
  PERFORM mudarabah_set_investor_ratio('40000000-0000-0000-0000-0000000000c1', 0.60, 'better terms while open');
  IF mudarabah_effective_ratio('40000000-0000-0000-0000-0000000000c1') <> 0.60 THEN
    RAISE EXCEPTION 'TEST FAIL R1: the open cycle did not rise to 0.60';
  END IF;
  PERFORM mudarabah_set_investor_ratio('40000000-0000-0000-0000-0000000000c1', 0.45, 'revised while still open');
  IF mudarabah_effective_ratio('40000000-0000-0000-0000-0000000000c1') <> 0.45 THEN
    RAISE EXCEPTION 'TEST FAIL R1: the open cycle would not fall to 0.45';
  END IF;
  RAISE NOTICE 'PASS R1: while subscriptions are open the ratio moves either way';
END $$;

-- R2 / R3 / R4 — closed: up yes, down no, and no walking it back
DO $$ DECLARE v_ok BOOLEAN := FALSE; v_msg TEXT; BEGIN
  IF mudarabah_effective_ratio('40000000-0000-0000-0000-0000000000c2') <> 0.50 THEN
    RAISE EXCEPTION 'TEST FAIL: the closed cycle should start at the series 0.50';
  END IF;

  -- R2: the manager chooses to take 40% instead of 50%
  PERFORM mudarabah_set_investor_ratio('40000000-0000-0000-0000-0000000000c2', 0.60,
    'trade did not warrant a full manager share');
  IF mudarabah_effective_ratio('40000000-0000-0000-0000-0000000000c2') <> 0.60 THEN
    RAISE EXCEPTION 'TEST FAIL R2: a closed cycle refused a MORE generous ratio';
  END IF;

  -- R3/R4: and it cannot come back down, not even to where it started
  BEGIN
    PERFORM mudarabah_set_investor_ratio('40000000-0000-0000-0000-0000000000c2', 0.50, 'walking it back');
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; v_msg := SQLERRM; END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL R4: the ratchet let the holders share fall again';
  END IF;
  IF v_msg NOT LIKE '%Taking a smaller manager%' THEN
    RAISE EXCEPTION 'TEST FAIL R3: the refusal did not say what IS allowed: %', v_msg;
  END IF;
  IF mudarabah_effective_ratio('40000000-0000-0000-0000-0000000000c2') <> 0.60 THEN
    RAISE EXCEPTION 'TEST FAIL R3: the refused change still moved the ratio';
  END IF;

  RAISE NOTICE 'PASS R2/R3/R4: the manager may take less, never more, and cannot walk it back';
END $$;

-- R5 — settled refuses outright, in the generous direction too
INSERT INTO mudarabah_ledgers (cycle_id, description, disclose_mode, status)
VALUES ('40000000-0000-0000-0000-0000000000c2','office furniture','perSlot','draft');
INSERT INTO mudarabah_settlements (cycle_id, ledger_id, engine_version, ratio_used,
  unit_value_used, wht_rate_used, computed, is_current)
VALUES ('40000000-0000-0000-0000-0000000000c2',
  (SELECT id FROM mudarabah_ledgers WHERE cycle_id='40000000-0000-0000-0000-0000000000c2'),
  'test', 0.60, 500000, 0.10, '{}'::jsonb, TRUE);

DO $$ DECLARE v_ok BOOLEAN := FALSE; BEGIN
  BEGIN PERFORM mudarabah_set_investor_ratio('40000000-0000-0000-0000-0000000000c2', 0.70, 'even more generous');
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL R5: a settled cycle moved its ratio';
  END IF;
  IF mudarabah_effective_ratio('40000000-0000-0000-0000-0000000000c2') <> 0.60 THEN
    RAISE EXCEPTION 'TEST FAIL R5: the refused change still moved the ratio';
  END IF;
  RAISE NOTICE 'PASS R5: settlement freezes the ratio in both directions';
END $$;

-- R6 — nonsense values and non-admin sessions
DO $$ DECLARE v_ok BOOLEAN := FALSE; BEGIN
  BEGIN PERFORM mudarabah_set_investor_ratio('40000000-0000-0000-0000-0000000000c1', 60);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'TEST FAIL R6: a ratio of 60 (=6000%%) was accepted'; END IF;

  v_ok := FALSE;
  BEGIN PERFORM mudarabah_set_investor_ratio('40000000-0000-0000-0000-0000000000c1', 0);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'TEST FAIL R6: a zero holders share was accepted'; END IF;

  v_ok := FALSE;
  PERFORM set_config('test.uid','10000000-0000-0000-0000-0000000000c1',false);
  BEGIN PERFORM mudarabah_set_investor_ratio('40000000-0000-0000-0000-0000000000c1', 0.99);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'TEST FAIL R6: an investor set the ratio in their own favour'; END IF;
  PERFORM set_config('test.uid','a0000000-0000-0000-0000-0000000000c1',false);

  RAISE NOTICE 'PASS R6: impossible ratios and non-admin sessions are refused';
END $$;

ROLLBACK;
