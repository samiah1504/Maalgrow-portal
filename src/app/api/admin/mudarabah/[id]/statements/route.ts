import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";
import { generateStatements } from "@/lib/mudarabah/statements";

const ADMIN_ROLES = ["super_admin", "administrator"];

async function guard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { supabase };
}

// GET  /api/admin/mudarabah/[id]/statements — who has a document and who does not
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await guard();
  if (g.error) return g.error;

  const { id } = await params;
  const { data, error } = await mudarabahDb(g.supabase).rpc(
    "mudarabah_statement_status",
    { p_cycle_id: id }
  );
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ statements: data ?? [] });
}

// POST /api/admin/mudarabah/[id]/statements
//
//   action: "generate"   — build whatever is outstanding (pending or failed)
//   action: "regenerate" — rebuild EVERY document for the cycle
//
// Regeneration is for when a rendering fault is found after the fact.
// It rebuilds documents from the settlement they were always rendered
// from; the snapshot is not touched and no figure can move. What
// changes is the file, and nothing else.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const g = await guard();
    if (g.error) return g.error;

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { action?: string };
    const db = mudarabahDb(g.supabase);

    if (body.action === "regenerate") {
      const { error } = await db.rpc("mudarabah_requeue_statements", {
        p_cycle_id: id,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    } else if (body.action !== "generate") {
      return NextResponse.json(
        { error: "action must be generate or regenerate" },
        { status: 400 }
      );
    }

    const admin = await createAdminClient();
    const result = await generateStatements(admin, id);

    return NextResponse.json({
      ok: result.failed === 0,
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not build the statements" },
      { status: 500 }
    );
  }
}
