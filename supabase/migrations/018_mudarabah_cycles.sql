-- ============================================================
-- Migration 018 – Mudarabah cycles
--
-- Data model and persistence for the Mudarabah cycle feature. This
-- migration is ADDITIVE: it creates new tables only and does not
-- touch any existing table, function or policy. In particular the
-- existing `cycles` table (series cycles) is untouched — everything
-- here is prefixed `mudarabah_`.
--
--   • mudarabah_cycles            – cycle setup (inputs only)
--   • mudarabah_products          – products declared once per cycle
--   • mudarabah_months            – 3 months, month-level expenses
--   • mudarabah_month_rows        – one row per product per month
--   • mudarabah_holdings          – slots held, referencing investors
--   • mudarabah_settlements       – the FROZEN figures
--   • mudarabah_settlement_holders– per holder, incl. what was paid
--   • mudarabah_settlement_products – per product, ADMIN ONLY
--   • mudarabah_balance_entries   – what moved at settlement
--   • mudarabah_cycle_events      – settle / unsettle trail
--
-- STORE INPUTS ONLY. No profit, no ROI, no cost price per unit is
-- stored on a cycle — those derive through the shared TypeScript
-- engine. The one exception is the settlement snapshot, which is the
-- record of a real event rather than a cache of a display value.
--
-- ALL MONEY IS INTEGER KOBO (BIGINT). ₦8,000 is 800000. Never a float.
--
-- CONFIDENTIALITY: per-product figures are admin-only. Investors have
-- no read policy on products, month rows, months, or the per-product
-- settlement table — the aggregate settlement is all they can reach.
--
-- Apply AFTER migration 017.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Cycle
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_cycles (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           TEXT NOT NULL,
  -- A category ("home furniture"), never a list of products
  description    TEXT,
  start_date     DATE NOT NULL,
  currency       TEXT NOT NULL DEFAULT 'NGN',
  slot_price     BIGINT NOT NULL CHECK (slot_price > 0),      -- kobo
  slots          INTEGER NOT NULL CHECK (slots >= 0),
  -- Investor share of profit, 0–100. A RATIO applied to realised
  -- profit — never a rate on capital.
  ratio          NUMERIC(5,2) NOT NULL CHECK (ratio >= 0 AND ratio <= 100),
  wht            NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (wht >= 0 AND wht <= 100),
  status         TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'settled')),
  disclose_mode  TEXT NOT NULL DEFAULT 'perSlot'
    CHECK (disclose_mode IN ('full', 'perSlot')),
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mudarabah_cycles_status
  ON mudarabah_cycles(status);

-- ------------------------------------------------------------
-- 2. Products — declared ONCE per cycle, stable across all 3 months
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_products (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id     UUID NOT NULL REFERENCES mudarabah_cycles(id) ON DELETE CASCADE,
  -- Client-supplied stable key, so a saved cycle round-trips unchanged
  product_key  TEXT NOT NULL,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, product_key)
);

-- ------------------------------------------------------------
-- 3. Months — exactly 3, month-level selling expenses only.
--    These are NEVER allocated to products.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_months (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id      UUID NOT NULL REFERENCES mudarabah_cycles(id) ON DELETE CASCADE,
  month_index   INTEGER NOT NULL CHECK (month_index BETWEEN 1 AND 3),
  ads           BIGINT NOT NULL DEFAULT 0 CHECK (ads >= 0),
  logistics     BIGINT NOT NULL DEFAULT 0 CHECK (logistics >= 0),
  misc          BIGINT NOT NULL DEFAULT 0 CHECK (misc >= 0),
  bank_charges  BIGINT NOT NULL DEFAULT 0 CHECK (bank_charges >= 0),
  UNIQUE (cycle_id, month_index)
);

-- ------------------------------------------------------------
-- 4. Month rows — one per product per month.
--
--    stock_left stores what was actually COUNTED. When it equals the
--    derived expectation it is simply the derived figure saved; when
--    it differs, the gap is a recorded loss. Stored either way so a
--    later formula change cannot silently alter history.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_month_rows (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  month_id    UUID NOT NULL REFERENCES mudarabah_months(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES mudarabah_products(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  unit_cost   BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),   -- kobo
  sold_qty    INTEGER NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  sell_price  BIGINT NOT NULL DEFAULT 0 CHECK (sell_price >= 0),  -- kobo
  stock_left  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (month_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_mudarabah_month_rows_product
  ON mudarabah_month_rows(product_id);

-- ------------------------------------------------------------
-- 5. Holdings — references the EXISTING investors table.
--    No new investor, user or account table is created.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_holdings (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id        UUID NOT NULL REFERENCES mudarabah_cycles(id) ON DELETE CASCADE,
  investor_id     UUID NOT NULL REFERENCES investors(id),
  slots           INTEGER NOT NULL CHECK (slots > 0),
  capital_action  TEXT NOT NULL DEFAULT 'rollover'
    CHECK (capital_action IN ('withdraw', 'rollover')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (cycle_id, investor_id)
);

CREATE INDEX IF NOT EXISTS idx_mudarabah_holdings_investor
  ON mudarabah_holdings(investor_id);

-- ------------------------------------------------------------
-- 6. Settlements — THE FREEZE.
--
--    Once a cycle is settled its figures are read from here and never
--    recomputed. A re-settlement writes a NEW row; the previous one is
--    retained with is_current = FALSE and is never overwritten.
--
--    `computed` holds AGGREGATE figures only. No per-product data ever
--    enters this record, so nothing downstream of it can leak one.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_settlements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id        UUID NOT NULL REFERENCES mudarabah_cycles(id) ON DELETE CASCADE,
  settled_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_by      UUID REFERENCES profiles(id),
  -- Which rules this cycle was settled under
  engine_version  TEXT NOT NULL,
  computed        JSONB NOT NULL,
  is_current      BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_at   TIMESTAMPTZ,
  superseded_by   UUID REFERENCES profiles(id),
  supersede_reason TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one current settlement per cycle. This index is what makes
-- settlement idempotent — the guard is the record, not a status flag.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mudarabah_settlement_current
  ON mudarabah_settlements(cycle_id) WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_mudarabah_settlements_cycle
  ON mudarabah_settlements(cycle_id, settled_at DESC);

CREATE TABLE IF NOT EXISTS mudarabah_settlement_holders (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  settlement_id   UUID NOT NULL REFERENCES mudarabah_settlements(id) ON DELETE CASCADE,
  investor_id     UUID NOT NULL REFERENCES investors(id),
  slots           INTEGER NOT NULL,
  capital         BIGINT NOT NULL,   -- kobo
  profit          BIGINT NOT NULL,   -- kobo, may be negative on a loss
  capital_action  TEXT NOT NULL CHECK (capital_action IN ('withdraw', 'rollover')),
  -- What ACTUALLY moved, deliberately separate from `profit`
  amount_paid     BIGINT NOT NULL,
  amount_paid_note TEXT,
  UNIQUE (settlement_id, investor_id)
);

CREATE INDEX IF NOT EXISTS idx_mudarabah_settlement_holders_investor
  ON mudarabah_settlement_holders(investor_id);

-- Per-product figures. ADMIN ONLY — deliberately a separate table so
-- that no investor-readable row ever carries a product breakdown.
CREATE TABLE IF NOT EXISTS mudarabah_settlement_products (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  settlement_id  UUID NOT NULL REFERENCES mudarabah_settlements(id) ON DELETE CASCADE,
  product_key    TEXT NOT NULL,
  product_name   TEXT NOT NULL,
  units_bought   INTEGER NOT NULL,
  units_sold     INTEGER NOT NULL,
  units_left     INTEGER NOT NULL,
  revenue        BIGINT NOT NULL,
  cogs           BIGINT NOT NULL,
  gross          BIGINT NOT NULL,
  gross_margin   NUMERIC(8,4) NOT NULL,
  UNIQUE (settlement_id, product_key)
);

-- ------------------------------------------------------------
-- 7. Balance entries — what moved. Corrections are posted as their
--    own entries; originals are never rewritten.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_balance_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id       UUID NOT NULL REFERENCES mudarabah_cycles(id) ON DELETE CASCADE,
  settlement_id  UUID NOT NULL REFERENCES mudarabah_settlements(id) ON DELETE CASCADE,
  investor_id    UUID NOT NULL REFERENCES investors(id),
  entry_type     TEXT NOT NULL
    CHECK (entry_type IN ('profit', 'capital', 'reversal')),
  amount         BIGINT NOT NULL,   -- kobo; negative for reversals
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mudarabah_balance_entries_investor
  ON mudarabah_balance_entries(investor_id);
CREATE INDEX IF NOT EXISTS idx_mudarabah_balance_entries_settlement
  ON mudarabah_balance_entries(settlement_id);

-- ------------------------------------------------------------
-- 8. Cycle events — the visible trail. Silent fixes are how ledgers
--    stop being trustworthy.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_cycle_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id      UUID NOT NULL REFERENCES mudarabah_cycles(id) ON DELETE CASCADE,
  settlement_id UUID REFERENCES mudarabah_settlements(id) ON DELETE SET NULL,
  action        TEXT NOT NULL
    CHECK (action IN ('settled', 'unsettled', 'resettled')),
  reason        TEXT,
  actor_id      UUID REFERENCES profiles(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mudarabah_cycle_events_cycle
  ON mudarabah_cycle_events(cycle_id, created_at DESC);

-- ------------------------------------------------------------
-- 9. Row level security
--
--    Reads are scoped here; ALL writes go through the SECURITY
--    DEFINER functions below.
-- ------------------------------------------------------------
ALTER TABLE mudarabah_cycles              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_months              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_month_rows          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_holdings            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_settlements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_settlement_holders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_settlement_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_balance_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_cycle_events        ENABLE ROW LEVEL SECURITY;

-- Staff: full read across the ledger
DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah cycles"
    ON mudarabah_cycles FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah products"
    ON mudarabah_products FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah months"
    ON mudarabah_months FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah month rows"
    ON mudarabah_month_rows FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah holdings"
    ON mudarabah_holdings FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah settlements"
    ON mudarabah_settlements FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah settlement holders"
    ON mudarabah_settlement_holders FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-product figures: STAFF ONLY. There is deliberately no investor
-- policy on this table.
DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah settlement products"
    ON mudarabah_settlement_products FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah balance entries"
    ON mudarabah_balance_entries FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff read mudarabah cycle events"
    ON mudarabah_cycle_events FOR SELECT USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Investors: only cycles they hold slots in, and only aggregate rows.
-- No policy exists for them on products, months, month rows or
-- settlement products, so a per-product figure is unreachable.
DO $$ BEGIN
  CREATE POLICY "Investors read their own mudarabah cycles"
    ON mudarabah_cycles FOR SELECT
    USING (
      id IN (
        SELECT cycle_id FROM mudarabah_holdings
        WHERE investor_id = get_my_investor_id()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Investors read their own mudarabah holdings"
    ON mudarabah_holdings FOR SELECT
    USING (investor_id = get_my_investor_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Investors read current settlements of their cycles"
    ON mudarabah_settlements FOR SELECT
    USING (
      is_current
      AND cycle_id IN (
        SELECT cycle_id FROM mudarabah_holdings
        WHERE investor_id = get_my_investor_id()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Investors read their own settlement figures"
    ON mudarabah_settlement_holders FOR SELECT
    USING (investor_id = get_my_investor_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Investors read their own balance entries"
    ON mudarabah_balance_entries FOR SELECT
    USING (investor_id = get_my_investor_id());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 10. Permission helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_assert_admin()
RETURNS VOID AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::TEXT INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
    RAISE EXCEPTION 'Only an administrator can change a Mudarabah cycle';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 11. Save a cycle (inputs only)
--
--     Accepts the same shape the TypeScript engine consumes, so a
--     saved cycle round-trips unchanged. A SETTLED cycle is not
--     editable — correcting one requires an explicit unsettle.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_save_cycle(p_cycle JSONB)
RETURNS UUID AS $$
DECLARE
  v_id        UUID;
  v_status    TEXT;
  v_month     JSONB;
  v_row       JSONB;
  v_month_id  UUID;
  v_prod      JSONB;
  v_index     INTEGER;
  v_pos       INTEGER;
BEGIN
  PERFORM mudarabah_assert_admin();

  v_id := NULLIF(p_cycle->>'id', '')::UUID;

  IF v_id IS NOT NULL THEN
    SELECT status INTO v_status FROM mudarabah_cycles WHERE id = v_id;
    IF v_status = 'settled' THEN
      RAISE EXCEPTION 'This cycle is settled. Unsettle it first to make a correction.';
    END IF;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO mudarabah_cycles (
      name, description, start_date, currency, slot_price, slots,
      ratio, wht, status, disclose_mode, created_by
    ) VALUES (
      p_cycle->>'name',
      NULLIF(p_cycle->>'description', ''),
      (p_cycle->>'startDate')::DATE,
      COALESCE(NULLIF(p_cycle->>'currency', ''), 'NGN'),
      (p_cycle->>'slotPrice')::BIGINT,
      (p_cycle->>'slots')::INTEGER,
      (p_cycle->>'ratio')::NUMERIC,
      COALESCE((p_cycle->>'wht')::NUMERIC, 0),
      COALESCE(NULLIF(p_cycle->>'status', ''), 'draft'),
      COALESCE(NULLIF(p_cycle->>'discloseMode', ''), 'perSlot'),
      auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE mudarabah_cycles SET
      name          = p_cycle->>'name',
      description   = NULLIF(p_cycle->>'description', ''),
      start_date    = (p_cycle->>'startDate')::DATE,
      currency      = COALESCE(NULLIF(p_cycle->>'currency', ''), 'NGN'),
      slot_price    = (p_cycle->>'slotPrice')::BIGINT,
      slots         = (p_cycle->>'slots')::INTEGER,
      ratio         = (p_cycle->>'ratio')::NUMERIC,
      wht           = COALESCE((p_cycle->>'wht')::NUMERIC, 0),
      status        = COALESCE(NULLIF(p_cycle->>'status', ''), status),
      disclose_mode = COALESCE(NULLIF(p_cycle->>'discloseMode', ''), disclose_mode),
      updated_at    = NOW()
    WHERE id = v_id;
  END IF;

  -- Products. Removing a product removes its rows through the cascade;
  -- adding one must be cheap, since the full list is rarely known when
  -- a cycle is opened.
  v_pos := 0;
  FOR v_prod IN SELECT * FROM jsonb_array_elements(COALESCE(p_cycle->'products', '[]'::JSONB))
  LOOP
    INSERT INTO mudarabah_products (cycle_id, product_key, name, position)
    VALUES (v_id, v_prod->>'id', v_prod->>'name', v_pos)
    ON CONFLICT (cycle_id, product_key)
      DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position;
    v_pos := v_pos + 1;
  END LOOP;

  DELETE FROM mudarabah_products
  WHERE cycle_id = v_id
    AND product_key NOT IN (
      SELECT x->>'id' FROM jsonb_array_elements(COALESCE(p_cycle->'products', '[]'::JSONB)) x
    );

  -- Months and their rows
  v_index := 0;
  FOR v_month IN SELECT * FROM jsonb_array_elements(COALESCE(p_cycle->'months', '[]'::JSONB))
  LOOP
    v_index := v_index + 1;

    INSERT INTO mudarabah_months (cycle_id, month_index, ads, logistics, misc, bank_charges)
    VALUES (
      v_id, v_index,
      COALESCE((v_month->>'ads')::BIGINT, 0),
      COALESCE((v_month->>'logistics')::BIGINT, 0),
      COALESCE((v_month->>'misc')::BIGINT, 0),
      COALESCE((v_month->>'bankCharges')::BIGINT, 0)
    )
    ON CONFLICT (cycle_id, month_index) DO UPDATE SET
      ads = EXCLUDED.ads, logistics = EXCLUDED.logistics,
      misc = EXCLUDED.misc, bank_charges = EXCLUDED.bank_charges
    RETURNING id INTO v_month_id;

    FOR v_row IN SELECT * FROM jsonb_array_elements(COALESCE(v_month->'rows', '[]'::JSONB))
    LOOP
      INSERT INTO mudarabah_month_rows (
        month_id, product_id, qty, unit_cost, sold_qty, sell_price, stock_left
      )
      SELECT
        v_month_id, p.id,
        COALESCE((v_row->>'qty')::INTEGER, 0),
        COALESCE((v_row->>'unitCost')::BIGINT, 0),
        COALESCE((v_row->>'soldQty')::INTEGER, 0),
        COALESCE((v_row->>'sellPrice')::BIGINT, 0),
        COALESCE((v_row->>'stockLeft')::INTEGER, 0)
      FROM mudarabah_products p
      WHERE p.cycle_id = v_id AND p.product_key = v_row->>'productId'
      ON CONFLICT (month_id, product_id) DO UPDATE SET
        qty = EXCLUDED.qty, unit_cost = EXCLUDED.unit_cost,
        sold_qty = EXCLUDED.sold_qty, sell_price = EXCLUDED.sell_price,
        stock_left = EXCLUDED.stock_left;
    END LOOP;

    -- Rows removed on the client are removed here too
    DELETE FROM mudarabah_month_rows r
    USING mudarabah_products p
    WHERE r.month_id = v_month_id
      AND r.product_id = p.id
      AND p.product_key NOT IN (
        SELECT x->>'productId'
        FROM jsonb_array_elements(COALESCE(v_month->'rows', '[]'::JSONB)) x
      );
  END LOOP;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 12. Read a cycle back in the engine's own shape
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_get_cycle(p_cycle_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_cycle  mudarabah_cycles%ROWTYPE;
  v_result JSONB;
BEGIN
  SELECT * INTO v_cycle FROM mudarabah_cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'id',           v_cycle.id,
    'name',         v_cycle.name,
    'description',  v_cycle.description,
    'startDate',    to_char(v_cycle.start_date, 'YYYY-MM-DD'),
    'currency',     v_cycle.currency,
    'slotPrice',    v_cycle.slot_price,
    'slots',        v_cycle.slots,
    'ratio',        v_cycle.ratio::FLOAT8,
    'wht',          v_cycle.wht::FLOAT8,
    'status',       v_cycle.status,
    'discloseMode', v_cycle.disclose_mode,
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.product_key, 'name', p.name) ORDER BY p.position)
      FROM mudarabah_products p WHERE p.cycle_id = p_cycle_id
    ), '[]'::JSONB),
    'months', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'ads',         m.ads,
          'logistics',   m.logistics,
          'misc',        m.misc,
          'bankCharges', m.bank_charges,
          'rows', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'productId', p.product_key,
                'qty',       r.qty,
                'unitCost',  r.unit_cost,
                'soldQty',   r.sold_qty,
                'sellPrice', r.sell_price,
                'stockLeft', r.stock_left
              ) ORDER BY p.position
            )
            FROM mudarabah_month_rows r
            JOIN mudarabah_products p ON p.id = r.product_id
            WHERE r.month_id = m.id
          ), '[]'::JSONB)
        ) ORDER BY m.month_index
      )
      FROM mudarabah_months m WHERE m.cycle_id = p_cycle_id
    ), '[]'::JSONB)
  ) INTO v_result;

  RETURN v_result;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 13. Holdings
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_set_holding(
  p_cycle_id       UUID,
  p_investor_id    UUID,
  p_slots          INTEGER,
  p_capital_action TEXT DEFAULT 'rollover'
)
RETURNS UUID AS $$
DECLARE
  v_id     UUID;
  v_status TEXT;
BEGIN
  PERFORM mudarabah_assert_admin();

  SELECT status INTO v_status FROM mudarabah_cycles WHERE id = p_cycle_id;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'No such cycle';
  END IF;
  IF v_status = 'settled' THEN
    RAISE EXCEPTION 'This cycle is settled. Unsettle it first to make a correction.';
  END IF;

  INSERT INTO mudarabah_holdings (cycle_id, investor_id, slots, capital_action)
  VALUES (p_cycle_id, p_investor_id, p_slots, p_capital_action)
  ON CONFLICT (cycle_id, investor_id) DO UPDATE SET
    slots = EXCLUDED.slots,
    capital_action = EXCLUDED.capital_action,
    updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 14. Settle — the freeze.
--
--     The figures are computed by the shared TypeScript engine and
--     passed in; the database deliberately does NOT recompute them,
--     because a second implementation of the maths is a second source
--     of truth.
--
--     IDEMPOTENT: guarded on the settlement record existing, not on
--     the status flag. Settling twice returns the first settlement and
--     posts no further balance entries.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_settle_cycle(
  p_cycle_id       UUID,
  p_engine_version TEXT,
  p_computed       JSONB,
  p_holders        JSONB,
  p_products       JSONB DEFAULT '[]'::JSONB
)
RETURNS UUID AS $$
DECLARE
  v_existing UUID;
  v_id       UUID;
  v_holder   JSONB;
  v_prod     JSONB;
  v_prior    INTEGER;
BEGIN
  PERFORM mudarabah_assert_admin();

  SELECT id INTO v_existing
  FROM mudarabah_settlements
  WHERE cycle_id = p_cycle_id AND is_current;

  IF v_existing IS NOT NULL THEN
    -- Already settled. Do nothing at all — no second snapshot, no
    -- second set of balance entries, no doubled balances.
    RETURN v_existing;
  END IF;

  SELECT COUNT(*) INTO v_prior
  FROM mudarabah_settlements WHERE cycle_id = p_cycle_id;

  INSERT INTO mudarabah_settlements (
    cycle_id, settled_by, engine_version, computed
  ) VALUES (
    p_cycle_id, auth.uid(), p_engine_version, p_computed
  ) RETURNING id INTO v_id;

  FOR v_holder IN SELECT * FROM jsonb_array_elements(COALESCE(p_holders, '[]'::JSONB))
  LOOP
    INSERT INTO mudarabah_settlement_holders (
      settlement_id, investor_id, slots, capital, profit,
      capital_action, amount_paid, amount_paid_note
    ) VALUES (
      v_id,
      (v_holder->>'investorRef')::UUID,
      (v_holder->>'slots')::INTEGER,
      (v_holder->>'capital')::BIGINT,
      (v_holder->>'profit')::BIGINT,
      v_holder->>'capitalAction',
      (v_holder->>'amountPaid')::BIGINT,
      NULLIF(v_holder->>'amountPaidNote', '')
    );

    -- What moved: the profit share always, plus capital for anyone
    -- withdrawing rather than rolling over.
    INSERT INTO mudarabah_balance_entries (
      cycle_id, settlement_id, investor_id, entry_type, amount, note
    ) VALUES (
      p_cycle_id, v_id, (v_holder->>'investorRef')::UUID, 'profit',
      (v_holder->>'profit')::BIGINT, NULLIF(v_holder->>'amountPaidNote', '')
    );

    IF v_holder->>'capitalAction' = 'withdraw' THEN
      INSERT INTO mudarabah_balance_entries (
        cycle_id, settlement_id, investor_id, entry_type, amount, note
      ) VALUES (
        p_cycle_id, v_id, (v_holder->>'investorRef')::UUID, 'capital',
        (v_holder->>'capital')::BIGINT, NULL
      );
    END IF;
  END LOOP;

  -- Per-product figures, kept in their own admin-only table
  FOR v_prod IN SELECT * FROM jsonb_array_elements(COALESCE(p_products, '[]'::JSONB))
  LOOP
    INSERT INTO mudarabah_settlement_products (
      settlement_id, product_key, product_name, units_bought, units_sold,
      units_left, revenue, cogs, gross, gross_margin
    ) VALUES (
      v_id,
      v_prod->>'productId',
      v_prod->>'productName',
      (v_prod->>'unitsBought')::INTEGER,
      (v_prod->>'unitsSold')::INTEGER,
      (v_prod->>'unitsLeft')::INTEGER,
      (v_prod->>'revenue')::BIGINT,
      (v_prod->>'cogs')::BIGINT,
      (v_prod->>'gross')::BIGINT,
      (v_prod->>'grossMargin')::NUMERIC
    );
  END LOOP;

  UPDATE mudarabah_cycles
  SET status = 'settled', updated_at = NOW()
  WHERE id = p_cycle_id;

  INSERT INTO mudarabah_cycle_events (cycle_id, settlement_id, action, actor_id)
  VALUES (
    p_cycle_id, v_id,
    CASE WHEN v_prior > 0 THEN 'resettled' ELSE 'settled' END,
    auth.uid()
  );

  PERFORM create_audit_log(
    CASE WHEN v_prior > 0 THEN 'mudarabah_cycle_resettled' ELSE 'mudarabah_cycle_settled' END,
    'mudarabah_cycle', p_cycle_id::TEXT, NULL,
    jsonb_build_object('settlement_id', v_id, 'engine_version', p_engine_version)
  );

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 15. Unsettle — deliberate, reasoned, and logged.
--
--     The earlier snapshot is RETAINED, never overwritten. Balance
--     movements are undone by posting reversal entries of their own,
--     not by rewriting the originals. A correction leaves a trail.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_unsettle_cycle(
  p_cycle_id UUID,
  p_reason   TEXT
)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  PERFORM mudarabah_assert_admin();

  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to unsettle a cycle';
  END IF;

  SELECT id INTO v_id
  FROM mudarabah_settlements
  WHERE cycle_id = p_cycle_id AND is_current;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'This cycle has no current settlement';
  END IF;

  -- Retained, not deleted: is_current goes false and the row stays.
  UPDATE mudarabah_settlements
  SET is_current = FALSE,
      superseded_at = NOW(),
      superseded_by = auth.uid(),
      supersede_reason = p_reason
  WHERE id = v_id;

  -- Reverse what moved, as its own entries
  INSERT INTO mudarabah_balance_entries (
    cycle_id, settlement_id, investor_id, entry_type, amount, note
  )
  SELECT cycle_id, settlement_id, investor_id, 'reversal', -amount, p_reason
  FROM mudarabah_balance_entries
  WHERE settlement_id = v_id AND entry_type IN ('profit', 'capital');

  UPDATE mudarabah_cycles
  SET status = 'active', updated_at = NOW()
  WHERE id = p_cycle_id;

  INSERT INTO mudarabah_cycle_events (cycle_id, settlement_id, action, reason, actor_id)
  VALUES (p_cycle_id, v_id, 'unsettled', p_reason, auth.uid());

  PERFORM create_audit_log(
    'mudarabah_cycle_unsettled', 'mudarabah_cycle', p_cycle_id::TEXT, NULL,
    jsonb_build_object('settlement_id', v_id, 'reason', p_reason)
  );

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 16. Correct a single payment, with the reason recorded
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_record_payment(
  p_settlement_id UUID,
  p_investor_id   UUID,
  p_amount_paid   BIGINT,
  p_note          TEXT
)
RETURNS VOID AS $$
BEGIN
  PERFORM mudarabah_assert_admin();

  IF p_note IS NULL OR btrim(p_note) = '' THEN
    RAISE EXCEPTION 'A note is required when the amount paid differs from the computed figure';
  END IF;

  UPDATE mudarabah_settlement_holders
  SET amount_paid = p_amount_paid, amount_paid_note = p_note
  WHERE settlement_id = p_settlement_id AND investor_id = p_investor_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such holder on that settlement';
  END IF;

  PERFORM create_audit_log(
    'mudarabah_payment_adjusted', 'mudarabah_settlement', p_settlement_id::TEXT, NULL,
    jsonb_build_object('investor_id', p_investor_id, 'amount_paid', p_amount_paid, 'note', p_note)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 17. Lock down direct access — writes go through the functions above
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON mudarabah_cycles, mudarabah_products, mudarabah_months,
             mudarabah_month_rows, mudarabah_holdings, mudarabah_settlements,
             mudarabah_settlement_holders, mudarabah_settlement_products,
             mudarabah_balance_entries, mudarabah_cycle_events FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON mudarabah_cycles, mudarabah_products,
             mudarabah_months, mudarabah_month_rows, mudarabah_holdings,
             mudarabah_settlements, mudarabah_settlement_holders,
             mudarabah_settlement_products, mudarabah_balance_entries,
             mudarabah_cycle_events FROM authenticated';
  END IF;
END $$;
