/**
 * Record that an approved investor payment was transferred ("Mark as
 * Paid"), or reverse that record.
 *
 * Mark as Paid: the payment officer, administrators and super admins,
 * after making the bank transfer outside the system. The status is
 * stored once, on the payment line, and every screen reads it there.
 * Reverse: super admin only, with a reason; the history keeps both.
 */
import { NextResponse } from "next/server";
import { MAALRISE_PAY_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_PAY_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown payment." }, { status: 404 });
  const b = await readJson<{ action?: string; paid_on?: string; reference?: string; reason?: string }>(request);

  if (b?.action === "mark_paid") {
    if (!b.paid_on || !/^\d{4}-\d{2}-\d{2}$/.test(b.paid_on)) {
      return NextResponse.json({ error: "The date of the transfer is required." }, { status: 400 });
    }
    const res = await gate.db.rpc("maalrise_mark_line_paid", { p_line: id, p_paid_on: b.paid_on, p_reference: b.reference ?? "" });
    if (res.error) return dbError(res.error);
    return NextResponse.json({ ok: true });
  }
  if (b?.action === "reverse") {
    if (gate.role !== "super_admin") return NextResponse.json({ error: "Only a super admin can reverse a payment." }, { status: 403 });
    if (!b.reason?.trim()) return NextResponse.json({ error: "A reason is required." }, { status: 400 });
    const res = await gate.db.rpc("maalrise_reverse_line_payment", { p_line: id, p_reason: b.reason });
    if (res.error) return dbError(res.error);
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
