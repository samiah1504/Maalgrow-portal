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
      .select("id, series_id, end_date")
      .eq("id", id)
      .single();
    if (!source) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    // Idempotent: if the next cycle already exists, return it
    const { data: existing } = await adminClient
      .from("cycles")
      .select("*")
      .eq("series_id", source.series_id)
      .eq("start_date", source.end_date)
      .maybeSingle();
    if (existing) {
      return NextResponse.json({ cycle: existing, created: false });
    }

    const { data: newId, error: rpcError } = await supabase.rpc(
      "create_next_cycle",
      { p_series_id: source.series_id }
    );
    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 400 });
    }

    const { data: cycle } = await adminClient
      .from("cycles")
      .select("*")
      .eq("id", newId as string)
      .single();

    return NextResponse.json({ cycle, created: true });
  } catch (err) {
    console.error("[API] POST rollover/next-cycle error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
