/**
 * Create a MaalRise Cycle with its first draft of terms.
 *
 * Prepare roles only (D8). The counterparty is chosen or created, the
 * Cycle is created as a draft, and the terms are saved through
 * maalrise_save_terms(), which recalculates every figure and refuses
 * anything it cannot reproduce. Nothing here approves, activates or
 * notifies anyone.
 */
import { NextResponse } from "next/server";
import { computeTerms } from "@/lib/maalrise/compute";
import { saveTermsArgs } from "@/lib/maalrise/terms-payload";
import { parseTermsInput } from "@/lib/maalrise/terms-input";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

type Body = {
  counterparty?: { id?: string; name?: string; registration_no?: string; contact_email?: string };
  cycle?: {
    name?: string;
    transaction_name?: string;
    description?: string;
    start_date?: string;
    duration_months?: number;
    stated_maturity_date?: string | null;
    unit_price_kobo?: number;
  };
  terms?: unknown;
};

export async function POST(request: Request) {
  const gate = await maalriseGate(MAALRISE_PREPARE_ROLES);
  if (!gate.ok) return gate.response;
  const body = await readJson<Body>(request);
  const c = body?.cycle;
  if (!c?.name?.trim() || !c.transaction_name?.trim()) {
    return NextResponse.json({ error: "Cycle name and transaction name are required." }, { status: 400 });
  }
  if (!c.start_date || !/^\d{4}-\d{2}-\d{2}$/.test(c.start_date)) {
    return NextResponse.json({ error: "A valid start date is required." }, { status: 400 });
  }
  const months = c.duration_months;
  if (!Number.isInteger(months) || (months as number) < 1 || (months as number) > 120) {
    return NextResponse.json({ error: "Duration must be 1 to 120 whole months." }, { status: 400 });
  }
  const unitPrice = c.unit_price_kobo;
  if (!Number.isInteger(unitPrice) || (unitPrice as number) <= 0) {
    return NextResponse.json({ error: "Unit price is required." }, { status: 400 });
  }

  // Check the terms completely BEFORE creating anything.
  const parsed = parseTermsInput(body?.terms, months as number);
  if ("error" in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });
  const breakdown = computeTerms(parsed.input);
  if (breakdown.errors.length) {
    return NextResponse.json({ error: breakdown.errors.map((e) => e.message).join(" ") }, { status: 400 });
  }
  if (parsed.input.costKobo % (unitPrice as number) !== 0) {
    return NextResponse.json(
      { error: "The transaction cost must be a whole number of units at this unit price." },
      { status: 400 }
    );
  }

  // Counterparty: an existing one, or a new one.
  let counterpartyId = body?.counterparty?.id;
  if (counterpartyId && !isUuid(counterpartyId)) {
    return NextResponse.json({ error: "Unknown counterparty." }, { status: 400 });
  }
  if (!counterpartyId) {
    if (!body?.counterparty?.name?.trim()) {
      return NextResponse.json({ error: "Choose a counterparty or enter a new one." }, { status: 400 });
    }
    const cp = await gate.db.rpc("maalrise_create_counterparty", {
      p: {
        name: body.counterparty.name,
        registration_no: body.counterparty.registration_no ?? "",
        contact_email: body.counterparty.contact_email ?? "",
      },
    });
    if (cp.error) return dbError(cp.error);
    counterpartyId = cp.data as string;
  }

  const created = await gate.db.rpc("maalrise_create_cycle", {
    p: {
      name: c.name,
      transaction_name: c.transaction_name,
      description: c.description ?? "",
      counterparty_id: counterpartyId,
      start_date: c.start_date,
      duration_months: months,
      stated_maturity_date: c.stated_maturity_date ?? "",
      unit_price_kobo: unitPrice,
    },
  });
  if (created.error) return dbError(created.error);
  const cycleId = created.data as string;

  const saved = await gate.db.rpc("maalrise_save_terms", { p_cycle: cycleId, ...saveTermsArgs(parsed.input, breakdown) });
  if (saved.error) {
    // The draft Cycle exists; its terms can be saved again from the Cycle page.
    return NextResponse.json(
      { id: cycleId, warning: `The Cycle was created but its terms were not saved: ${saved.error.message}` },
      { status: 201 }
    );
  }
  return NextResponse.json({ id: cycleId, terms_id: saved.data }, { status: 201 });
}
