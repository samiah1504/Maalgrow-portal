import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";

const ADMIN_ROLES = ["super_admin", "administrator", "finance"];

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: cycleId } = await params;
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!callerProfile || !ADMIN_ROLES.includes(callerProfile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { total_revenue, total_expenses, notes } = body as {
      total_revenue: unknown;
      total_expenses: unknown;
      notes?: string;
    };

    if (
      typeof total_revenue !== "number" ||
      isNaN(total_revenue) ||
      total_revenue < 0
    ) {
      return NextResponse.json(
        { error: "total_revenue must be a non-negative number" },
        { status: 400 }
      );
    }

    if (
      typeof total_expenses !== "number" ||
      isNaN(total_expenses) ||
      total_expenses < 0
    ) {
      return NextResponse.json(
        { error: "total_expenses must be a non-negative number" },
        { status: 400 }
      );
    }

    // A cycle with a trading ledger declares its profit by settling the
    // ledger, which calls declare_cycle_profit itself with figures the
    // engine produced. Accepting a hand-entered declaration as well
    // would let whichever ran last silently overwrite the other.
    const { data: ledger } = await mudarabahDb(supabase)
      .from("mudarabah_ledgers")
      .select("cycle_id")
      .eq("cycle_id", cycleId)
      .maybeSingle();

    if (ledger) {
      return NextResponse.json(
        {
          error:
            "This cycle has a Mudarabah trading ledger. Declare its profit by settling the ledger, not by entering figures here.",
        },
        { status: 409 }
      );
    }

    // Use the admin's session so declared_by records who declared it
    // (the function itself is SECURITY DEFINER).
    const { data, error } = await supabase.rpc("declare_cycle_profit", {
      p_cycle_id: cycleId,
      p_total_revenue: total_revenue,
      p_total_expenses: total_expenses,
      p_notes: notes?.trim() || null,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "P0001" ? 400 : 500 }
      );
    }

    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error("[API] POST /admin/cycles/[id]/declare-profit error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
