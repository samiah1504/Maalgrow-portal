-- ============================================================
-- Mudarabah cycles — scenario tests (migration 018)
-- Run against a DB with migrations 001–018 applied.
--
-- All money is INTEGER KOBO. ₦100,000 is 10000000.
-- ============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'mudadmin@test.com'),
  ('a0000000-0000-0000-0000-0000000000f2', 'mudops@test.com'),
  ('10000000-0000-0000-0000-0000000000f1', 'mi1@test.com'),
  ('10000000-0000-0000-0000-0000000000f2', 'mi2@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000f1', 'mudadmin@test.com', 'Mud Admin', 'super_admin'),
  ('a0000000-0000-0000-0000-0000000000f2', 'mudops@test.com', 'Mud Ops', 'operations'),
  ('10000000-0000-0000-0000-0000000000f1', 'mi1@test.com', 'Holder One', 'investor'),
  ('10000000-0000-0000-0000-0000000000f2', 'mi2@test.com', 'Holder Two', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO investors (id, profile_id, investor_code, full_name, email) VALUES
  ('20000000-0000-0000-0000-0000000000f1', '10000000-0000-0000-0000-0000000000f1', 'MGM0001', 'Holder One', 'mi1@test.com'),
  ('20000000-0000-0000-0000-0000000000f2', '10000000-0000-0000-0000-0000000000f2', 'MGM0002', 'Holder Two', 'mi2@test.com')
ON CONFLICT (id) DO NOTHING;

SET test.uid = 'a0000000-0000-0000-0000-0000000000f1';

-- ------------------------------------------------------------
-- Scenario 1: round trip — a saved cycle reads back unchanged
-- ------------------------------------------------------------
DO $$
DECLARE
  v_in  JSONB;
  v_id  UUID;
  v_out JSONB;
BEGIN
  v_in := jsonb_build_object(
    'name', 'Cycle 2026-Q1',
    'description', 'home furniture',
    'startDate', '2026-01-01',
    'currency', 'NGN',
    'slotPrice', 10000000,          -- ₦100,000
    'slots', 20,
    'ratio', 70,
    'wht', 5,
    'status', 'active',
    'discloseMode', 'perSlot',
    'products', jsonb_build_array(
      jsonb_build_object('id', 'sofa',  'name', '3-seater sofa'),
      jsonb_build_object('id', 'table', 'name', 'Dining table'),
      jsonb_build_object('id', 'bed',   'name', 'Bed frame')
    ),
    'months', jsonb_build_array(
      jsonb_build_object(
        'ads', 6000000, 'logistics', 2500000, 'misc', 1000000, 'bankCharges', 500000,
        'rows', jsonb_build_array(
          jsonb_build_object('productId','sofa','qty',20,'unitCost',4700000,'soldQty',13,'sellPrice',7100000,'stockLeft',7),
          jsonb_build_object('productId','table','qty',50,'unitCost',910000,'soldQty',31,'sellPrice',1430000,'stockLeft',19),
          jsonb_build_object('productId','bed','qty',25,'unitCost',2100000,'soldQty',17,'sellPrice',3100000,'stockLeft',8)
        )
      ),
      jsonb_build_object(
        'ads', 5500000, 'logistics', 2200000, 'misc', 800000, 'bankCharges', 600000,
        'rows', jsonb_build_array(
          jsonb_build_object('productId','sofa','qty',12,'unitCost',4850000,'soldQty',14,'sellPrice',7250000,'stockLeft',5),
          jsonb_build_object('productId','table','qty',30,'unitCost',940000,'soldQty',33,'sellPrice',1460000,'stockLeft',15),
          jsonb_build_object('productId','bed','qty',10,'unitCost',2150000,'soldQty',12,'sellPrice',3150000,'stockLeft',6)
        )
      ),
      jsonb_build_object(
        'ads', 5000000, 'logistics', 2000000, 'misc', 1200000, 'bankCharges', 700000,
        'rows', jsonb_build_array(
          jsonb_build_object('productId','sofa','qty',6,'unitCost',4900000,'soldQty',9,'sellPrice',7300000,'stockLeft',2),
          jsonb_build_object('productId','table','qty',20,'unitCost',960000,'soldQty',30,'sellPrice',1500000,'stockLeft',5),
          jsonb_build_object('productId','bed','qty',8,'unitCost',2200000,'soldQty',13,'sellPrice',3200000,'stockLeft',1)
        )
      )
    )
  );

  v_id := mudarabah_save_cycle(v_in);
  v_out := mudarabah_get_cycle(v_id);

  -- Everything the engine consumes must come back identical
  IF (v_out - 'id') <> (v_in - 'id') THEN
    RAISE EXCEPTION 'TEST FAIL S1: cycle did not round trip.% in=% out=%', chr(10), v_in, v_out;
  END IF;

  -- Nothing derived is stored: no profit, ROI or unit cost price column
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name IN ('mudarabah_cycles','mudarabah_months','mudarabah_month_rows')
      AND column_name IN ('profit','roi','net_profit','unit_cp','cost_price','gross')
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S1: a derived value is being stored on the cycle';
  END IF;

  RAISE NOTICE 'PASS S1: cycle round trips unchanged, inputs only';
END $$;

-- ------------------------------------------------------------
-- Scenario 2: multi-product persistence — every product keeps its own
-- per-month row, and stock carries forward per product
-- ------------------------------------------------------------
DO $$
DECLARE
  v_id    UUID;
  v_rows  INTEGER;
  v_sofa3 INTEGER;
  v_tab3  INTEGER;
BEGIN
  SELECT id INTO v_id FROM mudarabah_cycles WHERE name = 'Cycle 2026-Q1';

  SELECT COUNT(*) INTO v_rows
  FROM mudarabah_month_rows r
  JOIN mudarabah_months m ON m.id = r.month_id
  WHERE m.cycle_id = v_id;

  IF v_rows <> 9 THEN
    RAISE EXCEPTION 'TEST FAIL S2: expected 9 rows (3 products x 3 months), got %', v_rows;
  END IF;

  SELECT r.stock_left INTO v_sofa3
  FROM mudarabah_month_rows r
  JOIN mudarabah_months m ON m.id = r.month_id
  JOIN mudarabah_products p ON p.id = r.product_id
  WHERE m.cycle_id = v_id AND m.month_index = 3 AND p.product_key = 'sofa';

  SELECT r.stock_left INTO v_tab3
  FROM mudarabah_month_rows r
  JOIN mudarabah_months m ON m.id = r.month_id
  JOIN mudarabah_products p ON p.id = r.product_id
  WHERE m.cycle_id = v_id AND m.month_index = 3 AND p.product_key = 'table';

  -- Each product's own counted stock, kept apart
  IF v_sofa3 <> 2 OR v_tab3 <> 5 THEN
    RAISE EXCEPTION 'TEST FAIL S2: per-product stock wrong: sofa=% table=%', v_sofa3, v_tab3;
  END IF;

  -- A product removed from the list takes its rows with it
  PERFORM mudarabah_save_cycle(
    jsonb_set(
      mudarabah_get_cycle(v_id),
      '{products}',
      jsonb_build_array(
        jsonb_build_object('id','sofa','name','3-seater sofa'),
        jsonb_build_object('id','table','name','Dining table')
      )
    )
  );

  SELECT COUNT(*) INTO v_rows
  FROM mudarabah_month_rows r
  JOIN mudarabah_months m ON m.id = r.month_id
  WHERE m.cycle_id = v_id;

  IF v_rows <> 6 THEN
    RAISE EXCEPTION 'TEST FAIL S2: removing a product left % rows, expected 6', v_rows;
  END IF;

  RAISE NOTICE 'PASS S2: products and their per-month rows persist independently';
END $$;

-- ------------------------------------------------------------
-- Scenario 3: settlement is idempotent
-- ------------------------------------------------------------
DO $$
DECLARE
  v_id       UUID;
  v_s1       UUID;
  v_s2       UUID;
  v_count    INTEGER;
  v_entries  INTEGER;
  v_computed JSONB;
  v_holders  JSONB;
BEGIN
  SELECT id INTO v_id FROM mudarabah_cycles WHERE name = 'Cycle 2026-Q1';

  PERFORM mudarabah_set_holding(v_id, '20000000-0000-0000-0000-0000000000f1', 12, 'withdraw');
  PERFORM mudarabah_set_holding(v_id, '20000000-0000-0000-0000-0000000000f2', 8,  'rollover');

  -- Figures come from the shared engine; the database never recomputes
  v_computed := jsonb_build_object(
    'profit', 151615570, 'holderPot', 106130899, 'managerPot', 45484671,
    'grossPerSlot', 5306545, 'whtPerSlot', 265327, 'netPerSlot', 5041218,
    'returnPerSlot', 50.41, 'endCash', 335010000, 'endStockValue', 16605570,
    'slotPrice', 10000000, 'slots', 20, 'capital', 200000000, 'isLoss', false
  );
  v_holders := jsonb_build_array(
    jsonb_build_object('investorRef','20000000-0000-0000-0000-0000000000f1',
      'slots',12,'capital',120000000,'profit',60494616,'capitalAction','withdraw','amountPaid',180494616),
    jsonb_build_object('investorRef','20000000-0000-0000-0000-0000000000f2',
      'slots',8,'capital',80000000,'profit',40329744,'capitalAction','rollover','amountPaid',40329744)
  );

  v_s1 := mudarabah_settle_cycle(v_id, '1.0.0', v_computed, v_holders);
  -- Settling again must change nothing at all
  v_s2 := mudarabah_settle_cycle(v_id, '1.0.0', v_computed, v_holders);

  IF v_s1 <> v_s2 THEN
    RAISE EXCEPTION 'TEST FAIL S3: second settle created a new settlement';
  END IF;

  SELECT COUNT(*) INTO v_count FROM mudarabah_settlements WHERE cycle_id = v_id;
  IF v_count <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S3: expected 1 settlement, got %', v_count;
  END IF;

  -- 2 holders: one withdrawing (profit + capital), one rolling over (profit)
  SELECT COUNT(*) INTO v_entries FROM mudarabah_balance_entries WHERE cycle_id = v_id;
  IF v_entries <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL S3: expected 3 balance entries, got % (a doubled balance)', v_entries;
  END IF;

  IF (SELECT status FROM mudarabah_cycles WHERE id = v_id) <> 'settled' THEN
    RAISE EXCEPTION 'TEST FAIL S3: cycle not marked settled';
  END IF;

  IF (SELECT engine_version FROM mudarabah_settlements WHERE id = v_s1) <> '1.0.0' THEN
    RAISE EXCEPTION 'TEST FAIL S3: engine version not stamped';
  END IF;

  RAISE NOTICE 'PASS S3: settling twice produces one settlement and one set of entries';
END $$;

-- ------------------------------------------------------------
-- Scenario 4: a settled cycle is not editable
-- ------------------------------------------------------------
DO $$
DECLARE
  v_id UUID;
  v_ok BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_id FROM mudarabah_cycles WHERE name = 'Cycle 2026-Q1';
  BEGIN
    PERFORM mudarabah_save_cycle(mudarabah_get_cycle(v_id));
  EXCEPTION WHEN OTHERS THEN
    v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL S4: a settled cycle accepted an edit';
  END IF;

  v_ok := FALSE;
  BEGIN
    PERFORM mudarabah_set_holding(v_id, '20000000-0000-0000-0000-0000000000f1', 99, 'withdraw');
  EXCEPTION WHEN OTHERS THEN
    v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL S4: a settled cycle accepted a holdings change';
  END IF;

  RAISE NOTICE 'PASS S4: settled cycles reject edits to inputs and holdings';
END $$;

-- ------------------------------------------------------------
-- Scenario 5: unsettle keeps the earlier snapshot and leaves a trail
-- ------------------------------------------------------------
DO $$
DECLARE
  v_id        UUID;
  v_old       UUID;
  v_new       UUID;
  v_snapshots INTEGER;
  v_reversals INTEGER;
  v_computed  JSONB;
BEGIN
  SELECT id INTO v_id FROM mudarabah_cycles WHERE name = 'Cycle 2026-Q1';
  SELECT id INTO v_old FROM mudarabah_settlements WHERE cycle_id = v_id AND is_current;

  PERFORM mudarabah_unsettle_cycle(v_id, 'Month 3 stock count was wrong');

  -- The earlier snapshot is RETAINED, not overwritten
  IF NOT EXISTS (
    SELECT 1 FROM mudarabah_settlements
    WHERE id = v_old AND is_current = FALSE AND superseded_at IS NOT NULL
      AND supersede_reason = 'Month 3 stock count was wrong'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S5: the earlier snapshot was not retained';
  END IF;

  IF (SELECT status FROM mudarabah_cycles WHERE id = v_id) <> 'active' THEN
    RAISE EXCEPTION 'TEST FAIL S5: cycle did not reopen';
  END IF;

  -- Who, when and why
  IF NOT EXISTS (
    SELECT 1 FROM mudarabah_cycle_events
    WHERE cycle_id = v_id AND action = 'unsettled'
      AND reason = 'Month 3 stock count was wrong'
      AND actor_id = 'a0000000-0000-0000-0000-0000000000f1'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S5: unsettle was not logged with who and why';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM audit_logs
    WHERE action = 'mudarabah_cycle_unsettled' AND entity_id = v_id::TEXT
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S5: unsettle missing from the audit log';
  END IF;

  -- Balances undone by their own entries, originals untouched
  SELECT COUNT(*) INTO v_reversals
  FROM mudarabah_balance_entries WHERE settlement_id = v_old AND entry_type = 'reversal';
  IF v_reversals <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL S5: expected 3 reversal entries, got %', v_reversals;
  END IF;

  IF (SELECT SUM(amount) FROM mudarabah_balance_entries WHERE settlement_id = v_old) <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL S5: reversals do not cancel the originals';
  END IF;

  -- Re-settling writes a NEW snapshot; the old one stays
  v_computed := jsonb_build_object(
    'profit', 150000000, 'holderPot', 105000000, 'managerPot', 45000000,
    'grossPerSlot', 5250000, 'whtPerSlot', 262500, 'netPerSlot', 4987500,
    'returnPerSlot', 49.88, 'endCash', 335010000, 'endStockValue', 16605570,
    'slotPrice', 10000000, 'slots', 20, 'capital', 200000000, 'isLoss', false
  );
  v_new := mudarabah_settle_cycle(v_id, '1.0.0', v_computed, jsonb_build_array(
    jsonb_build_object('investorRef','20000000-0000-0000-0000-0000000000f1',
      'slots',12,'capital',120000000,'profit',59850000,'capitalAction','withdraw','amountPaid',179850000)
  ));

  IF v_new = v_old THEN
    RAISE EXCEPTION 'TEST FAIL S5: re-settlement reused the old snapshot';
  END IF;

  SELECT COUNT(*) INTO v_snapshots FROM mudarabah_settlements WHERE cycle_id = v_id;
  IF v_snapshots <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL S5: expected 2 snapshots retained, got %', v_snapshots;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM mudarabah_cycle_events WHERE cycle_id = v_id AND action = 'resettled'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S5: re-settlement not logged';
  END IF;

  RAISE NOTICE 'PASS S5: unsettle retains the snapshot, logs who/when/why, reverses by new entries';
END $$;

-- ------------------------------------------------------------
-- Scenario 6: permissions and confidentiality
-- ------------------------------------------------------------
DO $$
DECLARE
  v_id UUID;
  v_ok BOOLEAN := FALSE;
BEGIN
  SELECT id INTO v_id FROM mudarabah_cycles WHERE name = 'Cycle 2026-Q1';

  -- Operations staff may read, but may not settle or edit
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000f2';
  BEGIN
    PERFORM mudarabah_unsettle_cycle(v_id, 'trying it on');
  EXCEPTION WHEN OTHERS THEN
    v_ok := TRUE;
  END;
  IF NOT v_ok THEN
    RAISE EXCEPTION 'TEST FAIL S6: non-administrator was allowed to unsettle';
  END IF;

  -- Investors have NO read policy on any per-product table
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename IN ('mudarabah_products', 'mudarabah_month_rows',
                        'mudarabah_months', 'mudarabah_settlement_products')
      AND qual ILIKE '%get_my_investor_id%'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S6: an investor policy exists on a per-product table';
  END IF;

  -- The frozen snapshot itself carries no product breakdown
  IF EXISTS (
    SELECT 1 FROM mudarabah_settlements
    WHERE cycle_id = v_id
      AND (computed::TEXT ILIKE '%product%' OR computed::TEXT ILIKE '%sofa%')
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S6: the settlement snapshot leaks per-product data';
  END IF;

  RAISE NOTICE 'PASS S6: only administrators may settle; per-product data is admin-only';
END $$;

ROLLBACK;
