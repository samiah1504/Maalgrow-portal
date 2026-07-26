/**
 * Render an investor's report to HTML, exactly as the portal will.
 *
 * Same path as the admin preview: loadReportSource → reportFigures →
 * renderReportDocument. Nothing here is a mock — if this document is
 * right, the one the investor receives is right.
 *
 * Read-only. It writes files and touches nothing in the database.
 *
 *   npx tsx scripts/render-mudarabah-report.ts --list
 *   npx tsx scripts/render-mudarabah-report.ts --cycle <id> [--out dir]
 *   npx tsx scripts/render-mudarabah-report.ts --demo [--out dir]
 *
 * --demo needs no database. It runs a worked cycle through the same
 * resolver and the same renderer, for checking the document itself.
 */
import { createClient } from "@supabase/supabase-js";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadReportSource, loadCreditNote } from "../src/lib/mudarabah/report-source";
import {
  renderCreditNoteDocument,
  renderReportDocument,
  type CreditNoteData,
} from "../src/lib/mudarabah/report-html";
import {
  holderReportFigures,
  reportFigures,
  type ReportCycle,
  type ReportHolding,
} from "../src/lib/mudarabah/report-figures";
import type {
  CycleInput,
  MonthInput,
  MonthRowInput,
} from "../src/lib/mudarabah/compute";
import { mudarabahDb } from "../src/lib/mudarabah/db";

// The portal's own .env.local — no extra dependency for a script that
// only ever reads.
try {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
    if (m && !process.env[m[1]]) {
      process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // fall through to whatever is already in the environment
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
  process.exit(1);
}

const client = createClient(url, key, { auth: { persistSession: false } });
const db = mudarabahDb(client);

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

async function list() {
  const [{ data: series }, { data: cycles }, { data: ledgers }] = await Promise.all([
    db.from("series").select("id, name"),
    db
      .from("cycles")
      .select("id, series_id, cycle_label, start_date, end_date, status, total_investors, total_slots")
      .order("start_date", { ascending: false }),
    db.from("mudarabah_ledgers").select("cycle_id, status"),
  ]);

  const seriesName = new Map((series ?? []).map((s) => [s.id, String(s.name)]));
  const ledgerOf = new Map((ledgers ?? []).map((l) => [l.cycle_id, l.status]));

  for (const c of cycles ?? []) {
    console.log(
      [
        c.id,
        `Series ${seriesName.get(c.series_id) ?? "?"}`,
        c.cycle_label,
        `${c.start_date}→${c.end_date}`,
        c.status,
        `${c.total_investors} investors`,
        `${c.total_slots} slots`,
        `ledger: ${ledgerOf.get(c.id) ?? "none"}`,
      ].join(" · ")
    );
  }
}

async function render(cycleId: string, out: string) {
  const source = await loadReportSource(client, cycleId);
  if (!source) {
    console.error("No such cycle");
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  console.log(
    `${source.cycle.seriesName} ${source.cycle.cycleLabel} · ${source.holdings.length} holders · ` +
      `${source.figures.provisional ? "PROVISIONAL" : "settled"} · ` +
      `net per slot ₦${(source.figures.netPerSlot / 100).toLocaleString("en-NG")}`
  );

  for (const h of source.holdings) {
    const safe = h.investorCode || h.investmentId.slice(0, 8);
    const file = `${out}/report-${safe}.html`;
    writeFileSync(file, renderReportDocument(source.figures, source.cycle, h));
    console.log(`  ${h.investorName} · ${h.units} slots → ${file}`);

    const note = await loadCreditNote(client, cycleId, h.investmentId, source.cycle);
    if (note) {
      const nf = `${out}/credit-note-${safe}.html`;
      writeFileSync(nf, renderCreditNoteDocument(note));
      console.log(`    credit note ${note.reference} → ${nf}`);
    }
  }
}

/* ── A worked cycle, no database ─────────────────────────────────── */

function demo(out: string) {
  const K = 100;
  const row = (
    productId: string, qty: number, unitCost: number, soldQty: number,
    sellPrice: number, stockLeft?: number
  ): MonthRowInput => ({ productId, qty, unitCost, soldQty, sellPrice, stockLeft });

  // Three products, three months, 20 slots at ₦100,000, 70/30, 10% tax
  const input: CycleInput = {
    slotPrice: 100_000 * K,
    slots: 20,
    ratio: 70,
    wht: 10,
    withdrawSlots: 12.5,
    products: [
      { id: "sofa", name: "3-seater sofa" },
      { id: "table", name: "Dining table" },
      { id: "bed", name: "Bed frame" },
    ],
    months: [
      {
        rows: [
          row("sofa", 20, 47_000 * K, 13, 71_000 * K),
          row("table", 50, 9_100 * K, 31, 14_300 * K),
          row("bed", 25, 21_000 * K, 17, 31_000 * K),
        ],
        ads: 60_000 * K, logistics: 25_000 * K, misc: 10_000 * K, bankCharges: 5_000 * K,
      },
      {
        rows: [
          row("sofa", 12, 48_500 * K, 14, 72_500 * K),
          row("table", 30, 9_400 * K, 33, 14_600 * K, 15),
          row("bed", 10, 21_500 * K, 12, 31_500 * K),
        ],
        ads: 55_000 * K, logistics: 22_000 * K, misc: 8_000 * K, bankCharges: 6_000 * K,
      },
      {
        rows: [
          row("sofa", 6, 49_000 * K, 9, 73_000 * K),
          row("table", 20, 9_600 * K, 30, 15_000 * K),
          row("bed", 8, 22_000 * K, 13, 32_000 * K),
        ],
        ads: 50_000 * K, logistics: 20_000 * K, misc: 12_000 * K, bankCharges: 7_000 * K,
      },
    ] as [MonthInput, MonthInput, MonthInput],
  };

  const cycle: ReportCycle = {
    seriesName: "A",
    // The portal builds labels as a month range, so use one here too
    cycleLabel: "Feb 2026 – Apr 2026",
    startDate: "2026-02-01",
    endDate: "2026-04-30",
    description: "home furniture",
    discloseMode: "perSlot",
    totalUnits: 20,
    investorCount: 3,
  };

  const holdings: ReportHolding[] = [
    { investmentId: "d1", investorName: "Aisha Bello", investorCode: "MG0041",
      units: 2.5, decision: "withdraw", slotsWithdrawn: 2.5 },
    { investmentId: "d2", investorName: "Ibrahim Sanusi", investorCode: "MG0058",
      units: 7.5, decision: "rollover", slotsWithdrawn: 0 },
    { investmentId: "d3", investorName: "Fatima Yusuf", investorCode: "MG0072",
      units: 10, decision: "partial", slotsWithdrawn: 4 },
  ];

  const figures = reportFigures({ status: "active", input });

  mkdirSync(out, { recursive: true });
  console.log(
    `${cycle.seriesName} ${cycle.cycleLabel} · ${holdings.length} holders · ` +
      `PROVISIONAL · net per slot ₦${(figures.netPerSlot / 100).toLocaleString("en-NG")}`
  );

  for (const h of holdings) {
    const file = `${out}/report-${h.investorCode}.html`;
    writeFileSync(file, renderReportDocument(figures, cycle, h));
    console.log(`  ${h.investorName} · ${h.units} slots → ${file}`);
  }

  // The credit note, as it reads once the tax has been filed
  const lead = holdings[0];
  const hf = holderReportFigures(figures, lead);
  const note: CreditNoteData = {
    reference: "WHT-2026-000041",
    issuer: {
      companyName: "MaalGrow Limited",
      companyAddress: "12 Ahmadu Bello Way, Kaduna",
      companyTin: "01234567-0001",
      signatoryName: "Samiah Ibrahim",
      signatoryTitle: "Managing Director",
    },
    investorName: lead.investorName,
    investorAddress: "8 Sultan Road, Kaduna",
    investorTin: "22334455-0001",
    seriesName: cycle.seriesName,
    cycleLabel: cycle.cycleLabel,
    periodStart: cycle.startDate,
    periodEnd: cycle.endDate,
    grossProfit: hf.grossProfit,
    whtRate: figures.whtRate,
    whtAmount: hf.wht,
    netPaid: hf.netProfit,
    deductedOn: cycle.endDate,
    remittanceReference: "FIRS/KD/2026/004182",
    filedOn: "2026-05-14",
  };
  const nf = `${out}/credit-note-${lead.investorCode}.html`;
  writeFileSync(nf, renderCreditNoteDocument(note));
  console.log(`  credit note ${note.reference} → ${nf}`);
}

async function main() {
  const out = arg("--out") ?? "tmp-report";
  if (args.includes("--demo")) return demo(out);
  const cycleId = arg("--cycle");
  if (args.includes("--list") || !cycleId) await list();
  else await render(cycleId, out);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
