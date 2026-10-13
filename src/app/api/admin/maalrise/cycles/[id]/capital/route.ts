/**
 * Record capital repaid by the counterparty (Phase 5). Finance,
 * administrators and super admins record; an administrator or super
 * admin may confirm in the same step. Several entries are allowed (a
 * split transfer) but never more than the capital owed; investors are
 * paid out only once the FULL capital is confirmed.
 */
import { NextResponse } from "next/server";
import { MAALRISE_RECEIPT_ROLES, canApprove } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

type Body = { amount_kobo?: number; received_on?: string; reference?: string; notes?: string; confirm_now?: boolean };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_RECEIPT_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });
  const b = await readJson<Body>(request);
  if (!Number.isInteger(b?.amount_kobo) || (b?.amount_kobo as number) <= 0) {
    return NextResponse.json({ error: "The amount received must be greater than zero." }, { status: 400 });
  }
  if (!b?.received_on || !/^\d{4}-\d{2}-\d{2}$/.test(b.received_on)) {
    return NextResponse.json({ error: "The date the capital was received is required." }, { status: 400 });
  }
  if (b.confirm_now && !canApprove(gate.role)) {
    return NextResponse.json({ error: "Only an administrator can confirm capital." }, { status: 403 });
  }
  const rec = await gate.db.rpc("maalrise_record_capital", {
    p_cycle: id,
    p: { amount_kobo: b.amount_kobo, received_on: b.received_on, reference: b.reference?.trim() ?? "", notes: b.notes?.trim() ?? "" },
  });
  if (rec.error) return dbError(rec.error);
  const entryId = rec.data as string;
  if (!b.confirm_now) return NextResponse.json({ id: entryId, confirmed: false }, { status: 201 });
  const conf = await gate.db.rpc("maalrise_confirm_capital", { p_receipt: entryId });
  if (conf.error) {
    return NextResponse.json({ id: entryId, confirmed: false, warning: `Recorded, but not confirmed: ${conf.error.message}` }, { status: 201 });
  }
  return NextResponse.json({ id: entryId, confirmed: true, settlement_id: conf.data }, { status: 201 });
}
