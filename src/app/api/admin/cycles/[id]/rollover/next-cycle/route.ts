import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Creates the next cycle for the series of the given (source) cycle so
// the Super Admin can confirm it before the rollover is finalised.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const adminClient = await createAdminClient();
    const { data: source } = await adminClient
      .from("cycles")
      .select("id")
      .eq("id", id)
      .single();
    if (!source) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    // Idempotent, and resolved the way the rollover engine resolves it
    // (migration 036): the earliest cycle in the series starting on or
    // after this one ends. The previous exact start_date = end_date
    // check missed every successor created since 036, so each click
    // appended another cycle. Both functions are revoked from
    // authenticated, hence the service-role client.
    const { data: existingId, error: lookupError } = await adminClient.rpc(
      "mudarabah_next_cycle",
      { p_source_cycle_id: id }
    );
    if (lookupError) {
      return NextResponse.json({ error: lookupError.message }, { status: 400 });
    }

    const { data: nextId, error: rpcError } = await adminClient.rpc(
      "mudarabah_ensure_next_cycle",
      { p_source_cycle_id: id }
    );
    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 400 });
    }

    const { data: cycle } = await adminClient
      .from("cycles")
      .select("*")
      .eq("id", nextId)
      .single();

    return NextResponse.json({ cycle, created: existingId === null });
  } catch (err) {
    console.error("[API] POST rollover/next-cycle error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
