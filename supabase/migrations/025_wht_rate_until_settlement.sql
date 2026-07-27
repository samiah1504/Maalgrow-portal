-- ============================================================
-- 025 — the withholding rate is the law's, not a cycle term
--
-- WHAT WAS WRONG. mudarabah_set_cycle_terms refuses every change
-- once subscriptions close, on the grounds that the terms were
-- advertised to investors. That is right for two of the three:
--
--   * the profit-sharing ratio is what an investor agreed to, and
--   * the slot value defines what they bought.
--
-- Moving either after the fact changes a bargain already struck.
--
-- The withholding rate is not like them. It is set by the tax
-- authority, not by MaalGrow, and no investor agreed to it — they are
-- subject to it. Locking it at subscription close means a rate that
-- was never entered, or one the law changed mid-cycle, cannot be
-- recorded at all. And the consequence is not unfairness to an
-- investor; it is withholding the wrong amount of somebody else's
-- tax, then issuing credit notes that say so.
--
-- That is exactly what happened: series.default_wht_rate defaults to
-- 0 and nothing ever prompted anyone to set it, so a cycle sat at
-- 0.00% looking perfectly well-formed, with the field disabled and
-- the page explaining that subscriptions had closed.
--
-- WHAT CHANGES. A dedicated setter, allowed until SETTLEMENT rather
-- than until subscription close. mudarabah_set_cycle_terms is left
-- exactly as it is — the ratio and the slot value keep their old
-- lock, which was never the problem.
--
-- Settlement remains the true freeze. Once a cycle is settled the
-- rate is in the snapshot, credit notes may already quote it, and it
-- becomes history rather than a setting. Unsettle first if it really
-- must move.
--
-- Re-runnable.
-- ============================================================

CREATE OR REPLACE FUNCTION mudarabah_set_wht_rate(
  p_cycle_id UUID,
  p_rate     NUMERIC,
  p_reason   TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_old   NUMERIC;
  v_label TEXT;
BEGIN
  PERFORM mudarabah_assert_admin();

  IF p_rate IS NULL OR p_rate < 0 OR p_rate >= 1 THEN
    RAISE EXCEPTION 'The withholding rate must be a fraction of one — 0.10 for ten per cent. Got %', p_rate;
  END IF;

  SELECT cycle_label INTO v_label FROM cycles WHERE id = p_cycle_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cycle not found';
  END IF;

  -- Settlement is the freeze, not subscription close. A settled
  -- cycle's rate is in its snapshot and may already be quoted on an
  -- investor's credit note.
  IF EXISTS (
    SELECT 1 FROM mudarabah_settlements
    WHERE cycle_id = p_cycle_id AND is_current
  ) THEN
    RAISE EXCEPTION 'Cycle % is settled. Its withholding rate is part of the settlement snapshot and may already appear on issued credit notes — reopen the cycle first if it genuinely must change.', v_label;
  END IF;

  v_old := mudarabah_effective_wht_rate(p_cycle_id);

  UPDATE cycles SET wht_rate = p_rate, updated_at = NOW()
  WHERE id = p_cycle_id;

  PERFORM create_audit_log(
    'mudarabah_wht_rate_changed', 'cycle', p_cycle_id::TEXT,
    jsonb_build_object('wht_rate', v_old),
    jsonb_build_object(
      'wht_rate', p_rate,
      'reason', NULLIF(TRIM(COALESCE(p_reason, '')), '')
    )
  );

  RETURN jsonb_build_object('cycleId', p_cycle_id, 'from', v_old, 'to', p_rate);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION mudarabah_set_wht_rate(UUID, NUMERIC, TEXT) TO authenticated;
  END IF;
END $$;
