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
      channel?: "sms" | "whatsapp" | "both" | "whatsapp_fallback";
      message_body?: string;
      recipient_group?: "all_active" | "series" | "individual";
      series_id?: string | null;
      investor_ids?: string[] | null;
      respect_preferences?: boolean;
      scheduled_for?: string | null;
      status?: "draft" | "queued";
    };

    if (!body.name?.trim()) {
      return NextResponse.json({ error: "Campaign name is required" }, { status: 400 });
    }
    if (!body.message_body?.trim()) {
      return NextResponse.json({ error: "Message is required" }, { status: 400 });
    }
    if (!body.channel || !["sms", "whatsapp", "both", "whatsapp_fallback"].includes(body.channel)) {
      return NextResponse.json({ error: "Select a delivery method" }, { status: 400 });
    }
    if (!body.recipient_group) {
      return NextResponse.json({ error: "Select a recipient group" }, { status: 400 });
    }
    if (body.recipient_group === "series" && !body.series_id) {
      return NextResponse.json({ error: "Select a series" }, { status: 400 });
    }
    if (
      body.recipient_group === "individual" &&
      (!body.investor_ids || body.investor_ids.length === 0)
    ) {
      return NextResponse.json({ error: "Select at least one investor" }, { status: 400 });
    }

    const db = await createAdminClient();

    const { data: campaign, error } = await db
      .from("comm_campaigns")
      .insert({
        name: body.name.trim(),
        template_id: body.template_id ?? null,
        channel: body.channel,
        message_body: body.message_body,
        recipient_group: body.recipient_group,
        series_id: body.recipient_group === "series" ? body.series_id : null,
        respect_preferences: body.respect_preferences ?? false,
        scheduled_for: body.scheduled_for ?? null,
        status: body.status === "queued" ? "queued" : "draft",
        created_by: auth.userId,
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
