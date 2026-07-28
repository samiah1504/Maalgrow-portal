/**
 * Emailing each holder their cycle-end statement.
 *
 * THE FILE IS THE ONE ALREADY STORED. Nothing here re-renders a
 * report. generateStatements built each PDF at settlement and put it
 * in the private bucket; this downloads that exact object and attaches
 * it. Two renders can drift apart, and then what an investor received
 * by email contradicts what their portal shows — the same rule
 * statements.ts opens with, applied one step further along.
 *
 * NOBODY IS EMAILED TWICE. Every send is claimed first through
 * mudarabah_claim_statement_email, which moves the row out of 'unsent'
 * only if it is still there. Two administrators pressing the button at
 * once, or a retry overlapping a run still in flight, cannot both
 * send: the second claim returns false and that holder is skipped.
 *
 * ONE FAILURE IS ONE FAILURE. A bad address, a missing file or a
 * refusal from Resend is recorded against that holder and the rest
 * carry on — the same shape as generateStatements, and for the same
 * reason: a partial success has to be visible as a partial success.
 *
 * SERVER ONLY.
 */

import { mudarabahDb } from "./db";
import { STATEMENT_BUCKET } from "./statements";
import { sendStatementEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site-url";
import { figuresFromSettlement, holderReportFigures } from "./report-figures";
import type { SettlementComputed } from "./figures";

export type StatementEmailResult = {
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  results: {
    investorName: string;
    investorCode: string;
    state: "sent" | "failed" | "skipped";
    detail?: string;
  }[];
};

type Row = {
  statement_id: string;
  investment_id: string;
  investor_id: string;
  investor_name: string;
  investor_code: string;
  investor_email: string | null;
  storage_path: string;
};

/** What the instruction deadline reads as in an email. */
function longDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

const DECISION_LABEL: Record<string, string> = {
  continue: "Profit paid · capital continues into the next cycle",
  exit: "Profit and all capital paid out",
  partial_exit: "Profit paid · part of your capital withdrawn",
  rollover_all: "Capital and profit both continue",
};

/**
 * Send the outstanding statement emails for a cycle.
 *
 * `retry` widens the set to include ones that failed before. It never
 * includes ones already sent — there is no argument that re-sends a
 * financial statement to somebody who has it.
 */
export async function emailStatements(
  adminClient: unknown,
  cycleId: string,
  options: { retry?: boolean } = {}
): Promise<StatementEmailResult> {
  const db = mudarabahDb(adminClient);
  const storage = (adminClient as {
    storage: {
      from: (b: string) => {
        download: (
          path: string
        ) => Promise<{ data: Blob | null; error: { message: string } | null }>;
      };
    };
  }).storage;

  const { data: pending, error: listError } = await db.rpc(
    "mudarabah_statements_to_email",
    { p_cycle_id: cycleId, p_retry: options.retry ?? false }
  );
  if (listError) throw new Error(listError.message);

  const rows = (pending ?? []) as unknown as Row[];
  const result: StatementEmailResult = {
    total: rows.length,
    sent: 0,
    failed: 0,
    skipped: 0,
    results: [],
  };
  if (rows.length === 0) return result;

  /* ── Everything the covering note needs, loaded once ─────── */

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
    .select("cycle_label, series_id, instruction_closes_at, rollover_deadline, end_date")
    .eq("id", cycleId)
    .maybeSingle();
  const { data: seriesRow } = await db
    .from("series")
    .select("name")
    .eq("id", cycleRow?.series_id ?? "")
    .maybeSingle();

  const figures = figuresFromSettlement(
    settlement.computed as SettlementComputed,
    settlement.settled_at,
    settlement.engine_version,
    Number(settlement.wht_rate_used ?? 0)
  );

  const { data: holders } = await db
    .from("mudarabah_settlement_holders")
    .select("investment_id, units")
    .eq("settlement_id", settlement.id);
  const unitsByInvestment = new Map(
    (holders ?? []).map((h) => [h.investment_id as string, Number(h.units)])
  );

  // Whether they have already answered. The email that ASKS and the
  // email that CONFIRMS are different letters; sending the asking one
  // to somebody who answered last week reads as though the portal
  // lost their instruction.
  const { data: decisions } = await db
    .from("rollover_decisions")
    .select("investment_id, decision")
    .eq("source_cycle_id", cycleId);
  const decisionByInvestment = new Map(
    (decisions ?? []).map((d) => [d.investment_id as string, String(d.decision)])
  );

  // The latest of the dates that could close the window, matching
  // rollover_decision_deadline in the database rather than guessing.
  const deadline = longDate(
    [
      cycleRow?.instruction_closes_at,
      cycleRow?.rollover_deadline,
      cycleRow?.end_date,
    ]
      .filter((d): d is string => Boolean(d))
      .reduce<string | null>((a, b) => (a && a > b ? a : b), null)
  );

  const seriesName = String(seriesRow?.name ?? "");
  const cycleLabel = String(cycleRow?.cycle_label ?? "");

  /* ── One holder at a time ────────────────────────────────── */

  for (const row of rows) {
    const to = (row.investor_email ?? "").trim();

    // No address is not a failure to retry — it is a fact about the
    // investor's record, and it stays visible until somebody fixes it.
    if (!to) {
      await db.rpc("mudarabah_mark_statement_email", {
        p_id: row.statement_id,
        p_state: "skipped",
        p_message_id: null,
        p_error: "No email address on record for this investor",
      });
      result.skipped++;
      result.results.push({
        investorName: row.investor_name,
        investorCode: row.investor_code,
        state: "skipped",
        detail: "No email address on record",
      });
      continue;
    }

    // Claim BEFORE doing anything expensive. If somebody else already
    // has this row, we must not download, attach or send.
    const { data: claimed, error: claimError } = await db.rpc(
      "mudarabah_claim_statement_email",
      { p_id: row.statement_id, p_email_to: to }
    );
    if (claimError || claimed !== true) {
      result.skipped++;
      result.results.push({
        investorName: row.investor_name,
        investorCode: row.investor_code,
        state: "skipped",
        detail: claimError?.message ?? "Already being sent, or already sent",
      });
      continue;
    }

    try {
      const { data: file, error: dlError } = await storage
        .from(STATEMENT_BUCKET)
        .download(row.storage_path);
      if (dlError || !file) {
        throw new Error(
          `Could not read the stored statement: ${dlError?.message ?? "not found"}`
        );
      }

      const units = unitsByInvestment.get(row.investment_id) ?? 0;
      // Only the units matter for the two figures the covering note
      // quotes; the decision wording comes from rollover_decisions
      // below, and the split of withdrawn versus continuing slots is
      // the attached statement's job, not this email's.
      const holder = holderReportFigures(figures, {
        investmentId: row.investment_id,
        investorName: row.investor_name,
        investorCode: row.investor_code,
        units,
        decision: "none",
        slotsWithdrawn: 0,
      });
      const decision = decisionByInvestment.get(row.investment_id) ?? null;

      const sendResult = await sendStatementEmail(
        {
          to,
          fullName: row.investor_name,
          investorCode: row.investor_code,
          seriesName,
          cycleLabel,
          slots: units,
          // The NET — what reaches their account. The gross is a
          // larger, friendlier number that does not match the
          // transfer, and quoting it would generate a call from
          // every reader.
          netProfit: holder.netProfit / 100,
          capital: holder.capital / 100,
          instructionDeadline: deadline,
          decisionMade: decision !== null,
          decisionLabel: decision ? DECISION_LABEL[decision] ?? decision : null,
          portalLink: SITE_URL,
        },
        {
          filename: `MaalGrow-statement-${row.investor_code}-${cycleLabel.replace(/\s+/g, "-")}.pdf`,
          content: Buffer.from(await file.arrayBuffer()),
        }
      );

      if (!sendResult.success) throw new Error(sendResult.error ?? "Send failed");

      await db.rpc("mudarabah_mark_statement_email", {
        p_id: row.statement_id,
        p_state: "sent",
        p_message_id: sendResult.messageId ?? null,
        p_error: null,
      });
      result.sent++;
      result.results.push({
        investorName: row.investor_name,
        investorCode: row.investor_code,
        state: "sent",
        detail: to,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.rpc("mudarabah_mark_statement_email", {
        p_id: row.statement_id,
        p_state: "failed",
        p_message_id: null,
        p_error: message.slice(0, 500),
      });
      result.failed++;
      result.results.push({
        investorName: row.investor_name,
        investorCode: row.investor_code,
        state: "failed",
        detail: message,
      });
    }
  }

  return result;
}
