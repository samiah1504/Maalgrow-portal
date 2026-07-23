-- ============================================================
-- Migration 013 – Communication Centre
--
-- Admin-only SMS / WhatsApp communications to EXISTING investors
-- via a provider abstraction (Sendchamp today). Not a marketing
-- tool: investor updates, portal migration, maturity notices,
-- profit/capital notifications, announcements.
--
--   comm_templates   — editable message templates (built-ins seeded)
--   comm_campaigns   — one row per communication campaign
--   comm_recipients  — one row per investor per campaign; stores the
--                      fully resolved personalised message, per-
--                      recipient delivery state, provider response.
--                      UNIQUE(campaign_id, investor_id) makes sending
--                      idempotent: refresh / double-click can never
--                      produce duplicate messages.
-- ============================================================

-- ============================================================
-- 1. Investor communication preference
-- ============================================================

ALTER TABLE investors
  ADD COLUMN IF NOT EXISTS preferred_channel TEXT NOT NULL DEFAULT 'sms'
  CHECK (preferred_channel IN ('sms', 'whatsapp', 'both'));

-- ============================================================
-- 2. Templates
-- ============================================================

CREATE TABLE IF NOT EXISTS comm_templates (
  id                     UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                   TEXT NOT NULL,
  channel                TEXT NOT NULL DEFAULT 'both'
                         CHECK (channel IN ('sms', 'whatsapp', 'both')),
  body                   TEXT NOT NULL,
  -- Sendchamp-approved WhatsApp template code (optional; plain text
  -- WhatsApp messages are used when absent)
  whatsapp_template_code TEXT,
  header_media_url       TEXT,
  is_builtin             BOOLEAN NOT NULL DEFAULT FALSE,
  status                 TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'archived')),
  created_by             UUID REFERENCES profiles(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- 3. Campaigns
-- ============================================================

CREATE TABLE IF NOT EXISTS comm_campaigns (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  template_id         UUID REFERENCES comm_templates(id),
  channel             TEXT NOT NULL
                      CHECK (channel IN ('sms', 'whatsapp', 'both', 'whatsapp_fallback')),
  message_body        TEXT NOT NULL,          -- template snapshot at send time
  recipient_group     TEXT NOT NULL
                      CHECK (recipient_group IN ('all_active', 'series', 'individual')),
  series_id           UUID REFERENCES series(id),
  respect_preferences BOOLEAN NOT NULL DEFAULT FALSE,
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'queued', 'processing', 'sent',
                                        'partially_sent', 'failed', 'cancelled')),
  total_recipients    INTEGER NOT NULL DEFAULT 0,
  sent_count          INTEGER NOT NULL DEFAULT 0,
  failed_count        INTEGER NOT NULL DEFAULT 0,
  skipped_count       INTEGER NOT NULL DEFAULT 0,
  estimated_units     INTEGER NOT NULL DEFAULT 0,
  estimated_cost      NUMERIC(12,2) NOT NULL DEFAULT 0,
  scheduled_for       TIMESTAMPTZ,
  created_by          UUID REFERENCES profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at          TIMESTAMPTZ,
  completed_at        TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_comm_campaigns_created
  ON comm_campaigns(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_comm_campaigns_status
  ON comm_campaigns(status);

-- ============================================================
-- 4. Recipients — the idempotency backbone
-- ============================================================

CREATE TABLE IF NOT EXISTS comm_recipients (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id         UUID NOT NULL REFERENCES comm_campaigns(id) ON DELETE CASCADE,
  investor_id         UUID NOT NULL REFERENCES investors(id),
  phone_normalized    TEXT,                    -- 234XXXXXXXXXX; investor row is never modified
  channel_used        TEXT,                    -- 'sms' | 'whatsapp' | 'whatsapp+sms'
  message             TEXT NOT NULL,           -- fully resolved, personalised text
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  skip_reason         TEXT,                    -- invalid phone / unresolved variable / duplicate
  sms_fallback_used   BOOLEAN NOT NULL DEFAULT FALSE,
  provider_message_id TEXT,
  provider_response   JSONB,
  error               TEXT,
  attempts            INTEGER NOT NULL DEFAULT 0,
  sent_at             TIMESTAMPTZ,
  UNIQUE (campaign_id, investor_id)
);

CREATE INDEX IF NOT EXISTS idx_comm_recipients_campaign
  ON comm_recipients(campaign_id, status);

-- ============================================================
-- 5. Row Level Security — admins only; investors have NO access
-- ============================================================

ALTER TABLE comm_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE comm_campaigns  ENABLE ROW LEVEL SECURITY;
ALTER TABLE comm_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Comms admins manage templates"
  ON comm_templates FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'administrator'))
  );

CREATE POLICY "Comms admins manage campaigns"
  ON comm_campaigns FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'administrator'))
  );

CREATE POLICY "Comms admins manage recipients"
  ON comm_recipients FOR ALL
  USING (
    EXISTS (SELECT 1 FROM profiles
            WHERE profiles.id = auth.uid()
              AND profiles.role IN ('super_admin', 'administrator'))
  );

-- ============================================================
-- 6. Built-in editable templates
-- ============================================================

INSERT INTO comm_templates (name, channel, body, is_builtin) VALUES
(
  'Portal Migration', 'both',
  E'Dear {{first_name}},\n\nWe are pleased to inform you that MaalGrow has successfully migrated to our new Investor Portal.\n\nThe email registered on your investment account is:\n\n{{registered_email}}\n\nWe have already sent your portal invitation to this email address.\n\nKindly check your Inbox and Spam/Junk folder and follow the instructions to activate your account.\n\nIf the email above is incorrect, please contact MaalGrow immediately so we can update your records.\n\nThank you for investing with MaalGrow.',
  TRUE
),
(
  'Maturity Notice', 'both',
  E'Dear {{first_name}},\n\nYour MaalGrow {{series_name}} investment matures on {{maturity_date}}.\n\nPlease log in to your portal at {{portal_url}} before maturity to review your Maturity Instructions.\n\nThank you for investing with MaalGrow.',
  TRUE
),
(
  'Profit Payment', 'both',
  E'Dear {{first_name}},\n\nYour declared profit for your MaalGrow {{series_name}} investment has been processed for payment to your registered bank account.\n\nLog in at {{portal_url}} to view the details.\n\nThank you for investing with MaalGrow.',
  TRUE
),
(
  'Capital Withdrawal', 'both',
  E'Dear {{first_name}},\n\nYour capital withdrawal request for your MaalGrow {{series_name}} investment has been processed for payment to your registered bank account.\n\nLog in at {{portal_url}} to view the details.\n\nThank you for investing with MaalGrow.',
  TRUE
),
(
  'Partial Capital Withdrawal', 'both',
  E'Dear {{first_name}},\n\nYour partial capital withdrawal for your MaalGrow {{series_name}} investment has been processed. Your remaining capital continues into the next investment cycle.\n\nLog in at {{portal_url}} to view your updated investment.\n\nThank you for investing with MaalGrow.',
  TRUE
),
(
  'Capital Continuation', 'both',
  E'Dear {{first_name}},\n\nYour MaalGrow {{series_name}} investment capital has continued into the next 3-month investment cycle.\n\nLog in at {{portal_url}} to view your updated investment timeline.\n\nThank you for investing with MaalGrow.',
  TRUE
),
(
  'General Announcement', 'both',
  E'Dear {{first_name}},\n\n[Write your announcement here]\n\nThank you for investing with MaalGrow.',
  TRUE
),
(
  'Profile Update Request', 'both',
  E'Dear {{first_name}},\n\nWe need you to update your profile details on the MaalGrow Investor Portal.\n\nPlease log in at {{portal_url}} and review your information, or contact MaalGrow if you need assistance.\n\nThank you for investing with MaalGrow.',
  TRUE
),
(
  'Investment Update', 'both',
  E'Dear {{first_name}},\n\nThere is an update on your MaalGrow {{series_name}} investment ({{investor_code}}).\n\nPlease log in at {{portal_url}} to view the details.\n\nThank you for investing with MaalGrow.',
  TRUE
);
