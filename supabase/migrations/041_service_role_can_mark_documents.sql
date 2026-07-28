-- ============================================================
-- 041 — let the trusted server record what it has done
--
-- THE FAULT. Building a cycle's statements ran for minutes and saved
-- nothing. Every document rendered, every PDF uploaded, and then each
-- row stayed exactly as it was: "Queued — the build has not reached
-- this one yet", thirty-eight of them, attempt count zero. Pressing
-- the button again rebuilt the same five files, and again, and again.
--
-- The renderer runs on the server under the SERVICE-ROLE key, because
-- it has to write to a private storage bucket. A service-role
-- connection is not a logged-in person: auth.uid() is NULL and there
-- is no row for it in profiles. mudarabah_assert_admin() looked up
-- that row, found nothing, and raised — so mudarabah_mark_statement
-- refused every single call, and the state of the document was never
-- written down.
--
-- ── WHY THIS IS NOT A WEAKENING ──────────────────────────────
--
-- The gate never protected anything against this caller. Row-level
-- security does not apply to the service role at all: code holding
-- that key can already UPDATE mudarabah_statements — or any other
-- table — directly, without going near these functions. Refusing it
-- here bought no safety whatsoever. It only broke the one path that
-- legitimately runs there, and broke it silently.
--
-- What the gate DOES protect against is unchanged, and that is the
-- part that matters: an investor, a payment officer, a member of
-- support or finance, or anyone else holding an ordinary logged-in
-- session still cannot call any of these. They reach the database as
-- 'authenticated', not 'service_role', and fall through to exactly
-- the profiles check that was there before.
--
-- The key itself is server-only — SUPABASE_SERVICE_ROLE_KEY, never
-- NEXT_PUBLIC_, never sent to a browser. Nothing a visitor controls
-- can present it.
--
-- ── SCOPE ────────────────────────────────────────────────────
--
-- This is one function, and eighteen callers share it: the ledger
-- writes, credit-note issuance, settlement state, WHT remittances and
-- the statement document functions. All of them are already fully
-- open to a service-role connection through plain SQL. Fixing the
-- helper rather than the one function it broke means the next job
-- that runs on the server does not rediscover this the same way.
--
-- Re-runnable.
-- ============================================================

CREATE OR REPLACE FUNCTION mudarabah_assert_admin()
RETURNS VOID AS $$
DECLARE
  v_role TEXT;
BEGIN
  -- The server itself. It already has unrestricted access to every
  -- one of these tables; see the note above.
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN;
  END IF;

  SELECT role::TEXT INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
    RAISE EXCEPTION 'Only an administrator can change a Mudarabah ledger';
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
