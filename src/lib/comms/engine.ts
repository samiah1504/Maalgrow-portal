import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/types/database.types";
import { getCommsProvider, type SendResult } from "./provider";
import { resolveTemplate, smsUnits, smsCostNgn } from "./util";
import { loadCommRecipients } from "./server";

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
  >,
  investorIds: string[] | null
): Promise<{ total: number; sendable: number; skipped: number; units: number; cost: number }> {
  const { recipients } = await loadCommRecipients(adminClient, {
    group: campaign.recipient_group,
    seriesId: campaign.series_id,
    investorIds,
  });

  let sendable = 0;
  let skipped = 0;
  let totalUnits = 0;

  const rows = recipients.map((r) => {
    const { text, unresolved } = resolveTemplate(campaign.message_body, r.vars);
    let skipReason = r.skip_reason;
    if (!skipReason && unresolved.length > 0) {
      // A message with a raw {{placeholder}} is never sent.
      skipReason = `Missing data for variable(s): ${unresolved.join(", ")}`;
    }
    if (skipReason) skipped++;
    else {
      sendable++;
      totalUnits += smsUnits(text);
    }
    return {
      campaign_id: campaign.id,
      investor_id: r.investor_id,
      phone_normalized: r.phone_normalized,
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
  if (!campaign.respect_preferences) return campaign.channel;
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
