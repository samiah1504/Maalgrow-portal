import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

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

    return NextResponse.json({
      success: true,
      processed: rpcResult,
      matured_cycles: (newlyMatured ?? []).length,
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
