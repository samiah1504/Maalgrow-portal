-- ============================================================
-- 024 — slots held must equal money confirmed
--
-- THE RULE THIS ENFORCES. An investor is entered into the portal
-- only after their payment has arrived and been confirmed. There is
-- no instalment plan, no partial subscription, no credit. So for
-- every active enrolment:
--
--     investments.capital  ==  SUM(confirmed investment_payments)
--
-- Nothing enforced that. Two half-links let it drift:
--
--   * Editing an enrolment's slots (the Edit Slots dialog) wrote to
--     investments and nothing else. The money never moved with it.
--
--   * Reversing a payment called remove_payment_allocation, which
--     returns early when the payment carries 0 slots — correct for a
--     genuine instalment, but under this portal's rule there are no
--     instalments, so it silently unfunded the enrolment instead.
--
-- Between them, a cycle could hold 78 slots against ₦38,500,000 of
-- confirmed money, and only the Mudarabah ledger page noticed. At
-- settlement that phantom slot divides real profit.
--
-- WHAT THIS MIGRATION DOES NOT DO. It never writes a payment record
-- to make the sums agree. investment_payments mirrors what reached
-- the bank; a function that invents rows there to tidy a slot count
-- destroys the only thing that table is for. So set_investment_slots
-- REFUSES the edit and names the shortfall, leaving the admin to
-- correct the payment through the existing payment flow — which has
-- its own audit trail, and which already adjusts slots by itself
-- when the payment carries them.
--
-- Re-runnable. Every statement is CREATE OR REPLACE.
-- ============================================================

-- ------------------------------------------------------------
-- 1. What an enrolment has actually been paid.
--
--    Confirmed only. Pending money has not arrived, rejected and
--    reversed money is not there any more.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION investment_confirmed_paid(p_investment_id UUID)
RETURNS NUMERIC AS $$
  SELECT COALESCE(SUM(amount), 0)
  FROM investment_payments
  WHERE investment_id = p_investment_id
    AND status = 'confirmed';
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 2. Every active enrolment whose slots and money disagree.
--
--    p_cycle_id NULL means the whole portal. Ordered worst first so
--    the biggest discrepancy is the one you see.
--
--    A NEGATIVE gap (more money than slots) matters as much as a
--    positive one: it means an investor paid for something they were
--    never credited with.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION investment_funding_gaps(p_cycle_id UUID DEFAULT NULL)
RETURNS TABLE (
  investment_id   UUID,
  investment_code TEXT,
  investor_id     UUID,
  investor_name   TEXT,
  investor_code   TEXT,
  cycle_id        UUID,
  cycle_label     TEXT,
  units           NUMERIC,
  capital         NUMERIC,
  confirmed_paid  NUMERIC,
  gap             NUMERIC
) AS $$
  SELECT
    i.id,
    i.investment_code,
    i.investor_id,
    inv.full_name,
    inv.investor_code,
    i.cycle_id,
    c.cycle_label,
    i.units,
    i.capital,
    investment_confirmed_paid(i.id),
    i.capital - investment_confirmed_paid(i.id)
  FROM investments i
  JOIN investors inv ON inv.id = i.investor_id
  JOIN cycles c ON c.id = i.cycle_id
  WHERE i.status::text = 'active'
    AND (p_cycle_id IS NULL OR i.cycle_id = p_cycle_id)
    -- Half a kobo. NUMERIC is exact, but the enrolment's capital and
    -- the payment total are reached by different arithmetic.
    AND ABS(i.capital - investment_confirmed_paid(i.id)) > 0.005
  ORDER BY ABS(i.capital - investment_confirmed_paid(i.id)) DESC;
$$ LANGUAGE sql STABLE;

-- ------------------------------------------------------------
-- 3. Setting an enrolment's slots, with the invariant enforced.
--
--    Replaces the direct table UPDATE the API used to do. The
--    cycle's totals still move by way of the update_cycle_totals
--    trigger — that part was always right.
--
--    The refusal is the feature. It fires BEFORE the write, names
--    the exact shortfall, and says which way to resolve it.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_investment_slots(
  p_investment_id UUID,
  p_units         NUMERIC,
  p_reason        TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_actor       UUID;
  v_inv         investments%ROWTYPE;
  v_new_capital NUMERIC;
  v_paid        NUMERIC;
  v_gap         NUMERIC;
BEGIN
  v_actor := assert_payment_admin();

  IF p_units IS NULL OR p_units < 0.5 THEN
    RAISE EXCEPTION 'Slots must be at least 0.5';
  END IF;
  IF FLOOR(p_units * 2) <> p_units * 2 THEN
    RAISE EXCEPTION 'Slots must be in steps of 0.5';
  END IF;

  SELECT * INTO v_inv FROM investments WHERE id = p_investment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enrolment not found';
  END IF;
  IF v_inv.status::text <> 'active' THEN
    RAISE EXCEPTION 'Only active enrolments can be adjusted (this one is %). Matured and completed cycles are historical records.',
      v_inv.status;
  END IF;

  v_new_capital := ROUND(p_units * v_inv.price_per_unit, 2);
  v_paid        := investment_confirmed_paid(p_investment_id);
  v_gap         := v_new_capital - v_paid;

  IF v_inv.units = p_units AND v_inv.capital = v_new_capital THEN
    RETURN jsonb_build_object(
      'changed', FALSE, 'units', p_units, 'capital', v_new_capital,
      'confirmedPaid', v_paid
    );
  END IF;

  -- THE INVARIANT. Slots are a claim on profit; a claim nobody paid
  -- for is paid out of everybody else's share at settlement.
  IF ABS(v_gap) > 0.005 THEN
    IF v_gap > 0 THEN
      RAISE EXCEPTION
        'Cannot set % slots: that is ₦% of capital, but only ₦% has been confirmed for this enrolment — ₦% short. Correct the payment record first; a payment carrying slots adjusts the enrolment by itself.',
        p_units, TRIM(TO_CHAR(v_new_capital, 'FM999999999990.00')),
        TRIM(TO_CHAR(v_paid, 'FM999999999990.00')),
        TRIM(TO_CHAR(v_gap, 'FM999999999990.00'));
    ELSE
      RAISE EXCEPTION
        'Cannot set % slots: that is ₦% of capital, but ₦% has been confirmed for this enrolment — ₦% more than the slots account for. Reverse or correct the excess payment first.',
        p_units, TRIM(TO_CHAR(v_new_capital, 'FM999999999990.00')),
        TRIM(TO_CHAR(v_paid, 'FM999999999990.00')),
        TRIM(TO_CHAR(-v_gap, 'FM999999999990.00'));
    END IF;
  END IF;

  UPDATE investments SET
    units      = p_units,
    capital    = v_new_capital,
    updated_at = NOW()
  WHERE id = p_investment_id;

  PERFORM create_audit_log(
    'investment_slots_adjusted', 'investment', p_investment_id::text,
    jsonb_build_object('units', v_inv.units, 'capital', v_inv.capital),
    jsonb_build_object(
      'units', p_units, 'capital', v_new_capital,
      'confirmedPaid', v_paid,
      'reason', NULLIF(TRIM(COALESCE(p_reason, '')), '')
    )
  );

  RETURN jsonb_build_object(
    'changed', TRUE, 'units', p_units, 'capital', v_new_capital,
    'confirmedPaid', v_paid
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. mudarabah_get_ledger — holders carry their funding position.
--
--    Byte-for-byte the 021 version except for two added keys on each
--    holder ('capital', 'confirmedPaid') and one added top-level key
--    ('fundingGaps'). Verified by diff against 021.
--
--    Per-holder rather than a cycle total, because "₦500,000 short"
--    is not actionable and "Amina Yusuf is ₦500,000 short" is.
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
      WHERE i.cycle_id = p_cycle_id AND i.status = 'active'
    ), '[]'::JSONB)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. Grants.
--
--    investment_confirmed_paid stays internal: it reads one
--    enrolment's payments and RLS does not apply inside a SECURITY
--    DEFINER caller, so it is not something to hand to a session.
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION set_investment_slots(UUID, NUMERIC, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION investment_funding_gaps(UUID) TO authenticated;
    REVOKE EXECUTE ON FUNCTION investment_confirmed_paid(UUID) FROM anon, authenticated;
  END IF;
END $$;
