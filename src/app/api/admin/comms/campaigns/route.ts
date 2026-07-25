import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireCommsAdmin } from "@/lib/comms/server";
import { buildCampaignRecipients } from "@/lib/comms/engine";

export async function GET() {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;

  const db = await createAdminClient();
  const { data: campaigns } = await db
    .from("comm_campaigns")
    .select(
      "*, series:series_id(name), creator:created_by(full_name, email), template:template_id(name)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  return NextResponse.json({ campaigns: campaigns ?? [] });
}

export async function POST(request: Request) {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;

  try {
    const body = (await request.json()) as {
      name?: string;
      template_id?: string | null;
      channel?: "sms" | "whatsapp" | "both" | "whatsapp_fallback" | "email";
      message_body?: string;
      recipient_group?: string;
      series_id?: string | null;
      cycle_id?: string | null;
      investor_ids?: string[] | null;
      respect_preferences?: boolean;
      scheduled_for?: string | null;
      status?: "draft" | "queued";
      // Email channel fields
      email_type?: "operational" | "general";
      email_subject?: string;
      email_preview_text?: string | null;
      from_name?: string | null;
      from_email?: string | null;
      reply_to_email?: string | null;
      attachment?: {
        path: string;
        name: string;
        mime: string;
        size: number;
      } | null;
    };

    const VALID_GROUPS = [
      "all_active", "series", "cycle", "individual",
      "kyc_incomplete", "kyc_approved", "portal_not_activated",
      "maturity_pending", "profit_published",
    ];

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }
    if (!body.message_body?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (
      !body.channel ||
      !["sms", "whatsapp", "both", "whatsapp_fallback", "email"].includes(body.channel)
    ) {
      return NextResponse.json({ error: "Select a delivery method" }, { status: 400 });
    }
    if (!body.recipient_group || !VALID_GROUPS.includes(body.recipient_group)) {
      return NextResponse.json({ error: "Select a recipient group" }, { status: 400 });
    }
    if (["series", "cycle"].includes(body.recipient_group) && !body.series_id) {
      return NextResponse.json({ error: "Select a series" }, { status: 400 });
    }
    if (body.recipient_group === "cycle" && !body.cycle_id) {
      return NextResponse.json({ error: "Select a cycle" }, { status: 400 });
    }
    if (
      body.recipient_group === "individual" &&
      (!body.investor_ids || body.investor_ids.length === 0)
    ) {
      return NextResponse.json({ error: "Select at least one investor" }, { status: 400 });
    }
    if (body.channel === "email" && !body.email_subject?.trim()) {
      return NextResponse.json({ error: "Email subject is required" }, { status: 400 });
    }

    const db = await createAdminClient();

    const { data: campaign, error } = await db
      .from("comm_campaigns")
      .insert({
        name: body.name.trim(),
        template_id: body.template_id ?? null,
        channel: body.channel,
        message_body: body.message_body,
        recipient_group: body.recipient_group as "all_active",
        series_id: ["series", "cycle"].includes(body.recipient_group)
          ? body.series_id
          : null,
        cycle_id: body.recipient_group === "cycle" ? body.cycle_id : null,
        respect_preferences:
          body.channel === "email" ? false : body.respect_preferences ?? false,
        scheduled_for: body.scheduled_for ?? null,
        status: body.status === "queued" ? "queued" : "draft",
        created_by: auth.userId,
        ...(body.channel === "email"
          ? {
              email_type: body.email_type === "general" ? "general" : "operational",
              email_subject: body.email_subject!.trim(),
              email_preview_text: body.email_preview_text?.trim() || null,
              from_name: body.from_name?.trim() || null,
              from_email: body.from_email?.trim() || null,
              reply_to_email: body.reply_to_email?.trim() || null,
              attachment_mode: body.attachment ? "shared" : "none",
              attachment_path: body.attachment?.path ?? null,
              attachment_name: body.attachment?.name ?? null,
              attachment_mime: body.attachment?.mime ?? null,
              attachment_size: body.attachment?.size ?? null,
            }
          : {}),
      })
      .select()
      .single();

    if (error || !campaign) {
      return NextResponse.json(
        { error: "Failed to create campaign: " + error?.message },
        { status: 500 }
      );
    }

    // Snapshot the personalised recipient rows now (idempotent)
    const summary = await buildCampaignRecipients(
      db,
      campaign,
      body.investor_ids ?? null
    );

    // Audit log (runs as the calling admin's session)
    const session = await createClient();
    await session.rpc("create_audit_log", {
      p_action: "comms_campaign_created",
      p_entity_type: "comm_campaign",
      p_entity_id: campaign.id,
      p_new_values: {
        name: campaign.name,
        channel: campaign.channel,
        recipient_group: campaign.recipient_group,
        recipients: summary.total,
        sendable: summary.sendable,
        status: campaign.status,
      },
    });

    return NextResponse.json({ campaign: { ...campaign, ...summary } }, { status: 201 });
  } catch (err) {
    console.error("[API] POST /admin/comms/campaigns error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
