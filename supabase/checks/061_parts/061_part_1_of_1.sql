-- ============================================================
-- 061 — MaalRise: move funding credited to the wrong investor (14 Oct 2026)
--
-- ONE PART for the Supabase SQL Editor: run once. Success = "061 applied".
-- APPLY ONLY AFTER supabase/checks/maalrise_061_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_061_postapply.sql.
-- To undo: supabase/checks/maalrise_061_rollback.sql.
--
-- Units recorded under the wrong investor are moved to the right one —
-- all of a confirmed funding entry, or part of it (the entry is then
-- split: the moved units become a new confirmed entry for the right
-- investor, same date, reference marked "/moved"). Allocations follow.
-- The Cycle's total does not change, so its terms do not either.
--
-- Only before activation (reopen an active Cycle first, migration 060).
-- Super admin and administrator, with a reason. Every move is in the
-- audit log with the before and after. MaalRise only.
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.maalrise_reopen_cycle(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'STOP: run migration 060 first.';
  END IF;
  IF to_regprocedure('public.maalrise_move_funding(uuid,uuid,integer,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: 061 has already been applied. Do not run it again.';
  END IF;
END $$;

-- >>> 061 BODY START

CREATE OR REPLACE FUNCTION maalrise_move_funding(p_funding UUID, p_to UUID, p_units INTEGER, p_reason TEXT)
RETURNS UUID AS $$
DECLARE
  v_f      maalrise_investor_fundings%ROWTYPE;
  v_cycle  maalrise_cycles%ROWTYPE;
  v_to     maalrise_investors%ROWTYPE;
  v_kobo   BIGINT;
  v_new    UUID;
  v_ref    TEXT;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  IF NULLIF(trim(p_reason), '') IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;
  SELECT * INTO v_f FROM maalrise_investor_fundings WHERE id = p_funding FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding not found'; END IF;
  IF v_f.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed funding can be moved (this entry is %); reject and re-record an unconfirmed entry instead', v_f.status;
  END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = v_f.cycle_id FOR UPDATE;
  IF v_cycle.status NOT IN ('draft', 'terms_submitted', 'terms_approved') THEN
    RAISE EXCEPTION 'Funding can be moved only before the Cycle is activated (this one is %); reopen it first', v_cycle.status;
  END IF;
  SELECT * INTO v_to FROM maalrise_investors WHERE id = p_to;
  IF NOT FOUND THEN RAISE EXCEPTION 'Choose the investor the units belong to'; END IF;
  IF p_to = v_f.maalrise_investor_id THEN RAISE EXCEPTION 'The units are already with this investor'; END IF;
  IF v_to.status = 'suspended' THEN RAISE EXCEPTION 'That investor is suspended'; END IF;
  IF p_units IS NULL OR p_units < 1 OR p_units > v_f.units THEN
    RAISE EXCEPTION 'Units to move must be between 1 and % (this entry''s units)', v_f.units;
  END IF;
  v_kobo := p_units * v_cycle.unit_price_kobo;

  IF p_units = v_f.units THEN
    -- The whole entry was the other investor's.
    UPDATE maalrise_investor_fundings SET maalrise_investor_id = p_to WHERE id = p_funding;
    v_new := p_funding;
  ELSE
    -- Part of it: split, keeping the same date and confirmation.
    v_ref := v_f.reference || '/moved';
    WHILE EXISTS (SELECT 1 FROM maalrise_investor_fundings
                   WHERE cycle_id = v_f.cycle_id AND lower(trim(reference)) = lower(v_ref) AND status <> 'rejected') LOOP
      v_ref := v_ref || '+';
    END LOOP;
    UPDATE maalrise_investor_fundings SET units = units - p_units, amount_kobo = amount_kobo - v_kobo WHERE id = p_funding;
    INSERT INTO maalrise_investor_fundings (cycle_id, maalrise_investor_id, units, amount_kobo, received_on, reference, status,
                                            recorded_by, confirmed_by, confirmed_at, self_confirm_reason)
    VALUES (v_f.cycle_id, p_to, p_units, v_kobo, v_f.received_on, v_ref, 'confirmed',
            v_f.recorded_by, v_f.confirmed_by, v_f.confirmed_at, v_f.self_confirm_reason)
    RETURNING id INTO v_new;
  END IF;

  -- Allocations follow the units.
  UPDATE maalrise_allocations SET units = units - p_units, capital_kobo = capital_kobo - v_kobo, updated_at = NOW()
   WHERE cycle_id = v_f.cycle_id AND maalrise_investor_id = v_f.maalrise_investor_id AND units > p_units;
  IF NOT FOUND THEN
    DELETE FROM maalrise_allocations
     WHERE cycle_id = v_f.cycle_id AND maalrise_investor_id = v_f.maalrise_investor_id AND units = p_units;
    IF NOT FOUND THEN RAISE EXCEPTION 'The investor''s allocation does not match this funding; nothing was changed'; END IF;
  END IF;
  INSERT INTO maalrise_allocations (cycle_id, maalrise_investor_id, units, capital_kobo)
  VALUES (v_f.cycle_id, p_to, p_units, v_kobo)
  ON CONFLICT (cycle_id, maalrise_investor_id) DO UPDATE
    SET units = maalrise_allocations.units + EXCLUDED.units,
        capital_kobo = maalrise_allocations.capital_kobo + EXCLUDED.capital_kobo,
        updated_at = NOW();

  PERFORM create_audit_log('maalrise_move_funding', 'maalrise_investor_funding', p_funding::TEXT,
    jsonb_build_object('investor', v_f.maalrise_investor_id, 'units', v_f.units, 'reference', v_f.reference),
    jsonb_build_object('to_investor', p_to, 'units_moved', p_units, 'amount_kobo', v_kobo,
                       'entry', v_new, 'reason', trim(p_reason)));
  RETURN v_new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- <<< 061 BODY END

COMMIT;

SELECT '061 applied' AS result;
