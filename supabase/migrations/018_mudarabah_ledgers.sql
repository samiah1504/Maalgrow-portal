-- ============================================================
-- Migration 018 – Mudarabah trading ledger
--
-- The ledger ATTACHES to the portal's existing series and cycles.
-- It does not introduce a second notion of a cycle:
--
--   • the cycle, its dates and its label   → cycles
--   • the slot value                       → cycles.unit_value
--                                            ↳ series.price_per_unit
--   • the profit-sharing ratio             → cycles.investor_ratio
--                                            ↳ series.mudarabah_investor_ratio
--   • who holds how many slots             → investments
--   • what happens to capital at maturity  → investments.maturity_decision
--                                            + rollover_decisions.slots_to_withdraw
--
-- The ledger itself holds only what did not already exist: the
-- category shown to investors, the disclosure mode, and three months
-- of trading in products and rows.
--
-- PROFIT IS ALWAYS PAID OUT. The only maturity decision an investor
-- makes is what happens to their CAPITAL. Withholding tax therefore
-- always applies at payout, uniformly, at declaration.
--
-- Terms that investors subscribe on the strength of — the ratio, the
-- slot value and the withholding rate — are editable only until
-- subscriptions close, and the values actually used are recorded in
-- the settlement snapshot.
--
-- ALL LEDGER MONEY IS INTEGER KOBO (BIGINT). The portal's existing
-- money columns stay NUMERIC naira and are written as such.
--
-- Apply AFTER migration 017.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Per-cycle terms, falling back to the series
-- ------------------------------------------------------------
ALTER TABLE cycles
  ADD COLUMN IF NOT EXISTS investor_ratio NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS wht_rate       NUMERIC(5,4);

DO $$ BEGIN
  ALTER TABLE cycles ADD CONSTRAINT cycles_investor_ratio_check
    CHECK (investor_ratio IS NULL OR (investor_ratio > 0 AND investor_ratio < 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE cycles ADD CONSTRAINT cycles_wht_rate_check
    CHECK (wht_rate IS NULL OR (wht_rate >= 0 AND wht_rate < 1));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The advertised default for new cycles in a series
ALTER TABLE series
  ADD COLUMN IF NOT EXISTS default_wht_rate NUMERIC(5,4) NOT NULL DEFAULT 0;

DO $$ BEGIN
  ALTER TABLE series ADD CONSTRAINT series_default_wht_rate_check
    CHECK (default_wht_rate >= 0 AND default_wht_rate < 1);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 2. Withholding tax on the existing declaration model
--
--    profit_per_slot stays GROSS and stays authoritative for the
--    split. The net figures sit alongside it so every existing view
--    can show both without recomputing.
-- ------------------------------------------------------------
ALTER TABLE cycle_profit_declarations
  ADD COLUMN IF NOT EXISTS wht_rate            NUMERIC(5,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wht_per_slot        NUMERIC(20,6) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS profit_per_slot_net NUMERIC(20,6),
  ADD COLUMN IF NOT EXISTS total_wht           NUMERIC(20,2) NOT NULL DEFAULT 0;

UPDATE cycle_profit_declarations
SET profit_per_slot_net = profit_per_slot
WHERE profit_per_slot_net IS NULL;

ALTER TABLE investments
  ADD COLUMN IF NOT EXISTS declared_wht        NUMERIC(20,2),
  ADD COLUMN IF NOT EXISTS declared_profit_net NUMERIC(20,2);

UPDATE investments
SET declared_wht = 0, declared_profit_net = declared_profit
WHERE declared_profit IS NOT NULL AND declared_profit_net IS NULL;

-- ------------------------------------------------------------
-- 3. Effective terms, and when they lock
--
--    Editable while a cycle is draft, upcoming or subscription_open.
--    From subscription_closed onward the terms are fixed: investors
--    subscribed on the strength of them, and changing them afterwards
--    is a breach of the agreement, not a configuration change.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_terms_locked(p_cycle_id UUID)
RETURNS BOOLEAN AS $$
  SELECT status::TEXT NOT IN ('draft', 'upcoming', 'subscription_open')
  FROM cycles WHERE id = p_cycle_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION mudarabah_effective_ratio(p_cycle_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(c.investor_ratio, s.mudarabah_investor_ratio)
  FROM cycles c JOIN series s ON s.id = c.series_id
  WHERE c.id = p_cycle_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION mudarabah_effective_unit_value(p_cycle_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(c.unit_value, s.price_per_unit)
  FROM cycles c JOIN series s ON s.id = c.series_id
  WHERE c.id = p_cycle_id;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION mudarabah_effective_wht_rate(p_cycle_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(c.wht_rate, s.default_wht_rate, 0)
  FROM cycles c JOIN series s ON s.id = c.series_id
  WHERE c.id = p_cycle_id;
$$ LANGUAGE sql STABLE;

-- Set a cycle's terms, refusing once subscriptions have closed
CREATE OR REPLACE FUNCTION mudarabah_set_cycle_terms(
  p_cycle_id       UUID,
  p_investor_ratio NUMERIC DEFAULT NULL,
  p_unit_value     NUMERIC DEFAULT NULL,
  p_wht_rate       NUMERIC DEFAULT NULL
)
RETURNS VOID AS $$
BEGIN
  PERFORM mudarabah_assert_admin();

  IF mudarabah_terms_locked(p_cycle_id) THEN
    RAISE EXCEPTION 'Subscriptions have closed on this cycle. The ratio, slot value and withholding rate were advertised to investors and cannot be changed now.';
  END IF;

  UPDATE cycles SET
    investor_ratio = COALESCE(p_investor_ratio, investor_ratio),
    unit_value     = COALESCE(p_unit_value, unit_value),
    wht_rate       = COALESCE(p_wht_rate, wht_rate),
    updated_at     = NOW()
  WHERE id = p_cycle_id;

  PERFORM create_audit_log(
    'mudarabah_cycle_terms_changed', 'cycle', p_cycle_id::TEXT, NULL,
    jsonb_build_object('investor_ratio', p_investor_ratio,
                       'unit_value', p_unit_value, 'wht_rate', p_wht_rate)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Permission helper
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_assert_admin()
RETURNS VOID AS $$
DECLARE
  v_role TEXT;
BEGIN
  SELECT role::TEXT INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
    RAISE EXCEPTION 'Only an administrator can change a Mudarabah ledger';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. The ledger — one per cycle, and only for cycles that have one.
--    Cycles predating this feature simply have no ledger.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_ledgers (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id       UUID NOT NULL UNIQUE REFERENCES cycles(id) ON DELETE CASCADE,
  -- A category ("home furniture"), never a list of products. The only
  -- product wording an investor ever sees.
  description    TEXT,
  disclose_mode  TEXT NOT NULL DEFAULT 'perSlot'
    CHECK (disclose_mode IN ('full', 'perSlot')),
  status         TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'settled')),
  created_by     UUID REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mudarabah_products (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ledger_id    UUID NOT NULL REFERENCES mudarabah_ledgers(id) ON DELETE CASCADE,
  product_key  TEXT NOT NULL,
  name         TEXT NOT NULL,
  position     INTEGER NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (ledger_id, product_key)
);

CREATE TABLE IF NOT EXISTS mudarabah_months (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ledger_id     UUID NOT NULL REFERENCES mudarabah_ledgers(id) ON DELETE CASCADE,
  month_index   INTEGER NOT NULL CHECK (month_index BETWEEN 1 AND 3),
  ads           BIGINT NOT NULL DEFAULT 0 CHECK (ads >= 0),
  logistics     BIGINT NOT NULL DEFAULT 0 CHECK (logistics >= 0),
  misc          BIGINT NOT NULL DEFAULT 0 CHECK (misc >= 0),
  bank_charges  BIGINT NOT NULL DEFAULT 0 CHECK (bank_charges >= 0),
  UNIQUE (ledger_id, month_index)
);

-- stock_left stores what was actually COUNTED, whether or not it
-- matches the derived expectation, so a later formula change cannot
-- silently alter history.
CREATE TABLE IF NOT EXISTS mudarabah_month_rows (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  month_id    UUID NOT NULL REFERENCES mudarabah_months(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES mudarabah_products(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL DEFAULT 0 CHECK (qty >= 0),
  unit_cost   BIGINT NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),
  sold_qty    INTEGER NOT NULL DEFAULT 0 CHECK (sold_qty >= 0),
  sell_price  BIGINT NOT NULL DEFAULT 0 CHECK (sell_price >= 0),
  stock_left  INTEGER NOT NULL DEFAULT 0,
  UNIQUE (month_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_mudarabah_month_rows_product
  ON mudarabah_month_rows(product_id);

-- ------------------------------------------------------------
-- 6. Settlements — the freeze.
--
--    Records the terms ACTUALLY used, so a cycle settled under an old
--    ratio or an old statutory rate keeps showing them.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mudarabah_settlements (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id         UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  ledger_id        UUID NOT NULL REFERENCES mudarabah_ledgers(id) ON DELETE CASCADE,
  settled_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  settled_by       UUID REFERENCES profiles(id),
  engine_version   TEXT NOT NULL,
  -- The terms in force at settlement
  ratio_used       NUMERIC(5,4) NOT NULL,
  unit_value_used  NUMERIC(20,2) NOT NULL,
  wht_rate_used    NUMERIC(5,4) NOT NULL DEFAULT 0,
  -- Aggregate figures only. No per-product data ever enters this row.
  computed         JSONB NOT NULL,
  is_current       BOOLEAN NOT NULL DEFAULT TRUE,
  superseded_at    TIMESTAMPTZ,
  superseded_by    UUID REFERENCES profiles(id),
  supersede_reason TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- At most one current settlement per cycle. This index is what makes
-- settlement idempotent — the guard is the record, not a status flag.
CREATE UNIQUE INDEX IF NOT EXISTS idx_mudarabah_settlement_current
  ON mudarabah_settlements(cycle_id) WHERE is_current;

CREATE INDEX IF NOT EXISTS idx_mudarabah_settlements_cycle
  ON mudarabah_settlements(cycle_id, settled_at DESC);

CREATE TABLE IF NOT EXISTS mudarabah_settlement_holders (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  settlement_id    UUID NOT NULL REFERENCES mudarabah_settlements(id) ON DELETE CASCADE,
  investment_id    UUID NOT NULL REFERENCES investments(id),
  investor_id      UUID NOT NULL REFERENCES investors(id),
  units            NUMERIC(12,2) NOT NULL,
  capital          BIGINT NOT NULL,        -- kobo
  gross_profit     BIGINT NOT NULL,        -- kobo, may be negative on a loss
  wht              BIGINT NOT NULL DEFAULT 0,
  net_profit       BIGINT NOT NULL,
  -- Capital only: profit is always paid out
  capital_action   TEXT NOT NULL CHECK (capital_action IN ('withdraw', 'rollover', 'partial')),
  slots_withdrawn  NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- What ACTUALLY moved, deliberately separate from the computed figure
  amount_paid      BIGINT NOT NULL,
  amount_paid_note TEXT,
  -- Room to join up with a payment request later; not populated yet
  payment_request_id UUID REFERENCES payment_requests(id),
  UNIQUE (settlement_id, investment_id)
);

CREATE INDEX IF NOT EXISTS idx_mudarabah_settlement_holders_investor
  ON mudarabah_settlement_holders(investor_id);

-- Per-product figures. ADMIN ONLY — deliberately a separate table so
-- no investor-readable row ever carries a product breakdown.
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

-- What moved. Corrections are posted as their own entries; originals
-- are never rewritten.
CREATE TABLE IF NOT EXISTS mudarabah_balance_entries (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id       UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
  settlement_id  UUID NOT NULL REFERENCES mudarabah_settlements(id) ON DELETE CASCADE,
  investor_id    UUID NOT NULL REFERENCES investors(id),
  entry_type     TEXT NOT NULL
    CHECK (entry_type IN ('profit', 'wht', 'capital', 'reversal')),
  amount         BIGINT NOT NULL,   -- kobo; negative for reversals
  note           TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mudarabah_balance_entries_investor
  ON mudarabah_balance_entries(investor_id);
CREATE INDEX IF NOT EXISTS idx_mudarabah_balance_entries_settlement
  ON mudarabah_balance_entries(settlement_id);

CREATE TABLE IF NOT EXISTS mudarabah_cycle_events (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id      UUID NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
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
-- 7. Row level security
-- ------------------------------------------------------------
ALTER TABLE mudarabah_ledgers             ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_products            ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_months              ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_month_rows          ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_settlements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_settlement_holders  ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_settlement_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_balance_entries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE mudarabah_cycle_events        ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'mudarabah_ledgers', 'mudarabah_products', 'mudarabah_months',
    'mudarabah_month_rows', 'mudarabah_settlements',
    'mudarabah_settlement_holders', 'mudarabah_settlement_products',
    'mudarabah_balance_entries', 'mudarabah_cycle_events'
  ] LOOP
    BEGIN
      EXECUTE FORMAT(
        'CREATE POLICY "Staff read %1$s" ON %1$s FOR SELECT USING (is_admin())', t
      );
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END LOOP;
END $$;

-- Investors: only the cycles they hold an investment in, and only
-- aggregate rows. There is deliberately NO investor policy on
-- products, months, month rows or settlement products, so a
-- per-product figure is unreachable.
DO $$ BEGIN
  CREATE POLICY "Investors read ledgers of their own cycles"
    ON mudarabah_ledgers FOR SELECT
    USING (
      cycle_id IN (
        SELECT cycle_id FROM investments WHERE investor_id = get_my_investor_id()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Investors read current settlements of their cycles"
    ON mudarabah_settlements FOR SELECT
    USING (
      is_current
      AND cycle_id IN (
        SELECT cycle_id FROM investments WHERE investor_id = get_my_investor_id()
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
-- 8. Save and read the ledger (inputs only)
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_save_ledger(p_ledger JSONB)
RETURNS UUID AS $$
DECLARE
  v_id       UUID;
  v_cycle_id UUID;
  v_status   TEXT;
  v_month    JSONB;
  v_row      JSONB;
  v_month_id UUID;
  v_prod     JSONB;
  v_index    INTEGER;
  v_pos      INTEGER;
BEGIN
  PERFORM mudarabah_assert_admin();

  v_cycle_id := (p_ledger->>'cycleId')::UUID;
  IF v_cycle_id IS NULL THEN
    RAISE EXCEPTION 'A ledger must belong to an existing cycle';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cycles WHERE id = v_cycle_id) THEN
    RAISE EXCEPTION 'No such cycle';
  END IF;

  SELECT id, status INTO v_id, v_status
  FROM mudarabah_ledgers WHERE cycle_id = v_cycle_id;

  IF v_status = 'settled' THEN
    RAISE EXCEPTION 'This cycle is settled. Reopen it first to make a correction.';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO mudarabah_ledgers (cycle_id, description, disclose_mode, status, created_by)
    VALUES (
      v_cycle_id,
      NULLIF(p_ledger->>'description', ''),
      COALESCE(NULLIF(p_ledger->>'discloseMode', ''), 'perSlot'),
      COALESCE(NULLIF(p_ledger->>'status', ''), 'draft'),
      auth.uid()
    ) RETURNING id INTO v_id;
  ELSE
    UPDATE mudarabah_ledgers SET
      description   = NULLIF(p_ledger->>'description', ''),
      disclose_mode = COALESCE(NULLIF(p_ledger->>'discloseMode', ''), disclose_mode),
      status        = COALESCE(NULLIF(p_ledger->>'status', ''), status),
      updated_at    = NOW()
    WHERE id = v_id;
  END IF;

  v_pos := 0;
  FOR v_prod IN SELECT * FROM jsonb_array_elements(COALESCE(p_ledger->'products', '[]'::JSONB))
  LOOP
    INSERT INTO mudarabah_products (ledger_id, product_key, name, position)
    VALUES (v_id, v_prod->>'id', v_prod->>'name', v_pos)
    ON CONFLICT (ledger_id, product_key)
      DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position;
    v_pos := v_pos + 1;
  END LOOP;

  DELETE FROM mudarabah_products
  WHERE ledger_id = v_id
    AND product_key NOT IN (
      SELECT x->>'id' FROM jsonb_array_elements(COALESCE(p_ledger->'products', '[]'::JSONB)) x
    );

  v_index := 0;
  FOR v_month IN SELECT * FROM jsonb_array_elements(COALESCE(p_ledger->'months', '[]'::JSONB))
  LOOP
    v_index := v_index + 1;

    INSERT INTO mudarabah_months (ledger_id, month_index, ads, logistics, misc, bank_charges)
    VALUES (
      v_id, v_index,
      COALESCE((v_month->>'ads')::BIGINT, 0),
      COALESCE((v_month->>'logistics')::BIGINT, 0),
      COALESCE((v_month->>'misc')::BIGINT, 0),
      COALESCE((v_month->>'bankCharges')::BIGINT, 0)
    )
    ON CONFLICT (ledger_id, month_index) DO UPDATE SET
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
      WHERE p.ledger_id = v_id AND p.product_key = v_row->>'productId'
      ON CONFLICT (month_id, product_id) DO UPDATE SET
        qty = EXCLUDED.qty, unit_cost = EXCLUDED.unit_cost,
        sold_qty = EXCLUDED.sold_qty, sell_price = EXCLUDED.sell_price,
        stock_left = EXCLUDED.stock_left;
    END LOOP;

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

-- Returns the ledger together with everything the engine needs that
-- lives on the EXISTING records, plus the cycle's membership.
CREATE OR REPLACE FUNCTION mudarabah_get_ledger(p_cycle_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_ledger   mudarabah_ledgers%ROWTYPE;
  v_cycle    cycles%ROWTYPE;
  v_series   series%ROWTYPE;
  v_units    NUMERIC(12,2);
  v_pooled   NUMERIC(20,2);
  v_uv       NUMERIC(20,2);
BEGIN
  SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_series FROM series WHERE id = v_cycle.series_id;
  SELECT * INTO v_ledger FROM mudarabah_ledgers WHERE cycle_id = p_cycle_id;

  v_uv := mudarabah_effective_unit_value(p_cycle_id);

  SELECT COALESCE(SUM(units), 0) INTO v_units
  FROM investments WHERE cycle_id = p_cycle_id AND status = 'active';

  -- The capital actually pooled, from the membership itself
  v_pooled := COALESCE(v_units, 0) * v_uv;

  RETURN jsonb_build_object(
    'cycleId',        p_cycle_id,
    'ledgerId',       v_ledger.id,
    'hasLedger',      v_ledger.id IS NOT NULL,
    'seriesId',       v_cycle.series_id,
    'seriesName',     v_series.name,
    'cycleLabel',     v_cycle.cycle_label,
    'cycleStatus',    v_cycle.status,
    'startDate',      to_char(v_cycle.start_date, 'YYYY-MM-DD'),
    'endDate',        to_char(v_cycle.end_date, 'YYYY-MM-DD'),
    'termsLocked',    mudarabah_terms_locked(p_cycle_id),
    'unitValue',      v_uv,
    'ratio',          mudarabah_effective_ratio(p_cycle_id),
    'whtRate',        mudarabah_effective_wht_rate(p_cycle_id),
    'totalUnits',     COALESCE(v_units, 0),
    'cycleTotalSlots', v_cycle.total_slots,
    'pooledCapital',  v_pooled,
    'amountReceived', v_cycle.amount_received,
    'totalCapital',   v_cycle.total_capital,
    'investorCount',  (SELECT COUNT(*) FROM investments
                       WHERE cycle_id = p_cycle_id AND status = 'active'),
    'description',    v_ledger.description,
    'discloseMode',   COALESCE(v_ledger.disclose_mode, 'perSlot'),
    'status',         COALESCE(v_ledger.status, 'draft'),
    'withdrawSlots', COALESCE((
      SELECT SUM(
        CASE
          WHEN rd.decision::TEXT = 'exit' THEN i.units
          WHEN rd.decision::TEXT = 'partial_exit' THEN COALESCE(rd.slots_to_withdraw, 0)
          ELSE 0
        END
      )
      FROM investments i
      LEFT JOIN rollover_decisions rd ON rd.investment_id = i.id
      WHERE i.cycle_id = p_cycle_id AND i.status = 'active'
    ), 0),
    'products', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', p.product_key, 'name', p.name) ORDER BY p.position)
      FROM mudarabah_products p WHERE p.ledger_id = v_ledger.id
    ), '[]'::JSONB),
    'months', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'ads', m.ads, 'logistics', m.logistics,
          'misc', m.misc, 'bankCharges', m.bank_charges,
          'rows', COALESCE((
            SELECT jsonb_agg(
              jsonb_build_object(
                'productId', p.product_key, 'qty', r.qty,
                'unitCost', r.unit_cost, 'soldQty', r.sold_qty,
                'sellPrice', r.sell_price, 'stockLeft', r.stock_left
              ) ORDER BY p.position
            )
            FROM mudarabah_month_rows r
            JOIN mudarabah_products p ON p.id = r.product_id
            WHERE r.month_id = m.id
          ), '[]'::JSONB)
        ) ORDER BY m.month_index
      )
      FROM mudarabah_months m WHERE m.ledger_id = v_ledger.id
    ), '[]'::JSONB),
    'holders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'investmentId', i.id,
        'investorId',   i.investor_id,
        'investorName', inv.full_name,
        'investorCode', inv.investor_code,
        'units',        i.units,
        'capitalAction', CASE
          WHEN rd.decision::TEXT = 'exit' THEN 'withdraw'
          WHEN rd.decision::TEXT = 'partial_exit' THEN 'partial'
          ELSE 'rollover' END,
        'slotsWithdrawn', CASE
          WHEN rd.decision::TEXT = 'exit' THEN i.units
          WHEN rd.decision::TEXT = 'partial_exit' THEN COALESCE(rd.slots_to_withdraw, 0)
          ELSE 0 END
      ) ORDER BY inv.full_name)
      FROM investments i
      JOIN investors inv ON inv.id = i.investor_id
      LEFT JOIN rollover_decisions rd ON rd.investment_id = i.id
      WHERE i.cycle_id = p_cycle_id AND i.status = 'active'
    ), '[]'::JSONB)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 9. declare_cycle_profit — extended for withholding tax
--
--    profit_per_slot stays GROSS and stays authoritative for the
--    split. Tax is computed on each holder's ALLOCATED gross, not on
--    the pot before allocation, so the figure remitted for an investor
--    matches the figure on their statement.
--
--    Gross profit is allocated across holders by largest remainder in
--    KOBO, so the parts add back to the investor pot exactly.
-- ------------------------------------------------------------
DROP FUNCTION IF EXISTS declare_cycle_profit(UUID, NUMERIC, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION declare_cycle_profit(
  p_cycle_id        UUID,
  p_total_revenue   NUMERIC,
  p_total_expenses  NUMERIC,
  p_notes           TEXT DEFAULT NULL,
  p_wht_rate        NUMERIC DEFAULT NULL,
  p_allow_redeclare BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
  v_cycle           cycles%ROWTYPE;
  v_total_units     NUMERIC(12,2);
  v_net_profit      NUMERIC(20,2);
  v_ratio           NUMERIC(5,4);
  v_wht_rate        NUMERIC(5,4);
  v_pot_kobo        BIGINT;
  v_inv_share       NUMERIC(20,2);
  v_co_share        NUMERIC(20,2);
  v_profit_per_slot NUMERIC(20,6);
  v_wht_per_slot    NUMERIC(20,6);
  v_decl_id         UUID;
  v_inv_count       INTEGER := 0;
  v_alloc_sum       BIGINT := 0;
  v_wht_sum         BIGINT := 0;
  v_leftover        BIGINT;
  v_rec             RECORD;
BEGIN
  SELECT * INTO v_cycle FROM cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;

  IF v_cycle.status NOT IN ('awaiting_profit_declaration', 'active') AND NOT p_allow_redeclare THEN
    RAISE EXCEPTION 'Cycle is not awaiting profit declaration (status: %)', v_cycle.status;
  END IF;

  IF EXISTS (SELECT 1 FROM cycle_profit_declarations WHERE cycle_id = p_cycle_id)
     AND NOT p_allow_redeclare THEN
    RAISE EXCEPTION 'Profit has already been declared for this cycle';
  END IF;

  v_ratio    := mudarabah_effective_ratio(p_cycle_id);
  v_wht_rate := COALESCE(p_wht_rate, mudarabah_effective_wht_rate(p_cycle_id), 0);

  SELECT COALESCE(SUM(units), 0) INTO v_total_units
  FROM investments
  WHERE cycle_id = p_cycle_id AND status IN ('active', 'matured');

  IF v_total_units = 0 THEN
    RAISE EXCEPTION 'No investments found in this cycle';
  END IF;

  v_net_profit      := p_total_revenue - p_total_expenses;
  v_inv_share       := ROUND(v_net_profit * v_ratio, 2);
  v_co_share        := v_net_profit - v_inv_share;
  v_profit_per_slot := v_inv_share / v_total_units;
  v_wht_per_slot    := ROUND(v_profit_per_slot * v_wht_rate, 6);
  v_pot_kobo        := ROUND(v_inv_share * 100);

  -- Largest remainder: floor each holder's exact share, then hand the
  -- remaining kobo to the largest fractional remainders. Nobody is
  -- systematically shortchanged and the total is exact.
  CREATE TEMP TABLE IF NOT EXISTS mud_alloc (
    investment_id UUID PRIMARY KEY,
    investor_id   UUID,
    units         NUMERIC(12,2),
    gross_kobo    BIGINT,
    wht_kobo      BIGINT,
    remainder     NUMERIC(30,10)
  ) ON COMMIT DROP;
  DELETE FROM mud_alloc;

  INSERT INTO mud_alloc (investment_id, investor_id, units, gross_kobo, remainder)
  SELECT i.id, i.investor_id, i.units,
         FLOOR(v_pot_kobo * i.units / v_total_units),
         (v_pot_kobo * i.units / v_total_units)
           - FLOOR(v_pot_kobo * i.units / v_total_units)
  FROM investments i
  WHERE i.cycle_id = p_cycle_id AND i.status IN ('active', 'matured');

  SELECT COALESCE(SUM(gross_kobo), 0) INTO v_alloc_sum FROM mud_alloc;
  v_leftover := v_pot_kobo - v_alloc_sum;

  IF v_leftover > 0 THEN
    UPDATE mud_alloc SET gross_kobo = gross_kobo + 1
    WHERE investment_id IN (
      SELECT investment_id FROM mud_alloc
      ORDER BY remainder DESC, investment_id
      LIMIT v_leftover
    );
  END IF;

  -- Tax on each holder's ALLOCATED gross
  UPDATE mud_alloc SET wht_kobo = ROUND(gross_kobo * v_wht_rate);

  SELECT COALESCE(SUM(gross_kobo), 0), COALESCE(SUM(wht_kobo), 0)
  INTO v_alloc_sum, v_wht_sum FROM mud_alloc;

  IF v_alloc_sum <> v_pot_kobo THEN
    RAISE EXCEPTION 'Allocation does not add up: holders total % kobo, investor pot is % kobo',
      v_alloc_sum, v_pot_kobo;
  END IF;

  IF EXISTS (SELECT 1 FROM cycle_profit_declarations WHERE cycle_id = p_cycle_id) THEN
    UPDATE cycle_profit_declarations SET
      total_revenue         = p_total_revenue,
      total_expenses        = p_total_expenses,
      net_profit            = v_net_profit,
      investor_profit_share = v_inv_share,
      company_profit_share  = v_co_share,
      profit_per_slot       = v_profit_per_slot,
      total_slots           = v_total_units,
      wht_rate              = v_wht_rate,
      wht_per_slot          = v_wht_per_slot,
      profit_per_slot_net   = v_profit_per_slot - v_wht_per_slot,
      total_wht             = v_wht_sum / 100.0,
      notes                 = p_notes,
      declared_by           = auth.uid(),
      declared_at           = NOW()
    WHERE cycle_id = p_cycle_id
    RETURNING id INTO v_decl_id;
  ELSE
    INSERT INTO cycle_profit_declarations (
      cycle_id, total_revenue, total_expenses, net_profit,
      investor_profit_share, company_profit_share,
      profit_per_slot, total_slots, wht_rate, wht_per_slot,
      profit_per_slot_net, total_wht, notes, declared_by
    ) VALUES (
      p_cycle_id, p_total_revenue, p_total_expenses, v_net_profit,
      v_inv_share, v_co_share, v_profit_per_slot, v_total_units,
      v_wht_rate, v_wht_per_slot, v_profit_per_slot - v_wht_per_slot,
      v_wht_sum / 100.0, p_notes, auth.uid()
    ) RETURNING id INTO v_decl_id;
  END IF;

  FOR v_rec IN SELECT * FROM mud_alloc LOOP
    UPDATE investments SET
      declared_profit     = v_rec.gross_kobo / 100.0,
      declared_wht        = v_rec.wht_kobo / 100.0,
      declared_profit_net = (v_rec.gross_kobo - v_rec.wht_kobo) / 100.0,
      status              = CASE WHEN status = 'active' THEN 'matured' ELSE status END,
      updated_at          = NOW()
    WHERE id = v_rec.investment_id;

    INSERT INTO notifications (user_id, title, message, type, action_url)
    SELECT inv.profile_id,
      'Profit Declared for Your Investment',
      FORMAT(
        'The profit for cycle %s has been declared. Your share is ₦%s%s.',
        v_cycle.cycle_label,
        TO_CHAR(v_rec.gross_kobo / 100.0, 'FM999,999,999,999.00'),
        CASE WHEN v_rec.wht_kobo > 0
          THEN FORMAT(', and ₦%s after withholding tax',
                 TO_CHAR((v_rec.gross_kobo - v_rec.wht_kobo) / 100.0, 'FM999,999,999,999.00'))
          ELSE '' END
      ),
      'maturity',
      FORMAT('/investments/%s', v_rec.investment_id)
    FROM investors inv WHERE inv.id = v_rec.investor_id;

    v_inv_count := v_inv_count + 1;
  END LOOP;

  UPDATE cycles SET status = 'completed', updated_at = NOW()
  WHERE id = p_cycle_id AND status <> 'completed';

  RETURN jsonb_build_object(
    'success',               true,
    'declaration_id',        v_decl_id,
    'net_profit',            v_net_profit,
    'investor_profit_share', v_inv_share,
    'company_profit_share',  v_co_share,
    'profit_per_slot',       v_profit_per_slot,
    'wht_rate',              v_wht_rate,
    'wht_per_slot',          v_wht_per_slot,
    'profit_per_slot_net',   v_profit_per_slot - v_wht_per_slot,
    'total_wht',             v_wht_sum / 100.0,
    'total_slots',           v_total_units,
    'investments_updated',   v_inv_count
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 10. Settle — the freeze, plus the write-through
--
--     The figures come from the shared TypeScript engine; the database
--     does not recompute them, because a second implementation of the
--     maths is a second source of truth. Settling also calls
--     declare_cycle_profit so the portal's own views can never
--     disagree with the report.
--
--     IDEMPOTENT: guarded on the settlement record, not a status flag.
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
  v_existing  UUID;
  v_id        UUID;
  v_ledger_id UUID;
  v_holder    JSONB;
  v_prod      JSONB;
  v_prior     INTEGER;
  v_revenue   NUMERIC(20,2);
  v_expenses  NUMERIC(20,2);
  v_profit    NUMERIC(20,2);
BEGIN
  PERFORM mudarabah_assert_admin();

  SELECT id INTO v_existing
  FROM mudarabah_settlements WHERE cycle_id = p_cycle_id AND is_current;

  IF v_existing IS NOT NULL THEN
    -- Already settled. Nothing at all happens again: no second
    -- snapshot, no second set of balance entries, no doubled balance.
    RETURN v_existing;
  END IF;

  SELECT id INTO v_ledger_id FROM mudarabah_ledgers WHERE cycle_id = p_cycle_id;
  IF v_ledger_id IS NULL THEN
    RAISE EXCEPTION 'This cycle has no trading ledger to settle';
  END IF;

  SELECT COUNT(*) INTO v_prior FROM mudarabah_settlements WHERE cycle_id = p_cycle_id;

  INSERT INTO mudarabah_settlements (
    cycle_id, ledger_id, settled_by, engine_version,
    ratio_used, unit_value_used, wht_rate_used, computed
  ) VALUES (
    p_cycle_id, v_ledger_id, auth.uid(), p_engine_version,
    mudarabah_effective_ratio(p_cycle_id),
    mudarabah_effective_unit_value(p_cycle_id),
    mudarabah_effective_wht_rate(p_cycle_id),
    p_computed
  ) RETURNING id INTO v_id;

  FOR v_holder IN SELECT * FROM jsonb_array_elements(COALESCE(p_holders, '[]'::JSONB))
  LOOP
    INSERT INTO mudarabah_settlement_holders (
      settlement_id, investment_id, investor_id, units, capital,
      gross_profit, wht, net_profit, capital_action, slots_withdrawn,
      amount_paid, amount_paid_note
    ) VALUES (
      v_id,
      (v_holder->>'investmentId')::UUID,
      (v_holder->>'investorId')::UUID,
      (v_holder->>'units')::NUMERIC,
      (v_holder->>'capital')::BIGINT,
      (v_holder->>'grossProfit')::BIGINT,
      COALESCE((v_holder->>'wht')::BIGINT, 0),
      (v_holder->>'netProfit')::BIGINT,
      v_holder->>'capitalAction',
      COALESCE((v_holder->>'slotsWithdrawn')::NUMERIC, 0),
      (v_holder->>'amountPaid')::BIGINT,
      NULLIF(v_holder->>'amountPaidNote', '')
    );

    -- Profit moves for EVERY investor, always
    INSERT INTO mudarabah_balance_entries (
      cycle_id, settlement_id, investor_id, entry_type, amount, note
    ) VALUES (
      p_cycle_id, v_id, (v_holder->>'investorId')::UUID, 'profit',
      (v_holder->>'netProfit')::BIGINT, NULLIF(v_holder->>'amountPaidNote', '')
    );

    IF COALESCE((v_holder->>'wht')::BIGINT, 0) <> 0 THEN
      INSERT INTO mudarabah_balance_entries (
        cycle_id, settlement_id, investor_id, entry_type, amount, note
      ) VALUES (
        p_cycle_id, v_id, (v_holder->>'investorId')::UUID, 'wht',
        (v_holder->>'wht')::BIGINT, 'Withheld and remitted'
      );
    END IF;

    -- Capital moves only for the slots being withdrawn
    IF COALESCE((v_holder->>'slotsWithdrawn')::NUMERIC, 0) > 0 THEN
      INSERT INTO mudarabah_balance_entries (
        cycle_id, settlement_id, investor_id, entry_type, amount, note
      ) VALUES (
        p_cycle_id, v_id, (v_holder->>'investorId')::UUID, 'capital',
        (v_holder->>'capitalWithdrawn')::BIGINT, NULL
      );
    END IF;
  END LOOP;

  FOR v_prod IN SELECT * FROM jsonb_array_elements(COALESCE(p_products, '[]'::JSONB))
  LOOP
    INSERT INTO mudarabah_settlement_products (
      settlement_id, product_key, product_name, units_bought, units_sold,
      units_left, revenue, cogs, gross, gross_margin
    ) VALUES (
      v_id, v_prod->>'productId', v_prod->>'productName',
      (v_prod->>'unitsBought')::INTEGER, (v_prod->>'unitsSold')::INTEGER,
      (v_prod->>'unitsLeft')::INTEGER, (v_prod->>'revenue')::BIGINT,
      (v_prod->>'cogs')::BIGINT, (v_prod->>'gross')::BIGINT,
      (v_prod->>'grossMargin')::NUMERIC
    );
  END LOOP;

  UPDATE mudarabah_ledgers
  SET status = 'settled', updated_at = NOW()
  WHERE id = v_ledger_id;

  -- Write through to the portal's own declaration, so the dashboards,
  -- the cycle history and the report can never disagree.
  v_revenue  := (p_computed->>'revenue')::BIGINT / 100.0;
  v_profit   := (p_computed->>'profit')::BIGINT / 100.0;
  v_expenses := v_revenue - v_profit;

  PERFORM declare_cycle_profit(
    p_cycle_id, v_revenue, v_expenses,
    FORMAT('Declared from the Mudarabah trading ledger (engine %s)', p_engine_version),
    mudarabah_effective_wht_rate(p_cycle_id),
    TRUE
  );

  INSERT INTO mudarabah_cycle_events (cycle_id, settlement_id, action, actor_id)
  VALUES (p_cycle_id, v_id,
    CASE WHEN v_prior > 0 THEN 'resettled' ELSE 'settled' END, auth.uid());

  PERFORM create_audit_log(
    CASE WHEN v_prior > 0 THEN 'mudarabah_cycle_resettled' ELSE 'mudarabah_cycle_settled' END,
    'cycle', p_cycle_id::TEXT, NULL,
    jsonb_build_object('settlement_id', v_id, 'engine_version', p_engine_version)
  );

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 11. Unsettle — deliberate, reasoned, logged.
--     The earlier snapshot is RETAINED, never overwritten; balances
--     are undone by their own entries.
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
    RAISE EXCEPTION 'A reason is required to reopen a settled cycle';
  END IF;

  SELECT id INTO v_id
  FROM mudarabah_settlements WHERE cycle_id = p_cycle_id AND is_current;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'This cycle has no current settlement';
  END IF;

  UPDATE mudarabah_settlements
  SET is_current = FALSE, superseded_at = NOW(),
      superseded_by = auth.uid(), supersede_reason = p_reason
  WHERE id = v_id;

  INSERT INTO mudarabah_balance_entries (
    cycle_id, settlement_id, investor_id, entry_type, amount, note
  )
  SELECT cycle_id, settlement_id, investor_id, 'reversal', -amount, p_reason
  FROM mudarabah_balance_entries
  WHERE settlement_id = v_id AND entry_type IN ('profit', 'wht', 'capital');

  UPDATE mudarabah_ledgers
  SET status = 'active', updated_at = NOW()
  WHERE cycle_id = p_cycle_id;

  INSERT INTO mudarabah_cycle_events (cycle_id, settlement_id, action, reason, actor_id)
  VALUES (p_cycle_id, v_id, 'unsettled', p_reason, auth.uid());

  PERFORM create_audit_log(
    'mudarabah_cycle_unsettled', 'cycle', p_cycle_id::TEXT, NULL,
    jsonb_build_object('settlement_id', v_id, 'reason', p_reason)
  );

  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 12. Correct a single payment, with the reason recorded
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_record_payment(
  p_settlement_id UUID,
  p_investment_id UUID,
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
  WHERE settlement_id = p_settlement_id AND investment_id = p_investment_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such holder on that settlement';
  END IF;

  PERFORM create_audit_log(
    'mudarabah_payment_adjusted', 'mudarabah_settlement', p_settlement_id::TEXT, NULL,
    jsonb_build_object('investment_id', p_investment_id,
                       'amount_paid', p_amount_paid, 'note', p_note)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 13. Lock down direct access — writes go through the functions above
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON mudarabah_ledgers, mudarabah_products, mudarabah_months,
             mudarabah_month_rows, mudarabah_settlements,
             mudarabah_settlement_holders, mudarabah_settlement_products,
             mudarabah_balance_entries, mudarabah_cycle_events FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE INSERT, UPDATE, DELETE ON mudarabah_ledgers, mudarabah_products,
             mudarabah_months, mudarabah_month_rows, mudarabah_settlements,
             mudarabah_settlement_holders, mudarabah_settlement_products,
             mudarabah_balance_entries, mudarabah_cycle_events FROM authenticated';
  END IF;
END $$;
