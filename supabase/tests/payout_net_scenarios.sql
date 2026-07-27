-- ============================================================
-- Payout amount and timing — migration 035
--
-- process_cycle_rollover raised each profit request for
-- declared_profit — the GROSS. The investor receives the net; the
-- difference is withheld for the tax authority. On Series B that was
-- ₦1,093,806 too much, which is exactly the tax.
--
-- And requests were only ever raised in bulk by the administrator,
-- so an investor who had decided could not be paid until everybody
-- else had. Submitting now raises the request itself.
--
--   P1  the profit request is the NET, not the gross
--   P2  submitting raises it; no admin run needed
--   P3  changing the instruction corrects a PENDING request
--   P4  an approved or paid request is never touched
--   P5  the rollover does not raise a second copy
--   P6  nothing is raised before the profit is declared
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;

INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-00000000cc01','pa@t.com'),
 ('10000000-0000-0000-0000-00000000cc01','pi@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-00000000cc01','pa@t.com','P Admin','super_admin'),
 ('10000000-0000-0000-0000-00000000cc01','pi@t.com','P Investor','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
INSERT INTO investors (id,profile_id,investor_code,full_name,email,bank_name,account_name,account_number) VALUES
 ('20000000-0000-0000-0000-00000000cc01','10000000-0000-0000-0000-00000000cc01','MGP001','P Investor','pi@t.com','GTB','P Investor','0123456789')
ON CONFLICT (id) DO NOTHING;
INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-00000000cc01','C','Series C',0,500000,0.50)
ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value)
 VALUES ('40000000-0000-0000-0000-00000000cc01',(SELECT id FROM series WHERE name='C'),991,'P-991',
   CURRENT_DATE - 90, CURRENT_DATE, 'completed', 500000);

-- Settled: 2 slots, ₦1,000,000 capital, ₦100,000 gross profit,
-- ₦10,000 withheld at 10%, so ₦90,000 is actually due.
INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,
  investment_date,maturity_date,status,declared_profit,declared_wht,declared_profit_net)
VALUES ('P-1','20000000-0000-0000-0000-00000000cc01',(SELECT id FROM series WHERE name='C'),
  '40000000-0000-0000-0000-00000000cc01',2,500000,1000000,CURRENT_DATE-90,CURRENT_DATE,'matured',
  100000, 10000, 90000);

SELECT set_config('test.uid','10000000-0000-0000-0000-00000000cc01',false);

-- P1 / P2 — submitting raises the request, for the NET
DO $$ DECLARE v_amt NUMERIC; v_n INT; BEGIN
  PERFORM submit_rollover_decision(
    (SELECT id FROM investments WHERE investment_code='P-1'),
    'continue'::maturity_decision);

  SELECT COUNT(*), MAX(amount) INTO v_n, v_amt FROM payment_requests
   WHERE investment_id=(SELECT id FROM investments WHERE investment_code='P-1') AND type='roi';

  IF v_n <> 1 THEN RAISE EXCEPTION 'TEST FAIL P2: expected 1 profit request, got %', v_n; END IF;
  IF v_amt <> 90000 THEN
    RAISE EXCEPTION 'TEST FAIL P1: profit request is % — the GROSS is 100000, the net is 90000', v_amt;
  END IF;

  -- continuing means no capital request
  IF EXISTS (SELECT 1 FROM payment_requests
             WHERE investment_id=(SELECT id FROM investments WHERE investment_code='P-1')
               AND type='capital') THEN
    RAISE EXCEPTION 'TEST FAIL P2: continuing raised a capital request';
  END IF;
  RAISE NOTICE 'PASS P1/P2: submitting raises the profit request, net of tax';
END $$;

-- P3 — changing the instruction corrects it
DO $$ DECLARE v_cap NUMERIC; BEGIN
  PERFORM submit_rollover_decision(
    (SELECT id FROM investments WHERE investment_code='P-1'),
    'exit'::maturity_decision);

  SELECT amount INTO v_cap FROM payment_requests
   WHERE investment_id=(SELECT id FROM investments WHERE investment_code='P-1') AND type='capital';
  IF v_cap IS NULL OR v_cap <> 1000000 THEN
    RAISE EXCEPTION 'TEST FAIL P3: exit did not raise the capital request, got %', v_cap;
  END IF;
  IF (SELECT COUNT(*) FROM payment_requests
      WHERE investment_id=(SELECT id FROM investments WHERE investment_code='P-1')) <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL P3: expected exactly 2 requests';
  END IF;
  RAISE NOTICE 'PASS P3: changing the instruction adds the capital request';
END $$;

-- P4 — an approved request is never touched, even on a change of mind
DO $$ DECLARE v_n INT; BEGIN
  UPDATE payment_requests SET status='paid', paid_at=NOW()
   WHERE investment_id=(SELECT id FROM investments WHERE investment_code='P-1') AND type='capital';

  PERFORM submit_rollover_decision(
    (SELECT id FROM investments WHERE investment_code='P-1'),
    'continue'::maturity_decision);

  IF NOT EXISTS (SELECT 1 FROM payment_requests
                 WHERE investment_id=(SELECT id FROM investments WHERE investment_code='P-1')
                   AND type='capital' AND status='paid') THEN
    RAISE EXCEPTION 'TEST FAIL P4: a PAID capital request was removed by a change of mind';
  END IF;
  RAISE NOTICE 'PASS P4: money already paid is never unmade';
END $$;

-- P5 — the rollover does not raise a second copy
DO $$ DECLARE v_n INT; BEGIN
  PERFORM sync_maturity_payment_requests(
    (SELECT id FROM investments WHERE investment_code='P-1'));
  PERFORM sync_maturity_payment_requests(
    (SELECT id FROM investments WHERE investment_code='P-1'));

  SELECT COUNT(*) INTO v_n FROM payment_requests
   WHERE investment_id=(SELECT id FROM investments WHERE investment_code='P-1') AND type='roi';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL P5: % profit requests after repeated syncs — an investor would be paid twice', v_n;
  END IF;
  RAISE NOTICE 'PASS P5: syncing repeatedly raises nothing twice';
END $$;

-- P6 — nothing before the profit exists
DO $$ DECLARE v JSONB; BEGIN
  INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,
    investment_date,maturity_date,status)
  VALUES ('P-2','20000000-0000-0000-0000-00000000cc01',(SELECT id FROM series WHERE name='C'),
    '40000000-0000-0000-0000-00000000cc01',1,500000,500000,CURRENT_DATE-90,CURRENT_DATE,'active');

  v := sync_maturity_payment_requests((SELECT id FROM investments WHERE investment_code='P-2'));
  IF v->>'skipped' IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL P6: a request was raised before the profit was declared: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM payment_requests
             WHERE investment_id=(SELECT id FROM investments WHERE investment_code='P-2')) THEN
    RAISE EXCEPTION 'TEST FAIL P6: a payment request exists with no declared profit';
  END IF;
  RAISE NOTICE 'PASS P6: nothing is requested before there is a profit to request';
END $$;

ROLLBACK;
