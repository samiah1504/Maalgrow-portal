-- ============================================================
-- A temporary password — migration 045
--
-- The feature is an administrator setting somebody else's password.
-- What makes that acceptable is not that we mean well, it is that the
-- knowledge EXPIRES: the flag goes up in the same action, the portal
-- allows nothing but the change screen while it is up, and only the
-- owner can take it down.
--
-- These check the parts of that which live in the database, and in
-- particular the one that would quietly undo the whole thing — an
-- administrator being able to clear the flag for somebody else, which
-- would extend their own access indefinitely.
--
--   P1  setting it raises the flag and records who and why
--   P2  a reason is required
--   P3  finance and support cannot do it
--   P4  an investor certainly cannot
--   P5  the owner clears it by changing their password
--   P6  AN ADMINISTRATOR CANNOT CLEAR IT FOR SOMEBODY ELSE
--   P7  clearing is recorded too
--   P8  the flag is what the portal reads to hold them at the door
--   P9  the admin list shows who is currently on one
-- ============================================================
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-00000000ca01', 'pwadmin@test.com'),
  ('a0000000-0000-0000-0000-00000000ca02', 'pwfinance@test.com'),
  ('10000000-0000-0000-0000-00000000ca01', 'lockedout@test.com'),
  ('10000000-0000-0000-0000-00000000ca02', 'other@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-00000000ca01', 'pwadmin@test.com', 'PW Admin', 'super_admin'),
  ('a0000000-0000-0000-0000-00000000ca02', 'pwfinance@test.com', 'PW Finance', 'finance'),
  ('10000000-0000-0000-0000-00000000ca01', 'lockedout@test.com', 'Locked Out', 'investor'),
  ('10000000-0000-0000-0000-00000000ca02', 'other@test.com', 'Other One', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

SET LOCAL test.uid = 'a0000000-0000-0000-0000-00000000ca01';

-- ------------------------------------------------------------
-- P1 / P2 — raising it
-- ------------------------------------------------------------
DO $$ DECLARE r profiles%ROWTYPE; v_msg TEXT; BEGIN
  PERFORM admin_flag_temporary_password(
    '10000000-0000-0000-0000-00000000ca01',
    'Reset emails are not reaching her — read out over the phone');

  SELECT * INTO r FROM profiles WHERE id = '10000000-0000-0000-0000-00000000ca01';
  IF NOT r.must_change_password THEN
    RAISE EXCEPTION 'TEST FAIL P1: the flag was not raised';
  END IF;
  IF r.password_set_by <> 'a0000000-0000-0000-0000-00000000ca01' THEN
    RAISE EXCEPTION 'TEST FAIL P1: who did it was not recorded — %', r.password_set_by;
  END IF;
  IF r.password_set_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL P1: when was not recorded';
  END IF;

  -- P2. Without a reason there is no record worth having.
  BEGIN
    PERFORM admin_flag_temporary_password('10000000-0000-0000-0000-00000000ca02', '   ');
    RAISE EXCEPTION 'TEST FAIL P2: a blank reason was accepted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%reason is required%' THEN
    RAISE EXCEPTION 'TEST FAIL P2: refused for the wrong reason — %', v_msg;
  END IF;

  RAISE NOTICE 'PASS P1/P2: raised, attributed, and refused without a reason';
END $$;

-- ------------------------------------------------------------
-- P3 / P4 — who cannot
-- ------------------------------------------------------------
DO $$ DECLARE v_msg TEXT; BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000ca02', TRUE);
  BEGIN
    PERFORM admin_flag_temporary_password(
      '10000000-0000-0000-0000-00000000ca02', 'finance trying it on');
    RAISE EXCEPTION 'TEST FAIL P3: finance set somebody''s password';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%administrator%' THEN
    RAISE EXCEPTION 'TEST FAIL P3: refused for the wrong reason — %', v_msg;
  END IF;

  PERFORM set_config('test.uid', '10000000-0000-0000-0000-00000000ca02', TRUE);
  BEGIN
    PERFORM admin_flag_temporary_password(
      '10000000-0000-0000-0000-00000000ca01', 'investor trying it on');
    RAISE EXCEPTION 'TEST FAIL P4: an investor set somebody else''s password';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;

  RAISE NOTICE 'PASS P3/P4: only an administrator';
END $$;

-- ------------------------------------------------------------
-- P6 — THE ONE THAT MATTERS
--
--     An administrator clearing the flag for somebody else would
--     leave them holding a password nobody is required to replace —
--     which is precisely the indefinite access the flag exists to
--     prevent. clear_my_password_change_flag takes no argument at
--     all, so there is nothing to aim at somebody else.
-- ------------------------------------------------------------
DO $$ DECLARE r profiles%ROWTYPE; BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000ca01', TRUE);

  -- The administrator calls it. It can only ever act on the caller,
  -- so the investor's flag must be untouched.
  PERFORM clear_my_password_change_flag();

  SELECT * INTO r FROM profiles WHERE id = '10000000-0000-0000-0000-00000000ca01';
  IF NOT r.must_change_password THEN
    RAISE EXCEPTION 'TEST FAIL P6: an administrator cleared somebody else''s flag';
  END IF;

  RAISE NOTICE 'PASS P6: the flag can only be cleared by the person holding it';
END $$;

-- ------------------------------------------------------------
-- P8 — what the portal reads
-- ------------------------------------------------------------
DO $$ BEGIN
  PERFORM set_config('test.uid', '10000000-0000-0000-0000-00000000ca01', TRUE);
  IF NOT my_password_change_required() THEN
    RAISE EXCEPTION 'TEST FAIL P8: the portal would let her straight in';
  END IF;

  PERFORM set_config('test.uid', '10000000-0000-0000-0000-00000000ca02', TRUE);
  IF my_password_change_required() THEN
    RAISE EXCEPTION 'TEST FAIL P8: somebody unaffected is being held at the door';
  END IF;

  RAISE NOTICE 'PASS P8: held only where the flag is up';
END $$;

-- ------------------------------------------------------------
-- P9 — who is on one, before P5 clears it
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-00000000ca01', TRUE);
  SELECT COUNT(*) INTO v_n FROM profiles_on_temporary_passwords()
   WHERE email = 'lockedout@test.com';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL P9: she is not on the temporary-password list';
  END IF;
  RAISE NOTICE 'PASS P9: the administrator can see who is on one';
END $$;

-- ------------------------------------------------------------
-- P5 / P7 — the owner clears it, and that is recorded
-- ------------------------------------------------------------
DO $$ DECLARE r profiles%ROWTYPE; v_n INT; BEGIN
  PERFORM set_config('test.uid', '10000000-0000-0000-0000-00000000ca01', TRUE);
  PERFORM clear_my_password_change_flag();

  SELECT * INTO r FROM profiles WHERE id = '10000000-0000-0000-0000-00000000ca01';
  IF r.must_change_password THEN
    RAISE EXCEPTION 'TEST FAIL P5: she could not clear her own flag';
  END IF;

  SELECT COUNT(*) INTO v_n FROM audit_logs
   WHERE action = 'temporary_password_replaced'
     AND entity_id = '10000000-0000-0000-0000-00000000ca01';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL P7: replacing it was not recorded (% rows)', v_n;
  END IF;

  -- And the original act is still on the record, with its reason.
  SELECT COUNT(*) INTO v_n FROM audit_logs
   WHERE action = 'password_set_by_admin'
     AND entity_id = '10000000-0000-0000-0000-00000000ca01'
     AND new_values->>'reason' LIKE '%not reaching her%';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL P7: the reason was not kept';
  END IF;

  RAISE NOTICE 'PASS P5/P7: she replaced it, and both acts are on the record';
END $$;

ROLLBACK;
\echo '=== ALL TEMPORARY PASSWORD TESTS PASSED ==='
