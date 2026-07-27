import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";

const ADMIN_ROLES = ["super_admin", "administrator"];

// PATCH /api/admin/mudarabah/[id]
//
//   action: "unsettle"     — reopen a settled cycle. A reason is
//                            required; the earlier snapshot is kept and
//                            the action is logged with who and when.
//   action: "set_terms"    — the cycle's own profit-sharing ratio and
//                            withholding rate. Refused once
//                            subscriptions have closed.
//
// Membership is NOT set here: how many slots an investor holds lives
// on their investment, and what happens to their capital lives on
// their maturity instruction.
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
      investorRatio?: number;
      whtRate?: number;
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

    if (body.action === "set_terms") {
      const { error } = await mudarabahDb(supabase).rpc("mudarabah_set_cycle_terms", {
        p_cycle_id: id,
        p_investor_ratio: body.investorRatio ?? null,
        p_wht_rate: body.whtRate ?? null,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    // The withholding rate has its own action because it has its own
    // lifetime. The ratio and the slot value are terms an investor
    // agreed to and freeze when subscriptions close; the withholding
    // rate is statutory and stays correctable until settlement, which
    // is where it genuinely freezes. See migration 025.
    if (body.action === "set_wht_rate") {
      const rate = Number(body.whtRate);
      if (!Number.isFinite(rate) || rate < 0 || rate >= 1) {
        return NextResponse.json(
          {
            error:
              "The withholding rate must be a fraction of one — 0.10 for ten per cent.",
          },
          { status: 400 }
        );
      }
      const { error } = await mudarabahDb(supabase).rpc("mudarabah_set_wht_rate", {
        p_cycle_id: id,
        p_rate: rate,
        p_reason: body.reason?.trim() || null,
      });
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    // The ratio has its own action for the same reason the withholding
    // rate does, but the rule is different: after subscriptions close
    // it may only move in the investors' favour. See migration 026.
    if (body.action === "set_investor_ratio") {
      const r = Number(body.investorRatio);
      if (!Number.isFinite(r) || r <= 0 || r >= 1) {
        return NextResponse.json(
          {
            error:
              "The slot holders' share must be a fraction of one — 0.60 for sixty per cent.",
          },
          { status: 400 }
        );
      }
      const { error } = await mudarabahDb(supabase).rpc(
        "mudarabah_set_investor_ratio",
        { p_cycle_id: id, p_ratio: r, p_reason: body.reason?.trim() || null }
      );
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json(
      {
        error:
          "action must be unsettle, set_terms, set_wht_rate or set_investor_ratio",
      },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not update the cycle" },
      { status: 500 }
    );
  }
}
