import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";
import { generateStatements } from "@/lib/mudarabah/statements";
import { emailStatements } from "@/lib/mudarabah/statement-email";

const ADMIN_ROLES = ["super_admin", "administrator"];

/**
 * Rendering a PDF launches a headless browser. The platform default of
 * a few seconds is nowhere near enough, and when it is exceeded the
 * function is killed with no error recorded anywhere — which is
 * exactly the "it said success and nothing happened" failure this
 * route produced. Ask for the longest run the plan allows.
 */
export const maxDuration = 300;

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
//   action: "email"      — send the outstanding statement emails
//   action: "email-retry"— and the ones that failed before
//   action: "release"    — free rows stuck mid-send after a crash
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
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      limit?: number;
    };
    const db = mudarabahDb(g.supabase);

    /* ── Sending ─────────────────────────────────────────────
       Deliberately its own action, never a side effect of settling.
       Thirty-eight emails firing the instant Settle is pressed would
       remove any chance to read the covering note first — and
       settlement carries a standing rule that it must not acquire new
       ways to fail. */
    if (body.action === "email" || body.action === "email-retry") {
      const admin = await createAdminClient();
      const result = await emailStatements(admin, id, {
        retry: body.action === "email-retry",
      });
      return NextResponse.json({ ok: result.failed === 0, ...result });
    }

    if (body.action === "release") {
      const { data, error } = await db.rpc(
        "mudarabah_release_stuck_statement_emails",
        { p_cycle_id: id }
      );
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, released: data ?? 0 });
    }

    if (body.action === "regenerate") {
      const { error } = await db.rpc("mudarabah_requeue_statements", {
        p_cycle_id: id,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    } else if (body.action !== "generate") {
      return NextResponse.json(
        {
          error:
            "action must be generate, regenerate, email, email-retry or release",
        },
        { status: 400 }
      );
    }

    const admin = await createAdminClient();
    // A few at a time. Rendering every document in one request runs
    // for minutes and the platform kills it partway with nothing to
    // show for it; the page calls this repeatedly until `outstanding`
    // reaches zero.
    const limit = Math.max(1, Math.min(Number(body.limit) || 5, 25));
    const result = await generateStatements(admin, id, { limit });

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
