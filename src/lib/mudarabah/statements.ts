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
import { renderCreditNoteDocument, renderReportDocument, type CreditNoteData } from "./report-html";
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
        // "undecided" must reach the renderer intact. Folding it into
        // "rollover" here is what made a statement claim a choice the
        // investor had never made — the renderer has always had the
        // right wording for "none" and simply never received it.
        decision:
          holder.capital_action === "withdraw"
            ? "withdraw"
            : holder.capital_action === "partial"
            ? "partial"
            : holder.capital_action === "undecided"
            ? "none"
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

/* ── Credit notes ────────────────────────────────────────────────── */

/**
 * Build the PDF for every credit note in a cycle that does not have
 * one yet.
 *
 * Same rule as the statement: generated once at issuance, stored, and
 * the same file downloaded and emailed thereafter. The document is
 * rendered from the FROZEN NOTE — every figure on it was fixed when
 * the note was issued, and nothing here recomputes any of them.
 */
export async function generateCreditNotes(
  adminClient: unknown,
  cycleId: string
): Promise<GenerationResult> {
  const db = mudarabahDb(adminClient);
  const storage = (adminClient as {
    storage: {
      from: (b: string) => {
        upload: (
          p: string,
          body: Buffer,
          o: { contentType: string; upsert: boolean }
        ) => Promise<{ error: { message: string } | null }>;
      };
    };
  }).storage;

  const { data: notes } = await db
    .from("wht_credit_notes")
    .select(
      "id, reference, cycle_id, settlement_id, investment_id, investor_id, investor_name, investor_address, investor_tin, period_start, period_end, gross_profit, wht_rate, wht_amount, net_paid, deducted_on, remittance_reference, filed_on"
    )
    .eq("cycle_id", cycleId);

  const rows = notes ?? [];
  const result: GenerationResult = { total: rows.length, generated: 0, failed: 0, errors: [] };
  if (rows.length === 0) return result;

  const { data: issuer } = await db
    .from("wht_issuer_settings")
    .select("company_name, company_address, company_tin, signatory_name, signatory_title")
    .eq("id", 1)
    .maybeSingle();

  const { data: cycleRow } = await db
    .from("cycles")
    .select("cycle_label, series_id")
    .eq("id", cycleId)
    .maybeSingle();
  const { data: seriesRow } = await db
    .from("series")
    .select("name")
    .eq("id", cycleRow?.series_id ?? "")
    .maybeSingle();

  for (const n of rows) {
    try {
      const note: CreditNoteData = {
        reference: n.reference,
        issuer: {
          companyName: issuer?.company_name ?? "MaalGrow",
          companyAddress: issuer?.company_address ?? null,
          companyTin: issuer?.company_tin ?? null,
          signatoryName: issuer?.signatory_name ?? null,
          signatoryTitle: issuer?.signatory_title ?? null,
        },
        investorName: n.investor_name,
        investorAddress: n.investor_address,
        investorTin: n.investor_tin,
        seriesName: String(seriesRow?.name ?? ""),
        cycleLabel: cycleRow?.cycle_label ?? "",
        periodStart: n.period_start,
        periodEnd: n.period_end,
        grossProfit: Number(n.gross_profit),
        // 0–1 in the column and in CreditNoteData alike
        whtRate: Number(n.wht_rate),
        whtAmount: Number(n.wht_amount),
        netPaid: Number(n.net_paid),
        deductedOn: n.deducted_on,
        remittanceReference: n.remittance_reference,
        filedOn: n.filed_on,
      };

      const pdf = await htmlToPdf(renderCreditNoteDocument(note));
      const path = statementStoragePath(cycleId, n.investment_id, "credit_note");
      const { error: upErr } = await storage.from(STATEMENT_BUCKET).upload(path, pdf, {
        contentType: "application/pdf",
        upsert: true,
      });
      if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

      // The row is created here rather than queued at settlement:
      // a note only exists once it has been issued.
      await db.from("mudarabah_statements").upsert(
        {
          cycle_id: cycleId,
          settlement_id: n.settlement_id,
          investment_id: n.investment_id,
          investor_id: n.investor_id,
          kind: "credit_note",
          storage_path: path,
          state: "ready",
          bytes: pdf.length,
          generated_at: new Date().toISOString(),
        },
        { onConflict: "settlement_id,investment_id,kind" }
      );
      result.generated++;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed++;
      result.errors.push({ investorName: n.investor_name, message });
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
