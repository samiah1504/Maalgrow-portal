-- ============================================================
-- Announcement scenarios — migration 028
--
-- The admin page was a mock: MOCK_ANNOUNCEMENTS in React
-- state, Publish pushing onto a local array. Nothing was ever
-- written, so no investor could ever have seen one.
--
--   A1-A4  sent to exactly the audience, unread, and counted
--   A5     audience 'all' reaches admins too
--   A6     withdrawing pulls it from every bell, and only it
--   A7     only an administrator can announce
--
-- Run against a DB with 001-028 applied.
-- ============================================================
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id,email) VALUES
 ('a0000000-0000-0000-0000-0000000000b1','ann@t.com'),
 ('10000000-0000-0000-0000-0000000000b1','ai1@t.com'),
 ('10000000-0000-0000-0000-0000000000b2','ai2@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id,email,full_name,role) VALUES
 ('a0000000-0000-0000-0000-0000000000b1','ann@t.com','Ann Admin','super_admin'),
 ('10000000-0000-0000-0000-0000000000b1','ai1@t.com','Inv One','investor'),
 ('10000000-0000-0000-0000-0000000000b2','ai2@t.com','Inv Two','investor')
ON CONFLICT (id) DO UPDATE SET role=EXCLUDED.role;

SELECT set_config('test.uid','a0000000-0000-0000-0000-0000000000b1',false);

DO $$ DECLARE v JSONB; v_id UUID; n INT; BEGIN
  v := broadcast_announcement('Cycle closing', 'Series B closes on 30 July.', 'investors');
  v_id := (v->>'id')::UUID;

  IF (v->>'recipients')::INT <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL A1: expected 2 investors, got %', v->>'recipients';
  END IF;

  SELECT COUNT(*) INTO n FROM notifications
   WHERE type='announcement' AND metadata->>'announcement_id' = v_id::TEXT;
  IF n <> 2 THEN RAISE EXCEPTION 'TEST FAIL A1: % notifications written, expected 2', n; END IF;

  -- the admin who sent it is NOT an investor, so must not be written to
  IF EXISTS (SELECT 1 FROM notifications WHERE user_id='a0000000-0000-0000-0000-0000000000b1'
             AND metadata->>'announcement_id' = v_id::TEXT) THEN
    RAISE EXCEPTION 'TEST FAIL A2: an investors-only announcement reached an admin';
  END IF;

  -- unread by default, which is what lights the bell
  IF EXISTS (SELECT 1 FROM notifications WHERE metadata->>'announcement_id'=v_id::TEXT AND is_read) THEN
    RAISE EXCEPTION 'TEST FAIL A3: announcements arrived already read';
  END IF;

  IF (SELECT recipient_count FROM announcements WHERE id=v_id) <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL A4: the record did not keep its reach';
  END IF;

  RAISE NOTICE 'PASS A1-A4: sent to exactly the audience, unread, and counted';
END $$;

DO $$ DECLARE v JSONB; BEGIN
  v := broadcast_announcement('Everyone', 'Maintenance tonight.', 'all');
  IF (v->>'recipients')::INT <> 3 THEN
    RAISE EXCEPTION 'TEST FAIL A5: audience all should reach 3, got %', v->>'recipients';
  END IF;
  RAISE NOTICE 'PASS A5: audience all reaches admins too';
END $$;

DO $$ DECLARE v_id UUID; v JSONB; BEGIN
  SELECT id INTO v_id FROM announcements WHERE title='Cycle closing';
  v := delete_announcement(v_id);
  IF (v->>'notificationsRemoved')::INT <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL A6: withdrawing left notifications behind: %', v;
  END IF;
  IF EXISTS (SELECT 1 FROM notifications WHERE metadata->>'announcement_id'=v_id::TEXT) THEN
    RAISE EXCEPTION 'TEST FAIL A6: notifications survived the withdrawal';
  END IF;
  -- and the OTHER announcement is untouched
  IF NOT EXISTS (SELECT 1 FROM notifications WHERE type='announcement') THEN
    RAISE EXCEPTION 'TEST FAIL A6: withdrawing one removed the others';
  END IF;
  RAISE NOTICE 'PASS A6: withdrawing pulls it from every bell, and only that one';
END $$;

DO $$ DECLARE v_ok BOOLEAN := FALSE; BEGIN
  PERFORM set_config('test.uid','10000000-0000-0000-0000-0000000000b1',false);
  BEGIN PERFORM broadcast_announcement('From an investor','Hello everyone','all');
  EXCEPTION WHEN OTHERS THEN v_ok := TRUE; END;
  IF NOT v_ok THEN RAISE EXCEPTION 'TEST FAIL A7: an investor broadcast to the whole portal'; END IF;
  RAISE NOTICE 'PASS A7: only an administrator can announce';
END $$;
ROLLBACK;
