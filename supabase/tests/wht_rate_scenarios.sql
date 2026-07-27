-- ============================================================
-- Withholding-rate scenarios — migration 025
--
-- The rate is statutory, not a term investors agreed to, so it
-- stays correctable until settlement rather than freezing when
-- subscriptions close. It reached production at 0.00% because
-- series.default_wht_rate defaults to zero and the field was
-- disabled outright, so there was no way to say otherwise.
--
--   W1  the ratio and slot value keep their old lock
--   W2  the statutory rate can still be corrected, and is
--       audited with the reason given
--   W3  an impossible rate, and a non-admin session, refused
--   W4  a settled cycle refuses, naming the credit notes
--
-- Run against a DB with 001–025 applied.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id,email) VALUES ('a0000000-0000-0000-0000-000000000a01','w@t.com'),('10000000-0000-0000-0000-000000000a01','wi@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-000000000a01','w@t.com','W Admin','super_admin'),
 ('10000000-0000-0000-0000-000000000a01','wi@t.com','W Inv','investor') ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
INSERT INTO investors (id,profile_id,investor_code,full_name,email,tin) VALUES
 ('20000000-0000-0000-0000-000000000a01','10000000-0000-0000-0000-000000000a01','MGW001','W Inv','wi@t.com','TIN-W1') ON CONFLICT DO NOTHING;
INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-000000000a01','C','Series C',0,500000,0.50) ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;
-- ACTIVE cycle: subscriptions closed, so set_cycle_terms must refuse
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
 VALUES ('40000000-0000-0000-0000-000000000a01',(SELECT id FROM series WHERE name='C'),941,'W-941','2026-04-30','2026-07-30','active',500000);
INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status)
 VALUES ('W-1','20000000-0000-0000-0000-000000000a01',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-000000000a01',2,500000,1000000,'2026-04-30','2026-07-30','active');
SELECT set_config('test.uid','a0000000-0000-0000-0000-000000000a01',false);

DO $$ DECLARE v_ok BOOLEAN := FALSE; v_rate NUMERIC; BEGIN
  IF mudarabah_effective_wht_rate('40000000-0000-0000-0000-000000000a01') <> 0 THEN
    RAISE EXCEPTION 'W setup: expected the untouched rate to be 0';
  END IF;

  -- The OLD path still refuses, as it should for ratio and slot value
  BEGIN
    PERFORM mudarabah_set_cycle_terms('40000000-0000-0000-0000-000000000a01', NULL, NULL, 0.10);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'W1: set_cycle_terms stopped refusing a closed cycle'; END IF;

  -- The NEW path succeeds on the same cycle
  PERFORM mudarabah_set_wht_rate('40000000-0000-0000-0000-000000000a01', 0.10, 'statutory rate was never entered');
  v_rate := mudarabah_effective_wht_rate('40000000-0000-0000-0000-000000000a01');
  IF v_rate <> 0.10 THEN RAISE EXCEPTION 'W2: expected 0.10, got %', v_rate; END IF;

  -- and it is on the record
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action='mudarabah_wht_rate_changed'
     AND new_values->>'reason' = 'statutory rate was never entered') THEN
    RAISE EXCEPTION 'W2: the change was not audited with its reason';
  END IF;
  RAISE NOTICE 'PASS W1/W2: the ratio stays locked; the statutory rate can still be corrected';
END $$;

DO $$ DECLARE v_ok BOOLEAN := FALSE; BEGIN
  -- Out of range
  BEGIN PERFORM mudarabah_set_wht_rate('40000000-0000-0000-0000-000000000a01', 10);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'W3: a rate of 10 (=1000%%) was accepted'; END IF;

  -- Investor session
  v_ok := FALSE;
  PERFORM set_config('test.uid','10000000-0000-0000-0000-000000000a01',false);
  BEGIN PERFORM mudarabah_set_wht_rate('40000000-0000-0000-0000-000000000a01', 0.05);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'W3: an investor changed the withholding rate'; END IF;
  PERFORM set_config('test.uid','a0000000-0000-0000-0000-000000000a01',false);
  RAISE NOTICE 'PASS W3: out-of-range rates and non-admin sessions are refused';
END $$;

-- W4 — a settled cycle refuses, because the rate is in its snapshot
INSERT INTO mudarabah_ledgers (cycle_id, description, disclose_mode, status)
VALUES ('40000000-0000-0000-0000-000000000a01','office furniture','perSlot','draft');
INSERT INTO mudarabah_settlements (cycle_id, ledger_id, engine_version, ratio_used,
  unit_value_used, wht_rate_used, computed, is_current)
VALUES ('40000000-0000-0000-0000-000000000a01',
  (SELECT id FROM mudarabah_ledgers WHERE cycle_id='40000000-0000-0000-0000-000000000a01'),
  'test', 0.50, 500000, 0.10, '{}'::jsonb, TRUE);

DO $$ DECLARE v_ok BOOLEAN := FALSE; v_msg TEXT; BEGIN
  BEGIN PERFORM mudarabah_set_wht_rate('40000000-0000-0000-0000-000000000a01', 0.05);
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; v_msg := SQLERRM; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'W4: a settled cycle let its withholding rate move'; END IF;
  IF v_msg NOT LIKE '%credit notes%' THEN
    RAISE EXCEPTION 'W4: the refusal did not explain why: %', v_msg;
  END IF;
  IF mudarabah_effective_wht_rate('40000000-0000-0000-0000-000000000a01') <> 0.10 THEN
    RAISE EXCEPTION 'W4: the refused change still moved the rate';
  END IF;
  RAISE NOTICE 'PASS W4: settlement is the freeze, and the refusal says why';
END $$;

ROLLBACK;
