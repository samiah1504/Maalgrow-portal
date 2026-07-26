import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";

const ADMIN_ROLES = ["super_admin", "administrator"];

// POST /api/admin/mudarabah — create or update a Mudarabah cycle.
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

    const body = (await request.json()) as { cycle?: Record<string, unknown> };
    const cycle = body.cycle;
    if (!cycle || typeof cycle !== "object") {
      return NextResponse.json({ error: "cycle is required" }, { status: 400 });
    }
    if (!String(cycle.name ?? "").trim()) {
      return NextResponse.json({ error: "Give the cycle a name" }, { status: 400 });
    }
    if (!String(cycle.startDate ?? "").trim()) {
      return NextResponse.json({ error: "Give the cycle a start date" }, { status: 400 });
    }
    if (!Number(cycle.slotPrice)) {
      return NextResponse.json(
        { error: "A slot has to be worth something" },
        { status: 400 }
      );
    }

    // The session client, so auth.uid() is the person making the change
    const { data, error } = await mudarabahDb(supabase).rpc("mudarabah_save_cycle", {
      p_cycle: cycle,
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
