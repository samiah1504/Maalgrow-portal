-- ============================================================
-- Migration 021 – Settlement: withholding tax state, honest
--                 maturity instructions, and a clean unsettle
--
-- Five changes, all additive:
--
--   1. Each settled holder carries the STATE of their withholding
--      tax — withheld, remitted, certified. Until now the only
--      signal was whether a credit note row existed, which cannot
--      tell "deducted but not yet filed" from "not yet issued".
--
--   2. mudarabah_get_ledger stops folding "no instruction on
--      record" into "rollover". Null stays null; settlement decides
--      what to do about it, in the open, and an administrator can
--      override it before committing.
--
--   3. Unsettle reverses the DECLARATION as well as the balance
--      entries. It was leaving investments matured with a declared
--      profit for a cycle that no longer had a settlement.
--
--   4. An investor's cycle history, read from the frozen snapshot
--      and never recomputed.
--
--   5. The tax balance entry stops claiming the money has been
--      remitted at the moment it is only withheld.
--
-- Apply AFTER migration 020.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The state of an investor's withholding tax
--
--    withheld  — settled and deducted; not yet filed
--    remitted  — filing recorded; no note issued yet
--    certified — note issued and reference allocated
--
--    Settlement sets 'withheld' and never anything else. Moving a
--    record on is part B, and only ever happens after the tax has
--    actually been filed.
-- ------------------------------------------------------------
ALTER TABLE mudarabah_settlement_holders
  ADD COLUMN IF NOT EXISTS wht_state TEXT NOT NULL DEFAULT 'withheld';

DO $$
BEGIN
  ALTER TABLE mudarabah_settlement_holders
    ADD CONSTRAINT mudarabah_settlement_holders_wht_state_check
    CHECK (wht_state IN ('withheld', 'remitted', 'certified'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_mud_settlement_holders_wht_state
  ON mudarabah_settlement_holders(wht_state)
  WHERE wht > 0;

-- ------------------------------------------------------------
-- 2. No instruction on record stays no instruction on record
--
--    The previous version returned 'rollover' for an investor who
--    had never answered, which reads on screen exactly like someone
--    who chose to leave their capital in. Those are different
--    situations and the difference matters: one is a decision, the
--    other is a person who has not been reached yet.
--
--    Two changes only — the capitalAction expression, and the
--    investor's tax number carried through so the settlement preview
--    can say who is missing one. Everything else is byte-for-byte the
--    018 version, verified by diff.
-- ------------------------------------------------------------
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
        'investorTin',  inv.tin,
        'units',        i.units,
        -- NULL when nothing was ever recorded. NOT 'rollover':
        -- someone who never answered is not someone who chose.
        'capitalAction', CASE
          WHEN rd.decision IS NULL THEN NULL
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
-- 3. Unsettle reverses the declaration too
--
--    Reopening a cycle used to reverse the balance entries and stop
--    there, leaving every investment matured with a declared profit
--    for a settlement that was no longer current — orphaned figures
--    that the existing dashboards would still show.
--
--    A cycle whose credit notes have been issued CANNOT be reopened.
--    Those documents are in taxpayers' hands and the figures behind
--    them must not move.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_unsettle_cycle(
  p_cycle_id UUID,
  p_reason   TEXT
)
RETURNS UUID AS $$
DECLARE
  v_id    UUID;
  v_notes INTEGER;
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

  SELECT COUNT(*) INTO v_notes FROM wht_credit_notes WHERE cycle_id = p_cycle_id;
  IF v_notes > 0 THEN
    RAISE EXCEPTION
      'This cycle has % withholding tax credit note(s) issued. Those documents cannot be unsaid, so the cycle cannot be reopened.',
      v_notes;
  END IF;

  UPDATE mudarabah_settlements
  SET is_current = FALSE, superseded_at = NOW(),
      superseded_by = auth.uid(), supersede_reason = p_reason
  WHERE id = v_id;

  -- Reverse the money
  INSERT INTO mudarabah_balance_entries (
    cycle_id, settlement_id, investor_id, entry_type, amount, note
  )
  SELECT cycle_id, settlement_id, investor_id, 'reversal', -amount, p_reason
  FROM mudarabah_balance_entries
  WHERE settlement_id = v_id AND entry_type IN ('profit', 'wht', 'capital');

  -- Reverse the declaration. The snapshot is retained; the derived
  -- figures on investments and cycles are not, because they describe
  -- a settlement that is no longer current.
  UPDATE investments SET
    declared_profit     = NULL,
    declared_wht        = NULL,
    declared_profit_net = NULL,
    status              = CASE WHEN status = 'matured' THEN 'active' ELSE status END,
    updated_at          = NOW()
  WHERE cycle_id = p_cycle_id;

  DELETE FROM cycle_profit_declarations WHERE cycle_id = p_cycle_id;

  UPDATE cycles
  SET status = 'awaiting_profit_declaration', updated_at = NOW()
  WHERE id = p_cycle_id AND status = 'completed';

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
-- 4. An investor's cycle history
--
--    Read from the frozen snapshot, never recomputed — a statement
--    from two years ago says today exactly what it said then.
--    Superseded settlements are excluded: they describe a cycle as
--    it was before being reopened.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION mudarabah_investor_cycle_history(p_investor_id UUID)
RETURNS TABLE (
  cycle_id        UUID,
  series_name     TEXT,
  cycle_label     TEXT,
  start_date      DATE,
  end_date        DATE,
  settled_at      TIMESTAMPTZ,
  units           NUMERIC,
  capital         BIGINT,
  gross_profit    BIGINT,
  wht             BIGINT,
  net_profit      BIGINT,
  net_return_pct  NUMERIC,
  capital_action  TEXT,
  slots_withdrawn NUMERIC,
  wht_state       TEXT
) AS $$
  SELECT
    c.id, s.name, c.cycle_label, c.start_date, c.end_date, st.settled_at,
    h.units, h.capital, h.gross_profit, h.wht, h.net_profit,
    CASE WHEN h.capital > 0
      THEN ROUND((h.net_profit::NUMERIC / h.capital) * 100, 2)
      ELSE 0 END,
    h.capital_action, h.slots_withdrawn, h.wht_state
  FROM mudarabah_settlement_holders h
  JOIN mudarabah_settlements st ON st.id = h.settlement_id
  JOIN cycles c ON c.id = st.cycle_id
  JOIN series s ON s.id = c.series_id
  WHERE h.investor_id = p_investor_id
    AND st.is_current
  ORDER BY c.start_date DESC;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- Investors may read their own history; the function is scoped by
-- investor id and the calling route checks ownership.

-- ------------------------------------------------------------
-- 5. Settlement records tax as WITHHELD, not remitted
--
--    The balance entry used to read "Withheld and remitted", which
--    said something untrue at the moment it was written: nothing has
--    been filed at settlement. Only the wording changes here; every
--    figure and every other statement is the 018 version, verified by
--    diff.
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
        -- Deducted. NOT remitted: filing happens afterwards, and the
        -- holder's wht_state says where it has got to.
        (v_holder->>'wht')::BIGINT, 'Withheld at settlement'
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
