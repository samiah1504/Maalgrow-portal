import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const ADMIN_ROLES = ["super_admin", "administrator", "finance"];

// PATCH /api/admin/investments/[id]
// action: "set_slots" — directly adjust an investor's slot count.
// Capital is recalculated as slots × slot value, and the cycle
// totals update automatically via the update_cycle_totals trigger,
// so every portfolio view (investor dashboard, series/cycle pages,
// reports) reflects the change immediately.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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

    const { id } = await params;
    const body = (await request.json()) as {
      action?: string;
      units?: number;
      reason?: string;
    };

    if (body.action !== "set_slots") {
      return NextResponse.json(
        { error: "action must be set_slots" },
        { status: 400 }
      );
    }

    const units = Number(body.units);
    if (isNaN(units) || units < 0.5 || !Number.isInteger(units * 2)) {
      return NextResponse.json(
        { error: "Slots must be at least 0.5, in steps of 0.5" },
        { status: 400 }
      );
    }

    const adminClient = await createAdminClient();
    const { data: investment, error: invErr } = await adminClient
      .from("investments")
      .select("id, investor_id, units, capital, price_per_unit, status, investment_code")
      .eq("id", id)
      .single();

    if (invErr || !investment) {
      return NextResponse.json({ error: "Investment not found" }, { status: 404 });
    }

    if (investment.status !== "active") {
      return NextResponse.json(
        {
          error: `Only active investments can be adjusted (this one is ${investment.status}). Matured or completed cycles are historical records.`,
        },
        { status: 400 }
      );
    }

    const newCapital =
      Math.round(units * investment.price_per_unit * 100) / 100;

    if (units === investment.units && newCapital === investment.capital) {
      return NextResponse.json({
        success: true,
        units,
        capital: newCapital,
        message: "No change",
      });
    }

    // The update_cycle_totals trigger (migration 014) applies the
    // delta to the cycle's total_capital / total_slots.
    const { error: updateErr } = await adminClient
      .from("investments")
      .update({
        units,
        capital: newCapital,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (updateErr) {
      return NextResponse.json(
        { error: "Failed to update slots: " + updateErr.message },
        { status: 500 }
      );
    }

    // Audit trail records who changed it, from what, to what
    await supabase.rpc("create_audit_log", {
      p_action: "investment_slots_adjusted",
      p_entity_type: "investment",
      p_entity_id: id,
      p_old_values: {
        units: investment.units,
        capital: investment.capital,
      },
      p_new_values: {
        units,
        capital: newCapital,
        reason: body.reason?.trim() || null,
      },
    });

    return NextResponse.json({
      success: true,
      units,
      capital: newCapital,
    });
  } catch (err) {
    console.error("[API] PATCH /admin/investments/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
