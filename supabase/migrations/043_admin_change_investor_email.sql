-- ============================================================
-- 043 — an administrator can correct an investor's email address
--
-- WHY THIS WAS NOT ALREADY POSSIBLE. An investor's email is in three
-- places, and they do different jobs:
--
--   auth.users.email   the LOGIN. Change it and they sign in with the
--                      new one; leave it and they cannot.
--   profiles.email     what the portal reads for the signed-in person.
--   investors.email    where their statement, their credit note and
--                      every campaign is SENT.
--
-- handle_new_user() copies the address into profiles when the account
-- is created and never again — it is an AFTER INSERT trigger, not an
-- update one. So there has never been anything keeping the three in
-- step, and the admin form quite reasonably refused to offer a field
-- that could only ever change one of them.
--
-- The failure that would cause is not obvious and not recoverable by
-- the investor: their statement arrives at the new address while the
-- login still wants the old one, or the reverse. Either way they call
-- and nobody can see why.
--
-- ── WHAT THIS FUNCTION IS FOR ────────────────────────────────
--
-- The two DATABASE copies, moved together in one statement so they
-- cannot end up disagreeing. auth.users is not touched here — that
-- belongs to Supabase Auth and is changed through its admin API by
-- the route, which calls this first and reverts it if the auth change
-- then fails. The old address is returned for exactly that purpose.
--
-- ── WHO ──────────────────────────────────────────────────────
--
-- super_admin and administrator only. The investor edit screen is
-- open to finance, operations and support as well, and changing
-- somebody's login is not the same kind of act as correcting their
-- phone number. The service role passes because the route runs there
-- after checking the human's role itself.
--
-- Re-runnable.
-- ============================================================

CREATE OR REPLACE FUNCTION admin_set_investor_email(
  p_investor_id UUID,
  p_email       TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_role      TEXT;
  v_new       TEXT;
  v_old       TEXT;
  v_profile   UUID;
BEGIN
  -- Not mudarabah_assert_admin(): same list, but its message talks
  -- about ledgers and would be nonsense on this screen.
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    SELECT role::TEXT INTO v_role FROM profiles WHERE id = auth.uid();
    IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
      RAISE EXCEPTION 'Only an administrator can change an investor''s email address';
    END IF;
  END IF;

  -- Addresses are compared and stored in lower case. "Aisha@" and
  -- "aisha@" are one mailbox, and treating them as two is how a
  -- UNIQUE index lets the same person in twice.
  v_new := lower(btrim(COALESCE(p_email, '')));

  IF v_new = '' THEN
    RAISE EXCEPTION 'An email address is required';
  END IF;
  -- Deliberately loose. The address has to be deliverable, and the
  -- only real test of that is sending to it; this catches the typo
  -- that is obviously not an address at all.
  IF v_new !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'That is not a valid email address: %', v_new;
  END IF;

  SELECT email, profile_id INTO v_old, v_profile
  FROM investors WHERE id = p_investor_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such investor';
  END IF;

  IF lower(btrim(COALESCE(v_old, ''))) = v_new THEN
    RETURN jsonb_build_object('changed', FALSE, 'old', v_old, 'new', v_new);
  END IF;

  -- Checked before anything moves, so the failure is a clear message
  -- rather than a constraint violation halfway through.
  IF EXISTS (
    SELECT 1 FROM investors
     WHERE lower(email) = v_new AND id <> p_investor_id
  ) THEN
    RAISE EXCEPTION 'Another investor already uses %', v_new;
  END IF;
  IF EXISTS (
    SELECT 1 FROM profiles
     WHERE lower(email) = v_new AND id IS DISTINCT FROM v_profile
  ) THEN
    RAISE EXCEPTION 'Another account already uses %', v_new;
  END IF;

  -- BOTH, in one statement each, inside one transaction. This is the
  -- whole point of doing it here rather than as two calls from the
  -- application.
  UPDATE investors SET email = v_new, updated_at = NOW()
   WHERE id = p_investor_id;

  IF v_profile IS NOT NULL THEN
    UPDATE profiles SET email = v_new, updated_at = NOW()
     WHERE id = v_profile;
  END IF;

  PERFORM create_audit_log(
    'investor_email_changed', 'investor', p_investor_id::TEXT,
    jsonb_build_object('email', v_old),
    jsonb_build_object('email', v_new)
  );

  -- The old address goes back to the caller so it can put things
  -- back if the Auth side then refuses.
  RETURN jsonb_build_object('changed', TRUE, 'old', v_old, 'new', v_new);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    -- Reached through the admin route, which checks the acting user
    -- first. Never callable straight from a browser session.
    REVOKE EXECUTE ON FUNCTION admin_set_investor_email(UUID, TEXT) FROM anon, authenticated;
  END IF;
END $$;
