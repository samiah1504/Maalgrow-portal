-- ============================================================
-- 031 — settling was blocked by an unfiltered DELETE
--
-- WHAT HAPPENED. Pressing Settle returned "DELETE requires a WHERE
-- clause" and wrote nothing. That message is not this portal's; it
-- comes from the safeupdate guard Supabase runs, which refuses any
-- UPDATE or DELETE without a WHERE — and it applies inside functions,
-- not only to statements typed into an editor.
--
-- declare_cycle_profit builds its largest-remainder allocation in a
-- temp table and clears it first with a bare DELETE FROM mud_alloc.
-- Harmless in plain Postgres, which is why every scenario passes
-- locally, and refused outright on Supabase. Settlement calls that
-- function, so settlement could not complete.
--
-- NOTHING WAS HALF-WRITTEN. The exception propagated out of the
-- implicit transaction wrapping the call, so the snapshot, the
-- holders, the balance entries and the declaration all rolled back
-- together — which is exactly what the settle screen promises.
--
-- THE FIX IS ONE STATEMENT. TRUNCATE is what empties a table, it is
-- not covered by the guard, and it says plainly that everything goes.
-- Byte-for-byte the 018 function otherwise — verified by diff.
--
-- Re-runnable.
-- ============================================================

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
  -- 031: TRUNCATE, not DELETE. Supabase runs the safeupdate
  -- guard, which raises "DELETE requires a WHERE clause" on any
  -- unfiltered DELETE — including inside a function, which is where
  -- this one is. Emptying a temp table is exactly what TRUNCATE is
  -- for, so this is both safe and clearer than DELETE ... WHERE TRUE.
  TRUNCATE mud_alloc;

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
