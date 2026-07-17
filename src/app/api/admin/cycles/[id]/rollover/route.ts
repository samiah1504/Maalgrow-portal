import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendRolloverEmails } from "@/lib/rollover-notify";

// Processing money movements is restricted to super admins
const PROCESS_ROLES = ["super_admin"];
const VIEW_ROLES = ["super_admin", "administrator", "finance"];

async function requireRole(allowed: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401, supabase: null };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !allowed.includes(profile.role ?? "")) {
    return { error: "Forbidden", status: 403, supabase: null };
  }
  return { error: null, status: 200, supabase };
}

// ─── GET: export rollover report as CSV ─────────────────────────────
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireRole(VIEW_ROLES);
  if (auth.error) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const adminClient = await createAdminClient();
  const { data: rows } = await adminClient
    .from("cycle_rollovers")
    .select(
      `id, decision, method, status, units, capital_rolled_over, profit_rolled_over,
       total_rollover_amount, rollover_balance, withdrawal_amount, error, email_sent,
       rollover_date,
       investor:investors(full_name, investor_code),
       destination_cycle:cycles!destination_cycle_id(cycle_label)`
    )
    .eq("source_cycle_id", id)
    .order("rollover_date", { ascending: true });

  type Row = {
    decision: string; method: string; status: string;
    units: number | null; capital_rolled_over: number; profit_rolled_over: number;
    total_rollover_amount: number; rollover_balance: number; withdrawal_amount: number;
    error: string | null; email_sent: boolean; rollover_date: string;
    investor: { full_name: string; investor_code: string } | null;
    destination_cycle: { cycle_label: string } | null;
  };

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = [
    "Investor", "Investor Code", "Decision", "Method", "Status", "Slots",
    "Capital Rolled Over", "Profit Rolled Over", "Total Rolled Over",
    "Rollover Balance", "Withdrawal Amount", "Destination Cycle",
    "Email Sent", "Error", "Processed At",
  ].join(",");

  const lines = ((rows ?? []) as unknown as Row[]).map((r) =>
    [
      esc(r.investor?.full_name), esc(r.investor?.investor_code),
      esc(r.decision), esc(r.method), esc(r.status), esc(r.units ?? ""),
      esc(r.capital_rolled_over), esc(r.profit_rolled_over),
      esc(r.total_rollover_amount), esc(r.rollover_balance),
      esc(r.withdrawal_amount), esc(r.destination_cycle?.cycle_label),
      esc(r.email_sent ? "yes" : "no"), esc(r.error), esc(r.rollover_date),
    ].join(",")
  );

  return new NextResponse([header, ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="rollover-report-${id}.csv"`,
    },
  });
}

// ─── POST: process (or retry) the cycle rollover ────────────────────
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const auth = await requireRole(PROCESS_ROLES);
  if (auth.error || !auth.supabase) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const body = (await request.json().catch(() => ({}))) as {
      destination_cycle_id?: string;
      convert_profit_to_slots?: boolean;
    };

    // The RPC runs with the admin's session so auth.uid()/is_admin()
    // inside the SECURITY DEFINER function see the real caller.
    const { data: result, error: rpcError } = await auth.supabase.rpc(
      "process_cycle_rollover",
      {
        p_source_cycle_id: id,
        p_destination_cycle_id: body.destination_cycle_id ?? null,
        p_convert_profit_to_slots: body.convert_profit_to_slots ?? false,
      }
    );

    if (rpcError) {
      if (rpcError.message.includes("NEXT_CYCLE_MISSING")) {
        return NextResponse.json(
          {
            error: rpcError.message.replace("NEXT_CYCLE_MISSING: ", ""),
            code: "NEXT_CYCLE_MISSING",
          },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: rpcError.message }, { status: 400 });
    }

    // Email dispatch is strictly after the rollover is committed —
    // failures are recorded on each record and retryable, and never
    // affect the rollover itself.
    const adminClient = await createAdminClient();
    const emails = await sendRolloverEmails(adminClient, id);

    return NextResponse.json({ result, emails });
  } catch (err) {
    console.error("[API] POST rollover error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
