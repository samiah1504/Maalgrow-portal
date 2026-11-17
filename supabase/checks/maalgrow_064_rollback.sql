-- ============================================================
-- MaalGrow 064 — ROLLBACK. Puts 049's rollover dates and 033's ledger
-- reader back exactly, and removes the cycle length. Cycles lengthened
-- by 064 that have still not started get their 3-month dates back.
-- REFUSES once a ledger has a fourth month, or once a cycle that 064
-- lengthened (or a cycle made since) has started. A cycle made since
-- that has not started keeps its dates.
-- ============================================================
BEGIN;
DO $$
DECLARE v_n BIGINT;
BEGIN
IF EXISTS (SELECT 1 FROM mudarabah_months WHERE month_index > 3) THEN
RAISE EXCEPTION 'Rollback refused: a ledger already has more than three months.';
END IF;
SELECT COUNT(*) INTO v_n FROM cycles WHERE status <> 'upcoming'
AND (id::TEXT IN (SELECT entity_id FROM audit_logs WHERE action = 'cycle_lengthened_to_series_length')
OR created_at > (SELECT MAX(created_at) FROM audit_logs WHERE action = 'maalgrow_064_applied'));
IF v_n > 0 THEN RAISE EXCEPTION 'Rollback refused: % six-month cycle(s) have started.', v_n; END IF;
END $$;
-- Lengthened cycles that have not started go back to their own dates
DO $$
DECLARE r RECORD;
BEGIN
FOR r IN SELECT DISTINCT ON (a.entity_id) a.entity_id, a.old_values, a.new_values FROM audit_logs a
JOIN cycles c ON c.id::TEXT = a.entity_id AND c.status = 'upcoming'
WHERE a.action = 'cycle_lengthened_to_series_length' ORDER BY a.entity_id, a.created_at DESC LOOP
UPDATE investments SET maturity_date = (r.old_values->>'end_date')::DATE, updated_at = NOW()
WHERE cycle_id::TEXT = r.entity_id AND maturity_date = (r.new_values->>'end_date')::DATE;
UPDATE cycles SET end_date = (r.old_values->>'end_date')::DATE, cycle_label = r.old_values->>'cycle_label', updated_at = NOW()
WHERE id::TEXT = r.entity_id;
END LOOP;
END $$;
DROP TRIGGER mudarabah_month_within_cycle ON mudarabah_months;
DROP TRIGGER maalgrow_cycle_months_default ON cycles;
DROP FUNCTION mudarabah_month_within_cycle_trg();
DROP FUNCTION maalgrow_cycle_months_default_trg();
ALTER TABLE mudarabah_months DROP CONSTRAINT mudarabah_months_month_index_check;
ALTER TABLE mudarabah_months ADD CONSTRAINT mudarabah_months_month_index_check CHECK (month_index BETWEEN 1 AND 3);
-- Exactly as 049 and 033 defined them
CREATE OR REPLACE FUNCTION create_next_cycle(p_series_id UUID)
RETURNS UUID AS $$
DECLARE
  v_series        series%ROWTYPE;
  v_last_cycle    cycles%ROWTYPE;
  v_new_start     DATE;
  v_new_end       DATE;
  v_anchor_day    INTEGER;
  v_intended_day  INTEGER;
  v_end_month     DATE;      -- first day of the month three on
  v_end_month_len INTEGER;   -- how many days that month has
  v_cycle_number  INTEGER;
  v_cycle_label   TEXT;
  v_new_cycle_id  UUID;
BEGIN
  SELECT * INTO v_series FROM series WHERE id = p_series_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Series not found: %', p_series_id;
  END IF;

  SELECT * INTO v_last_cycle
  FROM cycles
  WHERE series_id = p_series_id
  ORDER BY cycle_number DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No existing cycle found for series %', v_series.name;
  END IF;

  -- 049: the SAME day. A cycle ending on the 30th is followed by one
  -- beginning on the 30th.
  v_new_start := v_last_cycle.end_date;

  -- 049: the series' anchor day — the highest day-of-month any of its
  -- cycles has begun on, this one included.
  v_anchor_day := GREATEST(
    EXTRACT(DAY FROM v_new_start)::INTEGER,
    COALESCE((
      SELECT MAX(EXTRACT(DAY FROM start_date))::INTEGER
      FROM cycles
      WHERE series_id = p_series_id
        AND status <> 'cancelled'
    ), 0)
  );

  -- The day this cycle was MEANT to begin on. Only a start that sits
  -- on the last day of its month can be a clamped one, so only then
  -- does the anchor speak; every other start means what it says.
  IF v_new_start = (DATE_TRUNC('month', v_new_start) + INTERVAL '1 month' - INTERVAL '1 day')::DATE THEN
    v_intended_day := v_anchor_day;
  ELSE
    v_intended_day := EXTRACT(DAY FROM v_new_start)::INTEGER;
  END IF;

  -- Three months on, on the intended day, clamped to that month.
  v_end_month     := (DATE_TRUNC('month', v_new_start) + INTERVAL '3 months')::DATE;
  v_end_month_len := EXTRACT(DAY FROM (v_end_month + INTERVAL '1 month' - INTERVAL '1 day'))::INTEGER;
  v_new_end       := v_end_month + (LEAST(v_intended_day, v_end_month_len) - 1);

  v_cycle_number := v_last_cycle.cycle_number + 1;
  v_cycle_label  := TO_CHAR(v_new_start, 'Mon YYYY') || ' – ' || TO_CHAR(v_new_end, 'Mon YYYY');

  INSERT INTO cycles (series_id, cycle_number, cycle_label, start_date, end_date, status)
  VALUES (p_series_id, v_cycle_number, v_cycle_label, v_new_start, v_new_end, 'upcoming')
  RETURNING id INTO v_new_cycle_id;

  RETURN v_new_cycle_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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
  FROM investments WHERE cycle_id = p_cycle_id AND status <> 'cancelled';

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
                       WHERE cycle_id = p_cycle_id AND status <> 'cancelled'),
    -- Who specifically is out of step, named, worst first
    'fundingGaps', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'investmentId',  g.investment_id,
        'investorName',  g.investor_name,
        'investorCode',  g.investor_code,
        'units',         g.units,
        'capital',       g.capital,
        'confirmedPaid', g.confirmed_paid,
        'gap',           g.gap
      ))
      FROM investment_funding_gaps(p_cycle_id) g
    ), '[]'::JSONB),
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
      WHERE i.cycle_id = p_cycle_id AND i.status <> 'cancelled'
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
        'capital',      i.capital,
        'confirmedPaid', investment_confirmed_paid(i.id),
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
      WHERE i.cycle_id = p_cycle_id AND i.status <> 'cancelled'
    ), '[]'::JSONB)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP FUNCTION maalgrow_cycle_end(DATE, INTEGER, INTEGER);
UPDATE comm_templates SET body = replace(body, 'next 6-month investment cycle', 'next 3-month investment cycle')
WHERE name = 'Capital Continuation' AND body LIKE '%next 6-month investment cycle%';
ALTER TABLE cycles DROP COLUMN cycle_months;
ALTER TABLE series DROP COLUMN cycle_months;
COMMIT;
SELECT '064 rolled back' AS result;
