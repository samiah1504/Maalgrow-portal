/**
 * Tests for the report renderer.
 *
 * 1. No leakage — no product name, per-product quantity or unit cost.
 * 2. Wrong cycle — cycle A's report carries nothing of cycle B's.
 * 3. Fractional holdings — 2.5 slots is exactly 2.5 × per-slot, and
 *    the wording reads correctly.
 * 4. Gross and net agree with the declaration.
 * 5. Snapshot stability — settled report is byte-identical after a
 *    formula constant changes.
 * 6. Profit always paid — a holder rolling capital over still shows
 *    their full profit.
 * 7. No decision recorded — page 1 renders sensibly.
 *
 * Run: npx tsx scripts/test-mudarabah-report.ts
 */
import { compute, type CycleInput, type MonthInput, type MonthRowInput } from "../src/lib/mudarabah/compute";
import { buildSettlement } from "../src/lib/mudarabah/figures";
import {
  figuresFromLive,
  figuresFromSettlement,
  holderReportFigures,
  reportFigures,
  slotWord,
  type ReportCycle,
  type ReportHolding,
} from "../src/lib/mudarabah/report-figures";
import {
  renderCreditNoteDocument,
  renderReportDocument,
  type CreditNoteData,
} from "../src/lib/mudarabah/report-html";
import { inlineReportFonts } from "../src/lib/mudarabah/report-assets";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

const K = 100;
const row = (
  productId: string, qty: number, unitCost: number, soldQty: number,
  sellPrice: number, stockLeft?: number
): MonthRowInput => ({ productId, qty, unitCost, soldQty, sellPrice, stockLeft });

/* A real multi-product cycle, 20 slots at ₦100,000, 70/30, 10% tax */
const INPUT: CycleInput = {
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

const CYCLE: ReportCycle = {
  seriesName: "A",
  cycleLabel: "Cycle 3",
  startDate: "2026-08-01",
  endDate: "2026-10-31",
  description: "home furniture",
  discloseMode: "perSlot",
  totalUnits: 20,
  investorCount: 3,
};

const HOLDING: ReportHolding = {
  investmentId: "inv-1",
  investorName: "Aisha Bello",
  investorCode: "MG0001",
  units: 2.5,
  decision: "withdraw",
  slotsWithdrawn: 2.5,
};

const cycle = compute(INPUT);
const live = figuresFromLive(cycle);
const html = renderReportDocument(live, CYCLE, HOLDING);

/* ── 1. No leakage ───────────────────────────────────────────────── */

const leakedName = INPUT.products.find((p) =>
  html.toLowerCase().includes(p.name.toLowerCase())
);
check("no product name appears in the report", !leakedName, leakedName?.name);

// `money` marks the kobo figures. A quantity is already a count — put
// it through the kobo-to-naira division and 38 units becomes 0, which
// appears all over any report and reads as a leak that isn't one.
const perProduct = cycle.products.flatMap((p) => [
  { what: `${p.productName} revenue`, v: p.revenue, money: true },
  { what: `${p.productName} cost of goods sold`, v: p.cogs, money: true },
  { what: `${p.productName} units bought`, v: p.unitsBought, money: false },
  { what: `${p.productName} units sold`, v: p.unitsSold, money: false },
]);
// A leak is a figure the INVESTOR CAN READ, so scan the rendered text
// and nothing else. Two things have to be stripped first or the test
// cries wolf:
//
//   the stylesheet — full of font sizes and colours;
//   the markup     — the ring chart's cx="36" is geometry, not a
//                    quantity, and 36 also happens to be a per-product
//                    figure in this fixture.
//
// Then drop the separators inside numbers so "₦1,238,000" is compared
// as one number rather than matching a stray 38, and require the match
// to carry no digit, comma or point on either side.
const body = html.slice(html.indexOf("</style>"));
const text = body.replace(/<[^>]*>/g, " ");
const scan = text.replace(/(?<=\d),(?=\d{3}(?!\d))/g, "");
const appears = (n: number) => new RegExp(`(?<![\\d.,])${n}(?![\\d.,])`).test(scan);

// The aggregates the report is entitled to show. A per-product figure
// that happens to equal one of these is not a leak.
const allowed = new Set([
  Math.round(cycle.revenue / 100),
  Math.round(cycle.purchTotal / 100),
  Math.round(cycle.cogsTotal / 100),
  cycle.unitsBought,
  cycle.unitsSold,
  cycle.unitsLeft,
]);

const leakedFigure = perProduct.find((x) => {
  const shown = x.money ? Math.round(x.v / 100) : x.v;
  return shown > 0 && appears(shown) && !allowed.has(shown);
});
check("no per-product revenue or quantity appears", !leakedFigure, leakedFigure);

const unitCosts = cycle.months.flatMap((m) => m.rows.map((r) => r.unitCost));
const leakedCost = unitCosts.find((c) => (c > 0 ? appears(Math.round(c / 100)) : false));
check("no unit cost appears", !leakedCost, leakedCost);
check(
  "the only product wording is the cycle's category",
  html.includes("home furniture")
);

/* ── 1b. The page adds up ────────────────────────────────────────── */

/**
 * An investor WILL do the subtraction. Every figure printed on page 2
 * has to reconcile against the figures printed beside it — not merely
 * be correct in kobo underneath. Parse the naira back out of the
 * rendered document and check the arithmetic as a reader would.
 */
function nairaAfter(doc: string, label: string): number | null {
  // …<div class="k">LABEL</div><div class="v">−₦1,234</div>…
  const re = new RegExp(
    `<div class="k">${label}</div><div class="v">(−?)₦([\\d,]+)</div>`
  );
  const m = re.exec(doc);
  if (!m) return null;
  return (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, ""));
}

/** …<div class="csrow"><span>LABEL</span><span class="val">−₦1,234</span>… */
function summaryRow(doc: string, label: string): number | null {
  const re = new RegExp(
    `<span>${label}</span><span class="val">(−?)₦([\\d,]+)</span>`
  );
  const m = re.exec(doc);
  if (!m) return null;
  return (m[1] ? -1 : 1) * Number(m[2].replace(/,/g, ""));
}

const sales = summaryRow(html, "Total sales");
const cogs = summaryRow(html, "Total cost of the goods sold");
const grossShown = summaryRow(html, "Total gross profit");
const running = summaryRow(html, "Total operating expenses");
const unaccounted = summaryRow(html, "Stock unaccounted for") ?? 0;
const netShown = summaryRow(html, "Total net profit for the cycle");

check(
  "the cycle summary states sales, its costs and the profit",
  sales !== null && cogs !== null && grossShown !== null &&
    running !== null && netShown !== null,
  { sales, cogs, grossShown, running, unaccounted, netShown }
);
check(
  "sales less the cost of the goods is exactly the gross profit printed",
  sales! + cogs! === grossShown!,
  { sales, cogs, grossShown, sum: sales! + cogs! }
);
check(
  "and those figures subtract to exactly the profit printed beside them",
  grossShown! + running! + unaccounted === netShown!,
  { grossShown, running, unaccounted, netShown, sum: grossShown! + running! + unaccounted }
);

// The division has to reconcile too — and it is the half that would
// otherwise contradict page 1, where the holder's own profit is
// printed. A page 2 that divided total net profit by the slot count
// would show a figure roughly a fifth above what anyone receives.
const managerCut = summaryRow(html, "MaalGrow&#39;s share as manager \\(\\d+%\\)")
  ?? summaryRow(html, "MaalGrow's share as manager \\(\\d+%\\)");
const holderPot = summaryRow(html, "Slot holders&#39; share \\(\\d+%\\)")
  ?? summaryRow(html, "Slot holders' share \\(\\d+%\\)");
/** A count, not money — no naira sign to match on. */
function summaryCount(doc: string, label: string): number | null {
  const m = new RegExp(
    `<span>${label}</span><span class="val">([\\d,.]+)</span>`
  ).exec(doc);
  return m ? Number(m[1].replace(/,/g, "")) : null;
}
const slotsShown = summaryCount(html, "Total investment slots in the Series");

check(
  "the summary shows how the profit was divided",
  managerCut !== null && holderPot !== null && slotsShown !== null,
  { managerCut, holderPot, slotsShown }
);
check(
  "net profit less the manager's share is exactly the slot holders' share",
  netShown! + managerCut! === holderPot!,
  { netShown, managerCut, holderPot, sum: netShown! + managerCut! }
);

const perSlotShown = /<div class="k">Profit per slot<\/div>\s*<div class="v">₦([\d,]+)<\/div>/.exec(html);
check(
  "profit per slot is the slot holders' share divided by the slots",
  perSlotShown !== null &&
    Math.abs(
      Number(perSlotShown[1].replace(/,/g, "")) - holderPot! / slotsShown!
    ) <= 1,
  {
    printed: perSlotShown && Number(perSlotShown[1].replace(/,/g, "")),
    expected: holderPot! / slotsShown!,
  }
);
check(
  "and it is the per-slot profit the declaration settled, not net profit ÷ slots",
  perSlotShown !== null &&
    Math.abs(Number(perSlotShown[1].replace(/,/g, "")) - live.grossPerSlot / 100) <= 1,
  {
    printed: perSlotShown && Number(perSlotShown[1].replace(/,/g, "")),
    settled: live.grossPerSlot / 100,
    naive: netShown! / slotsShown!,
  }
);

// Each month card must reconcile the same way, and the months must add
// up to the cycle total — no figure on the page is orphaned.
const cards = html.split('<div class="mcard">').slice(1);
const cardSums = cards.map((c) => {
  // A subtotal is not a part. Gross profit sits in the middle of the
  // card and is already sales less cost — counting it as a component
  // would add the same money to the month twice.
  const money = [
    ...c.matchAll(/<div class="mline([^"]*)"><span>[^<]*<\/span><span class="val">(−?)₦([\d,]+)<\/span>/g),
  ]
    .filter((m) => !m[1].includes("sub"))
    .map((m) => (m[2] ? -1 : 1) * Number(m[3].replace(/,/g, "")));
  // last is the month's net; the ones before it are its parts
  const net = money[money.length - 1];
  const parts = money.slice(0, -1).reduce((t, v) => t + v, 0);
  return { net, parts };
});
check("there are three month cards", cardSums.length === 3, cardSums.length);
check(
  "each month card adds up on its own",
  cardSums.every((c) => c.parts === c.net),
  cardSums
);
check(
  "the months add up to the cycle total",
  cardSums.reduce((t, c) => t + c.net, 0) === netShown,
  { months: cardSums.map((c) => c.net), cycle: netShown }
);

check(
  "month headings avoid Marcellus numerals, which are ambiguous",
  html.includes("Month one") && html.includes("Month three") && !html.includes("Month 1")
);

/* ── 1c. The pictures page ───────────────────────────────────────── */

check("the report is four pages", (html.match(/<section class="page">/g) ?? []).length === 4);
check(
  "and each page says which of the four it is",
  ["Page 1 of 4", "Page 2 of 4", "Page 3 of 4", "Page 4 of 4"].every((s) =>
    html.includes(s)
  )
);
check(
  "the pictures page is there, drawn from the same figures",
  html.includes("The cycle in pictures") &&
    html.includes("The journey of a slot") &&
    html.includes("Every naira of sales income, divided") &&
    html.includes("Each month side by side")
);

// The journey names the CATEGORY. Naming the product would hand every
// investor the trade's buying list.
check(
  "the journey names the category, never a product",
  html.includes("Stock bought") && html.includes("home furniture")
);

// Parse the divided-income table back out and check it as a reader would
const divideRows = [
  ...html.matchAll(
    /<td><span class="dot [a-e]"><\/span>([^<]+)<\/td>\s*<td class="p">([\d.]+)%<\/td><td class="m">(−?)₦([\d,]+)<\/td>/g
  ),
].map((m) => ({
  label: m[1],
  share: Number(m[2]),
  value: (m[3] ? -1 : 1) * Number(m[4].replace(/,/g, "")),
}));
const totalRow =
  /<tr class="sum"><td>Total sales income<\/td><td class="p">100\.0%<\/td>\s*<td class="m">₦([\d,]+)<\/td>/.exec(
    html
  );

check("the divided-income table has rows", divideRows.length >= 3, divideRows.length);
check(
  "its shares add to exactly 100.0 per cent",
  Math.abs(divideRows.reduce((t, r) => t + r.share, 0) - 100) < 1e-9,
  divideRows.map((r) => r.share)
);
check(
  "its money column adds to the total sales income printed beneath it",
  totalRow !== null &&
    divideRows.reduce((t, r) => t + r.value, 0) ===
      Number(totalRow[1].replace(/,/g, "")),
  {
    parts: divideRows.reduce((t, r) => t + r.value, 0),
    total: totalRow && Number(totalRow[1].replace(/,/g, "")),
  }
);
check(
  "and that total is the very figure page 2 calls total sales",
  totalRow !== null && Number(totalRow[1].replace(/,/g, "")) === sales,
  { pictures: totalRow && totalRow[1], pageTwo: sales }
);
check(
  "running costs are itemised when the figures allow it",
  divideRows.some((r) => r.label === "Advertising") &&
    divideRows.some((r) => r.label === "Delivery to customers") &&
    divideRows.some((r) => r.label === "Bank charges")
);
check(
  "and the profit row equals the profit page 2 prints",
  divideRows.find((r) => r.label === "Profit")?.value === netShown,
  { pictures: divideRows.find((r) => r.label === "Profit")?.value, pageTwo: netShown }
);

// A cycle settled before the itemisation was recorded must still render
const noSplit = figuresFromLive(cycle);
noSplit.months = noSplit.months.map((m) => ({
  ...m,
  ads: undefined,
  logistics: undefined,
  misc: undefined,
  bankCharges: undefined,
}));
noSplit.expenseSplit = null;
const noSplitHtml = renderReportDocument(noSplit, CYCLE, HOLDING);
check(
  "an older snapshot with no itemisation falls back to one running-costs row",
  noSplitHtml.includes(">Running costs</td>") &&
    !noSplitHtml.includes(">Advertising</td>")
);
check(
  "and that fallback still adds to 100.0 per cent",
  /<tr class="sum"><td>Total sales income<\/td><td class="p">100\.0%<\/td>/.test(
    noSplitHtml
  )
);

/* ── 2. Wrong cycle ──────────────────────────────────────────────── */

const OTHER_HOLDING: ReportHolding = {
  investmentId: "inv-99",
  investorName: "Zainab Musa",
  investorCode: "MG0099",
  units: 5,
  decision: "rollover",
  slotsWithdrawn: 0,
};
const otherInput: CycleInput = { ...INPUT, slots: 8, withdrawSlots: 0 };
const otherFigures = figuresFromLive(compute(otherInput));
const otherHtml = renderReportDocument(otherFigures, { ...CYCLE, cycleLabel: "Cycle 4" }, OTHER_HOLDING);

check(
  "cycle A's report names only its own investor",
  html.includes("Aisha Bello") &&
    !html.includes("Zainab Musa") &&
    !html.includes("MG0099")
);
check(
  "cycle A's report carries cycle A's label, not another's",
  html.includes("Cycle 3") && !html.includes("Cycle 4")
);
check(
  "the other cycle's own figures differ, so a mix-up would be visible",
  otherFigures.capital !== live.capital &&
    !html.includes(String(Math.round(otherFigures.capital / 100)))
);

/* ── 3. Fractional holdings ──────────────────────────────────────── */

const h = holderReportFigures(live, HOLDING);
check(
  "2.5 slots is exactly 2.5 × the per-slot values",
  h.capital === Math.round(2.5 * live.slotPrice) &&
    h.grossProfit === Math.round(2.5 * live.grossPerSlot) &&
    h.wht === Math.round(2.5 * live.whtPerSlot) &&
    h.netProfit === h.grossProfit - h.wht,
  h
);
check("the wording reads '2.5 slots'", slotWord(2.5) === "2.5 slots" && html.includes("2.5 slots"));
check("a single slot reads '1 slot'", slotWord(1) === "1 slot");
check("a whole holding reads '3 slots'", slotWord(3) === "3 slots");
check(
  "no wording assumes whole slots",
  !/\b\d+\.\d+ slot\b/.test(html) && !/\b1 slots\b/.test(html)
);

/* ── 4. Gross and net agree with the declaration ─────────────────── */

// declare_cycle_profit computes profit_per_slot = investor pot / units
const potNaira = Math.round(live.holderPot) / 100;
const declProfitPerSlot = potNaira / live.totalUnits;
const declWhtPerSlot = declProfitPerSlot * live.whtRate;
check(
  "the report's gross per slot equals the declaration's profit_per_slot",
  Math.abs(live.grossPerSlot / 100 - declProfitPerSlot) < 0.01,
  { report: live.grossPerSlot / 100, declaration: declProfitPerSlot }
);
check(
  "the report's net per slot equals profit_per_slot_net",
  Math.abs(live.netPerSlot / 100 - (declProfitPerSlot - declWhtPerSlot)) < 0.01,
  { report: live.netPerSlot / 100, declaration: declProfitPerSlot - declWhtPerSlot }
);
check(
  "both returns are shown and labelled",
  html.includes("gross return on your capital") && html.includes("net return")
);
check(
  "the tax line names the rate",
  html.includes("Less withholding tax (10%)")
);
/**
 * Gross profit used to appear nowhere in an investor's report at all.
 * It is now shown on page 2, deliberately, because that page reports
 * how the SERIES traded and a trading account without a gross margin
 * is not a trading account.
 *
 * What has NOT changed is page 1. That page is the investor's own
 * money, and a gross figure there would be a number they could mistake
 * for something owed to them — their profit is net, after the
 * manager's share and after tax. So the rule is now placement, not
 * absence, and this checks the placement.
 */
const pages = html.split('<section class="page">').slice(1);
check("the report still has four pages", pages.length === 4, pages.length);
check(
  "gross profit never appears on page 1, beside the investor's own figures",
  !/Gross profit/i.test(pages[0]),
  pages[0].match(/.{0,60}Gross profit.{0,60}/i)?.[0]
);
check(
  "and it does appear on page 2, where the Series is reported",
  /Total gross profit/.test(pages[1])
);

/* ── 5. Snapshot stability ───────────────────────────────────────── */

const settlement = buildSettlement("cycle-1", cycle, [
  { investorRef: "investor-1", slots: 2.5, capitalAction: "withdraw" },
], "2026-11-05T10:00:00.000Z");
const settled = figuresFromSettlement(
  settlement.computed,
  settlement.settledAt,
  settlement.engineVersion,
  0.1
);
const before = renderReportDocument(settled, CYCLE, HOLDING);

// A formula constant changes: the manager's share moves to 40%
const changedEngine = { ...compute({ ...INPUT, ratio: 60 }) };
const settledAgain = figuresFromSettlement(
  settlement.computed,
  settlement.settledAt,
  settlement.engineVersion,
  0.1
);
const after = renderReportDocument(settledAgain, CYCLE, HOLDING);

check("a settled report is byte-identical after a formula change", before === after);
check(
  "and the changed engine really would have produced different figures",
  changedEngine.netPerSlot !== cycle.netPerSlot
);
check("a settled report carries no provisional banner", !before.includes("Provisional"));
check(
  "an unsettled report says so, loudly",
  html.includes("Provisional — this cycle is not yet settled")
);
check(
  "the resolver picks the snapshot for a settled cycle and never the engine",
  reportFigures({
    status: "settled",
    input: INPUT,
    settlement: {
      computed: settlement.computed,
      settledAt: settlement.settledAt,
      engineVersion: settlement.engineVersion,
      whtRate: 0.1,
    },
  }).source === "settlement" &&
    reportFigures({ status: "active", input: INPUT }).source === "live"
);

/* ── 6. Profit always paid ───────────────────────────────────────── */

const ROLLING: ReportHolding = { ...HOLDING, decision: "rollover", slotsWithdrawn: 0 };
const rollingHtml = renderReportDocument(live, CYCLE, ROLLING);
const rh = holderReportFigures(live, ROLLING);
check(
  "a holder rolling capital over is shown their full profit",
  rh.netProfit === h.netProfit && rh.netProfit > 0,
  { rolling: rh.netProfit, withdrawing: h.netProfit }
);
check(
  "the page says profit is paid either way",
  rollingHtml.includes("Your profit is paid to you either way")
);
check(
  "their capital is marked as continuing, not their profit",
  rollingHtml.includes("continues as 2.5 slots in the next cycle")
);
check(
  "page 3 says profit is always paid out and only capital can continue",
  rollingHtml.includes("always paid out at the end of every cycle") &&
    rollingHtml.includes("Only capital can continue")
);

/* ── 7. No decision recorded ─────────────────────────────────────── */

const UNDECIDED: ReportHolding = { ...HOLDING, decision: "none", slotsWithdrawn: 0 };
const undecidedHtml = renderReportDocument(live, CYCLE, UNDECIDED);
check(
  "with no decision, neither option is marked",
  !undecidedHtml.includes("Your choice")
);
check(
  "and the page says the instruction has not been received",
  undecidedHtml.includes("We have not received your instruction yet")
);
check(
  "the profit figure is unaffected by having no decision",
  holderReportFigures(live, UNDECIDED).netProfit === h.netProfit
);

/* ── The credit note ─────────────────────────────────────────────── */

const NOTE: CreditNoteData = {
  reference: "WHT-2026-000001",
  issuer: {
    companyName: "MaalVest Limited",
    companyAddress: "12 Marina, Lagos",
    companyTin: "TIN-99887766",
    signatoryName: "Samiah Yusuf",
    signatoryTitle: "Managing Director",
  },
  investorName: "Aisha Bello",
  investorAddress: "4 Awolowo Road, Ikoyi, Lagos",
  investorTin: "12345678-0001",
  seriesName: "A",
  cycleLabel: "Cycle 3",
  periodStart: "2026-08-01",
  periodEnd: "2026-10-31",
  grossProfit: h.grossProfit,
  whtRate: 0.1,
  whtAmount: h.wht,
  netPaid: h.netProfit,
  deductedOn: "2026-11-05",
  remittanceReference: "FIRS/2026/00123",
  filedOn: "2026-11-20",
};
const note = renderCreditNoteDocument(NOTE);

check("the credit note is a single page", (note.match(/class="page"/g) ?? []).length === 1);
check(
  "it carries the reference, both parties and the tax figures",
  note.includes("WHT-2026-000001") &&
    note.includes("MaalVest Limited") &&
    note.includes("TIN-99887766") &&
    note.includes("12345678-0001") &&
    note.includes("FIRS/2026/00123")
);
check(
  "it discloses nothing about the trading",
  !note.includes("home furniture") &&
    !INPUT.products.some((p) => note.includes(p.name)) &&
    !/Month 1/.test(note)
);
const noTin = renderCreditNoteDocument({ ...NOTE, investorTin: null });
check(
  "it renders when the investor has no tax number, showing it as not provided",
  noTin.includes("Tax identification number not provided") &&
    noTin.includes("WHT-2026-000001")
);
check(
  "a reissue renders identically",
  renderCreditNoteDocument(NOTE) === note
);
check("it has no charts or illustrations", !note.includes("<svg"));

/* ── Print stylesheet ────────────────────────────────────────────── */

check("A4 portrait with 11mm margins", html.includes("size: A4 portrait") && html.includes("padding: 11mm"));
check(
  "colour is forced to print on every coloured element",
  (html.match(/print-color-adjust: exact/g) ?? []).length >= 10
);
check(
  "month cards and option cards cannot split across a page",
  html.includes("page-break-inside: avoid")
);
check("each page breaks cleanly", html.includes("page-break-after: always"));
check(
  "fonts are self-hosted, never fetched from Google",
  html.includes("/fonts/marcellus-latin-400-normal.woff2") &&
    !html.includes("fonts.googleapis.com") &&
    !html.includes("fonts.gstatic.com")
);

// The naira sign is U+20A6, which the latin subset does NOT carry —
// it stops at the euro. Without the latin-ext faces every ₦ falls back
// to a system font, or to nothing at all on a print server.
check(
  "the naira sign has a self-hosted face to come from",
  html.includes("/fonts/karla-latin-ext-400-normal.woff2") &&
    html.includes("/fonts/ibm-plex-mono-latin-ext-400-normal.woff2") &&
    html.includes("U+20A0-20AB")
);
check(
  "and every weight that prints money has one",
  ["karla-latin-ext-400", "karla-latin-ext-500", "karla-latin-ext-700",
   "ibm-plex-mono-latin-ext-400", "ibm-plex-mono-latin-ext-500",
   "ibm-plex-mono-latin-ext-600"].every((f) => html.includes(f))
);
check("money is written in naira", html.includes("₦"));

// A document saved to disk, mailed, or handed to a headless browser as
// a file:// URL cannot resolve /fonts/… — it falls back silently and
// the file misrepresents what was checked.
const inlined = inlineReportFonts(html);
check(
  "every face can be embedded, so a saved document is self-contained",
  inlined.missing.length === 0 && inlined.inlined.length === 13,
  { inlined: inlined.inlined.length, missing: inlined.missing }
);
check(
  "and the embedded document keeps no path-relative font reference",
  !inlined.html.includes("url('/fonts/") &&
    inlined.html.includes("data:font/woff2;base64,")
);

console.log(`\n${failures === 0 ? "All report tests passed." : `${failures} failed.`}`);
process.exit(failures === 0 ? 0 : 1);
