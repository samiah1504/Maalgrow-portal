/**
 * Record a payment received from the counterparty for one month of an
 * active Cycle. Finance, administrators and super admins record; an
 * administrator or super admin may confirm in the same step
 * ("confirm_now"), including their own entry. Only confirmed money is
 * distributed — confirmation is maalrise_confirm_receipt in the
 * database, which works out the fee, the investors' shares and the
 * held excess.
 */
import { NextResponse } from "next/server";
import { MAALRISE_RECEIPT_ROLES, canApprove } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

type Body = { period?: number; amount_kobo?: number; received_on?: string; reference?: string; notes?: string; confirm_now?: boolean };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_RECEIPT_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });
  const b = await readJson<Body>(request);

  if (!Number.isInteger(b?.period) || (b?.period as number) < 1) {
    return NextResponse.json({ error: "Choose the month this payment is for." }, { status: 400 });
  }
  if (!Number.isInteger(b?.amount_kobo) || (b?.amount_kobo as number) <= 0) {
    return NextResponse.json({ error: "The amount received must be greater than zero." }, { status: 400 });
  }
  if (!b?.received_on || !/^\d{4}-\d{2}-\d{2}$/.test(b.received_on)) {
    return NextResponse.json({ error: "The date the payment was received is required." }, { status: 400 });
  }
  if (b.confirm_now && !canApprove(gate.role)) {
    return NextResponse.json({ error: "Only an administrator can confirm a payment." }, { status: 403 });
  }

  const rec = await gate.db.rpc("maalrise_record_receipt", {
    p_cycle: id,
    p: {
      period: b.period,
      amount_kobo: b.amount_kobo,
      received_on: b.received_on,
      reference: b.reference?.trim() ?? "",
      notes: b.notes?.trim() ?? "",
    },
  });
  if (rec.error) return dbError(rec.error);
  const receiptId = rec.data as string;
  if (!b.confirm_now) return NextResponse.json({ id: receiptId, confirmed: false }, { status: 201 });

  const conf = await gate.db.rpc("maalrise_confirm_receipt", { p_receipt: receiptId });
  if (conf.error) {
    // The entry is recorded; it can be confirmed from the list.
    return NextResponse.json(
      { id: receiptId, confirmed: false, warning: `Recorded, but not confirmed: ${conf.error.message}` },
      { status: 201 }
    );
  }
  return NextResponse.json({ id: receiptId, confirmed: true, distribution_id: conf.data }, { status: 201 });
}
