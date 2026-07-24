-- ============================================================
-- Migration 016 – Chat With Your Investor Manager
--
-- In-portal support chat between each investor and MaalGrow staff.
-- Strictly one-to-team: investors can never see or reach other
-- investors. All writes go through SECURITY DEFINER functions; RLS
-- allows only scoped reads (which also scopes Supabase Realtime).
--
--   • investors.assigned_manager_id — default Investor Manager
--   • chat_conversations — one active thread per investor at a time
--   • chat_messages — texts, attachments, internal notes
--   • chat_assignments — transfer history
--   • chat_quick_replies — approved reply templates (seeded)
--   • chat_settings — support-hours notice (single row)
--
-- Attachments live in the PRIVATE storage bucket 'chat-attachments',
-- accessed only via the service role + short-lived signed URLs.
--
-- Apply AFTER migration 015.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Default Investor Manager on the investor record
-- ------------------------------------------------------------
ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS assigned_manager_id UUID REFERENCES profiles(id);

-- ------------------------------------------------------------
-- 2. Tables
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS chat_conversations (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  investor_id              UUID NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  assigned_manager_id      UUID REFERENCES profiles(id),
  category                 TEXT NOT NULL DEFAULT 'General Enquiry',
  related_series_id        UUID REFERENCES series(id),
  related_cycle_id         UUID REFERENCES cycles(id),
  status                   TEXT NOT NULL DEFAULT 'awaiting_admin'
    CHECK (status IN ('open', 'awaiting_admin', 'awaiting_investor', 'resolved', 'archived')),
  priority                 TEXT NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('normal', 'high')),
  -- Unread counters per side (maintained transactionally in the RPCs)
  investor_unread          INTEGER NOT NULL DEFAULT 0,
  admin_unread             INTEGER NOT NULL DEFAULT 0,
  last_message_at          TIMESTAMPTZ,
  last_investor_message_at TIMESTAMPTZ,
  last_admin_message_at    TIMESTAMPTZ,
  first_admin_reply_at     TIMESTAMPTZ,
  resolved_at              TIMESTAMPTZ,
  resolved_by              UUID REFERENCES profiles(id),
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_conversations_investor
  ON chat_conversations(investor_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_manager
  ON chat_conversations(assigned_manager_id);
CREATE INDEX IF NOT EXISTS idx_chat_conversations_last_message
  ON chat_conversations(last_message_at DESC);

-- One live (non-archived) conversation per investor at a time
CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_conversations_active
  ON chat_conversations(investor_id)
  WHERE status <> 'archived';

CREATE TABLE IF NOT EXISTS chat_messages (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id      UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  sender_id            UUID NOT NULL REFERENCES profiles(id),
  sender_type          TEXT NOT NULL CHECK (sender_type IN ('investor', 'admin')),
  body                 TEXT,
  attachment_path      TEXT,
  attachment_name      TEXT,
  attachment_mime      TEXT,
  attachment_size      INTEGER,
  is_internal_note     BOOLEAN NOT NULL DEFAULT FALSE,
  read_at              TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (body IS NOT NULL OR attachment_path IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
  ON chat_messages(conversation_id, created_at);

CREATE TABLE IF NOT EXISTS chat_assignments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
  assigned_from   UUID REFERENCES profiles(id),
  assigned_to     UUID REFERENCES profiles(id),
  assigned_by     UUID REFERENCES profiles(id),
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_quick_replies (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  category   TEXT,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS chat_settings (
  id             BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  support_notice TEXT NOT NULL DEFAULT
    'Our Investor Managers are available Monday to Friday, 9:00 AM to 5:00 PM. Messages sent outside these hours will be attended to on the next working day.',
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO chat_settings (id) VALUES (TRUE) ON CONFLICT DO NOTHING;

-- Seed approved quick replies (idempotent)
INSERT INTO chat_quick_replies (title, message)
SELECT * FROM (VALUES
  ('Message received', 'We have received your message and are reviewing it. We will get back to you shortly, in shaa Allah.'),
  ('Payment being verified', 'Your payment is currently being verified. We will confirm as soon as it reflects.'),
  ('Payment reflected', 'Your payment has now reflected on your portal. Kindly log in to review your investment summary.'),
  ('KYC fields missing', 'Please complete the missing KYC fields on your profile so we can finalise your verification.'),
  ('Profit published', 'Your profit has been published. Kindly review your dashboard for the details.'),
  ('Maturity instruction', 'Please submit your maturity instruction from the portal so we can process your preference before the deadline.'),
  ('Details updated', 'We have updated your registered information as requested.'),
  ('Check invitation email', 'Please check the email registered on your account for the portal invitation link.')
) AS v(title, message)
WHERE NOT EXISTS (SELECT 1 FROM chat_quick_replies);

-- ------------------------------------------------------------
-- 3. Private storage bucket (skipped gracefully outside Supabase)
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('chat-attachments', 'chat-attachments', FALSE)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 4. Row Level Security
--    All writes go through the SECURITY DEFINER functions below;
--    these policies scope READS (and therefore Realtime).
-- ------------------------------------------------------------
ALTER TABLE chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_assignments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_quick_replies ENABLE ROW LEVEL SECURITY;
ALTER TABLE chat_settings      ENABLE ROW LEVEL SECURITY;

-- Staff scoping: super_admin + administrator see everything;
-- other staff roles see their own assignments and the unassigned queue.
CREATE OR REPLACE FUNCTION chat_staff_can_access(p_conversation chat_conversations)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles p
    WHERE p.id = auth.uid()
      AND (
        p.role IN ('super_admin', 'administrator')
        OR (
          p.role IN ('finance', 'operations', 'customer_support')
          AND (p_conversation.assigned_manager_id = auth.uid()
               OR p_conversation.assigned_manager_id IS NULL)
        )
      )
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

DO $$ BEGIN
  CREATE POLICY "Investors view own conversations"
    ON chat_conversations FOR SELECT
    USING (investor_id IN (SELECT id FROM investors WHERE profile_id = auth.uid()));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff view authorised conversations"
    ON chat_conversations FOR SELECT
    USING (chat_staff_can_access(chat_conversations.*));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Investors never see internal notes — enforced at the database level
DO $$ BEGIN
  CREATE POLICY "Investors view own messages"
    ON chat_messages FOR SELECT
    USING (
      is_internal_note = FALSE
      AND conversation_id IN (
        SELECT c.id FROM chat_conversations c
        JOIN investors i ON i.id = c.investor_id
        WHERE i.profile_id = auth.uid()
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff view authorised messages"
    ON chat_messages FOR SELECT
    USING (
      conversation_id IN (
        SELECT c.id FROM chat_conversations c WHERE chat_staff_can_access(c.*)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff view assignments"
    ON chat_assignments FOR SELECT
    USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Staff view quick replies"
    ON chat_quick_replies FOR SELECT
    USING (is_admin());
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE POLICY "Anyone reads chat settings"
    ON chat_settings FOR SELECT
    USING (TRUE);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ------------------------------------------------------------
-- 5. Realtime (skipped gracefully outside Supabase)
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_messages;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE chat_conversations;
    EXCEPTION WHEN duplicate_object THEN NULL; END;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 6. Helpers
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION chat_caller_investor()
RETURNS investors AS $$
DECLARE v investors%ROWTYPE;
BEGIN
  SELECT * INTO v FROM investors WHERE profile_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No investor account is linked to this login';
  END IF;
  RETURN v;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

CREATE OR REPLACE FUNCTION chat_caller_staff_role()
RETURNS TEXT AS $$
DECLARE v_role TEXT;
BEGIN
  SELECT role::text INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN
     ('super_admin', 'administrator', 'finance', 'operations', 'customer_support') THEN
    RAISE EXCEPTION 'You do not have permission to manage investor chats';
  END IF;
  RETURN v_role;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER STABLE;

-- Notify all senior admins + the assigned manager about investor activity
CREATE OR REPLACE FUNCTION chat_notify_staff(
  p_conv chat_conversations, p_title TEXT, p_message TEXT
)
RETURNS VOID AS $$
BEGIN
  INSERT INTO notifications (user_id, title, message, type, action_url)
  SELECT DISTINCT p.id, p_title, p_message, 'system'::notification_type,
         '/admin/chats/' || p_conv.id
  FROM profiles p
  WHERE p.is_active = TRUE
    AND (
      p.id = p_conv.assigned_manager_id
      OR (p_conv.assigned_manager_id IS NULL AND p.role IN ('super_admin', 'administrator'))
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 7. chat_start_conversation — investor opens (or reuses) their
--    active thread and sends the first message.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION chat_start_conversation(
  p_category          TEXT,
  p_body              TEXT,
  p_related_series_id UUID DEFAULT NULL,
  p_related_cycle_id  UUID DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_inv  investors%ROWTYPE;
  v_conv chat_conversations%ROWTYPE;
BEGIN
  v_inv := chat_caller_investor();

  IF COALESCE(TRIM(p_body), '') = '' THEN
    RAISE EXCEPTION 'Please type a message';
  END IF;

  SELECT * INTO v_conv FROM chat_conversations
  WHERE investor_id = v_inv.id AND status <> 'archived'
  FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO chat_conversations (
      investor_id, assigned_manager_id, category,
      related_series_id, related_cycle_id, status
    ) VALUES (
      v_inv.id, v_inv.assigned_manager_id, COALESCE(NULLIF(TRIM(p_category), ''), 'General Enquiry'),
      p_related_series_id, p_related_cycle_id, 'awaiting_admin'
    ) RETURNING * INTO v_conv;

    PERFORM create_audit_log(
      'chat_conversation_created', 'chat_conversation', v_conv.id::text,
      NULL, jsonb_build_object('investor_id', v_inv.id, 'category', v_conv.category)
    );
  END IF;

  RETURN chat_send_message(v_conv.id, p_body, NULL, NULL, NULL, NULL, FALSE);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 8. chat_send_message — both sides send through here.
--    Handles membership checks, status transitions, unread
--    counters, reopen-on-investor-reply, notifications, audit.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION chat_send_message(
  p_conversation_id UUID,
  p_body            TEXT,
  p_attachment_path TEXT DEFAULT NULL,
  p_attachment_name TEXT DEFAULT NULL,
  p_attachment_mime TEXT DEFAULT NULL,
  p_attachment_size INTEGER DEFAULT NULL,
  p_internal_note   BOOLEAN DEFAULT FALSE
)
RETURNS JSONB AS $$
DECLARE
  v_uid      UUID := auth.uid();
  v_conv     chat_conversations%ROWTYPE;
  v_inv      investors%ROWTYPE;
  v_is_staff BOOLEAN := FALSE;
  v_role     TEXT;
  v_msg      chat_messages%ROWTYPE;
  v_reopened BOOLEAN := FALSE;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  SELECT * INTO v_conv FROM chat_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;

  SELECT role::text INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IN ('super_admin', 'administrator', 'finance', 'operations', 'customer_support') THEN
    v_is_staff := TRUE;
    IF v_role NOT IN ('super_admin', 'administrator')
       AND v_conv.assigned_manager_id IS NOT NULL
       AND v_conv.assigned_manager_id <> v_uid THEN
      RAISE EXCEPTION 'This conversation is assigned to another team member';
    END IF;
  ELSE
    SELECT * INTO v_inv FROM investors WHERE id = v_conv.investor_id;
    IF v_inv.profile_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'You can only send messages in your own conversation';
    END IF;
    IF p_internal_note THEN
      RAISE EXCEPTION 'Internal notes are staff-only';
    END IF;
  END IF;

  IF COALESCE(TRIM(p_body), '') = '' AND p_attachment_path IS NULL THEN
    RAISE EXCEPTION 'Please type a message';
  END IF;
  IF v_conv.status = 'archived' THEN
    RAISE EXCEPTION 'This conversation has been archived';
  END IF;

  INSERT INTO chat_messages (
    conversation_id, sender_id, sender_type, body,
    attachment_path, attachment_name, attachment_mime, attachment_size,
    is_internal_note
  ) VALUES (
    p_conversation_id, v_uid,
    CASE WHEN v_is_staff THEN 'admin' ELSE 'investor' END,
    NULLIF(TRIM(COALESCE(p_body, '')), ''),
    p_attachment_path, p_attachment_name, p_attachment_mime, p_attachment_size,
    v_is_staff AND p_internal_note
  ) RETURNING * INTO v_msg;

  IF v_is_staff AND p_internal_note THEN
    -- Internal note: invisible to the investor, no status change
    UPDATE chat_conversations SET updated_at = NOW() WHERE id = p_conversation_id;
    PERFORM create_audit_log(
      'chat_internal_note', 'chat_conversation', p_conversation_id::text,
      NULL, jsonb_build_object('message_id', v_msg.id)
    );
  ELSIF v_is_staff THEN
    UPDATE chat_conversations SET
      status               = 'awaiting_investor',
      investor_unread      = investor_unread + 1,
      last_message_at      = NOW(),
      last_admin_message_at = NOW(),
      first_admin_reply_at = COALESCE(first_admin_reply_at, NOW()),
      updated_at           = NOW()
    WHERE id = p_conversation_id;

    SELECT * INTO v_inv FROM investors WHERE id = v_conv.investor_id;
    INSERT INTO notifications (user_id, title, message, type, action_url)
    VALUES (
      v_inv.profile_id,
      'New reply from your Investor Manager',
      'You have received a new response in your MaalGrow support chat.',
      'system', '/chat'
    );
    PERFORM create_audit_log(
      'chat_message_sent', 'chat_conversation', p_conversation_id::text,
      NULL, jsonb_build_object('message_id', v_msg.id, 'sender', 'admin',
                               'has_attachment', p_attachment_path IS NOT NULL)
    );
  ELSE
    v_reopened := v_conv.status = 'resolved';
    UPDATE chat_conversations SET
      status                   = 'awaiting_admin',
      admin_unread             = admin_unread + 1,
      last_message_at          = NOW(),
      last_investor_message_at = NOW(),
      resolved_at              = CASE WHEN v_conv.status = 'resolved' THEN NULL ELSE resolved_at END,
      resolved_by              = CASE WHEN v_conv.status = 'resolved' THEN NULL ELSE resolved_by END,
      updated_at               = NOW()
    WHERE id = p_conversation_id;

    PERFORM chat_notify_staff(
      v_conv,
      CASE WHEN v_reopened THEN 'Chat reopened by investor' ELSE 'New investor chat message' END,
      v_inv.full_name || ' (' || v_inv.investor_code || ') sent a new message.'
    );
    PERFORM create_audit_log(
      'chat_message_sent', 'chat_conversation', p_conversation_id::text,
      NULL, jsonb_build_object('message_id', v_msg.id, 'sender', 'investor',
                               'has_attachment', p_attachment_path IS NOT NULL,
                               'reopened', v_reopened)
    );
    IF v_reopened THEN
      PERFORM create_audit_log(
        'chat_conversation_reopened', 'chat_conversation', p_conversation_id::text,
        jsonb_build_object('status', 'resolved'), jsonb_build_object('status', 'awaiting_admin')
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'message_id', v_msg.id,
    'conversation_id', p_conversation_id,
    'created_at', v_msg.created_at,
    'reopened', v_reopened
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 9. chat_mark_read — marks the OTHER side's messages read for
--    the caller and clears the caller's unread counter only.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION chat_mark_read(p_conversation_id UUID)
RETURNS VOID AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_conv chat_conversations%ROWTYPE;
  v_role TEXT;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT * INTO v_conv FROM chat_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;

  SELECT role::text INTO v_role FROM profiles WHERE id = v_uid;

  IF v_role IN ('super_admin', 'administrator', 'finance', 'operations', 'customer_support') THEN
    UPDATE chat_messages SET read_at = NOW()
    WHERE conversation_id = p_conversation_id
      AND sender_type = 'investor' AND read_at IS NULL;
    UPDATE chat_conversations SET admin_unread = 0 WHERE id = p_conversation_id;
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM investors
      WHERE id = v_conv.investor_id AND profile_id = v_uid
    ) THEN
      RAISE EXCEPTION 'Not your conversation';
    END IF;
    UPDATE chat_messages SET read_at = NOW()
    WHERE conversation_id = p_conversation_id
      AND sender_type = 'admin' AND is_internal_note = FALSE AND read_at IS NULL;
    UPDATE chat_conversations SET investor_unread = 0 WHERE id = p_conversation_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 10. chat_update_conversation — staff actions: assign, priority,
--     resolve, reopen, archive. Assignment history + audit logged.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION chat_update_conversation(
  p_conversation_id UUID,
  p_action          TEXT,
  p_manager_id      UUID DEFAULT NULL,
  p_reason          TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_uid  UUID := auth.uid();
  v_role TEXT;
  v_conv chat_conversations%ROWTYPE;
BEGIN
  v_role := chat_caller_staff_role();

  SELECT * INTO v_conv FROM chat_conversations WHERE id = p_conversation_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Conversation not found'; END IF;

  IF v_role NOT IN ('super_admin', 'administrator')
     AND v_conv.assigned_manager_id IS NOT NULL
     AND v_conv.assigned_manager_id <> v_uid THEN
    RAISE EXCEPTION 'This conversation is assigned to another team member';
  END IF;

  IF p_action = 'assign' THEN
    IF p_manager_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = p_manager_id
        AND role IN ('super_admin', 'administrator', 'finance', 'operations', 'customer_support')
        AND is_active = TRUE
    ) THEN
      RAISE EXCEPTION 'The selected team member cannot receive chat assignments';
    END IF;

    INSERT INTO chat_assignments (conversation_id, assigned_from, assigned_to, assigned_by, reason)
    VALUES (p_conversation_id, v_conv.assigned_manager_id, p_manager_id, v_uid, NULLIF(TRIM(COALESCE(p_reason, '')), ''));

    UPDATE chat_conversations SET assigned_manager_id = p_manager_id, updated_at = NOW()
    WHERE id = p_conversation_id;

    IF p_manager_id IS NOT NULL AND p_manager_id <> v_uid THEN
      INSERT INTO notifications (user_id, title, message, type, action_url)
      VALUES (p_manager_id, 'Chat assigned to you',
              'An investor conversation has been assigned to you.',
              'system', '/admin/chats/' || p_conversation_id);
    END IF;

    PERFORM create_audit_log(
      'chat_conversation_assigned', 'chat_conversation', p_conversation_id::text,
      jsonb_build_object('assigned_manager_id', v_conv.assigned_manager_id),
      jsonb_build_object('assigned_manager_id', p_manager_id, 'reason', p_reason)
    );

  ELSIF p_action = 'priority_high' OR p_action = 'priority_normal' THEN
    UPDATE chat_conversations
    SET priority = CASE WHEN p_action = 'priority_high' THEN 'high' ELSE 'normal' END,
        updated_at = NOW()
    WHERE id = p_conversation_id;
    PERFORM create_audit_log(
      'chat_priority_changed', 'chat_conversation', p_conversation_id::text,
      jsonb_build_object('priority', v_conv.priority),
      jsonb_build_object('priority', CASE WHEN p_action = 'priority_high' THEN 'high' ELSE 'normal' END)
    );

  ELSIF p_action = 'resolve' THEN
    UPDATE chat_conversations SET
      status = 'resolved', resolved_at = NOW(), resolved_by = v_uid, updated_at = NOW()
    WHERE id = p_conversation_id;
    PERFORM create_audit_log(
      'chat_conversation_resolved', 'chat_conversation', p_conversation_id::text,
      jsonb_build_object('status', v_conv.status), jsonb_build_object('status', 'resolved')
    );

  ELSIF p_action = 'reopen' THEN
    UPDATE chat_conversations SET
      status = 'awaiting_admin', resolved_at = NULL, resolved_by = NULL, updated_at = NOW()
    WHERE id = p_conversation_id;
    PERFORM create_audit_log(
      'chat_conversation_reopened', 'chat_conversation', p_conversation_id::text,
      jsonb_build_object('status', v_conv.status), jsonb_build_object('status', 'awaiting_admin')
    );

  ELSIF p_action = 'archive' THEN
    UPDATE chat_conversations SET status = 'archived', updated_at = NOW()
    WHERE id = p_conversation_id;
    PERFORM create_audit_log(
      'chat_conversation_archived', 'chat_conversation', p_conversation_id::text,
      jsonb_build_object('status', v_conv.status), jsonb_build_object('status', 'archived')
    );

  ELSE
    RAISE EXCEPTION 'Unknown action: %', p_action;
  END IF;

  RETURN jsonb_build_object('success', TRUE, 'action', p_action);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- 11. chat_bulk_assign_manager — Super Admin assigns a default
--     Investor Manager to many investors at once. Also points
--     their live conversations (if unassigned or reassignment
--     requested) at the manager.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION chat_bulk_assign_manager(
  p_investor_ids UUID[],
  p_manager_id   UUID
)
RETURNS JSONB AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_role  TEXT;
  v_count INTEGER;
BEGIN
  SELECT role::text INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
    RAISE EXCEPTION 'Only administrators can assign Investor Managers';
  END IF;
  IF p_investor_ids IS NULL OR array_length(p_investor_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No investors selected';
  END IF;
  IF p_manager_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM profiles WHERE id = p_manager_id
      AND role IN ('super_admin', 'administrator', 'finance', 'operations', 'customer_support')
      AND is_active = TRUE
  ) THEN
    RAISE EXCEPTION 'The selected team member cannot be an Investor Manager';
  END IF;

  UPDATE investors SET assigned_manager_id = p_manager_id, updated_at = NOW()
  WHERE id = ANY(p_investor_ids);
  GET DIAGNOSTICS v_count = ROW_COUNT;

  -- Point their live conversations at the manager too
  UPDATE chat_conversations SET assigned_manager_id = p_manager_id, updated_at = NOW()
  WHERE investor_id = ANY(p_investor_ids) AND status <> 'archived';

  PERFORM create_audit_log(
    'chat_manager_bulk_assigned', 'investor', NULL,
    NULL, jsonb_build_object('manager_id', p_manager_id, 'investors', v_count)
  );

  RETURN jsonb_build_object('updated', v_count, 'manager_id', p_manager_id);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
