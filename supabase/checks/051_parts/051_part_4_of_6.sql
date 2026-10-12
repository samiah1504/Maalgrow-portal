-- ============================================================
-- MaalRise 051 — PART 4 OF 6
-- Arithmetic check; create counterparty, create Cycle, save terms
--
-- The six parts together are byte-for-byte the body of
-- supabase/migrations/051_maalrise_core.sql (lines 439–662 here), split
-- so each can be pasted and run on its own in the Supabase SQL Editor.
--
-- Run the parts IN ORDER, 1 to 6, each in its own Run.
-- Each part is its own transaction: if it fails, it leaves nothing
-- behind, and the earlier parts stay as they were. It refuses to run
-- out of order, or twice.
--
-- Success = the final result row reads "Part 4 of 6 applied".
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'maalrise_cycle_visible_to_me') THEN
    RAISE EXCEPTION 'STOP: run part 3 of 6 first (it creates maalrise_cycle_visible_to_me).';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = 'maalrise_save_terms') THEN
    RAISE EXCEPTION 'STOP: part 4 of 6 has already been applied (maalrise_save_terms exists). Do not run it again.';
  END IF;
END $$;

-- >>> 051 BODY START (part 4)
-- ------------------------------------------------------------
-- 8. Arithmetic — the database's own check of the terms engine
-- ------------------------------------------------------------
/** amount × bps / 10 000, rounded half away from zero, to the kobo. */
CREATE OR REPLACE FUNCTION maalrise_apply_bps(p_amount BIGINT, p_bps INTEGER)
RETURNS BIGINT AS $$
  SELECT round((p_amount::NUMERIC * p_bps) / 10000)::BIGINT;
$$ LANGUAGE sql IMMUTABLE;

-- ------------------------------------------------------------
-- 9. Writes
-- ------------------------------------------------------------

CREATE OR REPLACE FUNCTION maalrise_create_counterparty(p JSONB)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  INSERT INTO maalrise_counterparties (name, registration_no, contact_email, contact_phone, address, created_by)
  VALUES (trim(p->>'name'), NULLIF(trim(p->>'registration_no'), ''), NULLIF(trim(p->>'contact_email'), ''),
          NULLIF(trim(p->>'contact_phone'), ''), NULLIF(trim(p->>'address'), ''), auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_create_counterparty', 'maalrise_counterparty', v_id::TEXT, NULL, p);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION maalrise_create_cycle(p JSONB)
RETURNS UUID AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  INSERT INTO maalrise_cycles (name, transaction_name, description, counterparty_id, start_date,
                               duration_months, stated_maturity_date, unit_price_kobo, created_by)
  VALUES (trim(p->>'name'), trim(p->>'transaction_name'), NULLIF(trim(p->>'description'), ''),
          (p->>'counterparty_id')::UUID, (p->>'start_date')::DATE, (p->>'duration_months')::INTEGER,
          NULLIF(p->>'stated_maturity_date', '')::DATE, (p->>'unit_price_kobo')::BIGINT, auth.uid())
  RETURNING id INTO v_id;
  PERFORM create_audit_log('maalrise_create_cycle', 'maalrise_cycle', v_id::TEXT, NULL, p);
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

/**
 * Save the open draft of a Cycle's terms, verifying every figure.
 *
 * p_terms carries the inputs as entered and the engine's figures;
 * p_schedule is the per-month array. Nothing is stored unless the
 * database's own arithmetic reaches the same numbers to the kobo.
 */
CREATE OR REPLACE FUNCTION maalrise_save_terms(p_cycle UUID, p_terms JSONB, p_schedule JSONB)
RETURNS UUID AS $$
DECLARE
  v_cycle      maalrise_cycles%ROWTYPE;
  v_open       maalrise_cycle_terms%ROWTYPE;
  v_id         UUID;
  v_version    INTEGER;
  v_cost       BIGINT := (p_terms->>'cost_kobo')::BIGINT;
  v_mtype      TEXT   := p_terms->>'markup_type';
  v_mbps       INTEGER := NULLIF(p_terms->>'markup_bps', '')::INTEGER;
  v_mamt       BIGINT := NULLIF(p_terms->>'markup_amount_kobo', '')::BIGINT;
  v_stated     BIGINT := NULLIF(p_terms->>'stated_sale_price_kobo', '')::BIGINT;
  v_fbasis     TEXT   := p_terms->>'fee_basis';
  v_fbps       INTEGER := NULLIF(p_terms->>'fee_bps', '')::INTEGER;
  v_famt       BIGINT := NULLIF(p_terms->>'fee_amount_kobo', '')::BIGINT;
  v_ftreat     TEXT   := p_terms->>'fee_treatment';
  v_smode      TEXT   := p_terms->>'schedule_mode';
  v_markup     BIGINT;
  v_sale       BIGINT;
  v_fee        BIGINT := 0;
  v_pool       BIGINT;
  v_cp_total   BIGINT;
  v_n          INTEGER;
  v_line       JSONB;
  v_i          INTEGER := 0;
  v_net_sum    BIGINT := 0;
  v_fee_sum    BIGINT := 0;
  v_net        BIGINT;
  v_lfee       BIGINT;
  v_round      BIGINT;
  v_exp_fee    BIGINT;
  v_exp_net    BIGINT;
  v_exp_round  BIGINT;
BEGIN
  IF NOT maalrise_can_prepare() THEN RAISE EXCEPTION 'Unauthorized'; END IF;

  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status NOT IN ('draft', 'terms_approved') THEN
    RAISE EXCEPTION 'Terms can only be prepared for a draft Cycle or as a new version of approved terms (Cycle is %)', v_cycle.status;
  END IF;
  v_n := v_cycle.duration_months;

  -- Markup, sale price
  IF v_mtype = 'percent' THEN
    v_markup := maalrise_apply_bps(v_cost, v_mbps);
  ELSIF v_mtype = 'amount' THEN
    v_markup := v_mamt;
  ELSE
    RAISE EXCEPTION 'Unknown markup type %', v_mtype;
  END IF;
  v_sale := v_cost + v_markup;
  IF v_stated IS NOT NULL AND v_stated <> v_sale THEN
    RAISE EXCEPTION 'Stated sale price % does not equal cost + markup %', v_stated, v_sale;
  END IF;

  -- Fee: separate from markup, basis and treatment from the contract
  IF v_ftreat IS NULL OR v_ftreat NOT IN ('deducted_from_investors', 'charged_to_counterparty', 'waived') THEN
    RAISE EXCEPTION 'Fee treatment must be stated explicitly';
  END IF;
  IF v_ftreat <> 'waived' THEN
    v_fee := CASE v_fbasis
               WHEN 'fixed'  THEN v_famt
               WHEN 'cost'   THEN maalrise_apply_bps(v_cost, v_fbps)
               WHEN 'markup' THEN maalrise_apply_bps(v_markup, v_fbps)
             END;
    IF v_fee IS NULL THEN RAISE EXCEPTION 'Fee rate or amount is missing'; END IF;
  ELSE
    v_fbps := NULL; v_famt := NULL;
  END IF;

  v_pool := CASE WHEN v_ftreat = 'deducted_from_investors' THEN v_markup - v_fee ELSE v_markup END;
  v_cp_total := CASE WHEN v_ftreat = 'charged_to_counterparty' THEN v_sale + v_fee ELSE v_sale END;
  IF v_pool < 0 THEN RAISE EXCEPTION 'The fee deducted from investors exceeds the markup'; END IF;

  -- The engine's headline figures must match ours exactly
  IF (p_terms->>'markup_kobo')::BIGINT IS DISTINCT FROM v_markup
     OR (p_terms->>'sale_price_kobo')::BIGINT IS DISTINCT FROM v_sale
     OR (p_terms->>'fee_kobo')::BIGINT IS DISTINCT FROM v_fee
     OR (p_terms->>'investor_pool_kobo')::BIGINT IS DISTINCT FROM v_pool
     OR (p_terms->>'counterparty_total_kobo')::BIGINT IS DISTINCT FROM v_cp_total THEN
    RAISE EXCEPTION 'Submitted figures do not reconcile with the database calculation (markup %, sale %, fee %, pool %, counterparty %)',
      v_markup, v_sale, v_fee, v_pool, v_cp_total;
  END IF;

  -- Schedule
  IF jsonb_typeof(p_schedule) <> 'array' OR jsonb_array_length(p_schedule) <> v_n THEN
    RAISE EXCEPTION 'The schedule must have exactly % months', v_n;
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_schedule) LOOP
    v_i := v_i + 1;
    v_net := (v_line->>'investor_net_kobo')::BIGINT;
    v_lfee := (v_line->>'fee_kobo')::BIGINT;
    v_round := COALESCE((v_line->>'rounding_adjustment_kobo')::BIGINT, 0);
    IF (v_line->>'period')::INTEGER <> v_i THEN RAISE EXCEPTION 'Schedule periods must run 1..% in order', v_n; END IF;
    IF v_net IS NULL OR v_net < 0 OR v_lfee IS NULL OR v_lfee < 0 THEN
      RAISE EXCEPTION 'Month %: amounts must be zero or more', v_i;
    END IF;
    IF (v_line->>'counterparty_gross_kobo')::BIGINT IS DISTINCT FROM v_net + v_lfee THEN
      RAISE EXCEPTION 'Month %: gross must equal net + fee', v_i;
    END IF;
    -- Fee shown evenly with the remainder on the final month (A7 provisional);
    -- an equal schedule likewise. Computed first: inside an IF, a CASE's
    -- own THEN would be read as the IF's.
    v_exp_fee := (v_fee / v_n) + (CASE WHEN v_i = v_n THEN v_fee % v_n ELSE 0 END);
    v_exp_net := (v_pool / v_n) + (CASE WHEN v_i = v_n THEN v_pool % v_n ELSE 0 END);
    v_exp_round := CASE WHEN v_i < v_n THEN 0
                        WHEN v_smode = 'equal' THEN v_pool % v_n + v_fee % v_n
                        ELSE v_fee % v_n END;
    IF v_lfee <> v_exp_fee THEN
      RAISE EXCEPTION 'Month %: fee portion should be % (even split)', v_i, v_exp_fee;
    END IF;
    IF v_smode = 'equal' AND v_net <> v_exp_net THEN
      RAISE EXCEPTION 'Month %: equal instalment should be %', v_i, v_exp_net;
    END IF;
    IF v_round <> v_exp_round THEN
      RAISE EXCEPTION 'Month %: rounding adjustment should be %', v_i, v_exp_round;
    END IF;
    v_net_sum := v_net_sum + v_net;
    v_fee_sum := v_fee_sum + v_lfee;
  END LOOP;
  IF v_net_sum <> v_pool THEN
    RAISE EXCEPTION 'Monthly amounts total % but the investor profit pool is %', v_net_sum, v_pool;
  END IF;
  IF v_fee_sum <> v_fee THEN
    RAISE EXCEPTION 'Monthly fees total % but the fee is %', v_fee_sum, v_fee;
  END IF;

  -- Replace the open draft, or start a new version
  SELECT * INTO v_open FROM maalrise_cycle_terms
   WHERE cycle_id = p_cycle AND status IN ('draft', 'submitted') FOR UPDATE;
  IF FOUND AND v_open.status = 'submitted' THEN
    RAISE EXCEPTION 'These terms are awaiting approval; return them before editing';
  END IF;
  IF FOUND THEN
    DELETE FROM maalrise_schedule_lines WHERE terms_id = v_open.id;
    DELETE FROM maalrise_cycle_terms WHERE id = v_open.id;
    v_version := v_open.version;
  ELSE
    SELECT COALESCE(MAX(version), 0) + 1 INTO v_version FROM maalrise_cycle_terms WHERE cycle_id = p_cycle;
  END IF;

  INSERT INTO maalrise_cycle_terms (
    cycle_id, version, status, cost_kobo, markup_type, markup_bps, markup_amount_kobo, stated_sale_price_kobo,
    fee_basis, fee_bps, fee_amount_kobo, fee_treatment, schedule_mode,
    markup_kobo, sale_price_kobo, fee_kobo, investor_pool_kobo, counterparty_total_kobo,
    computed, engine_version, prepared_by)
  VALUES (
    p_cycle, v_version, 'draft', v_cost, v_mtype,
    CASE WHEN v_mtype = 'percent' THEN v_mbps END, CASE WHEN v_mtype = 'amount' THEN v_mamt END, v_stated,
    v_fbasis,
    CASE WHEN v_ftreat <> 'waived' AND v_fbasis <> 'fixed' THEN v_fbps END,
    CASE WHEN v_ftreat <> 'waived' AND v_fbasis = 'fixed' THEN v_famt END,
    v_ftreat, v_smode,
    v_markup, v_sale, v_fee, v_pool, v_cp_total,
    p_terms, COALESCE(p_terms->>'engine_version', 'unknown'), auth.uid())
  RETURNING id INTO v_id;

  INSERT INTO maalrise_schedule_lines (terms_id, period, due_date, counterparty_gross_kobo, fee_kobo,
                                       investor_net_kobo, rounding_adjustment_kobo)
  SELECT v_id, (l->>'period')::INTEGER,
         (v_cycle.start_date + make_interval(months => (l->>'period')::INTEGER))::DATE,
         (l->>'counterparty_gross_kobo')::BIGINT, (l->>'fee_kobo')::BIGINT,
         (l->>'investor_net_kobo')::BIGINT, COALESCE((l->>'rounding_adjustment_kobo')::BIGINT, 0)
  FROM jsonb_array_elements(p_schedule) l;

  PERFORM create_audit_log('maalrise_save_terms', 'maalrise_cycle_terms', v_id::TEXT, NULL,
    jsonb_build_object('cycle_id', p_cycle, 'version', v_version, 'investor_pool_kobo', v_pool, 'fee_kobo', v_fee));
  RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- <<< 051 BODY END (part 4)

COMMIT;

SELECT 'Part 4 of 6 applied' AS result;
