# MaalGrow Communication Centre

Admin-only SMS / WhatsApp communications to **existing investors** via
Sendchamp. Not a marketing tool: portal migration notices, maturity
notices, profit/capital notifications, and operational announcements.

---

## 1. Architecture

```
Admin UI (/admin/comms)              ← super_admin + administrator only
   │  server-side API routes (/api/admin/comms/*)
   ▼
Provider abstraction (src/lib/comms/provider.ts)
   ▼
Sendchamp implementation (src/lib/comms/sendchamp.ts)
```

- The Communication Centre depends **only** on the `CommsProvider`
  interface. To replace Sendchamp, implement the interface and change
  one line in `getCommsProvider()` — nothing else in the app changes.
- Sendchamp is **never called from the browser**; the API key exists
  only as a server-side environment variable.
- Row Level Security is enabled on all three tables; only
  `super_admin` and `administrator` roles can read them. Investors
  have no access path to the Communication Centre.

### Database tables (migration `013_communication_centre.sql`)

| Table | Purpose |
|---|---|
| `comm_templates` | Editable templates; 9 built-ins seeded (Portal Migration, Maturity Notice, Profit Payment, Capital Withdrawal, Partial Capital Withdrawal, Capital Continuation, General Announcement, Profile Update Request, Investment Update) |
| `comm_campaigns` | One row per campaign: channel, message snapshot, group, counters, status, estimates, scheduling |
| `comm_recipients` | One row per investor per campaign with the fully personalised message, delivery state and raw provider response. `UNIQUE(campaign_id, investor_id)` + atomic claiming make duplicate sends impossible |

`investors.preferred_channel` (`sms` / `whatsapp` / `both`) stores each
investor's preference, editable on the admin investor edit page.

---

## 2. Environment variables (Vercel → Settings → Environment Variables)

| Variable | Required | Notes |
|---|---|---|
| `SENDCHAMP_API_KEY` | ✅ | Sendchamp dashboard → API & Integrations. **Use the LIVE key in production, TEST key while testing.** |
| `SENDCHAMP_SMS_SENDER_ID` | ✅ for SMS | Your registered sender ID, e.g. `MaalGrow` (max 11 chars; must be approved by Sendchamp) |
| `SENDCHAMP_WHATSAPP_SENDER_ID` | ✅ for WhatsApp | The WhatsApp Business number connected to Sendchamp |
| `SENDCHAMP_BASE_URL` | optional | Defaults to `https://api.sendchamp.com/api/v1` |
| `SENDCHAMP_SMS_ROUTE` | optional | Defaults to `dnd` so messages reach DND-enabled Nigerian numbers |
| `COMM_SMS_COST_NGN` | optional | Naira per SMS unit used for cost estimates (default 4) |

Redeploy after adding variables.

---

## 3. Configuring Sendchamp (one-time, production)

### SMS
1. Create an account at sendchamp.com and complete business KYC
   (required for the DND route in Nigeria).
2. Dashboard → **SMS → Sender IDs → Request Sender ID** → request
   `MaalGrow`. Approval typically takes 1–2 business days.
3. Fund your wallet (SMS is prepaid).
4. Dashboard → **API & Integrations** → copy the **Live** API key into
   `SENDCHAMP_API_KEY`.

### WhatsApp
1. Dashboard → **WhatsApp** → connect a WhatsApp Business number
   (Sendchamp walks through Meta Business verification).
2. Once approved, put the number (international format) in
   `SENDCHAMP_WHATSAPP_SENDER_ID`.
3. Free-form ("text") messages are only deliverable inside an open
   24-hour session; for cold outreach Meta requires **approved
   templates**. Create the template in Sendchamp (mirroring the
   Portal Migration wording with placeholders), wait for Meta
   approval, then paste its **template code** into the matching
   template in the portal's Template Manager
   (`WhatsApp Template Code` field). When a template code is present
   the portal sends via the approved template; otherwise it sends
   plain text.

---

## 4. Feature summary

- **Recipient groups**: All Active Investors (active portal account +
  ≥1 active investment; exited/inactive automatically excluded),
  investors in a specific series, or individually searched investors
  (name / code / phone / email, with Select All / Clear).
- **Phone handling**: Nigerian numbers normalised to `234…`;
  international numbers (e.g. `+44…`, `+1…`, `00…`) are kept in full
  international format and sent over Sendchamp's **international**
  SMS route automatically — the stored number is never modified.
  Invalid numbers and duplicate numbers are counted, listed with the
  investor and reason, and excluded.
- **Channels**: SMS, WhatsApp, SMS + WhatsApp (both), and WhatsApp
  with SMS Fallback (SMS fires **only** when WhatsApp fails — never
  duplicates).
- **Preferences**: per-investor preferred channel; campaigns can
  respect preferences or override them for critical operational
  notices.
- **Personalisation**: `{{first_name}} {{full_name}}
  {{registered_email}} {{investor_code}} {{series_name}}
  {{maturity_date}} {{total_slots}} {{portal_url}}` — resolved per
  investor at campaign creation; **a message with an unresolved
  variable is never sent** (the recipient is skipped with the reason
  recorded).
- **Confirmation**: campaign name, group, method, recipient count,
  exclusions, estimated SMS units and cost, and a preview must be
  confirmed before sending. Cancel / Save Draft / Send.
- **Safe processing**: recipients are processed in batches with
  provider pacing; each row is claimed atomically, so double-clicks,
  refreshes and concurrent sends can never deliver duplicates. Failed
  rows are retryable (max 3 attempts). Scheduled campaigns
  (`scheduled_for`) are processed by the existing daily cron.
- **History & audit**: every campaign stored permanently with per-
  recipient delivery status and raw provider responses; every create /
  send / retry / cancel is written to `audit_logs`.

---

## 5. Testing guide

1. **Apply migration 013** in the Supabase SQL editor (after 008–012).
2. Set the environment variables using the Sendchamp **test** API key,
   then redeploy.
3. Create a test investor whose phone number is your own (any format:
   `0801…`, `+234 801…` — normalisation is automatic) with one active
   investment.
4. Communication Centre → New Communication:
   - Campaign name: `Test — ignore`
   - Recipients: Individual → search and select only your test investor
   - Method: SMS
   - Template: Portal Migration → confirm the preview shows YOUR
     name/email substituted
   - Review & Send → confirm the summary shows 1 recipient → Send.
5. Verify: the SMS arrives; History shows the campaign as **sent**;
   the campaign page shows the provider response; `audit_logs` has
   `comms_campaign_created` and `comms_campaign_sent` rows.
6. Repeat with **WhatsApp with SMS Fallback**: if your test number has
   WhatsApp, the message arrives there and no SMS is sent; check the
   recipient row shows `channel_used: whatsapp`.
7. **Duplicate-send test**: open the campaign page in two tabs and
   click Send in both — the second run reports 0 processed.
8. **Failure test**: give a test investor an invalid phone (`123`),
   include them in a campaign — they appear as skipped with the
   reason, and the campaign completes for everyone else.

---

## 6. Deployment checklist

1. `supabase/migrations/013_communication_centre.sql` applied.
2. All `SENDCHAMP_*` variables set with **live** values; redeploy.
3. Sender ID approved; WhatsApp number connected; wallet funded.
4. Send the Portal Migration campaign to **Individual → yourself**
   first, then to a small series, then to All Active Investors.
5. Watch Communication History for failures; use **Retry Failed**
   after fixing data issues (usually invalid phone numbers).

---

## 7. Replacing Sendchamp later

Create `src/lib/comms/<newprovider>.ts` implementing `CommsProvider`
(`sendSms`, `sendWhatsApp` → `SendResult`), then change the single
line in `getCommsProvider()` in `src/lib/comms/provider.ts`. Campaign
logic, UI, history and retries are provider-agnostic.
