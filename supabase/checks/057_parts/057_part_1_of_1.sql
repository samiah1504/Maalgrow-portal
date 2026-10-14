-- ============================================================
-- 057 — MaalRise: email a Cycle's investors at once (14 Oct 2026)
--
-- ONE PART for the Supabase SQL Editor: run once. Success = "057 applied".
-- APPLY ONLY AFTER supabase/checks/maalrise_057_preflight.sql reports
-- ready_to_apply = true. Then run supabase/checks/maalrise_057_postapply.sql.
-- To undo: supabase/checks/maalrise_057_rollback.sql.
--
-- maalrise_prepare_cycle_emails() prepares ONE email per investor in a
-- Cycle (with confirmed funding), as a draft in MaalRise Emails:
--
--   * someone who has never signed in → an INVITATION (the app adds a
--     "set your password" link when it is sent)
--   * someone who already has a login → a notification that they were
--     added to the Cycle, with their units and capital
--
-- Each investor gets at most one such email per Cycle, however often
-- it is pressed. Nothing is sent here: the drafts go out when a super
-- admin or administrator presses Send. MaalRise only; MaalGrow untouched.
-- ============================================================
BEGIN;

DO $$ BEGIN
  IF to_regprocedure('public.maalrise_approve_terms(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'STOP: run migration 056 first.';
  END IF;
  IF to_regprocedure('public.maalrise_prepare_cycle_emails(uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'STOP: 057 has already been applied. Do not run it again.';
  END IF;
END $$;

-- >>> 057 BODY START

CREATE OR REPLACE FUNCTION maalrise_prepare_cycle_emails(p_cycle UUID)
RETURNS JSONB AS $$
DECLARE
  v_cycle   maalrise_cycles%ROWTYPE;
  v_mat     DATE;
  r         RECORD;
  v_body    TEXT;
  v_pending INTEGER;
BEGIN
  IF NOT maalrise_can_approve() THEN RAISE EXCEPTION 'Unauthorized'; END IF;
  SELECT * INTO v_cycle FROM maalrise_cycles WHERE id = p_cycle;
  IF NOT FOUND THEN RAISE EXCEPTION 'Cycle not found'; END IF;
  IF v_cycle.status IN ('cancelled', 'closed') THEN RAISE EXCEPTION 'This Cycle is %', v_cycle.status; END IF;
  IF NOT EXISTS (SELECT 1 FROM maalrise_allocations WHERE cycle_id = p_cycle) THEN
    RAISE EXCEPTION 'No confirmed funding yet: confirm the investors'' funding first';
  END IF;
  v_mat := (v_cycle.start_date + make_interval(months => v_cycle.duration_months))::DATE;

  FOR r IN
    SELECT a.maalrise_investor_id AS inv, a.units, a.capital_kobo, i.full_name,
           (u.last_sign_in_at IS NULL) AS is_new
      FROM maalrise_allocations a
      JOIN maalrise_investors i ON i.id = a.maalrise_investor_id
      LEFT JOIN auth.users u ON u.id = i.profile_id
     WHERE a.cycle_id = p_cycle
  LOOP
    v_body := 'You have been added to the MaalRise Cycle ' || v_cycle.name || ' with ' || r.units || ' unit(s): capital of '
      || maalrise_naira(r.capital_kobo) || ', starting ' || to_char(v_cycle.start_date, 'DD Mon YYYY')
      || ' and maturing ' || to_char(v_mat, 'DD Mon YYYY') || '.';
    IF r.is_new THEN
      PERFORM maalrise_notify_investor(r.inv, 'cycle_invitation', 'Welcome to MaalRise',
        v_body || E'\n\nSet your password with the button below, then complete the KYC form when you first sign in. '
               || 'You will then see your expected profit and every payment made to you.',
        'cycle_welcome:' || p_cycle || ':' || r.inv, 'Welcome to MaalRise — ' || v_cycle.name);
    ELSE
      PERFORM maalrise_notify_investor(r.inv, 'cycle_added', 'Added to ' || v_cycle.name,
        v_body || E'\n\nSign in to MaalRise to see your expected profit for each month and every payment made to you.',
        'cycle_welcome:' || p_cycle || ':' || r.inv, 'MaalRise: you have been added to ' || v_cycle.name);
    END IF;
  END LOOP;

  SELECT COUNT(*) INTO v_pending FROM maalrise_investor_fundings WHERE cycle_id = p_cycle AND status = 'recorded';
  PERFORM create_audit_log('maalrise_prepare_cycle_emails', 'maalrise_cycle', p_cycle::TEXT, NULL, NULL);

  RETURN (
    SELECT jsonb_build_object(
      'to_send', COALESCE(jsonb_agg(o.id ORDER BY o.created_at) FILTER (WHERE o.status IN ('draft', 'failed')), '[]'::JSONB),
      'invitations', COUNT(*) FILTER (WHERE o.status IN ('draft', 'failed') AND o.kind = 'cycle_invitation'),
      'notifications', COUNT(*) FILTER (WHERE o.status IN ('draft', 'failed') AND o.kind = 'cycle_added'),
      'already_sent', COUNT(*) FILTER (WHERE o.status = 'sent'),
      'discarded', COUNT(*) FILTER (WHERE o.status = 'discarded'),
      'pending_funding', v_pending)
      FROM maalrise_email_outbox o
     WHERE o.dedupe_key LIKE 'cycle_welcome:' || p_cycle || ':%');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- <<< 057 BODY END

COMMIT;

SELECT '057 applied' AS result;
