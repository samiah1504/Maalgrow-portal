-- ============================================================
-- Investor Chat — scenario tests (migration 016)
-- Run against a DB with migrations 001–016 applied.
-- ============================================================
\set ON_ERROR_STOP on

BEGIN;

INSERT INTO auth.users (id, email) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.com'),
  ('b0000000-0000-0000-0000-000000000001', 'manager@test.com'),
  ('10000000-0000-0000-0000-000000000001', 'c1@test.com'),
  ('10000000-0000-0000-0000-000000000002', 'c2@test.com');

INSERT INTO profiles (id, email, full_name, role) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'admin@test.com', 'Super Admin', 'super_admin'),
  ('b0000000-0000-0000-0000-000000000001', 'manager@test.com', 'Aishah Manager', 'customer_support'),
  ('10000000-0000-0000-0000-000000000001', 'c1@test.com', 'Chat One', 'investor'),
  ('10000000-0000-0000-0000-000000000002', 'c2@test.com', 'Chat Two', 'investor')
ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;

INSERT INTO investors (id, profile_id, investor_code, full_name, email) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'MG20001', 'Chat One', 'c1@test.com'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'MG20002', 'Chat Two', 'c2@test.com');

-- Scenario 1: investor starts a conversation → awaiting_admin,
-- staff notified, unassigned goes to the general queue
SET test.uid = '10000000-0000-0000-0000-000000000001';
DO $$
DECLARE r JSONB; c chat_conversations%ROWTYPE;
BEGIN
  r := chat_start_conversation('Payment Update', 'Salam, my payment has not reflected.');
  SELECT * INTO c FROM chat_conversations WHERE investor_id = '20000000-0000-0000-0000-000000000001';
  IF c.status <> 'awaiting_admin' OR c.admin_unread <> 1 OR c.assigned_manager_id IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL S1: conversation state wrong: % % %', c.status, c.admin_unread, c.assigned_manager_id;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE user_id = 'a0000000-0000-0000-0000-000000000001'
      AND title = 'New investor chat message'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S1: general-queue admins not notified';
  END IF;
  -- second message reuses the same active conversation
  r := chat_start_conversation('Payment Update', 'Following up please.');
  IF (SELECT COUNT(*) FROM chat_conversations WHERE investor_id = '20000000-0000-0000-0000-000000000001') <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S1: duplicate conversation created';
  END IF;
  RAISE NOTICE 'PASS S1: conversation created, routed to general queue, no duplicates';
END $$;

-- Scenario 2: investor cannot touch another investor's conversation
SET test.uid = '10000000-0000-0000-0000-000000000002';
DO $$
DECLARE v_conv UUID;
BEGIN
  SELECT id INTO v_conv FROM chat_conversations WHERE investor_id = '20000000-0000-0000-0000-000000000001';
  BEGIN
    PERFORM chat_send_message(v_conv, 'I should not be able to do this');
    RAISE EXCEPTION 'TEST FAIL S2: cross-investor message accepted';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%own conversation%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM chat_update_conversation(v_conv, 'resolve');
    RAISE EXCEPTION 'TEST FAIL S2: investor performed staff action';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%permission%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS S2: investors blocked from other conversations and staff actions';
END $$;

-- Scenario 3: manager replies → awaiting_investor, investor unread +
-- notification; internal note changes nothing investor-visible
SET test.uid = 'a0000000-0000-0000-0000-000000000001';
DO $$
DECLARE v_conv UUID; c chat_conversations%ROWTYPE;
BEGIN
  SELECT id INTO v_conv FROM chat_conversations WHERE investor_id = '20000000-0000-0000-0000-000000000001';

  PERFORM chat_update_conversation(v_conv, 'assign', 'b0000000-0000-0000-0000-000000000001', 'Payments specialist');
  PERFORM chat_send_message(v_conv, 'Wa alaykum salam, we are verifying your payment now.');
  SELECT * INTO c FROM chat_conversations WHERE id = v_conv;
  IF c.status <> 'awaiting_investor' OR c.investor_unread <> 1 OR c.first_admin_reply_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL S3: reply state wrong: % %', c.status, c.investor_unread;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM notifications
    WHERE user_id = '10000000-0000-0000-0000-000000000001'
      AND title = 'New reply from your Investor Manager'
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S3: investor not notified';
  END IF;

  PERFORM chat_send_message(v_conv, 'Internal: evidence forwarded to Finance.', NULL, NULL, NULL, NULL, TRUE);
  SELECT * INTO c FROM chat_conversations WHERE id = v_conv;
  IF c.investor_unread <> 1 OR c.status <> 'awaiting_investor' THEN
    RAISE EXCEPTION 'TEST FAIL S3: internal note affected investor-visible state';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'chat_internal_note') THEN
    RAISE EXCEPTION 'TEST FAIL S3: internal note not audited';
  END IF;
  RAISE NOTICE 'PASS S3: reply flow, assignment, internal note isolation all correct';
END $$;

-- Scenario 4: RLS hides internal notes from investors
DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM pg_policies
  WHERE tablename = 'chat_messages' AND policyname = 'Investors view own messages'
    AND qual LIKE '%is_internal_note = false%';
  IF n <> 1 THEN
    RAISE EXCEPTION 'TEST FAIL S4: investor message policy missing internal-note exclusion';
  END IF;
  RAISE NOTICE 'PASS S4: RLS excludes internal notes from investor reads';
END $$;

-- Scenario 5: mark-read clears only the caller's counter
SET test.uid = '10000000-0000-0000-0000-000000000001';
DO $$
DECLARE c chat_conversations%ROWTYPE;
BEGIN
  SELECT * INTO c FROM chat_conversations WHERE investor_id = '20000000-0000-0000-0000-000000000001';
  PERFORM chat_mark_read(c.id);
  SELECT * INTO c FROM chat_conversations WHERE id = c.id;
  IF c.investor_unread <> 0 OR c.admin_unread = 0 THEN
    RAISE EXCEPTION 'TEST FAIL S5: wrong counters after investor mark-read: % %', c.investor_unread, c.admin_unread;
  END IF;
  IF EXISTS (
    SELECT 1 FROM chat_messages
    WHERE conversation_id = c.id AND sender_type = 'admin'
      AND is_internal_note = FALSE AND read_at IS NULL
  ) THEN
    RAISE EXCEPTION 'TEST FAIL S5: admin messages not marked read';
  END IF;
  RAISE NOTICE 'PASS S5: per-side unread tracking correct';
END $$;

-- Scenario 6: resolve, then investor reply auto-reopens
SET test.uid = 'a0000000-0000-0000-0000-000000000001';
SELECT chat_update_conversation(
  (SELECT id FROM chat_conversations WHERE investor_id = '20000000-0000-0000-0000-000000000001'),
  'resolve');
SET test.uid = '10000000-0000-0000-0000-000000000001';
DO $$
DECLARE r JSONB; c chat_conversations%ROWTYPE;
BEGIN
  SELECT * INTO c FROM chat_conversations WHERE investor_id = '20000000-0000-0000-0000-000000000001';
  IF c.status <> 'resolved' OR c.resolved_at IS NULL THEN
    RAISE EXCEPTION 'TEST FAIL S6: resolve did not stick';
  END IF;
  r := chat_send_message(c.id, 'Actually, one more question please.');
  IF (r->>'reopened')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'TEST FAIL S6: reopen flag not returned';
  END IF;
  SELECT * INTO c FROM chat_conversations WHERE id = c.id;
  IF c.status <> 'awaiting_admin' OR c.resolved_at IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAIL S6: conversation not reopened: %', c.status;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM audit_logs WHERE action = 'chat_conversation_reopened') THEN
    RAISE EXCEPTION 'TEST FAIL S6: reopen not audited';
  END IF;
  RAISE NOTICE 'PASS S6: resolved conversation reopens on investor reply';
END $$;

-- Scenario 7: manager scoping — assigned staff can act, and a
-- non-admin staff member cannot touch someone else's assignment
SET test.uid = 'b0000000-0000-0000-0000-000000000001';
DO $$
DECLARE v_conv UUID;
BEGIN
  SELECT id INTO v_conv FROM chat_conversations WHERE investor_id = '20000000-0000-0000-0000-000000000001';
  PERFORM chat_send_message(v_conv, 'Aishah here — payment confirmed, thank you.');
  -- reassign away, then the same manager must be blocked
  SET LOCAL test.uid = 'a0000000-0000-0000-0000-000000000001';
  PERFORM chat_update_conversation(v_conv, 'assign', 'a0000000-0000-0000-0000-000000000001', 'take over');
  SET LOCAL test.uid = 'b0000000-0000-0000-0000-000000000001';
  BEGIN
    PERFORM chat_send_message(v_conv, 'I should be blocked now');
    RAISE EXCEPTION 'TEST FAIL S7: unassigned manager could still reply';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%assigned to another team member%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS S7: staff scoping enforced (assigned can act, others blocked)';
END $$;

-- Scenario 8: bulk manager assignment
SET test.uid = 'a0000000-0000-0000-0000-000000000001';
DO $$
DECLARE r JSONB;
BEGIN
  r := chat_bulk_assign_manager(
    ARRAY['20000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002']::uuid[],
    'b0000000-0000-0000-0000-000000000001');
  IF (r->>'updated')::int <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL S8: bulk assign updated %', r->>'updated';
  END IF;
  IF (SELECT COUNT(*) FROM investors WHERE assigned_manager_id = 'b0000000-0000-0000-0000-000000000001') <> 2 THEN
    RAISE EXCEPTION 'TEST FAIL S8: investor managers not set';
  END IF;
  IF (SELECT assigned_manager_id FROM chat_conversations
      WHERE investor_id = '20000000-0000-0000-0000-000000000001')
     <> 'b0000000-0000-0000-0000-000000000001' THEN
    RAISE EXCEPTION 'TEST FAIL S8: live conversation not repointed';
  END IF;
  -- investors cannot bulk assign
  SET LOCAL test.uid = '10000000-0000-0000-0000-000000000001';
  BEGIN
    PERFORM chat_bulk_assign_manager(ARRAY['20000000-0000-0000-0000-000000000001']::uuid[], NULL);
    RAISE EXCEPTION 'TEST FAIL S8: investor performed bulk assignment';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM NOT LIKE '%administrators%' THEN RAISE; END IF;
  END;
  RAISE NOTICE 'PASS S8: bulk manager assignment works and is admin-only';
END $$;

-- Scenario 9: quick replies seeded and settings row present
DO $$
BEGIN
  IF (SELECT COUNT(*) FROM chat_quick_replies WHERE active) < 8 THEN
    RAISE EXCEPTION 'TEST FAIL S9: quick replies not seeded';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM chat_settings) THEN
    RAISE EXCEPTION 'TEST FAIL S9: chat settings row missing';
  END IF;
  RAISE NOTICE 'PASS S9: quick replies + settings seeded';
END $$;

ROLLBACK;
\echo '=== ALL INVESTOR CHAT TESTS PASSED ==='
