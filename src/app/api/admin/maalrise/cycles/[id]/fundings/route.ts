/**
 * Record capital paid in by an investor for a Cycle. Finance roles.
 *
 * The amount is worked out HERE from units × the Cycle's unit price,
 * never taken from the browser, and the database checks it again.
 * Recording is half of it: someone else must confirm (four eyes)
 * before it becomes an allocation.
 */
import { NextResponse } from "next/server";
import { MAALRISE_FINANCE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

type Body = { investor_id?: string; units?: number; received_on?: string; reference?: string };

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_FINANCE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  const b = await readJson<Body>(request);
  if (!isUuid(id) || !isUuid(b?.investor_id)) return NextResponse.json({ error: "Choose a Cycle and an investor." }, { status: 400 });
  if (!Number.isInteger(b?.units) || (b!.units as number) <= 0) {
    return NextResponse.json({ error: "Units must be a whole number greater than zero." }, { status: 400 });
  }
  if (!b?.received_on || !/^\d{4}-\d{2}-\d{2}$/.test(b.received_on)) {
    return NextResponse.json({ error: "The date received is required." }, { status: 400 });
  }
  if (!b.reference?.trim()) return NextResponse.json({ error: "A bank reference is required." }, { status: 400 });

  const { data: cycle, error } = await gate.db.from("maalrise_cycles").select("unit_price_kobo").eq("id", id).maybeSingle();
  if (error) return dbError(error);
  if (!cycle) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });

  const res = await gate.db.rpc("maalrise_record_funding", {
    p_cycle: id,
    p_investor: b.investor_id,
    p_units: b.units,
    p_amount_kobo: (b.units as number) * (cycle.unit_price_kobo as number),
    p_received_on: b.received_on,
    p_reference: b.reference,
  });
  if (res.error) return dbError(res.error);
  return NextResponse.json({ id: res.data }, { status: 201 });
}
