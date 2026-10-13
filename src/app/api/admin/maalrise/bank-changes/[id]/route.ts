/**
 * Review an investor's bank change request. Prepare roles (the ones
 * that already confirm bank details). Approving makes the new details
 * the CONFIRMED account; rejecting needs a reason, which the investor
 * sees.
 */
import { NextResponse } from "next/server";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_PREPARE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  const b = await readJson<{ action?: string; reason?: string }>(request);
  if (b?.action !== "approve" && b?.action !== "reject") {
    return NextResponse.json({ error: "Choose approve or reject." }, { status: 400 });
  }
  if (b.action === "reject" && !b.reason?.trim()) {
    return NextResponse.json({ error: "A reason is required to reject a request." }, { status: 400 });
  }
  const res = await gate.db.rpc("maalrise_review_bank_change", {
    p_request: id,
    p_approve: b.action === "approve",
    p_reason: b.action === "reject" ? b.reason!.trim() : null,
  });
  if (res.error) return dbError(res.error);
  return NextResponse.json({ ok: true });
}
