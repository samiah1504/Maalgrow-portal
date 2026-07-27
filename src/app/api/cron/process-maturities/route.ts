import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { processCampaignChunk } from "@/lib/comms/engine";

// Called by a cron job (e.g., daily at midnight via vercel.json cron config)
// Can also be called manually from admin portal
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");

  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    process.env.NODE_ENV !== "development"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = await createAdminClient();

    // Process matured investments — transitions cycles to awaiting_profit_declaration
    const { data: rpcResult, error: rpcError } = await supabase.rpc(
      "process_matured_investments"
    );

    if (rpcError) {
      console.error("[Cron] Maturity processing error:", rpcError);
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    // Open the next cycle for anything that has settled, and start any
    // cycle whose first day has arrived. Idempotent, so running it every
    // night is the same as running it once (migration 036).
    //
    // Deliberately not fatal: a cycle failing to open must not stop
    // maturities from being processed or campaigns from going out.
    const { data: openedCycles, error: openError } = await supabase.rpc(
      "mudarabah_open_next_cycles"
    );
    if (openError) {
      console.error("[Cron] Next-cycle opening error:", openError);
    }

    // Notify super_admin users about any cycles that matured today
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { data: newlyMatured } = await supabase
      .from("cycles")
      .select("id, cycle_label, series:series_id(name)")
      .eq("status", "awaiting_profit_declaration")
      .gte("updated_at", todayStart.toISOString());

    if (newlyMatured && newlyMatured.length > 0) {
      const { data: superAdmins } = await supabase
        .from("profiles")
        .select("id")
        .eq("role", "super_admin")
        .eq("is_active", true);

      if (superAdmins && superAdmins.length > 0) {
        const notifications = newlyMatured.flatMap((cycle) => {
          const raw = cycle as unknown as {
            id: string;
            cycle_label: string;
            series: { name: string } | null;
          };
          return superAdmins.map((admin) => ({
            user_id: admin.id,
            title: `Cycle Matured — Series ${raw.series?.name ?? "?"}: ${raw.cycle_label}`,
            message: `Series ${raw.series?.name ?? "?"} (${raw.cycle_label}) has matured today. Please declare the final Mudārabah profit so investors can submit their rollover or exit decisions.`,
            type: "maturity" as const,
            action_url: `/admin/cycles/${raw.id}/declare-profit`,
          }));
        });

        const { error: notifError } = await supabase
          .from("notifications")
          .insert(notifications);

        if (notifError) {
          console.error("[Cron] Failed to send maturity notifications:", notifError);
        }
      }
    }

    // Process scheduled communication campaigns that are now due —
    // one batch per campaign per cron run.
    const { data: dueCampaigns } = await supabase
      .from("comm_campaigns")
      .select("id")
      .in("status", ["queued", "processing"])
      .not("scheduled_for", "is", null)
      .lte("scheduled_for", new Date().toISOString())
      .limit(5);

    const commsResults: Record<string, unknown>[] = [];
    for (const c of dueCampaigns ?? []) {
      try {
        const r = await processCampaignChunk(supabase, c.id, { limit: 40 });
        commsResults.push({ campaign_id: c.id, ...r });
      } catch (commsErr) {
        console.error("[Cron] scheduled campaign error:", c.id, commsErr);
      }
    }

    return NextResponse.json({
      success: true,
      processed: rpcResult,
      next_cycles: openedCycles ?? null,
      matured_cycles: (newlyMatured ?? []).length,
      scheduled_campaigns: commsResults,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Cron] process-maturities error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
