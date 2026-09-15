-- ============================================================
-- The rollover tops up an existing enrolment — migration 050
--
--   G1  hand-enrolled BEFORE the rollover, individual path: one row,
--       slots and capital added, funded, history points at it
--   G2  the same through the batch: identical result
--   G3  rollover_all onto a hand row: profit lands in its balance
--   G4  two matured enrolments of one investor land on ONE row
--   G5  a hand row at a different price is NOT merged (fresh row)
--   G6  an investor with no row in the destination gets a fresh row
--   G7  cycle totals: slots and capital equal the rows, after top-ups
--   G8  reversal of a merged rollover reduces the row, keeps the
--       hand money, and re-enrolment merges again
--   G9  reversal of one of two rollovers on a shared row leaves the other
--   G10 reversal of an unshared rollover still deletes the row
--   G11 nothing is double-counted: value in = value out
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
SELECT ('a0000000-0000-0000-0000-00000000ff0'||n)::uuid, 'mrg'||n||'@t.com' FROM generate_series(0,6) n ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role)
SELECT ('a0000000-0000-0000-0000-00000000ff0'||n)::uuid,'mrg'||n||'@t.com','Mrg '||n,
       CASE WHEN n=0 THEN 'super_admin' ELSE 'investor' END::user_role FROM generate_series(0,6) n
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
SET LOCAL test.uid='a0000000-0000-0000-0000-00000000ff00';
INSERT INTO investors (id,profile_id,investor_code,full_name,email,phone,bank_name,account_name,account_number)
SELECT ('20000000-0000-0000-0000-00000000ff0'||n)::uuid,('a0000000-0000-0000-0000-00000000ff0'||n)::uuid,
       'MG-MRG'||n,'Mrg '||n,'mrg'||n||'@t.com','0801'||n,'GTBank','Mrg '||n,'00001'||n
FROM generate_series(1,6) n ON CONFLICT DO NOTHING;

INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,total_slots,status) VALUES
 ('40000000-0000-0000-0000-00000000ff01',(SELECT id FROM series WHERE name='A'),701,'30 May - 30 Aug','2026-05-30','2026-08-30',100,'active'),
 ('40000000-0000-0000-0000-00000000ff02',(SELECT id FROM series WHERE name='A'),702,'30 Aug - 30 Nov','2026-08-30','2026-11-30',100,'active');

-- Matured enrolments in the SOURCE cycle. n4 has two of them.
INSERT INTO investments (id,investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status) VALUES
 ('50000000-0000-0000-0000-00000000ff01','MRG-1', '20000000-0000-0000-0000-00000000ff01',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff01',2,500000,1000000,'2026-05-30','2026-08-30','active'),
 ('50000000-0000-0000-0000-00000000ff02','MRG-2', '20000000-0000-0000-0000-00000000ff02',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff01',2,500000,1000000,'2026-05-30','2026-08-30','active'),
 ('50000000-0000-0000-0000-00000000ff03','MRG-3', '20000000-0000-0000-0000-00000000ff03',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff01',1,500000, 500000,'2026-05-30','2026-08-30','active'),
 ('50000000-0000-0000-0000-00000000ff4a','MRG-4A','20000000-0000-0000-0000-00000000ff04',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff01',1,500000, 500000,'2026-05-30','2026-08-30','active'),
 ('50000000-0000-0000-0000-00000000ff4b','MRG-4B','20000000-0000-0000-0000-00000000ff04',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff01',2,500000,1000000,'2026-05-30','2026-08-30','active'),
 ('50000000-0000-0000-0000-00000000ff05','MRG-5', '20000000-0000-0000-0000-00000000ff05',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff01',1,500000, 500000,'2026-05-30','2026-08-30','active'),
 ('50000000-0000-0000-0000-00000000ff06','MRG-6', '20000000-0000-0000-0000-00000000ff06',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff01',1,500000, 500000,'2026-05-30','2026-08-30','active');

-- Enrolments recorded BY HAND in the DESTINATION before the rollover,
-- each with its bank payment. n5's is at an older price.
INSERT INTO investments (id,investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status) VALUES
 ('50000000-0000-0000-0000-00000000ffa1','HAND-1','20000000-0000-0000-0000-00000000ff01',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff02',5,500000,2500000,'2026-08-30','2026-11-30','active'),
 ('50000000-0000-0000-0000-00000000ffa2','HAND-2','20000000-0000-0000-0000-00000000ff02',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff02',5,500000,2500000,'2026-08-30','2026-11-30','active'),
 ('50000000-0000-0000-0000-00000000ffa3','HAND-3','20000000-0000-0000-0000-00000000ff03',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff02',5,500000,2500000,'2026-08-30','2026-11-30','active'),
 ('50000000-0000-0000-0000-00000000ffa5','HAND-5','20000000-0000-0000-0000-00000000ff05',(SELECT id FROM series WHERE name='A'),'40000000-0000-0000-0000-00000000ff02',5,400000,2000000,'2026-08-30','2026-11-30','active');
INSERT INTO investment_payments (investment_id,investor_id,series_id,cycle_id,amount,units,payment_date,status,method,reference)
SELECT i.id, i.investor_id, i.series_id, i.cycle_id, i.capital, i.units, '2026-08-30', 'confirmed', 'bank_transfer', 'BANK-'||i.investment_code
FROM investments i WHERE i.investment_code LIKE 'HAND-%';

INSERT INTO rollover_decisions (investment_id,investor_id,source_cycle_id,decision,slots_to_withdraw,bank_name,account_name,account_number)
SELECT i.id, i.investor_id, i.cycle_id, d.decision::maturity_decision, NULL, 'GTBank', i.investment_code, '0000'
FROM investments i
JOIN (VALUES ('MRG-1','continue'),('MRG-2','continue'),('MRG-3','rollover_all'),
             ('MRG-4A','continue'),('MRG-4B','continue'),('MRG-5','continue'),('MRG-6','continue')) d(code,decision)
  ON d.code = i.investment_code;

SELECT (declare_cycle_profit('40000000-0000-0000-0000-00000000ff01', 2500000, 0, 'merge', NULL, FALSE))->>'profit_per_slot' AS profit_per_slot;

-- The value in the destination BEFORE anything rolls, for G11.
CREATE TEMP TABLE _in AS
SELECT COALESCE(SUM(capital + COALESCE(rollover_balance,0)),0) AS dest_value
FROM investments WHERE cycle_id='40000000-0000-0000-0000-00000000ff02' AND status='active';

-- ------------------------------------------------------------
-- G1 — individual path onto a hand row
-- ------------------------------------------------------------
DO $$ DECLARE r JSONB; h investments%ROWTYPE; o investments%ROWTYPE; cr cycle_rollovers%ROWTYPE; n INT; BEGIN
  r := mudarabah_enrol_next_cycle('50000000-0000-0000-0000-00000000ff01');
  IF r->>'outcome' <> 'rolled' THEN RAISE EXCEPTION 'TEST FAIL G1: %', r; END IF;
  IF NOT (r->>'merged')::boolean OR (r->>'investmentId')::uuid <> '50000000-0000-0000-0000-00000000ffa1'
     OR r->>'investmentCode' <> 'HAND-1' THEN
    RAISE EXCEPTION 'TEST FAIL G1: not merged into HAND-1 — %', r;
  END IF;
  SELECT * INTO h FROM investments WHERE id='50000000-0000-0000-0000-00000000ffa1';
  SELECT * INTO o FROM investments WHERE id='50000000-0000-0000-0000-00000000ff01';
  SELECT * INTO cr FROM cycle_rollovers WHERE previous_investment_id='50000000-0000-0000-0000-00000000ff01';
  IF h.units <> 7 OR h.capital <> 3500000 OR COALESCE(h.rollover_balance,0) <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL G1: HAND-1 units % capital % balance %', h.units, h.capital, h.rollover_balance;
  END IF;
  IF investment_confirmed_paid(h.id) <> 3500000 THEN
    RAISE EXCEPTION 'TEST FAIL G1: HAND-1 funded % (expected 3,500,000 = bank 2,500,000 + carried 1,000,000)', investment_confirmed_paid(h.id);
  END IF;
  IF h.parent_investment_id <> o.id OR o.next_investment_id <> h.id OR o.status::text <> 'completed' THEN
    RAISE EXCEPTION 'TEST FAIL G1: lineage — parent % next % status %', h.parent_investment_id, o.next_investment_id, o.status;
  END IF;
  IF cr.new_investment_id <> h.id OR cr.units <> 2 OR cr.capital_rolled_over <> 1000000 OR cr.status <> 'completed' THEN
    RAISE EXCEPTION 'TEST FAIL G1: cycle_rollovers new % units % cap % status %', cr.new_investment_id, cr.units, cr.capital_rolled_over, cr.status;
  END IF;
  SELECT COUNT(*) INTO n FROM investments WHERE investor_id='20000000-0000-0000-0000-00000000ff01' AND cycle_id='40000000-0000-0000-0000-00000000ff02';
  IF n <> 1 THEN RAISE EXCEPTION 'TEST FAIL G1: % rows for the investor in the destination', n; END IF;
  SELECT COUNT(*) INTO n FROM investment_payments WHERE investment_id=h.id AND method='rollover' AND reference='ROLL-MRG-1';
  IF n <> 1 THEN RAISE EXCEPTION 'TEST FAIL G1: carry-forward payment missing on HAND-1'; END IF;
  RAISE NOTICE 'PASS G1: individual path topped up HAND-1 to 7 slots / 3,500,000, funded, linked';
END $$;

-- ------------------------------------------------------------
-- G2..G6 — the batch for everyone else
-- ------------------------------------------------------------
DO $$ DECLARE r JSONB; BEGIN
  r := process_cycle_rollover('40000000-0000-0000-0000-00000000ff01','40000000-0000-0000-0000-00000000ff02',FALSE);
  IF (r->>'failed')::int <> 0 THEN RAISE EXCEPTION 'TEST FAIL batch: % failed — %', r->>'failed', r->'results'; END IF;
  IF (r->>'rolled')::int <> 6 THEN RAISE EXCEPTION 'TEST FAIL batch: expected 6 rolled, got %', r->>'rolled'; END IF;
  RAISE NOTICE 'PASS batch: 6 rolled, 0 failed';
END $$;

-- G2
DO $$ DECLARE h1 investments%ROWTYPE; h2 investments%ROWTYPE; c1 cycle_rollovers%ROWTYPE; c2 cycle_rollovers%ROWTYPE; n INT; BEGIN
  SELECT * INTO h1 FROM investments WHERE investment_code='HAND-1';
  SELECT * INTO h2 FROM investments WHERE investment_code='HAND-2';
  SELECT * INTO c1 FROM cycle_rollovers WHERE previous_investment_id='50000000-0000-0000-0000-00000000ff01';
  SELECT * INTO c2 FROM cycle_rollovers WHERE previous_investment_id='50000000-0000-0000-0000-00000000ff02';
  IF (h1.units, h1.capital, COALESCE(h1.rollover_balance,0), investment_confirmed_paid(h1.id), h1.status)
     IS DISTINCT FROM (h2.units, h2.capital, COALESCE(h2.rollover_balance,0), investment_confirmed_paid(h2.id), h2.status) THEN
    RAISE EXCEPTION 'TEST FAIL G2: batch result differs from individual (HAND-2: % / % / % / %)', h2.units, h2.capital, h2.rollover_balance, investment_confirmed_paid(h2.id);
  END IF;
  IF (c1.units, c1.capital_rolled_over, c1.profit_rolled_over, c1.total_rollover_amount, c1.rollover_balance, c1.status)
     IS DISTINCT FROM (c2.units, c2.capital_rolled_over, c2.profit_rolled_over, c2.total_rollover_amount, c2.rollover_balance, c2.status) THEN
    RAISE EXCEPTION 'TEST FAIL G2: cycle_rollovers differ between paths';
  END IF;
  IF c2.new_investment_id <> h2.id THEN RAISE EXCEPTION 'TEST FAIL G2: batch rollover record does not point at HAND-2'; END IF;
  SELECT COUNT(*) INTO n FROM investments WHERE investor_id='20000000-0000-0000-0000-00000000ff02' AND cycle_id='40000000-0000-0000-0000-00000000ff02';
  IF n <> 1 THEN RAISE EXCEPTION 'TEST FAIL G2: % rows for the investor in the destination', n; END IF;
  RAISE NOTICE 'PASS G2: batch ≡ individual on a merged row';
END $$;

-- G3
DO $$ DECLARE h investments%ROWTYPE; v_net NUMERIC; BEGIN
  SELECT declared_profit_net INTO v_net FROM investments WHERE investment_code='MRG-3';
  IF v_net <= 0 THEN RAISE EXCEPTION 'TEST FAIL G3: vacuous — no net profit'; END IF;
  SELECT * INTO h FROM investments WHERE investment_code='HAND-3';
  IF h.units <> 6 OR h.capital <> 3000000 OR h.rollover_balance <> v_net OR investment_confirmed_paid(h.id) <> 3000000 THEN
    RAISE EXCEPTION 'TEST FAIL G3: HAND-3 units % capital % balance % funded % (expected 6 / 3,000,000 / % / 3,000,000)',
      h.units, h.capital, h.rollover_balance, investment_confirmed_paid(h.id), v_net;
  END IF;
  RAISE NOTICE 'PASS G3: rollover_all onto a hand row — capital 3,000,000, profit % in balance', v_net;
END $$;

-- G4
DO $$ DECLARE rows INT; h investments%ROWTYPE; a investments%ROWTYPE; b investments%ROWTYPE; n INT; BEGIN
  SELECT COUNT(*) INTO rows FROM investments WHERE investor_id='20000000-0000-0000-0000-00000000ff04' AND cycle_id='40000000-0000-0000-0000-00000000ff02';
  IF rows <> 1 THEN RAISE EXCEPTION 'TEST FAIL G4: two matured enrolments produced % rows', rows; END IF;
  SELECT * INTO h FROM investments WHERE investor_id='20000000-0000-0000-0000-00000000ff04' AND cycle_id='40000000-0000-0000-0000-00000000ff02';
  SELECT * INTO a FROM investments WHERE investment_code='MRG-4A';
  SELECT * INTO b FROM investments WHERE investment_code='MRG-4B';
  IF h.units <> 3 OR h.capital <> 1500000 OR investment_confirmed_paid(h.id) <> 1500000 THEN
    RAISE EXCEPTION 'TEST FAIL G4: merged row units % capital % funded %', h.units, h.capital, investment_confirmed_paid(h.id);
  END IF;
  IF a.next_investment_id <> h.id OR b.next_investment_id <> h.id THEN RAISE EXCEPTION 'TEST FAIL G4: forward links % / %', a.next_investment_id, b.next_investment_id; END IF;
  SELECT COUNT(*) INTO n FROM cycle_rollovers WHERE new_investment_id = h.id;
  IF n <> 2 THEN RAISE EXCEPTION 'TEST FAIL G4: % rollover records point at the row, expected 2', n; END IF;
  SELECT COUNT(*) INTO n FROM investment_payments WHERE investment_id = h.id AND method='rollover';
  IF n <> 2 THEN RAISE EXCEPTION 'TEST FAIL G4: % carry-forward payments, expected 2', n; END IF;
  RAISE NOTICE 'PASS G4: two matured enrolments → one row of 3 slots, both records and payments on it';
END $$;

-- G5
DO $$ DECLARE n INT; h investments%ROWTYPE; f investments%ROWTYPE; BEGIN
  SELECT COUNT(*) INTO n FROM investments WHERE investor_id='20000000-0000-0000-0000-00000000ff05' AND cycle_id='40000000-0000-0000-0000-00000000ff02';
  IF n <> 2 THEN RAISE EXCEPTION 'TEST FAIL G5: price mismatch should give a fresh row; found % row(s)', n; END IF;
  SELECT * INTO h FROM investments WHERE investment_code='HAND-5';
  IF h.units <> 5 OR h.capital <> 2000000 THEN RAISE EXCEPTION 'TEST FAIL G5: HAND-5 was changed (% / %)', h.units, h.capital; END IF;
  SELECT * INTO f FROM investments WHERE id = (SELECT next_investment_id FROM investments WHERE investment_code='MRG-5');
  IF f.id = h.id OR f.units <> 1 OR f.price_per_unit <> 500000 OR f.capital <> 500000 THEN
    RAISE EXCEPTION 'TEST FAIL G5: fresh row wrong (% / % / %)', f.units, f.price_per_unit, f.capital;
  END IF;
  RAISE NOTICE 'PASS G5: a hand row at 400,000 is left alone; the rollover made its own row at 500,000';
END $$;

-- G6
DO $$ DECLARE f investments%ROWTYPE; BEGIN
  SELECT * INTO f FROM investments WHERE id = (SELECT next_investment_id FROM investments WHERE investment_code='MRG-6');
  IF NOT FOUND OR f.units <> 1 OR f.capital <> 500000 OR f.parent_investment_id <> '50000000-0000-0000-0000-00000000ff06' THEN
    RAISE EXCEPTION 'TEST FAIL G6: fresh row for an investor with nothing in the destination is wrong';
  END IF;
  RAISE NOTICE 'PASS G6: no existing row → fresh row, as before';
END $$;

-- G7
DO $$ DECLARE c cycles%ROWTYPE; s NUMERIC; k NUMERIC; BEGIN
  SELECT * INTO c FROM cycles WHERE id='40000000-0000-0000-0000-00000000ff02';
  SELECT SUM(units), SUM(capital) INTO s, k FROM investments WHERE cycle_id=c.id AND status::text <> 'cancelled';
  -- The fixture seeds total_slots with 100; the trigger adds sold
  -- slots on top of whatever is there, so compare the movement.
  IF c.total_slots - 100 <> s OR c.total_capital <> k THEN
    RAISE EXCEPTION 'TEST FAIL G7: cycle totals slots % capital % vs rows % / %', c.total_slots - 100, c.total_capital, s, k;
  END IF;
  RAISE NOTICE 'PASS G7: cycle totals track the topped-up rows (% slots, %)', s, k;
END $$;

-- ------------------------------------------------------------
-- G8 — reverse the merged rollover of n1, then do it again
-- ------------------------------------------------------------
DO $$ DECLARE r JSONB; h investments%ROWTYPE; o investments%ROWTYPE; n INT; BEGIN
  r := mudarabah_unenrol_next_cycle('50000000-0000-0000-0000-00000000ff01');
  IF NOT (r->>'reversed')::boolean OR r->>'reducedInvestment' <> 'HAND-1' OR (r->>'slotsRemoved')::numeric <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL G8: reversal gave %', r;
  END IF;
  SELECT * INTO h FROM investments WHERE investment_code='HAND-1';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAIL G8: HAND-1 was deleted — the hand money is gone'; END IF;
  IF h.units <> 5 OR h.capital <> 2500000 OR COALESCE(h.rollover_balance,0) <> 0 OR h.parent_investment_id IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL G8: HAND-1 after reversal units % capital % balance % parent %', h.units, h.capital, h.rollover_balance, h.parent_investment_id;
  END IF;
  IF investment_confirmed_paid(h.id) <> 2500000 THEN RAISE EXCEPTION 'TEST FAIL G8: funded % after reversal', investment_confirmed_paid(h.id); END IF;
  SELECT COUNT(*) INTO n FROM investment_payments WHERE investment_id=h.id;
  IF n <> 1 THEN RAISE EXCEPTION 'TEST FAIL G8: % payments left on HAND-1, expected the bank payment only', n; END IF;
  SELECT * INTO o FROM investments WHERE investment_code='MRG-1';
  IF o.status::text <> 'matured' OR o.next_investment_id IS NOT NULL THEN RAISE EXCEPTION 'TEST FAIL G8: MRG-1 status % next %', o.status, o.next_investment_id; END IF;
  IF EXISTS (SELECT 1 FROM cycle_rollovers WHERE previous_investment_id=o.id) THEN RAISE EXCEPTION 'TEST FAIL G8: rollover record survived'; END IF;

  r := mudarabah_enrol_next_cycle(o.id);
  SELECT * INTO h FROM investments WHERE investment_code='HAND-1';
  IF r->>'outcome' <> 'rolled' OR NOT (r->>'merged')::boolean OR h.units <> 7 OR h.capital <> 3500000 OR investment_confirmed_paid(h.id) <> 3500000 THEN
    RAISE EXCEPTION 'TEST FAIL G8: re-enrolment after reversal — % / units % capital % funded %', r, h.units, h.capital, investment_confirmed_paid(h.id);
  END IF;
  RAISE NOTICE 'PASS G8: reversal took back 2 slots / 1,000,000 and the carry-forward only; re-enrolment merged again';
END $$;

-- G9 — reverse MRG-4B off the shared row; MRG-4A stays
DO $$ DECLARE r JSONB; h investments%ROWTYPE; n INT; BEGIN
  r := mudarabah_unenrol_next_cycle('50000000-0000-0000-0000-00000000ff4b');
  IF NOT (r->>'reversed')::boolean OR (r->>'slotsRemoved')::numeric <> 2 THEN RAISE EXCEPTION 'TEST FAIL G9: %', r; END IF;
  SELECT * INTO h FROM investments WHERE investor_id='20000000-0000-0000-0000-00000000ff04' AND cycle_id='40000000-0000-0000-0000-00000000ff02';
  IF NOT FOUND THEN RAISE EXCEPTION 'TEST FAIL G9: shared row deleted'; END IF;
  IF h.units <> 1 OR h.capital <> 500000 OR investment_confirmed_paid(h.id) <> 500000 OR h.parent_investment_id <> '50000000-0000-0000-0000-00000000ff4a' THEN
    RAISE EXCEPTION 'TEST FAIL G9: after reversal units % capital % funded % parent %', h.units, h.capital, investment_confirmed_paid(h.id), h.parent_investment_id;
  END IF;
  SELECT COUNT(*) INTO n FROM cycle_rollovers WHERE new_investment_id = h.id;
  IF n <> 1 THEN RAISE EXCEPTION 'TEST FAIL G9: % rollover records remain, expected 1', n; END IF;
  IF (SELECT next_investment_id FROM investments WHERE investment_code='MRG-4A') <> h.id THEN RAISE EXCEPTION 'TEST FAIL G9: MRG-4A lost its link'; END IF;
  RAISE NOTICE 'PASS G9: one of two rollovers reversed; the other''s slot, payment, link and parenthood remain';
END $$;

-- G10 — an unshared successor is still deleted outright
DO $$ DECLARE r JSONB; v_id UUID; BEGIN
  SELECT next_investment_id INTO v_id FROM investments WHERE investment_code='MRG-6';
  r := mudarabah_unenrol_next_cycle('50000000-0000-0000-0000-00000000ff06');
  IF NOT (r->>'reversed')::boolean OR r->>'removedInvestment' IS NULL THEN RAISE EXCEPTION 'TEST FAIL G10: %', r; END IF;
  IF EXISTS (SELECT 1 FROM investments WHERE id = v_id) THEN RAISE EXCEPTION 'TEST FAIL G10: unshared successor row survived'; END IF;
  IF EXISTS (SELECT 1 FROM investment_payments WHERE investment_id = v_id) THEN RAISE EXCEPTION 'TEST FAIL G10: its payment survived'; END IF;
  RAISE NOTICE 'PASS G10: unshared successor deleted, as in 048';
END $$;

-- G11 — conservation after all of the above: destination value equals
-- what was there by hand plus what actually carried (per cycle_rollovers)
DO $$ DECLARE v_dest NUMERIC; v_carried NUMERIC; v_hand NUMERIC; BEGIN
  SELECT COALESCE(SUM(capital + COALESCE(rollover_balance,0)),0) INTO v_dest
  FROM investments WHERE cycle_id='40000000-0000-0000-0000-00000000ff02' AND status::text = 'active';
  SELECT COALESCE(SUM(total_rollover_amount),0) INTO v_carried
  FROM cycle_rollovers WHERE destination_cycle_id='40000000-0000-0000-0000-00000000ff02' AND status='completed';
  SELECT dest_value INTO v_hand FROM _in;
  IF v_dest <> v_hand + v_carried THEN
    RAISE EXCEPTION 'TEST FAIL G11: destination holds % but hand % + carried % = %', v_dest, v_hand, v_carried, v_hand + v_carried;
  END IF;
  RAISE NOTICE 'PASS G11: value conserved — % = hand % + carried %', v_dest, v_hand, v_carried;
END $$;

ROLLBACK;
\echo '=== ALL MERGE SCENARIOS PASSED ==='
