-- ============================================================
-- 029 — correcting an announcement that has already gone out
--
-- 028 could send one and withdraw one, and nothing in between. So a
-- typo, a wrong date, or a wall of text with no paragraph breaks left
-- exactly one option: withdraw it — pulling it out of everybody's
-- notifications — and send it again, which reads to the investor as
-- two separate announcements about the same thing, the first of which
-- mysteriously vanished.
--
-- Editing in place is the honest operation. The announcement is the
-- same announcement; what it says has been corrected.
--
-- IT EDITS THE DELIVERED COPIES TOO. A notification is not a sent
-- letter that has left the building — it is a row this portal owns
-- and renders on demand. Updating the record without updating what
-- people actually see would leave the administrator reading the
-- corrected version while every investor still reads the mistake.
--
-- READ STATE IS PRESERVED. Someone who has read an announcement has
-- read it; a correction to its wording does not make it unread and
-- does not relight their bell. A change substantial enough to need
-- their attention again is a new announcement, not an edit.
--
-- Re-runnable.
-- ============================================================

CREATE OR REPLACE FUNCTION update_announcement(
  p_id         UUID,
  p_title      TEXT,
  p_body       TEXT,
  p_action_url TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_role    TEXT;
  v_updated INTEGER;
  v_url     TEXT := NULLIF(TRIM(COALESCE(p_action_url, '')), '');
BEGIN
  SELECT role::TEXT INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS NULL OR v_role NOT IN ('super_admin', 'administrator') THEN
    RAISE EXCEPTION 'Only an administrator can edit an announcement';
  END IF;

  IF p_title IS NULL OR TRIM(p_title) = '' THEN
    RAISE EXCEPTION 'An announcement needs a title';
  END IF;
  IF p_body IS NULL OR TRIM(p_body) = '' THEN
    RAISE EXCEPTION 'An announcement needs a message';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM announcements WHERE id = p_id) THEN
    RAISE EXCEPTION 'Announcement not found';
  END IF;

  UPDATE announcements SET
    title      = TRIM(p_title),
    content    = TRIM(p_body),
    action_url = v_url,
    updated_at = NOW()
  WHERE id = p_id;

  -- The copies already in people's notifications. is_read is left
  -- exactly as it is on every row.
  WITH touched AS (
    UPDATE notifications SET
      title      = TRIM(p_title),
      message    = TRIM(p_body),
      action_url = v_url
    WHERE type = 'announcement'
      AND metadata->>'announcement_id' = p_id::TEXT
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM touched;

  PERFORM create_audit_log(
    'announcement_edited', 'announcement', p_id::TEXT, NULL,
    jsonb_build_object('title', TRIM(p_title), 'notifications_updated', v_updated)
  );

  RETURN jsonb_build_object('id', p_id, 'notificationsUpdated', v_updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION update_announcement(UUID, TEXT, TEXT, TEXT) TO authenticated;
  END IF;
END $$;
