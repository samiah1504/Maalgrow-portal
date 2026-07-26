/**
 * Generating and storing an investor's statement.
 *
 * ONE FILE. The PDF an investor downloads and the PDF attached to
 * their cycle-end email are the same object in storage, not two
 * renders that ought to agree — two renders can drift apart, and then
 * what someone received by email contradicts what their portal shows.
 *
 * Generation runs AFTER settlement has committed, never inside it.
 * Settlement is the money event; it must not fail because a browser
 * timed out. If generation fails the settlement still stands, an
 * administrator sees the failure and can retry, and the investor is
 * told their statement is being prepared.
 *
 * SERVER ONLY.
 */

import { mudarabahDb } from "./db";
import { figuresFromSettlement, type ReportCycle, type ReportHolding } from "./report-figures";
import { renderReportDocument } from "./report-html";
import { htmlToPdf, statementStoragePath } from "./pdf";
import type { SettlementComputed } from "./figures";

export const STATEMENT_BUCKET = "mudarabah-statements";

export type GenerationResult = {
  total: number;
  generated: number;
  failed: number;
  errors: { investorName: string; message: string }[];
};

type PendingRow = {
  id: string;
  investment_id: string;
  investor_id: string;
  cycle_id: string;
  settlement_id: string;
};

/**
 * Build every outstanding statement for a cycle.
 *
 * Each document is independent: one failure is recorded against that
 * row and the rest carry on. Returning a summary rather than throwing
 * means a partial success is visible as a partial success.
 */
export async function generateStatements(
  adminClient: unknown,
  cycleId: string
): Promise<GenerationResult> {
  const db = mudarabahDb(adminClient);
  const storage = (adminClient as {
    storage: {
      from: (b: string) => {
        upload: (
          path: string,
          body: Buffer,
          opts: { contentType: string; upsert: boolean }
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
  }).storage;

  // The current settlement and everything the report needs from it
  const { data: settlement } = await db
    .from("mudarabah_settlements")
    .select("id, settled_at, engine_version, wht_rate_used, computed")
    .eq("cycle_id", cycleId)
    .eq("is_current", true)
    .maybeSingle();

  if (!settlement) {
    throw new Error("This cycle has no current settlement, so it has no statements");
  }

  const { data: cycleRow } = await db
    .from("cycles")
    .select("id, cycle_label, start_date, end_date, series_id")
    .eq("id", cycleId)
    .maybeSingle();
  const { data: seriesRow } = await db
    .from("series")
    .select("name")
    .eq("id", cycleRow?.series_id ?? "")
    .maybeSingle();
  const { data: ledgerRow } = await db
    .from("mudarabah_ledgers")
    .select("description, disclose_mode")
    .eq("cycle_id", cycleId)
    .maybeSingle();

  // The figures come from the SNAPSHOT. The engine is never called.
  const figures = figuresFromSettlement(
    settlement.computed as SettlementComputed,
    settlement.settled_at,
    settlement.engine_version,
    Number(settlement.wht_rate_used ?? 0)
  );

  const { data: holders } = await db
    .from("mudarabah_settlement_holders")
    .select("investment_id, investor_id, units, capital_action, slots_withdrawn")
    .eq("settlement_id", settlement.id);

  const cycle: ReportCycle = {
    seriesName: String(seriesRow?.name ?? ""),
    cycleLabel: cycleRow?.cycle_label ?? "",
    startDate: cycleRow?.start_date ?? "",
    endDate: cycleRow?.end_date ?? "",
    description: ledgerRow?.description ?? null,
    discloseMode: ledgerRow?.disclose_mode === "full" ? "full" : "perSlot",
    totalUnits: figures.totalUnits,
    investorCount: (holders ?? []).length,
  };

  const { data: pending } = await db
    .from("mudarabah_statements")
    .select("id, investment_id, investor_id, cycle_id, settlement_id")
    .eq("settlement_id", settlement.id)
    .eq("kind", "statement")
    .neq("state", "ready");

  const rows = (pending ?? []) as unknown as PendingRow[];
  const byInvestment = new Map((holders ?? []).map((h) => [h.investment_id, h]));

  const { data: investors } = await db
    .from("investors")
    .select("id, full_name, investor_code")
    .in("id", rows.map((r) => r.investor_id));
  const investorById = new Map((investors ?? []).map((i) => [i.id, i]));

  const result: GenerationResult = {
    total: rows.length,
    generated: 0,
    failed: 0,
    errors: [],
  };

  for (const row of rows) {
    const holder = byInvestment.get(row.investment_id);
    const investor = investorById.get(row.investor_id);
    const name = String(investor?.full_name ?? row.investor_id);

    try {
      if (!holder) throw new Error("No settlement figures for this holding");

      const holding: ReportHolding = {
        investmentId: row.investment_id,
        investorName: name,
        investorCode: String(investor?.investor_code ?? ""),
        units: Number(holder.units),
        decision:
          holder.capital_action === "withdraw"
            ? "withdraw"
            : holder.capital_action === "partial"
            ? "partial"
            : "rollover",
        slotsWithdrawn: Number(holder.slots_withdrawn ?? 0),
      };

      const pdf = await htmlToPdf(renderReportDocument(figures, cycle, holding));
      const path = statementStoragePath(cycleId, row.investment_id, "statement");

      // upsert, so regenerating replaces the file rather than
      // accumulating copies
      const { error: upErr } = await storage.from(STATEMENT_BUCKET).upload(path, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      await db.rpc("mudarabah_mark_statement", {
        p_id: row.id,
        p_state: "ready",
        p_path: path,
        p_bytes: pdf.length,
        p_error: null,
      });
      result.generated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.rpc("mudarabah_mark_statement", {
        p_id: row.id,
        p_state: "failed",
        p_path: null,
        p_bytes: null,
        p_error: message.slice(0, 500),
      });
      result.failed++;
      result.errors.push({ investorName: name, message });
    }
  }

  return result;
}

/**
 * A short-lived link to a stored document.
 *
 * Minted server-side, only after the caller has been shown to be
 * entitled to it. The bucket is private; there is no URL that works
 * without one of these.
 */
export async function signedStatementUrl(
  adminClient: unknown,
  storagePath: string,
  filename: string,
  expiresInSeconds = 120
): Promise<string | null> {
  const storage = (adminClient as {
    storage: {
      from: (b: string) => {
        createSignedUrl: (
          path: string,
          expiresIn: number,
          opts?: { download?: string }
        ) => Promise<{ data: { signedUrl: string } | null; error: unknown }>;
      };
    };
  }).storage;

  const { data } = await storage
    .from(STATEMENT_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds, { download: filename });
  return data?.signedUrl ?? null;
}
