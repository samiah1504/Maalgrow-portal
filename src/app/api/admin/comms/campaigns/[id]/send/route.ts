import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { requireCommsAdmin } from "@/lib/comms/server";
import { processCampaignChunk } from "@/lib/comms/engine";

// POST: process the next batch of recipients. The client calls this in
// a loop until done=true. Fully idempotent — refreshing or clicking
// Send repeatedly can never deliver duplicate messages (recipients are
// claimed atomically and UNIQUE(campaign_id, investor_id) holds).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  try {
    const body = (await request.json().catch(() => ({}))) as {
      limit?: number;
      retry_failed?: boolean;
    };

    const db = await createAdminClient();
    const result = await processCampaignChunk(db, id, {
      limit: body.limit,
      retryFailed: body.retry_failed ?? false,
    });

    if (result.done) {
      const session = await createClient();
      await session.rpc("create_audit_log", {
        p_action: body.retry_failed ? "comms_campaign_retried" : "comms_campaign_sent",
        p_entity_type: "comm_campaign",
        p_entity_id: id,
        p_new_values: {
          status: result.campaignStatus,
          remaining: result.remaining,
        },
      });
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Internal server error";
    console.error("[API] POST comms send error:", err);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
