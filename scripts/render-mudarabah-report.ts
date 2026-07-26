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
 *   npx tsx scripts/render-mudarabah-report.ts --cycle <id> [--out dir] [--pdf]
 *   npx tsx scripts/render-mudarabah-report.ts --demo [--out dir] [--pdf]
 *
 * --demo needs no database. It runs a worked cycle through the same
 * resolver and the same renderer, for checking the document itself.
 *
 * --pdf also prints each document with a local Chrome or Chromium. Set
 * CHROME_PATH if it lives somewhere unusual.
 *
 * Every file written is SELF-CONTAINED: the fonts are embedded, so a
 * document opened from disk looks exactly like the one the portal
 * serves. Without that the naira signs and the whole typographic scale
 * silently fall back and the file misrepresents what was checked.
 */
import { createClient } from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { inlineReportFonts } from "../src/lib/mudarabah/report-assets";
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

const args = process.argv.slice(2);
const arg = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/* ── Is this environment actually able to reach the database? ─────── */

/**
 * The commonest reason this script produces nothing is that .env.local
 * holds the template's placeholder values rather than real ones. The
 * Supabase client does not complain about that — it just fails to
 * fetch. Say plainly what is wrong and what to do about it.
 */
function preflight(): { url: string; key: string } | string[] {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const problems: string[] = [];

  if (!url) problems.push("NEXT_PUBLIC_SUPABASE_URL is not set");
  else if (/placeholder|example|your-project|localhost/i.test(url)) {
    problems.push(
      `NEXT_PUBLIC_SUPABASE_URL is a placeholder (${url}) — this is the template value, not your project`
    );
  }

  if (!key) problems.push("SUPABASE_SERVICE_ROLE_KEY is not set");
  else if (key.length < 40 || /placeholder|example|your-/i.test(key)) {
    problems.push("SUPABASE_SERVICE_ROLE_KEY does not look like a real service role key");
  }

  return problems.length ? problems : { url, key };
}

const env = preflight();
if (Array.isArray(env) && !args.includes("--demo")) {
  console.error("Cannot reach your database:\n");
  for (const p of env) console.error(`  • ${p}`);
  console.error(
    [
      "",
      "Put the real values in .env.local, or export them for this command:",
      "",
      "  Supabase dashboard → Project Settings → API",
      "    Project URL          → NEXT_PUBLIC_SUPABASE_URL",
      "    service_role secret  → SUPABASE_SERVICE_ROLE_KEY",
      "",
      "The service role key bypasses row level security. Keep it out of",
      "the browser and out of version control — this script runs on your",
      "machine and only ever reads.",
      "",
      "To check the document itself without a database, use --demo.",
    ].join("\n")
  );
  process.exit(1);
}

const client = Array.isArray(env)
  ? (null as never)
  : createClient(env.url, env.key, { auth: { persistSession: false } });
const db = mudarabahDb(client);

/* ── Writing a document out ──────────────────────────────────────── */

const CHROMES = [
  process.env.CHROME_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter(Boolean) as string[];

function findChrome(): string | null {
  return CHROMES.find((p) => existsSync(p)) ?? null;
}

let warnedFonts = false;

/**
 * Write the document with its fonts embedded, and optionally print it.
 * Returns what was written so the caller can report it.
 */
function writeDocument(path: string, html: string, wantPdf: boolean): string[] {
  const { html: standalone, missing } = inlineReportFonts(html);
  if (missing.length && !warnedFonts) {
    warnedFonts = true;
    console.warn(
      `  ! ${missing.length} font file(s) not found in public/fonts — those faces will fall back: ${missing.join(", ")}`
    );
  }
  writeFileSync(path, standalone);
  const written = [path];

  if (wantPdf) {
    const chrome = findChrome();
    if (!chrome) {
      console.warn(
        "  ! No Chrome or Chromium found for --pdf. Set CHROME_PATH, or open the HTML and print to PDF."
      );
      return written;
    }
    const pdf = path.replace(/\.html$/, ".pdf");
    execFileSync(
      chrome,
      [
        "--headless",
        "--disable-gpu",
        "--no-sandbox",
        "--no-pdf-header-footer",
        "--virtual-time-budget=5000",
        `--print-to-pdf=${pdf}`,
        `file://${resolve(path)}`,
      ],
      { stdio: "ignore" }
    );
    written.push(pdf);
  }
  return written;
}

async function list() {
  const [{ data: series }, { data: cycles }, { data: ledgers }] = await Promise.all([
    db.from("series").select("id, name"),
    db
      .from("cycles")
      .select("id, series_id, cycle_label, start_date, end_date, status, total_investors, total_slots")
      .order("start_date", { ascending: false }),
    db.from("mudarabah_ledgers").select("cycle_id, status"),
  ]);

  if (!cycles) {
    console.error(
      "The credentials look right but the query returned nothing — check the project is reachable from here and the service role key belongs to it."
    );
    process.exit(1);
  }
  if (cycles.length === 0) {
    console.log("This project has no cycles yet, so there is nothing to render.");
    return;
  }

  const seriesName = new Map((series ?? []).map((s) => [s.id, String(s.name)]));
  const ledgerOf = new Map((ledgers ?? []).map((l) => [l.cycle_id, l.status]));

  console.log(
    `${cycles.length} cycle(s). Render one with --cycle <id>; add --pdf to print it.\n`
  );
  for (const c of cycles) {
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

async function render(cycleId: string, out: string, wantPdf: boolean) {
  const source = await loadReportSource(client, cycleId);
  if (!source) {
    console.error(
      "No such cycle. Run --list to see the cycles this project has, and pass the id from the first column."
    );
    process.exit(1);
  }

  mkdirSync(out, { recursive: true });
  console.log(
    `${source.cycle.seriesName} · ${source.cycle.cycleLabel} · ${source.holdings.length} holder(s) · ` +
      `${source.figures.provisional ? "PROVISIONAL" : "settled"} · ` +
      `net per slot ₦${(source.figures.netPerSlot / 100).toLocaleString("en-NG")}`
  );

  if (source.missingLedger) {
    console.warn(
      "  ! This cycle has no trading ledger, so every figure is zero. Record the three months first."
    );
  }
  if (source.holdings.length === 0) {
    console.warn("  ! Nobody holds slots in this cycle, so there is nobody to render for.");
    return;
  }

  for (const h of source.holdings) {
    const safe = h.investorCode || h.investmentId.slice(0, 8);
    const written = writeDocument(
      `${out}/report-${safe}.html`,
      renderReportDocument(source.figures, source.cycle, h),
      wantPdf
    );
    console.log(`  ${h.investorName} · ${h.units} slots → ${written.join(", ")}`);

    const note = await loadCreditNote(client, cycleId, h.investmentId, source.cycle);
    if (note) {
      const nw = writeDocument(
        `${out}/credit-note-${safe}.html`,
        renderCreditNoteDocument(note),
        wantPdf
      );
      console.log(`    credit note ${note.reference} → ${nw.join(", ")}`);
    }
  }
}

/* ── A worked cycle, no database ─────────────────────────────────── */

function demo(out: string, wantPdf: boolean) {
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
    const written = writeDocument(
      `${out}/report-${h.investorCode}.html`,
      renderReportDocument(figures, cycle, h),
      wantPdf
    );
    console.log(`  ${h.investorName} · ${h.units} slots → ${written.join(", ")}`);
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
  const nw = writeDocument(
    `${out}/credit-note-${lead.investorCode}.html`,
    renderCreditNoteDocument(note),
    wantPdf
  );
  console.log(`  credit note ${note.reference} → ${nw.join(", ")}`);
}

async function main() {
  const out = arg("--out") ?? "tmp-report";
  const wantPdf = args.includes("--pdf");
  if (args.includes("--demo")) return demo(out, wantPdf);
  const cycleId = arg("--cycle");
  if (args.includes("--list") || !cycleId) await list();
  else await render(cycleId, out, wantPdf);
}

main().catch((e) => {
  // A dropped connection surfaces here as "fetch failed", which on its
  // own tells nobody anything useful.
  const msg = e instanceof Error ? e.message : String(e);
  if (/fetch failed|ENOTFOUND|ECONNREFUSED/i.test(msg)) {
    console.error(
      `Could not reach ${process.env.NEXT_PUBLIC_SUPABASE_URL}: ${msg}\n` +
        "Check the project URL, and that this machine can reach it."
    );
  } else {
    console.error(e);
  }
  process.exit(1);
});
