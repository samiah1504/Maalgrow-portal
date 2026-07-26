import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";

const ADMIN_ROLES = ["super_admin", "administrator"];

// PATCH /api/admin/mudarabah/[id]
//
//   action: "unsettle"     — reopen a settled cycle. A reason is
//                            required; the earlier snapshot is kept and
//                            the action is logged with who and when.
//   action: "set_holding"  — record how many slots an investor holds
//                            and whether their capital is withdrawing
//                            or rolling over.
//
// Settling itself is not here: it needs the figures from the shared
// engine, and belongs with the settlement flow in a later step.
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

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const body = (await request.json()) as {
      action?: string;
      reason?: string;
      investorId?: string;
      slots?: number;
      capitalAction?: string;
    };

    if (body.action === "unsettle") {
      const reason = String(body.reason ?? "").trim();
      if (reason.length < 5) {
        return NextResponse.json(
          { error: "Say why this cycle is being reopened — it goes on the record." },
          { status: 400 }
        );
      }
      const { error } = await mudarabahDb(supabase).rpc("mudarabah_unsettle_cycle", {
        p_cycle_id: id,
        p_reason: reason,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    if (body.action === "set_holding") {
      const slots = Number(body.slots);
      if (!body.investorId) {
        return NextResponse.json({ error: "investorId is required" }, { status: 400 });
      }
      if (!Number.isInteger(slots) || slots < 1) {
        return NextResponse.json(
          { error: "Slots must be a whole number, at least 1" },
          { status: 400 }
        );
      }
      const capitalAction = body.capitalAction === "withdraw" ? "withdraw" : "rollover";
      const { error } = await mudarabahDb(supabase).rpc("mudarabah_set_holding", {
        p_cycle_id: id,
        p_investor_id: body.investorId,
        p_slots: slots,
        p_capital_action: capitalAction,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      { error: "action must be unsettle or set_holding" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update the cycle" },
      { status: 500 }
    );
  }
}
