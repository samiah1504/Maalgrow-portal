/**
 * Confirm or reject a capital entry (administrators and super admins),
 * or reverse a confirmed one (super admin, with a reason, before the
 * capital settlement is approved).
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
    const res = await gate.db.rpc("maalrise_confirm_capital", { p_receipt: id });
    if (res.error) return dbError(res.error);
    return NextResponse.json({ settlement_id: res.data });
  }
  if (b?.action === "reject" || b?.action === "reverse") {
    if (!b.reason?.trim()) return NextResponse.json({ error: "A reason is required." }, { status: 400 });
    if (b.action === "reverse" && gate.role !== "super_admin") {
      return NextResponse.json({ error: "Only a super admin can reverse a confirmed entry." }, { status: 403 });
    }
    const res = await gate.db.rpc(b.action === "reject" ? "maalrise_reject_capital" : "maalrise_reverse_capital",
      { p_receipt: id, p_reason: b.reason });
    if (res.error) return dbError(res.error);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
