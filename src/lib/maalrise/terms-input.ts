/**
 * Parse terms as posted by the browser into a TermsInput.
 *
 * Only the INPUTS are accepted from the client — cost, markup, fee,
 * schedule choice. Every figure derived from them is recalculated on
 * the server by computeTerms() and then again by the database, so a
 * tampered total in a request has nowhere to go.
 */
import type { FeeBasis, FeeTreatment, TermsInput } from "./compute";

const int = (v: unknown) => (typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null);

export function parseTermsInput(raw: unknown, durationMonths: number): { input: TermsInput } | { error: string } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cost = int(r.costKobo);
  if (!cost) return { error: "Transaction cost is required." };

  const m = (r.markup ?? {}) as Record<string, unknown>;
  let markup: TermsInput["markup"];
  if (m.type === "percent" && int(m.bps) !== null) markup = { type: "percent", bps: int(m.bps)! };
  else if (m.type === "amount" && int(m.kobo) !== null) markup = { type: "amount", kobo: int(m.kobo)! };
  else return { error: "Markup must be a total percentage or amount for the whole Cycle." };

  const f = (r.fee ?? {}) as Record<string, unknown>;
  const treatments: FeeTreatment[] = ["deducted_from_investors", "charged_to_counterparty", "waived"];
  const bases: FeeBasis[] = ["cost", "markup", "fixed"];
  if (!treatments.includes(f.treatment as FeeTreatment)) return { error: "The fee treatment stated in the contract is required." };
  if (!bases.includes(f.basis as FeeBasis)) return { error: "Fee basis is required." };
  const fee: TermsInput["fee"] =
    f.basis === "fixed"
      ? { basis: "fixed", kobo: int(f.kobo) ?? undefined, treatment: f.treatment as FeeTreatment }
      : { basis: f.basis as FeeBasis, bps: int(f.bps) ?? undefined, treatment: f.treatment as FeeTreatment };

  const s = (r.schedule ?? {}) as Record<string, unknown>;
  let schedule: TermsInput["schedule"];
  if (s.mode === "equal") schedule = { mode: "equal" };
  else if (s.mode === "contract" && Array.isArray(s.netKobo)) {
    schedule = { mode: "contract", netKobo: s.netKobo.map((x) => (int(x) ?? NaN)) };
  } else return { error: "Choose equal instalments or contract-specific monthly amounts." };

  const stated = r.statedSalePriceKobo == null ? null : int(r.statedSalePriceKobo);
  if (r.statedSalePriceKobo != null && stated === null) return { error: "The contract sale price must be an amount." };

  return { input: { costKobo: cost, markup, statedSalePriceKobo: stated, fee, durationMonths, schedule } };
}
