-- ============================================================
-- Settled-cycle membership — migration 033
--
-- Settling matures every investment in a cycle. The ledger
-- counted only those still 'active', so the moment Series B
-- settled its page reported 0 slots, 0 investors and no
-- capital, against 39,000,000 naira received.
--
-- The members of a cycle are everyone who was genuinely in it.
-- Only 'cancelled' never was.
-- ============================================================
BEGIN;
INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-00000000aa01','sa@t.com'),
 ('10000000-0000-0000-0000-00000000aa01','si@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-00000000aa01','sa@t.com','Settled Admin','super_admin'),
 ('10000000-0000-0000-0000-00000000aa01','si@t.com','Settled Investor','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;
INSERT INTO investors (id,profile_id,investor_code,full_name,email) VALUES
 ('20000000-0000-0000-0000-00000000aa01','10000000-0000-0000-0000-00000000aa01','MGS901','Settled Investor','si@t.com')
ON CONFLICT DO NOTHING;
INSERT INTO series (id,name,description,start_month_offset,price_per_unit,mudarabah_investor_ratio)
 VALUES ('30000000-0000-0000-0000-00000000aa01','C','Series C',0,500000,0.50)
ON CONFLICT (name) DO UPDATE SET price_per_unit=EXCLUDED.price_per_unit;
INSERT INTO cycles (id,series_id,cycle_number,cycle_label,start_date,end_date,status,unit_value,total_slots)
 VALUES ('40000000-0000-0000-0000-00000000aa01',(SELECT id FROM series WHERE name='C'),971,'S-971','2026-04-30','2026-07-30','completed',500000,6);

-- Three memberships across the whole lifecycle, plus one cancelled
INSERT INTO investments (investment_code,investor_id,series_id,cycle_id,units,price_per_unit,capital,investment_date,maturity_date,status) VALUES
 ('S-A','20000000-0000-0000-0000-00000000aa01',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-00000000aa01',1,500000,500000,'2026-04-30','2026-07-30','active'),
 ('S-M','20000000-0000-0000-0000-00000000aa01',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-00000000aa01',2,500000,1000000,'2026-04-30','2026-07-30','matured'),
 ('S-C','20000000-0000-0000-0000-00000000aa01',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-00000000aa01',3,500000,1500000,'2026-04-30','2026-07-30','completed'),
 ('S-X','20000000-0000-0000-0000-00000000aa01',(SELECT id FROM series WHERE name='C'),'40000000-0000-0000-0000-00000000aa01',9,500000,4500000,'2026-04-30','2026-07-30','cancelled');

DO $$ DECLARE v JSONB; BEGIN
  v := mudarabah_get_ledger('40000000-0000-0000-0000-00000000aa01');

  IF (v->>'totalUnits')::NUMERIC <> 6 THEN
    RAISE EXCEPTION 'TEST FAIL: a settled cycle reported % slots, expected 6 (1 active + 2 matured + 3 completed)', v->>'totalUnits';
  END IF;
  IF (v->>'investorCount')::INT <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 3 members, got %', v->>'investorCount';
  END IF;
  IF (v->>'pooledCapital')::NUMERIC <> 3000000 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 3,000,000 pooled, got %', v->>'pooledCapital';
  END IF;
  IF jsonb_array_length(v->'holders') <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL: expected 3 holders listed, got %', jsonb_array_length(v->'holders');
  END IF;
  -- the cancelled enrolment must stay out: that is the phantom slot
  IF v::TEXT LIKE '%S-X%' THEN
    RAISE EXCEPTION 'TEST FAIL: a cancelled enrolment was counted as a member';
  END IF;

  RAISE NOTICE 'PASS: a settled cycle keeps its members; only cancelled is excluded';
END $$;
ROLLBACK;
