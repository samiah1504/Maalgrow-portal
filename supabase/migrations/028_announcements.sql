-- ============================================================
-- 028 — announcements that actually reach anybody
--
-- The admin announcements page was a mock. MOCK_ANNOUNCEMENTS lived
-- in React state, "Publish" pushed a row onto a local array, and
-- "Delete" spliced it out again. Nothing was ever written anywhere,
-- so no investor could ever have seen one. That is worse than an
-- obviously missing feature: an administrator could write an
-- announcement, see it listed as published, and reasonably believe
-- every investor had been told something.
--
-- THE TABLE HAS EXISTED SINCE MIGRATION 001. It was simply never
-- written to. So this adds no table and renames nothing — it fills
-- in the one column that was missing and supplies the two functions
-- that were never written.
--
-- ONE RECORD, MANY NOTIFICATIONS. Both, because they answer
-- different questions: the announcement is what was said and to
-- whom, and the notifications are what each person has in their
-- bell. Deriving one from the other loses the difference — a
-- notification a recipient deletes must not erase the fact that the
-- announcement was made.
--
-- THE FAN-OUT IS A SNAPSHOT, NOT A SUBSCRIPTION. Recipients are
-- resolved once, at the moment of sending. Somebody who joins
-- tomorrow does not retroactively receive yesterday's announcement,
-- which is what anyone reading "sent to 38 investors" would assume.
--
-- Re-runnable.
-- ============================================================

-- How many people it actually reached, counted at send time.
ALTER TABLE announcements
  ADD COLUMN IF NOT EXISTS recipient_count INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS action_url TEXT;

CREATE INDEX IF NOT EXISTS idx_announcements_created_at
  ON announcements(created_at DESC);

-- ------------------------------------------------------------
-- Send one.
--
--   Writes the record, then a notification per recipient, in one
--   transaction — so an announcement can never exist having reached
--   nobody, and notifications can never exist without the record
--   that explains them.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION broadcast_announcement(
  p_title      TEXT,
  p_body       TEXT,
  p_audience   TEXT DEFAULT 'investors',
  p_action_url TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_role  TEXT;
  v_id    UUID;
  v_count INTEGER;
  v_url   TEXT := NULLIF(TRIM(COALESCE(p_action_url, '')), '');
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT role::TEXT INTO v_role FROM profiles WHERE id = v_actor;
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
    RAISE EXCEPTION 'Only an administrator can send an announcement';
  END IF;

  IF p_title IS NULL OR TRIM(p_title) = '' THEN
    RAISE EXCEPTION 'An announcement needs a title';
  END IF;
  IF p_body IS NULL OR TRIM(p_body) = '' THEN
    RAISE EXCEPTION 'An announcement needs a message';
  END IF;
  IF p_audience NOT IN ('all', 'investors', 'admins') THEN
    RAISE EXCEPTION 'Audience must be all, investors or admins';
  END IF;

  INSERT INTO announcements (
    title, content, target_audience, action_url,
    is_published, published_at, created_by
  )
  VALUES (
    TRIM(p_title), TRIM(p_body), p_audience::target_audience, v_url,
    TRUE, NOW(), v_actor
  )
  RETURNING id INTO v_id;

  -- Resolved once, here. Deliberately not a view or a subscription:
  -- "sent to 38 investors" has to keep meaning that tomorrow.
  WITH recipients AS (
    SELECT p.id
    FROM profiles p
    WHERE CASE p_audience
            WHEN 'investors' THEN p.role::TEXT = 'investor'
            WHEN 'admins'    THEN p.role::TEXT IN ('super_admin', 'administrator', 'finance')
            ELSE TRUE
          END
  ), inserted AS (
    INSERT INTO notifications (user_id, title, message, type, action_url, metadata)
    SELECT r.id, TRIM(p_title), TRIM(p_body), 'announcement', v_url,
           jsonb_build_object('announcement_id', v_id)
    FROM recipients r
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM inserted;

  UPDATE announcements SET recipient_count = v_count WHERE id = v_id;

  PERFORM create_audit_log(
    'announcement_sent', 'announcement', v_id::TEXT, NULL,
    jsonb_build_object('title', TRIM(p_title), 'audience', p_audience,
                       'recipients', v_count)
  );

  RETURN jsonb_build_object('id', v_id, 'recipients', v_count);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------
-- Withdraw one.
--
--   Removes the notifications it created along with the record. An
--   announcement sent in error should stop being in people's bells,
--   not merely stop being listed for the administrator.
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_announcement(p_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_role    TEXT;
  v_removed INTEGER;
BEGIN
  SELECT role::TEXT INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
    RAISE EXCEPTION 'Only an administrator can withdraw an announcement';
  END IF;

  WITH gone AS (
    DELETE FROM notifications
    WHERE type = 'announcement'
      AND metadata->>'announcement_id' = p_id::TEXT
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_removed FROM gone;

  DELETE FROM announcements WHERE id = p_id;

  PERFORM create_audit_log(
    'announcement_withdrawn', 'announcement', p_id::TEXT,
    jsonb_build_object('notifications_removed', v_removed), NULL
  );

  RETURN jsonb_build_object('id', p_id, 'notificationsRemoved', v_removed);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION broadcast_announcement(TEXT, TEXT, TEXT, TEXT) TO authenticated;
    GRANT EXECUTE ON FUNCTION delete_announcement(UUID) TO authenticated;
  END IF;
END $$;
