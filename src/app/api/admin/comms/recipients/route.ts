import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireCommsAdmin, loadCommRecipients, type CommGroup } from "@/lib/comms/server";

// GET ?group=…&series_id=…&cycle_id=…&ids=a,b,c&for_email=1
// Returns the resolved recipient preview with validity stats.
export async function GET(request: Request) {
  const auth = await requireCommsAdmin();
  if (!auth.ok) return auth.response;

  const url = new URL(request.url);
  const group = (url.searchParams.get("group") ?? "all_active") as CommGroup;
  const seriesId = url.searchParams.get("series_id");
  const cycleId = url.searchParams.get("cycle_id");
  const forEmail = url.searchParams.get("for_email") === "1";
  const ids = url.searchParams.get("ids")?.split(",").filter(Boolean) ?? null;

  if (["series", "cycle"].includes(group) && !seriesId) {
    return NextResponse.json({ error: "series_id is required" }, { status: 400 });
  }
  if (group === "cycle" && !cycleId) {
    return NextResponse.json({ error: "cycle_id is required" }, { status: 400 });
  }
  if (group === "individual" && (!ids || ids.length === 0)) {
    return NextResponse.json({ recipients: [], stats: { total_selected: 0, valid_phones: 0, invalid_phones: 0, duplicates_removed: 0 } });
  }

  const db = await createAdminClient();
  const { recipients, stats } = await loadCommRecipients(db, {
    group,
    seriesId,
    cycleId,
    investorIds: ids,
    forEmail,
  });

  return NextResponse.json({
    stats,
    recipients: recipients.map((r) => ({
      investor_id: r.investor_id,
      full_name: r.full_name,
      investor_code: r.investor_code,
      email: r.email,
      phone_raw: r.phone_raw,
      phone_normalized: r.phone_normalized,
      preferred_channel: r.preferred_channel,
      skip_reason: r.skip_reason,
      sample_vars: r.vars,
    })),
  });
}
