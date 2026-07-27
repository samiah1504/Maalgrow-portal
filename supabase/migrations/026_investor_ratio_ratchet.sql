-- ============================================================
-- 026 — the manager may take less, never more
--
-- THE PROBLEM. The profit-sharing ratio freezes when subscriptions
-- close, and the slider goes dead with "Investors subscribed on the
-- strength of this ratio, so it cannot change now."
--
-- That reasoning is sound in one direction only. An investor who
-- subscribed at 50/50 has a complaint if the manager later takes 60%.
-- They have no complaint whatsoever if the manager takes 40% and
-- hands them 60% — that is a gift, not a broken bargain, and
-- MaalGrow does exactly this when a cycle has gone well or a
-- particular trade does not warrant a full share.
--
-- Treating both directions as the same thing blocked a routine act of
-- generosity in order to prevent something nobody was trying to do.
--
-- WHAT THIS ALLOWS. Once subscriptions have closed, the slot
-- holders' share may only RISE. Falling is still refused, because
-- that is the direction the lock exists for and no administrator can
-- consent to it on an investor's behalf. Before subscriptions close
-- nothing changes: the ratio moves freely, as it always did, through
-- mudarabah_set_cycle_terms.
--
-- Settlement remains the true freeze. After it the ratio is in the
-- snapshot, the profit is declared, and statements may already be in
-- investors' hands.
--
-- A one-way ratchet is a deliberately awkward thing to undo, and that
-- is the point. Raising the holders' share to 60% means the manager
-- cannot quietly walk it back to 50% next week — the cycle would have
-- to be reopened, which is logged, with a reason.
--
-- Re-runnable.
-- ============================================================

CREATE OR REPLACE FUNCTION mudarabah_set_investor_ratio(
  p_cycle_id UUID,
  p_ratio    NUMERIC,
  p_reason   TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_old    NUMERIC;
  v_locked BOOLEAN;
  v_label  TEXT;
BEGIN
  PERFORM mudarabah_assert_admin();

  IF p_ratio IS NULL OR p_ratio <= 0 OR p_ratio >= 1 THEN
    RAISE EXCEPTION 'The slot holders'' share must be a fraction of one, above 0 and below 1 — 0.60 for sixty per cent. Got %', p_ratio;
  END IF;

  SELECT cycle_label INTO v_label FROM cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;

  IF EXISTS (
    SELECT 1 FROM mudarabah_settlements
    WHERE cycle_id = p_cycle_id AND is_current
  ) THEN
    RAISE EXCEPTION 'Cycle % is settled. The ratio is part of the settlement snapshot and the profit has been declared on it — reopen the cycle first if it genuinely must change.', v_label;
  END IF;

  v_old    := mudarabah_effective_ratio(p_cycle_id);
  v_locked := mudarabah_terms_locked(p_cycle_id);

  -- THE RATCHET. Only after subscriptions have closed; before that
  -- the ratio is still being decided and moves either way.
  IF v_locked AND p_ratio < v_old - 1e-9 THEN
    RAISE EXCEPTION
      'Subscriptions have closed on cycle %. The slot holders'' share can be raised above %%% but not lowered to %%% — investors subscribed on the strength of it. Taking a smaller manager''s share is always allowed.',
      v_label,
      TRIM(TO_CHAR(v_old * 100, 'FM990.00')),
      TRIM(TO_CHAR(p_ratio * 100, 'FM990.00'));
  END IF;

  IF ABS(p_ratio - v_old) < 1e-9 THEN
    RETURN jsonb_build_object('cycleId', p_cycle_id, 'changed', FALSE, 'ratio', v_old);
  END IF;

  UPDATE cycles SET investor_ratio = p_ratio, updated_at = NOW()
  WHERE id = p_cycle_id;

  PERFORM create_audit_log(
    'mudarabah_investor_ratio_changed', 'cycle', p_cycle_id::TEXT,
    jsonb_build_object('investor_ratio', v_old, 'subscriptions_closed', v_locked),
    jsonb_build_object(
      'investor_ratio', p_ratio,
      'reason', NULLIF(TRIM(COALESCE(p_reason, '')), '')
    )
  );

  RETURN jsonb_build_object(
    'cycleId', p_cycle_id, 'changed', TRUE, 'from', v_old, 'to', p_ratio
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION mudarabah_set_investor_ratio(UUID, NUMERIC, TEXT) TO authenticated;
  END IF;
END $$;
