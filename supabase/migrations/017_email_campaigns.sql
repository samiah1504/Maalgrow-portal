-- ============================================================
-- Migration 017 – Email Campaigns (Resend) in the Communication
-- Centre
--
-- Adds Email as a third channel alongside SMS/WhatsApp (Sendchamp).
-- Extends the EXISTING comm_* tables — no parallel history system.
-- The MaalGrow database remains the source of truth for recipients;
-- transactional/password-reset/invitation emails are untouched.
--
-- Apply AFTER migration 016.
-- ============================================================

-- ------------------------------------------------------------
-- 1. Templates: allow the email channel + email metadata
-- ------------------------------------------------------------
ALTER TABLE comm_templates DROP CONSTRAINT IF EXISTS comm_templates_channel_check;
ALTER TABLE comm_templates
  ADD CONSTRAINT comm_templates_channel_check
  CHECK (channel IN ('sms', 'whatsapp', 'both', 'email'));

ALTER TABLE comm_templates
  ADD COLUMN IF NOT EXISTS email_subject      TEXT,
  ADD COLUMN IF NOT EXISTS email_preview_text TEXT,
  ADD COLUMN IF NOT EXISTS email_type         TEXT NOT NULL DEFAULT 'operational'
    CHECK (email_type IN ('operational', 'general'));

-- ------------------------------------------------------------
-- 2. Campaigns: email channel, new recipient groups, email fields
-- ------------------------------------------------------------
ALTER TABLE comm_campaigns DROP CONSTRAINT IF EXISTS comm_campaigns_channel_check;
ALTER TABLE comm_campaigns
  ADD CONSTRAINT comm_campaigns_channel_check
  CHECK (channel IN ('sms', 'whatsapp', 'both', 'whatsapp_fallback', 'email'));

ALTER TABLE comm_campaigns DROP CONSTRAINT IF EXISTS comm_campaigns_recipient_group_check;
ALTER TABLE comm_campaigns
  ADD CONSTRAINT comm_campaigns_recipient_group_check
  CHECK (recipient_group IN (
    'all_active', 'series', 'cycle', 'individual',
    'kyc_incomplete', 'kyc_approved', 'portal_not_activated',
    'maturity_pending', 'profit_published'
  ));

ALTER TABLE comm_campaigns
  ADD COLUMN IF NOT EXISTS cycle_id           UUID REFERENCES cycles(id),
  ADD COLUMN IF NOT EXISTS email_type         TEXT
    CHECK (email_type IS NULL OR email_type IN ('operational', 'general')),
  ADD COLUMN IF NOT EXISTS email_subject      TEXT,
  ADD COLUMN IF NOT EXISTS email_preview_text TEXT,
  ADD COLUMN IF NOT EXISTS from_name          TEXT,
  ADD COLUMN IF NOT EXISTS from_email         TEXT,
  ADD COLUMN IF NOT EXISTS reply_to_email     TEXT,
  ADD COLUMN IF NOT EXISTS attachment_mode    TEXT NOT NULL DEFAULT 'none'
    CHECK (attachment_mode IN ('none', 'shared')),
  ADD COLUMN IF NOT EXISTS attachment_path    TEXT,
  ADD COLUMN IF NOT EXISTS attachment_name    TEXT,
  ADD COLUMN IF NOT EXISTS attachment_mime    TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size    INTEGER,
  ADD COLUMN IF NOT EXISTS delivered_count    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS opened_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS clicked_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bounced_count      INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS complained_count   INTEGER NOT NULL DEFAULT 0;

-- ------------------------------------------------------------
-- 3. Recipients: email delivery tracking (webhook-driven)
-- ------------------------------------------------------------
ALTER TABLE comm_recipients
  ADD COLUMN IF NOT EXISTS email_address        TEXT,
  ADD COLUMN IF NOT EXISTS personalised_subject TEXT,
  ADD COLUMN IF NOT EXISTS delivered_at         TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS opened_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS clicked_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounced_at           TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bounce_reason        TEXT;

CREATE INDEX IF NOT EXISTS idx_comm_recipients_provider_msg
  ON comm_recipients(provider_message_id)
  WHERE provider_message_id IS NOT NULL;

-- ------------------------------------------------------------
-- 4. Private storage bucket for campaign attachments
-- ------------------------------------------------------------
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public)
    VALUES ('comm-attachments', 'comm-attachments', FALSE)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ------------------------------------------------------------
-- 5. Built-in email templates (idempotent; guarded per name)
-- ------------------------------------------------------------
INSERT INTO comm_templates (name, channel, email_type, email_subject, email_preview_text, body, is_builtin)
SELECT v.name, 'email', v.email_type, v.subject, v.preview, v.body, TRUE
FROM (VALUES
  (
    'New MaalGrow Investor Portal',
    'operational',
    'Important: Access Your New MaalGrow Investor Portal',
    'Your new investor portal is ready — complete your account setup.',
    E'Dear {{first_name}},\n\nWe have successfully migrated to our new MaalGrow Investor Portal.\n\nYour registered email address is {{registered_email}}. An invitation to access the new portal has already been sent to this email address.\n\nPlease check your inbox, Spam or Junk folder and follow the instructions in the invitation email to complete your account setup.\n\nYou can access the new portal at {{portal_url}}.\n\nPlease contact MaalGrow Investor Support if the registered email address is incorrect or you are unable to find your invitation.\n\nThank you for investing with MaalGrow.'
  ),
  (
    'Portal Invitation Reminder',
    'operational',
    'Reminder: Set Up Your MaalGrow Portal Account',
    'Your portal invitation is waiting in your inbox.',
    E'Dear {{first_name}},\n\nThis is a reminder that your MaalGrow Investor Portal account is ready. An invitation was sent to {{registered_email}} — please check your inbox and Spam folder.\n\nYou can reach the portal at {{portal_url}}.\n\nIf you cannot find the invitation, contact MaalGrow Investor Support and we will resend it.'
  ),
  (
    'KYC Update Required (Email)',
    'operational',
    'Action Required: Update Your MaalGrow KYC Details',
    'A few details are needed to keep your account fully verified.',
    E'Dear {{first_name}},\n\nYour KYC record requires an update. Please log in to your portal at {{portal_url}} and complete the missing details (including your next of kin) so we can keep your account fully verified.\n\nThank you for investing with MaalGrow.'
  ),
  (
    'KYC Approved (Email)',
    'operational',
    'Your MaalGrow KYC Has Been Approved',
    'Your verification is complete.',
    E'Dear {{first_name}},\n\nYour KYC has been reviewed and approved. You have full access to your MaalGrow portal at {{portal_url}}.\n\nThank you for investing with MaalGrow.'
  ),
  (
    'Investment Report',
    'operational',
    'Your MaalGrow {{series_name}} Report',
    'Your latest investment report is attached.',
    E'Dear {{first_name}},\n\nYour MaalGrow {{series_name}} report is now available. Please review the attached report and log in to your portal at {{portal_url}} for your personalised investment information.\n\nThank you for investing with MaalGrow.'
  ),
  (
    'Profit Published (Email)',
    'operational',
    'Your MaalGrow Profit Has Been Published',
    'Your profit for {{series_name}} is now on your dashboard.',
    E'Dear {{first_name}},\n\nThe profit for your {{series_name}} investment ({{cycle_name}}) has been published. Kindly log in to your portal at {{portal_url}} to review the details on your dashboard.\n\nThank you for investing with MaalGrow.'
  ),
  (
    'Maturity Instruction Reminder (Email)',
    'operational',
    'Action Required: Submit Your Maturity Instruction',
    'Tell us what to do with your investment before the deadline.',
    E'Dear {{first_name}},\n\nYour {{series_name}} investment matures on {{maturity_date}}. Please log in to your portal at {{portal_url}} and submit your maturity instruction so we can process your preference before the deadline.\n\nThank you for investing with MaalGrow.'
  ),
  (
    'General Investor Announcement (Email)',
    'general',
    'An Update from MaalGrow',
    'An announcement from the MaalGrow team.',
    E'Dear {{first_name}},\n\n[Write your announcement here]\n\nThank you for investing with MaalGrow.'
  )
) AS v(name, email_type, subject, preview, body)
WHERE NOT EXISTS (
  SELECT 1 FROM comm_templates t WHERE t.name = v.name
);
