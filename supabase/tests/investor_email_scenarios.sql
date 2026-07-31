-- ============================================================
-- Changing an investor's email address — migration 043
--
-- The address is in three places and they do different jobs: the
-- login, the profile, and where the statement is sent. Nothing kept
-- them in step, because handle_new_user() copies it in once at
-- creation and never again.
--
-- What these check is that the two DATABASE copies cannot come apart,
-- and that the failures happen BEFORE anything moves rather than
-- halfway through.
--
--   V1  an administrator moves both copies at once
--   V2  the previous address comes back, so Auth can be put back
--   V3  an address another investor uses is refused
--   V4  an address another account uses is refused
--   V5  nonsense is refused, and so is a blank
--   V6  the address is stored in lower case
--   V7  setting it to what it already is changes nothing
--   V8  finance cannot, and neither can support
--   V9  an investor certainly cannot
--   V10 the change is written to the audit log, both values
--
-- Run against a DB with 001–043 applied.
-- ============================================================
\set ON_ERROR_STOP on

DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE anon;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated, anon;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public, auth TO authenticated, anon;

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-0000000000d1', 'vadmin@test.com'),
  ('a0000000-0000-0000-0000-0000000000d2', 'vfinance@test.com'),
  ('10000000-0000-0000-0000-0000000000d1', 'old@test.com'),
  ('10000000-0000-0000-0000-0000000000d2', 'other@test.com')
ON CONFLICT (id) DO NOTHING;

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-0000000000d1', 'vadmin@test.com', 'V Admin', 'super_admin'),
  ('a0000000-0000-0000-0000-0000000000d2', 'vfinance@test.com', 'V Finance', 'finance'),
  ('10000000-0000-0000-0000-0000000000d1', 'old@test.com', 'V One', 'investor'),
  ('10000000-0000-0000-0000-0000000000d2', 'other@test.com', 'V Two', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role, email = EXCLUDED.email;

INSERT INTO investors (id, profile_id, investor_code, full_name, email) VALUES
  ('20000000-0000-0000-0000-0000000000d1', '10000000-0000-0000-0000-0000000000d1',
   'MGV0001', 'V One', 'old@test.com'),
  ('20000000-0000-0000-0000-0000000000d2', '10000000-0000-0000-0000-0000000000d2',
   'MGV0002', 'V Two', 'other@test.com')
ON CONFLICT (id) DO NOTHING;

SET LOCAL test.uid = 'a0000000-0000-0000-0000-0000000000d1';

-- ------------------------------------------------------------
-- V1 / V2 — both copies move, and the old one comes back
-- ------------------------------------------------------------
DO $$
DECLARE
  v_res  JSONB;
  v_inv  TEXT;
  v_prof TEXT;
BEGIN
  v_res := admin_set_investor_email(
    '20000000-0000-0000-0000-0000000000d1', 'new@test.com');

  SELECT email INTO v_inv  FROM investors WHERE id = '20000000-0000-0000-0000-0000000000d1';
  SELECT email INTO v_prof FROM profiles  WHERE id = '10000000-0000-0000-0000-0000000000d1';

  IF v_inv <> 'new@test.com' THEN
    RAISE EXCEPTION 'TEST FAIL V1: the investor record still reads %', v_inv;
  END IF;
  -- THE ONE THAT MATTERS. A change reaching one copy and not the
  -- other is how somebody ends up receiving their statement at an
  -- address they cannot log in with.
  IF v_prof <> 'new@test.com' THEN
    RAISE EXCEPTION 'TEST FAIL V1: the profile still reads % — the copies came apart', v_prof;
  END IF;

  IF (v_res->>'changed')::BOOLEAN IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL V1: the change was not reported — %', v_res::TEXT;
  END IF;
  -- Returned so the route can put it back when Supabase Auth refuses
  -- the new address. Without this there is no way back.
  IF v_res->>'old' <> 'old@test.com' THEN
    RAISE EXCEPTION 'TEST FAIL V2: the previous address was not returned — %', v_res::TEXT;
  END IF;

  RAISE NOTICE 'PASS V1/V2: both copies moved, and the old address came back';
END $$;

-- ------------------------------------------------------------
-- V3 / V4 — taken addresses are refused BEFORE anything moves
-- ------------------------------------------------------------
DO $$ DECLARE v_msg TEXT; v_inv TEXT; BEGIN
  BEGIN
    PERFORM admin_set_investor_email(
      '20000000-0000-0000-0000-0000000000d1', 'other@test.com');
    RAISE EXCEPTION 'TEST FAIL V3: an address another investor uses was accepted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%already uses%' THEN
    RAISE EXCEPTION 'TEST FAIL V3: refused for the wrong reason — %', v_msg;
  END IF;

  -- And nothing moved on the way to that refusal.
  SELECT email INTO v_inv FROM investors WHERE id = '20000000-0000-0000-0000-0000000000d1';
  IF v_inv <> 'new@test.com' THEN
    RAISE EXCEPTION 'TEST FAIL V3: the record was changed by a call that failed — %', v_inv;
  END IF;

  -- A staff account holds the address, but no investor does. Still
  -- refused: it is one login table underneath.
  BEGIN
    PERFORM admin_set_investor_email(
      '20000000-0000-0000-0000-0000000000d1', 'vfinance@test.com');
    RAISE EXCEPTION 'TEST FAIL V4: an address a staff account uses was accepted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%already uses%' THEN
    RAISE EXCEPTION 'TEST FAIL V4: refused for the wrong reason — %', v_msg;
  END IF;

  RAISE NOTICE 'PASS V3/V4: a taken address is refused, and nothing moves';
END $$;

-- ------------------------------------------------------------
-- V5 — and so is something that is not an address at all
-- ------------------------------------------------------------
DO $$ DECLARE v_msg TEXT; BEGIN
  BEGIN
    PERFORM admin_set_investor_email('20000000-0000-0000-0000-0000000000d1', 'not an email');
    RAISE EXCEPTION 'TEST FAIL V5: "not an email" was accepted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%not a valid email%' THEN
    RAISE EXCEPTION 'TEST FAIL V5: refused for the wrong reason — %', v_msg;
  END IF;

  BEGIN
    PERFORM admin_set_investor_email('20000000-0000-0000-0000-0000000000d1', '   ');
    RAISE EXCEPTION 'TEST FAIL V5: a blank was accepted';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%required%' THEN
    RAISE EXCEPTION 'TEST FAIL V5: a blank was refused for the wrong reason — %', v_msg;
  END IF;

  RAISE NOTICE 'PASS V5: nonsense and blanks are refused';
END $$;

-- ------------------------------------------------------------
-- V6 / V7 — case, and a change that is not one
-- ------------------------------------------------------------
DO $$ DECLARE v_res JSONB; v_inv TEXT; BEGIN
  PERFORM admin_set_investor_email(
    '20000000-0000-0000-0000-0000000000d1', '  Aisha.Bello@Example.COM ');
  SELECT email INTO v_inv FROM investors WHERE id = '20000000-0000-0000-0000-0000000000d1';
  IF v_inv <> 'aisha.bello@example.com' THEN
    RAISE EXCEPTION 'TEST FAIL V6: stored as % — case and spaces were not normalised', v_inv;
  END IF;

  -- The same mailbox in different case is NOT a change. Treating it
  -- as one would write an audit record and disturb the login for
  -- nothing.
  v_res := admin_set_investor_email(
    '20000000-0000-0000-0000-0000000000d1', 'AISHA.BELLO@EXAMPLE.COM');
  IF (v_res->>'changed')::BOOLEAN IS NOT FALSE THEN
    RAISE EXCEPTION 'TEST FAIL V7: the same address in another case counted as a change — %', v_res::TEXT;
  END IF;

  RAISE NOTICE 'PASS V6/V7: lower-cased, and the same address is not a change';
END $$;

-- ------------------------------------------------------------
-- V8 / V9 — who cannot
--
--     The investor edit screen is open to finance, operations and
--     support. Changing somebody's LOGIN is not the same kind of act
--     as correcting their phone number, and this is the check that
--     says so — the route checks it too, but this is the one a
--     script cannot go round.
-- ------------------------------------------------------------
DO $$ DECLARE v_msg TEXT; BEGIN
  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-0000000000d2', TRUE);
  BEGIN
    PERFORM admin_set_investor_email(
      '20000000-0000-0000-0000-0000000000d1', 'finance-tried@test.com');
    RAISE EXCEPTION 'TEST FAIL V8: finance changed an investor''s login';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%administrator%' THEN
    RAISE EXCEPTION 'TEST FAIL V8: refused for the wrong reason — %', v_msg;
  END IF;

  PERFORM set_config('test.uid', '10000000-0000-0000-0000-0000000000d2', TRUE);
  BEGIN
    PERFORM admin_set_investor_email(
      '20000000-0000-0000-0000-0000000000d1', 'investor-tried@test.com');
    RAISE EXCEPTION 'TEST FAIL V9: an investor changed somebody else''s login';
  EXCEPTION WHEN OTHERS THEN
    v_msg := SQLERRM;
    IF v_msg LIKE 'TEST FAIL%' THEN RAISE; END IF;
  END;
  IF v_msg NOT LIKE '%administrator%' THEN
    RAISE EXCEPTION 'TEST FAIL V9: refused for the wrong reason — %', v_msg;
  END IF;

  PERFORM set_config('test.uid', 'a0000000-0000-0000-0000-0000000000d1', TRUE);
  RAISE NOTICE 'PASS V8/V9: only an administrator can change a login';
END $$;

-- ------------------------------------------------------------
-- V10 — and it is written down, both values
-- ------------------------------------------------------------
DO $$ DECLARE v_n INT; BEGIN
  SELECT COUNT(*) INTO v_n FROM audit_logs
   WHERE action = 'investor_email_changed'
     AND entity_id = '20000000-0000-0000-0000-0000000000d1'
     AND old_values->>'email' = 'new@test.com'
     AND new_values->>'email' = 'aisha.bello@example.com';
  IF v_n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL V10: the change was not recorded with both values (% rows)', v_n;
  END IF;

  -- The refusals must not have left records of changes that did not
  -- happen.
  SELECT COUNT(*) INTO v_n FROM audit_logs
   WHERE action = 'investor_email_changed'
     AND new_values->>'email' IN ('other@test.com', 'not an email', 'finance-tried@test.com');
  IF v_n <> 0 THEN
    RAISE EXCEPTION 'TEST FAIL V10: a refused change was logged as though it happened';
  END IF;

  RAISE NOTICE 'PASS V10: the change is on the record, and the refusals are not';
END $$;

ROLLBACK;
\echo '=== ALL INVESTOR EMAIL TESTS PASSED ==='
