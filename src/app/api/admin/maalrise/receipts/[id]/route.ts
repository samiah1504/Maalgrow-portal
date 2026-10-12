/**
 * Confirm or reject a recorded payment. Administrators and super
 * admins only; they may confirm an entry they recorded themselves.
 * Confirming generates (or adds to) the month's distribution for
 * review and approval — it never pays anyone.
 */
import { NextResponse } from "next/server";
import { MAALRISE_APPROVE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_APPROVE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown entry." }, { status: 404 });
  const b = await readJson<{ action?: string; reason?: string }>(request);

  if (b?.action === "confirm") {
    const res = await gate.db.rpc("maalrise_confirm_receipt", { p_receipt: id });
    if (res.error) return dbError(res.error);
    return NextResponse.json({ distribution_id: res.data });
  }
  if (b?.action === "reject") {
    if (!b.reason?.trim()) return NextResponse.json({ error: "A reason is required." }, { status: 400 });
    const res = await gate.db.rpc("maalrise_reject_receipt", { p_receipt: id, p_reason: b.reason });
    if (res.error) return dbError(res.error);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
