/**
 * Approve a prepared distribution, or refresh it (re-take each
 * investor's confirmed bank account and recalculate). Administrators
 * and super admins. Approval makes each investor payment payable; the
 * transfers themselves happen outside the system.
 */
import { NextResponse } from "next/server";
import { MAALRISE_APPROVE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_APPROVE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown distribution." }, { status: 404 });
  const b = await readJson<{ action?: string }>(request);

  const fn = b?.action === "approve" ? "maalrise_approve_distribution" : b?.action === "refresh" ? "maalrise_refresh_distribution" : null;
  if (!fn) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  const res = await gate.db.rpc(fn, { p_dist: id });
  if (res.error) return dbError(res.error);
  return NextResponse.json({ ok: true });
}
