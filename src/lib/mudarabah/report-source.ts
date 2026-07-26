/**
 * Loading a cycle's report data from the database.
 *
 * This is the ONLY place the report reads storage. It exists so that
 * the boundary stays honest:
 *
 *   report-source.ts  reads the database
 *   report-figures.ts decides the figures — snapshot or live
 *   report-html.ts    renders, and touches neither
 *
 * The admin preview uses it now. The investor's own view and the email
 * job will use the same function, so a report cannot differ depending
 * on who asked for it.
 *
 * SERVER ONLY. It takes an admin Supabase client.
 */

import {
  draftFromLedger,
  termsFromLedger,
  toCycleInput,
  type LedgerPayload,
} from "./editor";
import type { SettlementComputed } from "./figures";
import {
  reportFigures,
  type CapitalDecision,
  type ReportCycle,
  type ReportFigures,
  type ReportHolding,
} from "./report-figures";
import type { CreditNoteData } from "./report-html";
import { mudarabahDb, type MudarabahClient } from "./db";

export type ReportSource = {
  cycleId: string;
  cycle: ReportCycle;
  figures: ReportFigures;
  holdings: ReportHolding[];
  /** True when the ledger has never been opened for this cycle */
  missingLedger: boolean;
};

/** The maturity instruction, as the report words it */
function decisionOf(
  raw: string | null | undefined,
  units: number,
  slotsToWithdraw: number | null
): { decision: CapitalDecision; slotsWithdrawn: number } {
  switch (raw) {
    case "exit":
      return { decision: "withdraw", slotsWithdrawn: units };
    case "partial_exit": {
      const n = Math.max(0, Math.min(units, Number(slotsToWithdraw ?? 0)));
      // A "partial" that takes everything is a withdrawal, and saying
      // otherwise on the statement would just confuse the investor.
      if (n >= units) return { decision: "withdraw", slotsWithdrawn: units };
      if (n <= 0) return { decision: "rollover", slotsWithdrawn: 0 };
      return { decision: "partial", slotsWithdrawn: n };
    }
    case "continue":
    case "rollover_all":
      return { decision: "rollover", slotsWithdrawn: 0 };
    default:
      // No instruction on record. The report says so rather than
      // guessing — the money is theirs and the choice is theirs.
      return { decision: "none", slotsWithdrawn: 0 };
  }
}

/**
 * Everything needed to render any investor's report for one cycle.
 *
 * A settled cycle reads its frozen snapshot. Anything else derives
 * live and comes back marked provisional.
 */
export async function loadReportSource(
  client: unknown,
  cycleId: string
): Promise<ReportSource | null> {
  const db: MudarabahClient = mudarabahDb(client);

  const { data: raw } = await db.rpc("mudarabah_get_ledger", {
    p_cycle_id: cycleId,
  });
  if (!raw) return null;

  const payload = raw as unknown as LedgerPayload;
  const terms = termsFromLedger(payload);
  const draft = draftFromLedger(payload);

  // The instruction lives on rollover_decisions. The ledger's own view
  // of it folds "no instruction" into "rollover"; a statement must not,
  // so read it directly.
  const { data: decisions } = await db
    .from("rollover_decisions")
    .select("investment_id, source_cycle_id, decision, slots_to_withdraw")
    .eq("source_cycle_id", cycleId);

  const byInvestment = new Map(
    (decisions ?? []).map((d) => [d.investment_id, d])
  );

  const holdings: ReportHolding[] = terms.holders.map((h) => {
    const d = byInvestment.get(h.investmentId);
    const { decision, slotsWithdrawn } = decisionOf(
      d?.decision,
      h.units,
      d?.slots_to_withdraw ?? null
    );
    return {
      investmentId: h.investmentId,
      investorName: h.investorName,
      investorCode: h.investorCode,
      units: h.units,
      decision,
      slotsWithdrawn,
    };
  });

  const cycle: ReportCycle = {
    seriesName: payload.seriesName,
    cycleLabel: payload.cycleLabel,
    startDate: payload.startDate,
    endDate: payload.endDate,
    description: payload.description,
    discloseMode: draft.discloseMode,
    totalUnits: terms.totalUnits,
    investorCount: holdings.length,
  };

  // Settled: the snapshot, never the engine.
  if (draft.status === "settled") {
    const { data: row } = await db
      .from("mudarabah_settlements")
      .select("settled_at, engine_version, wht_rate_used, computed")
      .eq("cycle_id", cycleId)
      .eq("is_current", true)
      .maybeSingle();

    if (row) {
      return {
        cycleId,
        cycle,
        holdings,
        missingLedger: !payload.hasLedger,
        figures: reportFigures({
          status: "settled",
          settlement: {
            computed: row.computed as SettlementComputed,
            settledAt: row.settled_at,
            engineVersion: row.engine_version,
            whtRate: Number(row.wht_rate_used ?? 0),
          },
        }),
      };
    }
    // Marked settled with no current snapshot — fall through and derive
    // live, which at least reports honestly instead of failing.
  }

  return {
    cycleId,
    cycle,
    holdings,
    missingLedger: !payload.hasLedger,
    figures: reportFigures({
      status: draft.status === "settled" ? "active" : draft.status,
      input: toCycleInput(draft, terms),
    }),
  };
}

/** One investor's holding within a loaded cycle */
export function holdingFor(
  source: ReportSource,
  investmentId: string
): ReportHolding | null {
  return source.holdings.find((h) => h.investmentId === investmentId) ?? null;
}

/* ── The credit note ─────────────────────────────────────────────── */

/**
 * A credit note exists only once the tax has been filed, so this
 * returns null far more often than not — and that is the correct
 * answer, not an error. Nothing is derived: whatever the note froze at
 * issuance is what the document says.
 */
export async function loadCreditNote(
  client: unknown,
  cycleId: string,
  investmentId: string,
  cycle: { seriesName: string; cycleLabel: string }
): Promise<CreditNoteData | null> {
  const db: MudarabahClient = mudarabahDb(client);

  const { data: note } = await db
    .from("wht_credit_notes")
    .select(
      "reference, investor_name, investor_address, investor_tin, period_start, period_end, gross_profit, wht_rate, wht_amount, net_paid, deducted_on, remittance_reference, filed_on"
    )
    .eq("cycle_id", cycleId)
    .eq("investment_id", investmentId)
    .maybeSingle();

  if (!note) return null;

  const { data: issuer } = await db
    .from("wht_issuer_settings")
    .select("company_name, company_address, company_tin, signatory_name, signatory_title")
    .eq("id", 1)
    .maybeSingle();

  return {
    reference: note.reference,
    issuer: {
      companyName: issuer?.company_name ?? "MaalGrow",
      companyAddress: issuer?.company_address ?? null,
      companyTin: issuer?.company_tin ?? null,
      signatoryName: issuer?.signatory_name ?? null,
      signatoryTitle: issuer?.signatory_title ?? null,
    },
    investorName: note.investor_name,
    investorAddress: note.investor_address,
    investorTin: note.investor_tin,
    seriesName: cycle.seriesName,
    cycleLabel: cycle.cycleLabel,
    periodStart: note.period_start,
    periodEnd: note.period_end,
    grossProfit: Number(note.gross_profit),
    // 0–1 both in the column and in CreditNoteData; the document is
    // what turns it into a percentage
    whtRate: Number(note.wht_rate),
    whtAmount: Number(note.wht_amount),
    netPaid: Number(note.net_paid),
    deductedOn: note.deducted_on,
    remittanceReference: note.remittance_reference,
    filedOn: note.filed_on,
  };
}
