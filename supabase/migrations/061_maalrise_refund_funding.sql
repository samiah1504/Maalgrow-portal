-- ============================================================
-- 061 — MaalRise: record a refund of an investor's funding (14 Oct 2026)
--
-- APPLY ONLY AFTER supabase/checks/maalrise_061_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_061_postapply.sql.
-- To undo: supabase/checks/maalrise_061_rollback.sql (refuses once a
-- refund has been recorded).
--
-- An investor who asked for their money back before the Cycle started
-- is taken out of it: their CONFIRMED funding entry is marked
-- "refunded" with the date the money went back, the bank reference and
-- the reason, and their units leave the Cycle's allocations. The entry
-- is kept (never deleted), so its reference stays used and a repeat
-- import does not bring them back.
--
-- Only before activation (draft, terms submitted or terms approved —
-- including a Cycle reopened under 060). Super admin and administrator.
-- The Cycle's cost is then corrected with a new terms version, or the
-- units taken up by others: a shortfall still blocks activation.
-- MaalRise only; MaalGrow untouched.
-- ============================================================
BEGIN;

ALTER TABLE maalrise_investor_fundings DROP CONSTRAINT maalrise_investor_fundings_status_check;
ALTER TABLE maalrise_investor_fundings ADD CONSTRAINT maalrise_investor_fundings_status_check
  CHECK (status IN ('recorded', 'confirmed', 'rejected', 'refunded'));
ALTER TABLE maalrise_investor_fundings
  ADD COLUMN refunded_by      UUID REFERENCES profiles(id),
  ADD COLUMN refunded_at      TIMESTAMPTZ,
  ADD COLUMN refunded_on      DATE,
  ADD COLUMN refund_reference TEXT,
  ADD COLUMN refund_reason    TEXT;
ALTER TABLE maalrise_investor_fundings ADD CONSTRAINT maalrise_fundings_refund_complete
  CHECK (status <> 'refunded' OR (refunded_by IS NOT NULL AND refunded_at IS NOT NULL AND refunded_on IS NOT NULL
                                  AND length(trim(refund_reference)) > 0 AND length(trim(refund_reason)) > 0));

CREATE OR REPLACE FUNCTION maalrise_refund_funding(p_funding UUID, p JSONB)
RETURNS VOID AS $$
DECLARE
  v_f      maalrise_investor_fundings%ROWTYPE;
  v_cycle  maalrise_cycles%ROWTYPE;
  v_on     DATE;
  v_ref    TEXT := NULLIF(trim(COALESCE(p->>'reference', '')), '');
  v_reason TEXT := NULLIF(trim(COALESCE(p->>'reason', '')), '');
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_f FROM maalrise_investor_fundings WHERE id = p_funding FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Funding not found'; END IF;
  IF v_f.status <> 'confirmed' THEN
    RAISE EXCEPTION 'Only confirmed funding can be refunded (this entry is %); reject an unconfirmed entry instead', v_f.status;
  END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = v_f.cycle_id FOR UPDATE;
  IF v_cycle.status NOT IN ('draft', 'terms_submitted', 'terms_approved') THEN
    RAISE EXCEPTION 'Refunds can be recorded only before the Cycle is activated (this one is %); reopen it first', v_cycle.status;
  END IF;
  BEGIN v_on := (p->>'refunded_on')::DATE;
  EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'The date of the refund is required'; END;
  IF v_on IS NULL THEN RAISE EXCEPTION 'The date of the refund is required'; END IF;
  IF v_on > maalrise_today() THEN RAISE EXCEPTION 'The refund cannot be dated in the future'; END IF;
  IF v_on < v_f.received_on THEN RAISE EXCEPTION 'The refund cannot be dated before the money was received'; END IF;
  IF v_ref IS NULL THEN RAISE EXCEPTION 'The bank reference of the refund is required'; END IF;
  IF v_reason IS NULL THEN RAISE EXCEPTION 'A reason is required'; END IF;

  UPDATE maalrise_investor_fundings
     SET status = 'refunded', refunded_by = auth.uid(), refunded_at = NOW(), refunded_on = v_on,
         refund_reference = v_ref, refund_reason = v_reason
   WHERE id = p_funding;

  -- Their units leave the Cycle; the allocation goes when nothing is left.
  UPDATE maalrise_allocations SET units = units - v_f.units, capital_kobo = capital_kobo - v_f.amount_kobo, updated_at = NOW()
   WHERE cycle_id = v_f.cycle_id AND maalrise_investor_id = v_f.maalrise_investor_id AND units > v_f.units;
  IF NOT FOUND THEN
    DELETE FROM maalrise_allocations
     WHERE cycle_id = v_f.cycle_id AND maalrise_investor_id = v_f.maalrise_investor_id AND units = v_f.units;
    IF NOT FOUND THEN RAISE EXCEPTION 'The investor''s allocation does not match this funding; nothing was changed'; END IF;
  END IF;

  PERFORM create_audit_log('maalrise_refund_funding', 'maalrise_investor_funding', p_funding::TEXT,
    jsonb_build_object('status', 'confirmed', 'units', v_f.units, 'amount_kobo', v_f.amount_kobo),
    jsonb_build_object('status', 'refunded', 'refunded_on', v_on, 'reference', v_ref, 'reason', v_reason));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMIT;
