/**
 * Save the open draft of a Cycle's terms, or start a new version of
 * approved terms. Prepare roles only. The database recalculates every
 * figure and keeps approved versions frozen.
 */
import { NextResponse } from "next/server";
import { computeTerms } from "@/lib/maalrise/compute";
import { saveTermsArgs } from "@/lib/maalrise/terms-payload";
import { parseTermsInput } from "@/lib/maalrise/terms-input";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_PREPARE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });

  const { data: cycle, error } = await gate.db
    .from("maalrise_cycles")
    .select("id, duration_months, unit_price_kobo")
    .eq("id", id)
    .maybeSingle();
  if (error) return dbError(error);
  if (!cycle) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });

  const body = await readJson<{ terms?: unknown }>(request);
  const parsed = parseTermsInput(body?.terms, cycle.duration_months as number);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const breakdown = computeTerms(parsed.input);
  if (breakdown.errors.length) {
    return NextResponse.json({ error: breakdown.errors.map((e) => e.message).join(" ") }, { status: 400 });
  }
  if (parsed.input.costKobo % (cycle.unit_price_kobo as number) !== 0) {
    return NextResponse.json({ error: "The transaction cost must be a whole number of units at this unit price." }, { status: 400 });
  }
  const saved = await gate.db.rpc("maalrise_save_terms", { p_cycle: id, ...saveTermsArgs(parsed.input, breakdown) });
  if (saved.error) return dbError(saved.error);
  return NextResponse.json({ terms_id: saved.data });
}
