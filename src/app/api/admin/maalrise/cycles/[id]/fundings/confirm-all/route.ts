/**
 * Confirm all of a Cycle's recorded funding in one press. Finance roles.
 *
 * Each record goes through maalrise_confirm_funding() as if confirmed
 * one by one, so every database rule still applies: someone other than
 * the recorder confirms, or a super admin with a reason (migration 056),
 * and never more units than the cost requires. Records this person
 * may not confirm are left as they are and listed with the reason.
 */
import { NextResponse } from "next/server";
import { MAALRISE_FINANCE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_FINANCE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });
  const b = await readJson<{ self_reason?: string }>(request);
  const selfReason = b?.self_reason?.trim() || null;

  const { data, error } = await gate.db.from("maalrise_investor_fundings")
    .select("id, recorded_by, reference, units").eq("cycle_id", id).eq("status", "recorded")
    .order("received_on").order("created_at");
  if (error) return dbError(error);
  if (!data?.length) return NextResponse.json({ error: "There is no recorded funding to confirm." }, { status: 400 });

  const results: { id: string; reference: string; ok: boolean; message: string }[] = [];
  for (const f of data) {
    const mine = f.recorded_by === gate.userId;
    if (mine && gate.role !== "super_admin") {
      results.push({ id: f.id, reference: f.reference, ok: false, message: "You recorded this; another finance person must confirm it" });
      continue;
    }
    if (mine && !selfReason) {
      results.push({ id: f.id, reference: f.reference, ok: false, message: "You recorded this; give a reason to confirm your own entries" });
      continue;
    }
    const res = await gate.db.rpc("maalrise_confirm_funding", { p_funding: f.id, p_self_reason: mine ? selfReason : null });
    results.push({ id: f.id, reference: f.reference, ok: !res.error, message: res.error ? res.error.message : "Confirmed" });
  }
  return NextResponse.json({
    confirmed: results.filter((r) => r.ok).length,
    not_confirmed: results.filter((r) => !r.ok).length,
    results,
  });
}
