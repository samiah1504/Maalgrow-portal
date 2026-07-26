import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";

const ADMIN_ROLES = ["super_admin", "administrator"];

// POST /api/admin/mudarabah — create or update a cycle's trading ledger.
//
// Inputs only. Every money value is integer kobo. The database
// function refuses to write to a settled cycle, so a correction has
// to go through the unsettle action and leave a trail.
export async function POST(request: Request) {
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

    const body = (await request.json()) as {
      ledger?: Record<string, unknown>;
      ratio?: number;
    };
    const ledger = body.ledger;
    if (!ledger || typeof ledger !== "object") {
      return NextResponse.json({ error: "ledger is required" }, { status: 400 });
    }
    if (!String(ledger.cycleId ?? "").trim()) {
      return NextResponse.json(
        { error: "A ledger has to belong to an existing cycle" },
        { status: 400 }
      );
    }

    const db = mudarabahDb(supabase);

    // The cycle's own ratio, if it is still editable. The database
    // refuses once subscriptions have closed.
    if (typeof body.ratio === "number" && body.ratio > 0 && body.ratio < 1) {
      const { error: termsError } = await db.rpc("mudarabah_set_cycle_terms", {
        p_cycle_id: String(ledger.cycleId),
        p_investor_ratio: body.ratio,
      });
      if (termsError) {
        return NextResponse.json({ error: termsError.message }, { status: 400 });
      }
    }

    // The session client, so auth.uid() is the person making the change
    const { data, error } = await db.rpc("mudarabah_save_ledger", {
      p_ledger: ledger,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ id: data });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save the cycle" },
      { status: 500 }
    );
  }
}
