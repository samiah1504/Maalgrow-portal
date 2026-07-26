import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";
import { signedStatementUrl } from "@/lib/mudarabah/statements";
import { statementFilename } from "@/lib/mudarabah/pdf";

/**
 * GET /api/investor/statement?cycleId=…
 *
 * Hands back a short-lived signed URL for the investor's OWN statement.
 *
 * THE AUTHORISATION IS NOT IN THIS FILE. `mudarabah_my_statement` is
 * scoped by get_my_investor_id(), which resolves from the session —
 * so the cycleId in the query decides WHICH cycle is asked about, never
 * WHOSE figures come back. An investor asking about someone else's
 * cycle gets no row, exactly as though it did not exist.
 *
 * This route is not a back door round the on-screen view; it is the
 * same check, reaching the same rows.
 */
export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const cycleId = new URL(request.url).searchParams.get("cycleId");
    if (!cycleId) {
      return NextResponse.json({ error: "cycleId is required" }, { status: 400 });
    }

    // The SESSION-scoped client. Using the admin client here would
    // bypass every policy and make the id in the query authoritative.
    const db = mudarabahDb(supabase);
    const { data, error } = await db.rpc("mudarabah_my_statement", {
      p_cycle_id: cycleId,
    });
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const row = (Array.isArray(data) ? data[0] : data) as
      | { state: string; storage_path: string | null }
      | undefined;

    // Not theirs, or no such cycle. The same answer either way: an
    // investor must not be able to learn that a cycle exists by the
    // shape of the refusal.
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (row.state !== "ready" || !row.storage_path) {
      return NextResponse.json(
        {
          state: row.state,
          message:
            "Your statement is being prepared. It will be available here shortly.",
        },
        { status: 202 }
      );
    }

    // The label on the file, for a downloads folder or a WhatsApp thread
    const { data: cycleRow } = await mudarabahDb(await createAdminClient())
      .from("cycles")
      .select("cycle_label, series_id")
      .eq("id", cycleId)
      .maybeSingle();
    const { data: seriesRow } = await mudarabahDb(await createAdminClient())
      .from("series")
      .select("name")
      .eq("id", cycleRow?.series_id ?? "")
      .maybeSingle();

    const filename = statementFilename(
      String(seriesRow?.name ?? ""),
      cycleRow?.cycle_label ?? "Cycle"
    );

    const url = await signedStatementUrl(
      await createAdminClient(),
      row.storage_path,
      filename
    );
    if (!url) {
      return NextResponse.json(
        { error: "Could not prepare the download. Please try again." },
        { status: 500 }
      );
    }

    return NextResponse.json({ url, filename });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not fetch the statement" },
      { status: 500 }
    );
  }
}
