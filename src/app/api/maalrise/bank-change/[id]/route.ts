/** The investor withdraws their own bank change request before it is reviewed. */
import { NextResponse } from "next/server";
import { dbError, isUuid, maalriseGate } from "@/lib/maalrise/api";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(["investor"]);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Request not found" }, { status: 404 });
  const res = await gate.db.rpc("maalrise_cancel_bank_change", { p_request: id });
  if (res.error) return dbError(res.error);
  return NextResponse.json({ ok: true });
}
