-- ============================================================
-- 033 — a settled cycle still has the investors it had
--
-- WHAT HAPPENED. Settling Series B worked. The snapshot, the
-- holders, the balance entries and the declaration were all written,
-- and the cycle went to 'completed'. Then its page reported 0 slots,
-- 0 investors and ₦0 of capital, and warned that ₦39,000,000 had
-- been received against nothing.
--
-- Nothing was lost. declare_cycle_profit moves every investment from
-- 'active' to 'matured' — that is what maturing IS — and
-- mudarabah_get_ledger counted only those still 'active'. So the
-- moment the cycle settled, the query that describes it started
-- returning an empty cycle.
--
-- MY MISTAKE, AND A RECENT ONE. When these figures were changed to
-- derive from the memberships rather than a stored counter, I wrote
-- the filter as "active" because that was true of every cycle I was
-- looking at: none of them had settled yet. The engine had it right
-- all along — declare_cycle_profit sums status IN ('active',
-- 'matured') — and the display did not.
--
-- THE MEMBERS OF A CYCLE ARE EVERYONE WHO WAS GENUINELY IN IT.
-- Only 'cancelled' was never really there: a cancelled enrolment is
-- one whose payment was reversed, which is exactly the phantom slot
-- migration 024 exists to keep out. Everything else — active,
-- matured, completed — held slots in this cycle and divided its
-- profit. So the filter is "not cancelled", which stays true through
-- the whole life of a cycle instead of only the part before it
-- settles.
--
-- investment_funding_gaps is deliberately NOT changed. It asks
-- whether a LIVE enrolment is paid for, and a settled one is
-- history; leaving it on 'active' means a settled cycle correctly
-- reports nothing.
--
-- Byte-for-byte the 024 function but for four filters — verified by
-- diff. Re-runnable.
-- ============================================================

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
