import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database.types";
import { getCommsProvider } from "./provider";
import { resolveTemplate, smsUnits, smsCostNgn } from "./util";
import { loadCommRecipients, type CommGroup } from "./server";
import { sendCampaignEmail } from "./resend-email";

type AdminClient = SupabaseClient<Database>;
type Campaign = Database["public"]["Tables"]["comm_campaigns"]["Row"];
type Recipient = Database["public"]["Tables"]["comm_recipients"]["Row"];

const MAX_ATTEMPTS = 3;
const SEND_SPACING_MS = 150; // gentle pacing for provider rate limits

// ── Campaign creation: snapshot the fully resolved recipient rows ────

export async function buildCampaignRecipients(
  adminClient: AdminClient,
  campaign: Pick<
    Campaign,
    "id" | "message_body" | "recipient_group" | "series_id"
  > & { channel?: string; cycle_id?: string | null; email_subject?: string | null },
  investorIds: string[] | null
): Promise<{ total: number; sendable: number; skipped: number; units: number; cost: number }> {
  const isEmail = campaign.channel === "email";
  const { recipients } = await loadCommRecipients(adminClient, {
    group: campaign.recipient_group as CommGroup,
    seriesId: campaign.series_id,
    cycleId: campaign.cycle_id ?? null,
    investorIds,
    forEmail: isEmail,
  });

  let sendable = 0;
  let skipped = 0;
  let totalUnits = 0;

  const rows = recipients.map((r) => {
    const { text, unresolved } = resolveTemplate(campaign.message_body, r.vars);
    // Email subjects are personalised too, and validated the same way
    const subjectRes = isEmail
      ? resolveTemplate(campaign.email_subject ?? "", r.vars)
      : { text: null as string | null, unresolved: [] as string[] };

    let skipReason = r.skip_reason;
    const allUnresolved = [...unresolved, ...subjectRes.unresolved];
    if (!skipReason && allUnresolved.length > 0) {
      // A message with a raw {{placeholder}} is never sent.
      skipReason = `Missing data for variable(s): ${[...new Set(allUnresolved)].join(", ")}`;
    }
    if (skipReason) skipped++;
    else {
      sendable++;
      if (!isEmail) totalUnits += smsUnits(text);
    }
    return {
      campaign_id: campaign.id,
      investor_id: r.investor_id,
      phone_normalized: r.phone_normalized,
      email_address: isEmail ? r.email : null,
      personalised_subject: subjectRes.text,
      message: text,
      status: (skipReason ? "skipped" : "pending") as "skipped" | "pending",
      skip_reason: skipReason,
    };
  });

  // Idempotent snapshot: UNIQUE(campaign_id, investor_id) ignores dupes
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await adminClient
      .from("comm_recipients")
      .upsert(chunk, { onConflict: "campaign_id,investor_id", ignoreDuplicates: true });
    if (error) throw new Error("Failed to store recipients: " + error.message);
  }

  // totalUnits is already summed across recipients, so cost = units × price
  const cost = smsCostNgn(totalUnits, 1);
  await adminClient
    .from("comm_campaigns")
    .update({
      total_recipients: rows.length,
      skipped_count: skipped,
      estimated_units: totalUnits,
      estimated_cost: cost,
    })
    .eq("id", campaign.id);

  return { total: rows.length, sendable, skipped, units: totalUnits, cost };
}

// ── Sending engine: chunked, idempotent, fallback-aware ─────────────

type EffectiveChannel = "sms" | "whatsapp" | "both" | "whatsapp_fallback";

function effectiveChannel(campaign: Campaign, pref: string | null): EffectiveChannel {
  if (!campaign.respect_preferences) return campaign.channel as EffectiveChannel;
  if (pref === "whatsapp") return "whatsapp";
  if (pref === "both") return "both";
  return "sms";
}

async function deliverOne(
  channel: EffectiveChannel,
  to: string,
  message: string
): Promise<{
  success: boolean;
  channelUsed: string;
  fallbackUsed: boolean;
  providerMessageId?: string;
  responses: unknown;
  error?: string;
  retryable: boolean;
}> {
  const provider = getCommsProvider();

  if (channel === "sms") {
    const r = await provider.sendSms({ to, message });
    return { success: r.success, channelUsed: "sms", fallbackUsed: false,
      providerMessageId: r.providerMessageId, responses: r.response, error: r.error, retryable: r.retryable };
  }

  if (channel === "whatsapp") {
    const r = await provider.sendWhatsApp({ to, message });
    return { success: r.success, channelUsed: "whatsapp", fallbackUsed: false,
      providerMessageId: r.providerMessageId, responses: r.response, error: r.error, retryable: r.retryable };
  }

  if (channel === "whatsapp_fallback") {
    // WhatsApp first; SMS ONLY if WhatsApp fails. Never both.
    const wa = await provider.sendWhatsApp({ to, message });
    if (wa.success) {
      return { success: true, channelUsed: "whatsapp", fallbackUsed: false,
        providerMessageId: wa.providerMessageId, responses: { whatsapp: wa.response }, retryable: false };
    }
    const sms = await provider.sendSms({ to, message });
    return {
      success: sms.success,
      channelUsed: sms.success ? "sms" : "whatsapp",
      fallbackUsed: true,
      providerMessageId: sms.providerMessageId,
      responses: { whatsapp: wa.response, sms: sms.response },
      error: sms.success ? undefined : `WhatsApp: ${wa.error}; SMS: ${sms.error}`,
      retryable: sms.retryable,
    };
  }

  // 'both': deliver on BOTH channels; success when at least one lands
  const [wa, sms] = [await provider.sendWhatsApp({ to, message }), await provider.sendSms({ to, message })];
  const success = wa.success || sms.success;
  return {
    success,
    channelUsed: "whatsapp+sms",
    fallbackUsed: false,
    providerMessageId: sms.providerMessageId ?? wa.providerMessageId,
    responses: { whatsapp: wa.response, sms: sms.response },
    error: success ? undefined : `WhatsApp: ${wa.error}; SMS: ${sms.error}`,
    retryable: wa.retryable || sms.retryable,
  };
}

/**
 * Processes the next chunk of a campaign. Fully idempotent:
 * - only rows in status 'pending' (or 'failed' when retrying) are eligible
 * - each row is CLAIMED with an optimistic attempts-guard update, so two
 *   concurrent calls (double click, page refresh) can never send twice
 */
export async function processCampaignChunk(
  adminClient: AdminClient,
  campaignId: string,
  opts: { limit?: number; retryFailed?: boolean } = {}
): Promise<{
  processed: number;
  sent: number;
  failed: number;
  remaining: number;
  done: boolean;
  campaignStatus: string;
}> {
  const limit = Math.min(Math.max(opts.limit ?? 15, 1), 40);

  const { data: campaignRaw } = await adminClient
    .from("comm_campaigns")
    .select("*")
    .eq("id", campaignId)
    .single();
  if (!campaignRaw) throw new Error("Campaign not found");
  const campaign = campaignRaw as Campaign;

  if (["cancelled", "draft"].includes(campaign.status)) {
    throw new Error(`Campaign is ${campaign.status} and cannot be sent`);
  }

  if (campaign.status !== "processing") {
    await adminClient
      .from("comm_campaigns")
      .update({ status: "processing", started_at: campaign.started_at ?? new Date().toISOString() })
      .eq("id", campaignId);
  }

  const statuses: ("pending" | "failed")[] = opts.retryFailed
    ? ["pending", "failed"]
    : ["pending"];
  const { data: pendingRaw } = await adminClient
    .from("comm_recipients")
    .select("*, investor:investors(preferred_channel)")
    .eq("campaign_id", campaignId)
    .in("status", statuses)
    .lt("attempts", MAX_ATTEMPTS)
    .limit(limit);

  const pending = (pendingRaw ?? []) as unknown as (Recipient & {
    investor: { preferred_channel: string } | null;
  })[];

  const isEmail = campaign.channel === "email";

  // Shared attachment: loaded ONCE per chunk from private storage
  let attachment: { filename: string; content: Buffer } | null = null;
  if (isEmail && campaign.attachment_mode === "shared" && campaign.attachment_path) {
    const { data: file, error: dlErr } = await adminClient.storage
      .from("comm-attachments")
      .download(campaign.attachment_path);
    if (dlErr || !file) {
      throw new Error(
        "Could not load the campaign attachment: " + (dlErr?.message ?? "not found")
      );
    }
    attachment = {
      filename: campaign.attachment_name ?? "report.pdf",
      content: Buffer.from(await file.arrayBuffer()),
    };
  }

  let processed = 0;
  let sentNow = 0;
  let failedNow = 0;

  for (const row of pending) {
    // Optimistic claim: bump attempts only if nobody else already did.
    const { data: claimed } = await adminClient
      .from("comm_recipients")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id)
      .eq("attempts", row.attempts)
      .in("status", statuses)
      .select("id");
    if (!claimed || claimed.length === 0) continue; // another worker took it

    processed++;

    if (isEmail) {
      if (!row.email_address) {
        await adminClient
          .from("comm_recipients")
          .update({ status: "skipped", skip_reason: "No valid email address" })
          .eq("id", row.id);
        continue;
      }
      const emailResult = await sendCampaignEmail({
        to: row.email_address,
        subject: row.personalised_subject ?? campaign.email_subject ?? campaign.name,
        bodyText: row.message,
        previewText: campaign.email_preview_text,
        emailType: (campaign.email_type as "operational" | "general") ?? "operational",
        fromName: campaign.from_name,
        fromEmail: campaign.from_email,
        replyTo: campaign.reply_to_email,
        attachment,
      });

      await adminClient
        .from("comm_recipients")
        .update({
          status: emailResult.success ? "sent" : "failed",
          channel_used: "email",
          provider_message_id: emailResult.providerMessageId ?? null,
          provider_response: emailResult.response as Json,
          error: emailResult.error ?? null,
          sent_at: emailResult.success ? new Date().toISOString() : null,
        })
        .eq("id", row.id);

      if (emailResult.success) sentNow++;
      else failedNow++;

      // Resend's default rate limit is ~2 requests/second
      await new Promise((r) => setTimeout(r, 600));
      continue;
    }

    if (!row.phone_normalized) {
      await adminClient
        .from("comm_recipients")
        .update({ status: "skipped", skip_reason: "No valid phone number" })
        .eq("id", row.id);
      continue;
    }

    const channel = effectiveChannel(campaign, row.investor?.preferred_channel ?? null);
    const result = await deliverOne(channel, row.phone_normalized, row.message);

    await adminClient
      .from("comm_recipients")
      .update({
        status: result.success ? "sent" : "failed",
        channel_used: result.channelUsed,
        sms_fallback_used: result.fallbackUsed,
        provider_message_id: result.providerMessageId ?? null,
        provider_response: result.responses as Json,
        error: result.error ?? null,
        sent_at: result.success ? new Date().toISOString() : null,
      })
      .eq("id", row.id);

    if (result.success) sentNow++;
    else failedNow++;

    await new Promise((r) => setTimeout(r, SEND_SPACING_MS));
  }

  // Recompute campaign counters + terminal status
  const { data: allRows } = await adminClient
    .from("comm_recipients")
    .select("status, attempts")
    .eq("campaign_id", campaignId);

  let sent = 0, failed = 0, skipped = 0, remaining = 0;
  for (const r of allRows ?? []) {
    if (r.status === "sent") sent++;
    else if (r.status === "skipped") skipped++;
    else if (r.status === "failed") failed++;
    else remaining++; // pending
  }

  const done = remaining === 0;
  let campaignStatus = "processing";
  if (done) {
    campaignStatus =
      failed === 0 ? "sent" : sent > 0 ? "partially_sent" : "failed";
  }

  await adminClient
    .from("comm_campaigns")
    .update({
      sent_count: sent,
      failed_count: failed,
      skipped_count: skipped,
      ...(done
        ? { status: campaignStatus as Campaign["status"], completed_at: new Date().toISOString() }
        : {}),
    })
    .eq("id", campaignId);

  return { processed, sent: sentNow, failed: failedNow, remaining, done, campaignStatus };
}
