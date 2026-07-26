-- ============================================================
-- Investor access scenarios — step 5, tests 1 to 3
--
-- Written BEFORE the investor report view, because this is the one
-- failure that would be unrecoverable: showing someone another
-- investor's figures leaks a third party's information.
--
-- Authorisation is not a check the route remembers to perform. It is
-- row level security keyed on get_my_investor_id(), which resolves
-- from auth.uid() — the session — and can never be influenced by a
-- parameter the client sends. These scenarios prove that by asking as
-- each investor in turn.
--
--   T1  investor A cannot read investor B's settlement figures
--   T2  investor A cannot read a cycle they hold no investment in
--   T3  an unauthenticated request reads nothing at all
--   T4  no route exposes per-product figures to any investor
--
-- Run against a DB with 001–021 applied.
-- ============================================================
\set ON_ERROR_STOP on

-- Supabase supplies the `authenticated` and `anon` roles; the local
-- stub does not. Without them these scenarios would run as the table
-- OWNER, for whom row level security is bypassed entirely — and would
-- pass while proving nothing.
DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000c1', 'accadmin@test.com'),
  ('10000000-0000-0000-0000-0000000000c1', 'alpha@test.com'),
  ('10000000-0000-0000-0000-0000000000c2', 'beta@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000c1', 'accadmin@test.com', 'Access Admin', 'super_admin'),
  ('10000000-0000-0000-0000-0000000000c1', 'alpha@test.com', 'Investor Alpha', 'investor'),
  ('10000000-0000-0000-0000-0000000000c2', 'beta@test.com', 'Investor Beta', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, full_name = EXCLUDED.full_name;

INSERT INTO investors (id, profile_id, investor_code, full_name, email) VALUES
  ('20000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c1', 'MGC0001', 'Investor Alpha', 'alpha@test.com'),
  ('20000000-0000-0000-0000-0000000000c2', '10000000-0000-0000-0000-0000000000c2', 'MGC0002', 'Investor Beta', 'beta@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO series (id, name, description, start_month_offset, price_per_unit, mudarabah_investor_ratio, default_wht_rate)
VALUES ('30000000-0000-0000-0000-0000000000c1', 'B', 'Series B', 0, 100000, 0.70, 0.10)
ON CONFLICT (name) DO UPDATE SET
  price_per_unit = EXCLUDED.price_per_unit,
  mudarabah_investor_ratio = EXCLUDED.mudarabah_investor_ratio,
  default_wht_rate = EXCLUDED.default_wht_rate;

-- TWO cycles. Alpha is in the first, Beta in the second. Neither is
-- in the other's.
INSERT INTO cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status, unit_value, wht_rate)
VALUES
  ('40000000-0000-0000-0000-0000000000c1', (SELECT id FROM series WHERE name='B'),
   601, 'B-601', '2026-01-01', '2026-03-31', 'active', 100000, 0.10),
  ('40000000-0000-0000-0000-0000000000c2', (SELECT id FROM series WHERE name='B'),
   602, 'B-602', '2026-04-01', '2026-06-30', 'active', 100000, 0.10);

INSERT INTO investments (
  id, investment_code, investor_id, series_id, cycle_id, units, price_per_unit,
  capital, investment_date, maturity_date, status
) VALUES
  ('50000000-0000-0000-0000-0000000000c1', 'MGB601-0001', '20000000-0000-0000-0000-0000000000c1',
   (SELECT id FROM series WHERE name='B'), '40000000-0000-0000-0000-0000000000c1',
   10, 100000, 1000000, '2026-01-01', '2026-03-31', 'active'),
  ('50000000-0000-0000-0000-0000000000c2', 'MGB602-0001', '20000000-0000-0000-0000-0000000000c2',
   (SELECT id FROM series WHERE name='B'), '40000000-0000-0000-0000-0000000000c2',
   4, 100000, 400000, '2026-04-01', '2026-06-30', 'active');

SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000c1';

-- Settle both cycles so there is something worth protecting
SELECT mudarabah_save_ledger(jsonb_build_object(
  'cycleId', '40000000-0000-0000-0000-0000000000c1', 'description', 'home furniture',
  'discloseMode', 'perSlot', 'status', 'active',
  'products', jsonb_build_array(jsonb_build_object('id','w','name','Executive chair')),
  'months', jsonb_build_array(
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB),
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB),
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB))));

SELECT mudarabah_save_ledger(jsonb_build_object(
  'cycleId', '40000000-0000-0000-0000-0000000000c2', 'description', 'home furniture',
  'discloseMode', 'perSlot', 'status', 'active',
  'products', jsonb_build_array(jsonb_build_object('id','w','name','Executive chair')),
  'months', jsonb_build_array(
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB),
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB),
    jsonb_build_object('ads',0,'logistics',0,'misc',0,'bankCharges',0,'rows','[]'::JSONB))));

SELECT mudarabah_settle_cycle(
  '40000000-0000-0000-0000-0000000000c1', '1.0.0',
  '{"revenue":50000000,"profit":10000000,"holderPot":7000000,"managerPot":3000000}'::JSONB,
  jsonb_build_array(jsonb_build_object(
    'investmentId','50000000-0000-0000-0000-0000000000c1',
    'investorId','20000000-0000-0000-0000-0000000000c1',
    'units',10,'capital',100000000,'grossProfit',7000000,'wht',700000,
    'netProfit',6300000,'capitalAction','rollover','slotsWithdrawn',0,
    'capitalWithdrawn',0,'amountPaid',6300000)),
  jsonb_build_array(jsonb_build_object(
    'productId','w','productName','Executive chair','unitsBought',40,'unitsSold',38,
    'unitsLeft',2,'revenue',50000000,'cogs',38000000,'gross',12000000,'grossMargin',24.0)));

SELECT mudarabah_settle_cycle(
  '40000000-0000-0000-0000-0000000000c2', '1.0.0',
  '{"revenue":20000000,"profit":4000000,"holderPot":2800000,"managerPot":1200000}'::JSONB,
  jsonb_build_array(jsonb_build_object(
    'investmentId','50000000-0000-0000-0000-0000000000c2',
    'investorId','20000000-0000-0000-0000-0000000000c2',
    'units',4,'capital',40000000,'grossProfit',2800000,'wht',280000,
    'netProfit',2520000,'capitalAction','withdraw','slotsWithdrawn',4,
    'capitalWithdrawn',40000000,'amountPaid',42520000)));

-- ------------------------------------------------------------
-- T1 + T2: ask AS Alpha. RLS answers, not the query.
-- ------------------------------------------------------------
DO $$
DECLARE v_n INTEGER;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL test.uid = '10000000-0000-0000-0000-0000000000c1';

  -- Alpha sees her own figures
  SELECT COUNT(*) INTO v_n FROM mudarabah_settlement_holders;
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL T1: Alpha should see exactly her own row, saw %', v_n;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mudarabah_settlement_holders
                 WHERE investor_id = '20000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'TEST FAIL T1: Alpha cannot see her own settlement figures';
  END IF;

  -- ...and asking explicitly for Beta's returns nothing. The id in the
  -- query is not what decides; the session is.
  IF EXISTS (SELECT 1 FROM mudarabah_settlement_holders
             WHERE investor_id = '20000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'TEST FAIL T1: Alpha read Beta''s settlement figures';
  END IF;
  IF EXISTS (SELECT 1 FROM mudarabah_settlement_holders
             WHERE investment_id = '50000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'TEST FAIL T1: Alpha read Beta''s row by investment id';
  END IF;

  -- T2: a cycle she holds nothing in is invisible, settlement and all
  IF EXISTS (SELECT 1 FROM mudarabah_settlements
             WHERE cycle_id = '40000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'TEST FAIL T2: Alpha read the settlement of a cycle she is not in';
  END IF;
  IF EXISTS (SELECT 1 FROM mudarabah_ledgers
             WHERE cycle_id = '40000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'TEST FAIL T2: Alpha read the ledger of a cycle she is not in';
  END IF;
  IF EXISTS (SELECT 1 FROM mudarabah_balance_entries
             WHERE investor_id = '20000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'TEST FAIL T2: Alpha read Beta''s balance entries';
  END IF;

  -- And her own cycle IS visible, so the test is not passing by
  -- accident of everything being denied
  IF NOT EXISTS (SELECT 1 FROM mudarabah_settlements
                 WHERE cycle_id = '40000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'TEST FAIL T1: Alpha cannot see her own cycle''s settlement';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS T1/T2: an investor reads only their own figures, in only their own cycles';
END $$;

-- ------------------------------------------------------------
-- The mirror image, as Beta. Symmetry matters: a policy that
-- happens to work one way round is not a policy.
-- ------------------------------------------------------------
DO $$
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL test.uid = '10000000-0000-0000-0000-0000000000c2';

  IF EXISTS (SELECT 1 FROM mudarabah_settlement_holders
             WHERE investor_id = '20000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'TEST FAIL T1: Beta read Alpha''s settlement figures';
  END IF;
  IF EXISTS (SELECT 1 FROM mudarabah_settlements
             WHERE cycle_id = '40000000-0000-0000-0000-0000000000c1') THEN
    RAISE EXCEPTION 'TEST FAIL T2: Beta read the settlement of a cycle he is not in';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM mudarabah_settlement_holders
                 WHERE investor_id = '20000000-0000-0000-0000-0000000000c2') THEN
    RAISE EXCEPTION 'TEST FAIL T1: Beta cannot see his own figures';
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS T1/T2 (mirrored): the same holds with the investors reversed';
END $$;

-- ------------------------------------------------------------
-- T3: no session at all
-- ------------------------------------------------------------
DO $$
DECLARE v_n INTEGER;
BEGIN
  SET LOCAL ROLE anon;
  SET LOCAL test.uid = '';

  SELECT COUNT(*) INTO v_n FROM mudarabah_settlement_holders;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL T3: an unauthenticated request read % settlement rows', v_n;
  END IF;
  SELECT COUNT(*) INTO v_n FROM mudarabah_settlements;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL T3: an unauthenticated request read % settlements', v_n;
  END IF;
  SELECT COUNT(*) INTO v_n FROM mudarabah_balance_entries;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL T3: an unauthenticated request read % balance entries', v_n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS T3: an unauthenticated request reads nothing';
END $$;

-- ------------------------------------------------------------
-- T4: per-product figures are unreachable by ANY investor
--
-- Not a step 5 requirement, but the same session that will render the
-- report is the one being tested, so it belongs here.
-- ------------------------------------------------------------
DO $$
DECLARE v_n INTEGER;
BEGIN
  SET LOCAL ROLE authenticated;
  SET LOCAL test.uid = '10000000-0000-0000-0000-0000000000c1';

  SELECT COUNT(*) INTO v_n FROM mudarabah_settlement_products;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL T4: an investor read % per-product rows', v_n;
  END IF;
  SELECT COUNT(*) INTO v_n FROM mudarabah_products;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL T4: an investor read % product rows', v_n;
  END IF;
  SELECT COUNT(*) INTO v_n FROM mudarabah_month_rows;
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL T4: an investor read % month rows', v_n;
  END IF;

  RESET ROLE;
  RAISE NOTICE 'PASS T4: no investor session can reach a per-product figure';
END $$;

ROLLBACK;
