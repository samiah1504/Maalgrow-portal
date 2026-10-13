/**
 * Approve a capital settlement, or refresh its bank snapshots first.
 * Administrators and super admins. Approval makes each investor's
 * capital repayment payable; transfers happen outside the system.
 */
import { NextResponse } from "next/server";
import { MAALRISE_APPROVE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_APPROVE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown settlement." }, { status: 404 });
  const b = await readJson<{ action?: string }>(request);
  const fn = b?.action === "approve" ? "maalrise_approve_capital_settlement"
    : b?.action === "refresh" ? "maalrise_refresh_capital_settlement" : null;
  if (!fn) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const res = await gate.db.rpc(fn, { p_settlement: id });
  if (res.error) return dbError(res.error);
  return NextResponse.json({ ok: true });
}
