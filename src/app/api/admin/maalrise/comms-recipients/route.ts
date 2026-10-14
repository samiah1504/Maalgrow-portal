/**
 * For the Communication Centre: the investor records of MaalRise
 * investors — all of them, or those in one Cycle — so a campaign can
 * reach them through the same channels as MaalGrow. Read only; the
 * campaign itself is created and sent by the Communication Centre as
 * usual. Same roles as the Communication Centre.
 */
import { NextResponse } from "next/server";
import { isUuid, maalriseGate } from "@/lib/maalrise/api";

export async function GET(request: Request) {
  const gate = await maalriseGate(["super_admin", "administrator"]);
  if (!gate.ok) return gate.response;
  const cycleId = new URL(request.url).searchParams.get("cycle_id");
  if (cycleId && !isUuid(cycleId)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 400 });

  const [cycles, investors] = await Promise.all([
    gate.db.from("maalrise_cycles").select("id, name, status").in("status", ["active", "matured", "closed"]).order("start_date", { ascending: false }),
    gate.db.from("maalrise_investors").select("id, maalgrow_investor_id"),
  ]);
  if (cycles.error || investors.error) return NextResponse.json({ error: (cycles.error ?? investors.error)!.message }, { status: 400 });

  let rows = (investors.data ?? []) as { id: string; maalgrow_investor_id: string | null }[];
  if (cycleId) {
    const { data: allocs, error } = await gate.db.from("maalrise_allocations").select("maalrise_investor_id").eq("cycle_id", cycleId);
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });
    const inCycle = new Set((allocs ?? []).map((a: { maalrise_investor_id: string }) => a.maalrise_investor_id));
    rows = rows.filter((r) => inCycle.has(r.id));
  }
  return NextResponse.json({
    cycles: cycles.data ?? [],
    investor_ids: rows.map((r) => r.maalgrow_investor_id).filter((x): x is string => !!x),
    without_record: rows.filter((r) => !r.maalgrow_investor_id).length,
  });
}
