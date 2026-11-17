/**
 * Migration 064: a cycle runs as many months as cycles.cycle_months
 * says — 6 now. Checks the calculation, the ledger model and the
 * investor report for a 6-month cycle, and that a 3-month cycle is
 * exactly what it always was.
 *
 *   npx tsx scripts/test-mudarabah-six-months.ts
 *   CHROME=/path/to/chrome npx tsx scripts/test-mudarabah-six-months.ts   (adds the A4 page check)
 */
import { createRequire } from "node:module";
import { compute, type CycleInput, type MonthInput, type MonthRowInput } from "../src/lib/mudarabah/compute";
import { figuresFromLive, type ReportCycle, type ReportHolding } from "../src/lib/mudarabah/report-figures";
import { renderReportDocument } from "../src/lib/mudarabah/report-html";
import { inlineReportFonts } from "../src/lib/mudarabah/report-assets";
import {
  draftFromLedger,
  emptyDraft,
  termsFromLedger,
  toCycleInput,
  type LedgerPayload,
} from "../src/lib/mudarabah/editor";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

const K = 100;
const row = (productId: string, qty: number, unitCost: number, soldQty: number, sellPrice: number, stockLeft?: number): MonthRowInput =>
  ({ productId, qty, unitCost, soldQty, sellPrice, stockLeft });
const month = (rows: MonthRowInput[], ads = 50_000 * K): MonthInput =>
  ({ rows, ads, logistics: 20_000 * K, misc: 8_000 * K, bankCharges: 5_000 * K });

const THREE: MonthInput[] = [
  month([row("sofa", 20, 47_000 * K, 13, 71_000 * K), row("table", 50, 9_100 * K, 31, 14_300 * K)]),
  month([row("sofa", 12, 48_500 * K, 14, 72_500 * K), row("table", 30, 9_400 * K, 33, 14_600 * K, 15)]),
  month([row("sofa", 6, 49_000 * K, 9, 73_000 * K), row("table", 20, 9_600 * K, 30, 15_000 * K)]),
];
const NEXT_THREE: MonthInput[] = [
  month([row("sofa", 10, 49_500 * K, 8, 74_000 * K), row("table", 25, 9_800 * K, 20, 15_200 * K)], 40_000 * K),
  month([row("sofa", 8, 50_000 * K, 11, 74_500 * K), row("table", 15, 9_900 * K, 18, 15_400 * K)], 45_000 * K),
  month([row("sofa", 4, 50_000 * K, 6, 75_000 * K, 0), row("table", 10, 10_000 * K, 12, 15_500 * K)], 30_000 * K),
];
const base = {
  slotPrice: 100_000 * K, slots: 20, ratio: 70, wht: 10, withdrawSlots: 5,
  products: [{ id: "sofa", name: "3-seater sofa" }, { id: "table", name: "Dining table" }],
};
const in3: CycleInput = { ...base, months: THREE };
const in6: CycleInput = { ...base, months: [...THREE, ...NEXT_THREE], monthCount: 6 };

/* ── The calculation ───────────────────────────────────────────── */
const c3 = compute(in3);
const c6 = compute(in6);
check("a 3-month cycle has three months (no monthCount = 3, as before 064)", c3.months.length === 3);
check("a 6-month cycle has six months", c6.months.length === 6, c6.months.length);
check("months 1–3 of the 6-month cycle are exactly the 3-month cycle's",
  JSON.stringify(c6.months.slice(0, 3)) === JSON.stringify(c3.months));
check("capital goes in once, in month 1", c6.months[0].fundsIn === c3.capital && c6.months.slice(1).every((m) => m.fundsIn === 0));
check("stock and cash carry from month 3 into month 4",
  c6.months[3].openUnits === c3.months[2].unitsLeft && c6.months[3].openCash === c3.months[2].cash);
check("profit is the six months' net added up",
  c6.profit === c6.months.reduce((s, m) => s + m.net, 0) && c6.profit !== c3.profit);
check("the split still adds back to the profit exactly", c6.holderPot + c6.mudaribPot === c6.profit);
const empty6 = compute({ ...in3, months: [...THREE], monthCount: 6 });
check("three empty extra months change no money", empty6.profit === c3.profit && empty6.months.length === 6
  && empty6.months.slice(3).every((m) => m.net === 0 && m.revenue === 0));

/* ── The ledger model ──────────────────────────────────────────── */
const payload = (n?: number): LedgerPayload => ({
  cycleId: "c", hasLedger: true, seriesName: "A", cycleLabel: "Nov 2026 – May 2027", cycleStatus: "active",
  startDate: "2026-11-30", endDate: "2027-05-30", ...(n === undefined ? {} : { cycleMonths: n }), termsLocked: true,
  unitValue: 100_000, ratio: 0.7, whtRate: 0.1, totalUnits: 20, cycleTotalSlots: 20, pooledCapital: 2_000_000,
  amountReceived: 2_000_000, totalCapital: 2_000_000, withdrawSlots: 0, description: "home furniture",
  discloseMode: "perSlot", status: "draft", products: [{ id: "sofa", name: "Sofa" }],
  months: [{ ads: 100, logistics: 0, misc: 0, bankCharges: 0, rows: [] }], holders: [],
});
check("an empty 6-month ledger has six months", emptyDraft("c", 6).months.length === 6);
check("an empty ledger defaults to three months", emptyDraft("c").months.length === 3);
check("a 6-month cycle's ledger opens with six months", draftFromLedger(payload(6)).months.length === 6);
check("a ledger from before 064 (no cycleMonths) opens with three", draftFromLedger(payload()).months.length === 3);
check("the terms say how many months", termsFromLedger(payload(6)).cycleMonths === 6 && termsFromLedger(payload()).cycleMonths === 3);
const i6 = toCycleInput(draftFromLedger(payload(6)), termsFromLedger(payload(6)));
const i3 = toCycleInput(draftFromLedger(payload(3)), termsFromLedger(payload(3)));
check("the 6-month input carries monthCount 6 and six months", i6.monthCount === 6 && i6.months.length === 6);
check("a 3-month input is unchanged: no monthCount key, three months", !("monthCount" in i3) && i3.months.length === 3);

/* ── The investor report ───────────────────────────────────────── */
const CYCLE: ReportCycle = {
  seriesName: "A", cycleLabel: "Nov 2026 – May 2027", startDate: "2026-11-30", endDate: "2027-05-30",
  description: "home furniture", discloseMode: "perSlot", totalUnits: 20, investorCount: 3,
};
const HOLDING: ReportHolding = {
  investmentId: "inv-1", investorName: "Aisha Bello", investorCode: "MG0001", units: 2.5, decision: "withdraw", slotsWithdrawn: 2.5,
};
const html6 = renderReportDocument(figuresFromLive(c6), CYCLE, HOLDING);
const html3 = renderReportDocument(figuresFromLive(c3), { ...CYCLE, endDate: "2027-02-28", cycleLabel: "Nov 2026 – Feb 2027" }, HOLDING);
check("the 6-month report has six month cards, Month one to Month six",
  (html6.match(/class="mcard"/g) ?? []).length === 6 && html6.includes("Month six") && !html6.includes("Month seven"));
// What a reader sees: the document without its stylesheet (whose comments are not shown)
const visible = (h: string) => h.replace(/<style[\s\S]*?<\/style>/g, "");
check("the 6-month report says six months, never three",
  html6.includes("over six months") && html6.includes("Six months · Series A") && !/three months/i.test(visible(html6)));
check("the 3-month report still says three months, three cards",
  html3.includes("over three months") && html3.includes("Three months · Series A") && (html3.match(/class="mcard"/g) ?? []).length === 3
  && !html3.includes('class="mrow many"'));

async function pageCheck() {
  const chrome = process.env.CHROME;
  if (!chrome) { console.log("SKIP: A4 page count (set CHROME to run it)"); return; }
  const puppeteer = createRequire(import.meta.url)("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: chrome, args: ["--no-sandbox"] });
  try {
    const pages = async (html: string) => {
      const p = await browser.newPage();
      await p.setContent(inlineReportFonts(html).html, { waitUntil: "load" });
      const pdf: Uint8Array = await p.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
      await p.close();
      return (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
    };
    const n3 = await pages(html3);
    const n6 = await pages(html6);
    check(`the 6-month report prints on as many A4 sheets as the 3-month one (${n6} vs ${n3})`, n6 === n3 && n3 > 0, { n3, n6 });
  } finally {
    await browser.close();
  }
}

pageCheck().then(() => {
  console.log(failures === 0 ? "\nAll six-month checks passed" : `\n${failures} failure(s)`);
  process.exit(failures === 0 ? 0 : 1);
});
