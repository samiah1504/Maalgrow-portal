-- ============================================================
-- 045 — a temporary password, and a flag that expires it
--
-- WHY THIS IS NEEDED. An investor whose invitation link expired has an
-- account with no password. Supabase then answers every sign-in with
-- "Invalid login credentials", which the portal shows as "the email
-- address or password is incorrect" — so somebody who never had a
-- password is told theirs is wrong. Reset emails fix most of these,
-- but not the investor who cannot receive email, or is on a phone
-- where the link keeps expiring before they finish.
--
-- ── THE PART THAT WORRIES ME, WRITTEN DOWN ───────────────────
--
-- An administrator who knows an investor's password can sign in as
-- them. Everything that account then does is indistinguishable from
-- the investor doing it — including submitting a maturity instruction
-- that is final and moves capital. That is not a theoretical concern
-- in a portal where the whole audit story rests on "the investor
-- chose this".
--
-- So the password an administrator sets is TEMPORARY BY CONSTRUCTION,
-- not by good intentions:
--
--   must_change_password is set at the same moment, in the same
--   action, and the portal will not let the investor go anywhere
--   except the change-password screen until it is cleared. The
--   administrator's knowledge therefore lasts exactly one sign-in.
--
--   It is shown on screen ONCE and never emailed. Emailing a password
--   puts it permanently in two mailboxes and every server between
--   them; that rule has held everywhere else in this portal and it
--   holds here.
--
--   Every use is audit-logged with who did it and why, and the reason
--   is required.
--
-- WHAT IS DELIBERATELY NOT HERE. Any way to READ a password. There is
-- nothing to read — Supabase stores a hash, and this migration adds
-- no column that could hold one.
--
-- Re-runnable.
-- ============================================================

-- ------------------------------------------------------------
-- 1. The flag.
-- ------------------------------------------------------------
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS must_change_password    BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS password_set_by         UUID REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS password_set_at         TIMESTAMPTZ;

COMMENT ON COLUMN profiles.must_change_password IS
  'An administrator set a temporary password. The portal allows nothing but the change-password screen until the person clears it themselves.';

-- ------------------------------------------------------------
-- 2. Raise the flag.
--
--    Called by the server AFTER Supabase Auth has accepted the new
--    password — never before. Setting the flag for a password that
--    was not actually changed would lock somebody out of a portal
--    they could still get into.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION admin_flag_temporary_password(
  p_profile_id UUID,
  p_reason     TEXT
)
RETURNS VOID AS $$
DECLARE
  v_role TEXT;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    SELECT role::TEXT INTO v_role FROM profiles WHERE id = auth.uid();
    IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
      RAISE EXCEPTION 'Only an administrator can set a temporary password';
    END IF;
  END IF;

  IF COALESCE(btrim(p_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required for setting somebody else''s password';
  END IF;

  UPDATE profiles SET
    must_change_password = TRUE,
    password_set_by      = auth.uid(),
    password_set_at      = NOW(),
    updated_at           = NOW()
  WHERE id = p_profile_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such profile';
  END IF;

  PERFORM create_audit_log(
    'password_set_by_admin', 'profile', p_profile_id::TEXT, NULL,
    jsonb_build_object('reason', btrim(p_reason), 'temporary', TRUE)
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 3. Lower it — and ONLY for yourself.
--
--    No p_profile_id. The flag says "this person has not yet chosen
--    their own password", and only that person choosing one can make
--    it false. An administrator clearing it for somebody else would
--    quietly extend their own access.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION clear_my_password_change_flag()
RETURNS VOID AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not signed in';
  END IF;

  UPDATE profiles SET
    must_change_password = FALSE,
    updated_at           = NOW()
  WHERE id = auth.uid() AND must_change_password;

  IF FOUND THEN
    PERFORM create_audit_log(
      'temporary_password_replaced', 'profile', auth.uid()::TEXT, NULL,
      jsonb_build_object('by_owner', TRUE)
    );
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 4. Whether the portal should hold somebody at the door.
--
--    Read by the layouts on every request, so it is one indexed
--    lookup by primary key and nothing more.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION my_password_change_required()
RETURNS BOOLEAN AS $$
  SELECT COALESCE(must_change_password, FALSE)
  FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER;

-- ------------------------------------------------------------
-- 5. Who is currently holding a temporary password, for the admin.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION profiles_on_temporary_passwords()
RETURNS TABLE (
  profile_id   UUID,
  full_name    TEXT,
  email        TEXT,
  role         TEXT,
  set_at       TIMESTAMPTZ,
  set_by_name  TEXT
) AS $$
  SELECT p.id, p.full_name, p.email, p.role::TEXT, p.password_set_at, s.full_name
  FROM profiles p
  LEFT JOIN profiles s ON s.id = p.password_set_by
  WHERE p.must_change_password AND is_admin()
  ORDER BY p.password_set_at DESC NULLS LAST;
$$ LANGUAGE sql STABLE SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    -- The person themselves, on the change-password screen.
    GRANT EXECUTE ON FUNCTION clear_my_password_change_flag()  TO authenticated;
    GRANT EXECUTE ON FUNCTION my_password_change_required()    TO authenticated;
    GRANT EXECUTE ON FUNCTION profiles_on_temporary_passwords() TO authenticated;
    -- Server only: raised after Auth has accepted the new password.
    REVOKE EXECUTE ON FUNCTION admin_flag_temporary_password(UUID, TEXT)
      FROM anon, authenticated;
  END IF;
END $$;
