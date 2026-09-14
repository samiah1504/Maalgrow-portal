-- ============================================================
-- Exit: transaction order, and that a payment-request failure can
-- never leave the investment marked completed.
--
-- Batch order per investor, inside ONE subtransaction:
--   sync_maturity_payment_requests -> mudarabah_roll_one -> lock -> results
-- If sync raises, the engine never runs and nothing is written.
-- If the engine raises after sync, the requests are rolled back too.
-- ============================================================
\set ON_ERROR_STOP on
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated;
BEGIN;
UPDATE series SET price_per_unit = 500000 WHERE name='A';
INSERT INTO auth.users (id,email) VALUES ('a0000000-0000-0000-0000-00000000ef00','xa@t.com'),('a0000000-0000-0000-0000-00000000ef01','x1@t.com'),('a0000000-0000-0000-0000-00000000ef02','x2@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES ('a0000000-0000-0000-0000-00000000ef00','xa@t.com','X Admin','super_admin'),
 ('a0000000-0000-0000-0000-00000000ef01','x1@t.com','Exit One','investor'),('a0000000-0000-0000-0000-00000000ef02','x2@t.com','Exit Two','investor') ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
SET LOCAL test.uid='a0000000-0000-0000-0000-00000000ef00';
INSERT INTO investors (id,profile_id,investor_code,full_name,email,phone,bank_name,account_name,account_number) VALUES
 ('20000000-0000-0000-0000-00000000ef01','a0000000-0000-0000-0000-00000000ef01','MG-X1','Exit One','x1@t.com','08','GTBank','Exit One','01'),
 ('20000000-0000-0000-0000-00000000ef02','a0000000-0000-0000-0000-00000000ef02','MG-X2','Exit Two','x2@t.com','08','GTBank','Exit Two','02') ON CONFLICT DO NOTHING;
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,total_slots,status) VALUES
 ('40000000-0000-0000-0000-00000000ef01',(SELECT id FROM series WHERE name='A'),901,'X Source','2026-05-30','2026-08-30',100,'active'),
 ('40000000-0000-0000-0000-00000000ef02',(SELECT id FROM series WHERE name='A'),902,'X Dest','2026-08-30','2026-11-30',100,'active');
INSERT INTO investments (id,investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status) VALUES
 ('50000000-0000-0000-0000-00000000ef01','X-1','20000000-0000-0000-0000-00000000ef01',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ef01',1,500000,500000,'2026-05-30','2026-08-30','active'),
 ('50000000-0000-0000-0000-00000000ef02','X-2','20000000-0000-0000-0000-00000000ef02',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ef01',1,500000,500000,'2026-05-30','2026-08-30','active');
INSERT INTO rollover_decisions (investment_id,investor_id,source_cycle_id,decision,bank_name,account_name,account_number) VALUES
 ('50000000-0000-0000-0000-00000000ef01','20000000-0000-0000-0000-00000000ef01','40000000-0000-0000-0000-00000000ef01','exit','GTBank','Exit One','01'),
 ('50000000-0000-0000-0000-00000000ef02','20000000-0000-0000-0000-00000000ef02','40000000-0000-0000-0000-00000000ef01','exit','GTBank','Exit Two','02');
SELECT (declare_cycle_profit('40000000-0000-0000-0000-00000000ef01',500000,0,'x',NULL,FALSE))->>'requests_raised' AS raised_at_declaration;

-- E1: the happy path, requests already raised at declaration (047), engine closes.
DO $$ DECLARE r JSONB; v_cap NUMERIC; v_roi NUMERIC; s TEXT; nx UUID; crs TEXT; BEGIN
  r := process_cycle_rollover('40000000-0000-0000-0000-00000000ef01','40000000-0000-0000-0000-00000000ef02',FALSE);
  IF (r->>'withdrawn')::int<>2 OR (r->>'failed')::int<>0 THEN RAISE EXCEPTION 'TEST FAIL E1: %', r; END IF;
  SELECT MAX(amount) FILTER (WHERE type='capital'), MAX(amount) FILTER (WHERE type='roi') INTO v_cap, v_roi FROM payment_requests WHERE investment_id='50000000-0000-0000-0000-00000000ef01';
  IF v_cap<>500000 OR v_roi<>125000 THEN RAISE EXCEPTION 'TEST FAIL E1: requests capital % roi %', v_cap, v_roi; END IF;
  SELECT status::text, next_investment_id INTO s, nx FROM investments WHERE id='50000000-0000-0000-0000-00000000ef01';
  SELECT status INTO crs FROM cycle_rollovers WHERE previous_investment_id='50000000-0000-0000-0000-00000000ef01';
  IF s<>'completed' OR nx IS NOT NULL OR crs<>'withdrawn' THEN RAISE EXCEPTION 'TEST FAIL E1: status % next % cr %', s, nx, crs; END IF;
  IF EXISTS (SELECT 1 FROM investments WHERE parent_investment_id='50000000-0000-0000-0000-00000000ef01') THEN RAISE EXCEPTION 'TEST FAIL E1: successor created for an exit'; END IF;
  RAISE NOTICE 'PASS E1: exit -> capital 500,000 + profit 125,000 requested; completed; withdrawn; next NULL; no successor';
END $$;

-- E2: a payment-request failure must not leave the investment completed.
-- Reset X-2 to the pre-batch state, then make the sync throw.
UPDATE investments SET status='matured', maturity_decision=NULL WHERE id='50000000-0000-0000-0000-00000000ef02';
DELETE FROM cycle_rollovers WHERE previous_investment_id='50000000-0000-0000-0000-00000000ef02';
DELETE FROM payment_requests WHERE investment_id='50000000-0000-0000-0000-00000000ef02';
CREATE OR REPLACE FUNCTION sync_maturity_payment_requests(p_investment_id UUID) RETURNS JSONB AS $f$
BEGIN RAISE EXCEPTION 'deliberate payment-request failure for E2'; END; $f$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ DECLARE r JSONB; s TEXT; nx UUID; crs TEXT; v_n INT; BEGIN
  r := process_cycle_rollover('40000000-0000-0000-0000-00000000ef01','40000000-0000-0000-0000-00000000ef02',FALSE);
  IF (r->>'failed')::int<>1 THEN RAISE EXCEPTION 'TEST FAIL E2: expected 1 failed, got %', r; END IF;
  SELECT status::text, next_investment_id INTO s, nx FROM investments WHERE id='50000000-0000-0000-0000-00000000ef02';
  SELECT status INTO crs FROM cycle_rollovers WHERE previous_investment_id='50000000-0000-0000-0000-00000000ef02';
  SELECT COUNT(*) INTO v_n FROM payment_requests WHERE investment_id='50000000-0000-0000-0000-00000000ef02';
  IF s<>'matured' THEN RAISE EXCEPTION 'TEST FAIL E2: investment marked % although the payment request failed', s; END IF;
  IF crs<>'failed' OR nx IS NOT NULL OR v_n<>0 THEN RAISE EXCEPTION 'TEST FAIL E2: cr % next % requests %', crs, nx, v_n; END IF;
  RAISE NOTICE 'PASS E2: sync failure -> investment stays matured, cycle_rollovers = failed (retryable), no requests, no successor';
END $$;
ROLLBACK;
\echo '=== ALL EXIT-ORDER SCENARIOS PASSED ==='
