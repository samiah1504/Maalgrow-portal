import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireCommsAdmin } from "@/lib/comms/server";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const db = await createAdminClient();
  const [{ data: campaign }, { data: recipients }] = await Promise.all([
    db
      .from("comm_campaigns")
      .select(
        "*, series:series_id(name), creator:created_by(full_name, email), template:template_id(name)"
      )
      .eq("id", id)
      .single(),
    db
      .from("comm_recipients")
      .select(
        "*, investor:investors(full_name, investor_code, phone, preferred_channel)"
      )
      .eq("campaign_id", id)
      .order("status"),
  ]);

  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }
  return NextResponse.json({ campaign, recipients: recipients ?? [] });
}

// PATCH: cancel a campaign, or move a draft to queued
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = (await request.json()) as { action?: "cancel" | "queue" };
  const db = await createAdminClient();

  const { data: campaign } = await db
    .from("comm_campaigns")
    .select("id, status")
    .eq("id", id)
    .single();
  if (!campaign) {
    return NextResponse.json({ error: "Campaign not found" }, { status: 404 });
  }

  if (body.action === "cancel") {
    if (["sent", "cancelled"].includes(campaign.status)) {
      return NextResponse.json(
        { error: `Campaign is already ${campaign.status}` },
        { status: 400 }
      );
    }
    await db.from("comm_campaigns").update({ status: "cancelled" }).eq("id", id);
  } else if (body.action === "queue") {
    if (campaign.status !== "draft") {
      return NextResponse.json({ error: "Only drafts can be queued" }, { status: 400 });
    }
    await db.from("comm_campaigns").update({ status: "queued" }).eq("id", id);
  } else {
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }

  const session = await createClient();
  await session.rpc("create_audit_log", {
    p_action: `comms_campaign_${body.action}`,
    p_entity_type: "comm_campaign",
    p_entity_id: id,
    p_new_values: { previous_status: campaign.status },
  });

  return NextResponse.json({ ok: true });
}
