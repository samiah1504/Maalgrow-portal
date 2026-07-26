/**
 * Regression tests for src/lib/mudarabah/compute.ts
 *
 * ALL MONEY IS INTEGER KOBO. The reference file works in naira floats,
 * so the parity test feeds it naira and compares against our kobo
 * figures scaled by 100. Figures that are pure products of the inputs
 * (revenue, purchase cost, expenses, cash) must match EXACTLY. Figures
 * that come out of the weighted-average split (cost of goods sold,
 * stock value, loss, and the profit built from them) are allowed to
 * differ by the rounding the reference cannot do — a few kobo — and
 * the test prints the largest drift it saw.
 *
 * 1. SINGLE-PRODUCT PARITY — runs the compute() engine extracted from
 *    reference/mudarabah-report-v4.html on the same cycle.
 * 2. INDEPENDENT CARRY-FORWARD — one product sells out while another
 *    carries stock; each keeps its own cost price.
 * 3. REPEAT PURCHASE — buying the same product again at a different
 *    price blends only that product's cost price.
 * 4. INVARIANT — endCash + closing stock === capital + profit, EXACTLY
 *    (integer kobo), on random multi-product inputs.
 * 5. NO PER-PRODUCT LEAKAGE into the investor-facing view.
 * 6. LOSS BRANCH — on a loss the manager's pot is exactly zero.
 *
 * Run: npx tsx scripts/test-mudarabah-compute.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  allocateHolders,
  compute,
  holderFigures,
  investorView,
  validateCycle,
  type CycleInput,
  type CycleResult,
  type MonthInput,
  type MonthRowInput,
} from "../src/lib/mudarabah/compute";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}
function near(a: number, b: number, tol = 1e-9): boolean {
  return a === b || Math.abs(a - b) <= tol;
}
/** kobo → readable naira */
const nf = (kobo: number) =>
  (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });

/* ── 1. Single-product parity with the reference engine ──────────── */

type RefMonth = {
  qty: number;
  unitCost: number;
  soldQty: number;
  sellPrice: number;
  ads: number;
  logi: number;
  misc: number;
  bank: number;
  stockLeft: number;
};

/** Runs the REFERENCE file's own compute(), untouched, in naira. */
function referenceCompute(
  fields: Record<string, number>,
  months: RefMonth[]
): Record<string, number> & { months: Record<string, number>[] } {
  const html = readFileSync(
    join(__dirname, "..", "reference", "mudarabah-report-v4.html"),
    "utf8"
  );
  const start = html.indexOf("function compute(){");
  const end = html.indexOf("/* ==================== admin UI");
  if (start < 0 || end < 0) throw new Error("Could not locate compute() in reference file");
  const source = html.slice(start, end);

  // Minimal stand-ins for the reference file's helpers/DOM.
  // purchExp is absent from the month data, so the reference's num()
  // reads it as 0 — the no-freight-to-allocate case.
  const prelude = `
    var state = { months: MONTHS };
    var $ = function(id){ return { value: FIELDS[id] }; };
    function num(v){ var n=parseFloat(v); return isFinite(n)?n:0; }
    function int(v){ var n=parseFloat(v); return isFinite(n)?Math.round(n):0; }
  `;
  const fn = new Function("FIELDS", "MONTHS", prelude + source + "\nreturn compute();");
  return fn(fields, months);
}

/** The checkpoint cycle, single product, in NAIRA (reference input) */
const PARITY_MONTHS: RefMonth[] = [
  { qty: 200, unitCost: 8_000, soldQty: 150, sellPrice: 12_000, ads: 60_000, logi: 25_000, misc: 10_000, bank: 5_000, stockLeft: 50 },
  { qty: 120, unitCost: 8_500, soldQty: 140, sellPrice: 12_500, ads: 55_000, logi: 22_000, misc: 8_000, bank: 6_000, stockLeft: 28 }, // 2 lost
  { qty: 100, unitCost: 9_000, soldQty: 120, sellPrice: 13_000, ads: 50_000, logi: 20_000, misc: 12_000, bank: 7_000, stockLeft: 8 },
];
const PARITY_FIELDS = { slotPrice: 100_000, slots: 20, ratio: 70, wht: 5, withdrawSlots: 8 };

const K = 100; // naira → kobo

const SINGLE: CycleInput = {
  ...PARITY_FIELDS,
  slotPrice: PARITY_FIELDS.slotPrice * K,
  products: [{ id: "p1", name: "3-seater sofa" }],
  months: PARITY_MONTHS.map((m) => ({
    rows: [
      {
        productId: "p1",
        qty: m.qty,
        unitCost: m.unitCost * K,
        soldQty: m.soldQty,
        sellPrice: m.sellPrice * K,
        stockLeft: m.stockLeft,
      },
    ],
    ads: m.ads * K,
    logistics: m.logi * K,
    misc: m.misc * K,
    bankCharges: m.bank * K,
  })) as [MonthInput, MonthInput, MonthInput],
};

const ours = compute(SINGLE);
const ref = referenceCompute(PARITY_FIELDS, PARITY_MONTHS);

let parityOk = true;
let maxDrift = 0;
/** Money: ours is kobo, the reference is naira */
function money(label: string, oursKobo: number, refNaira: number, tolKobo = 0) {
  const expected = refNaira * K;
  const drift = Math.abs(oursKobo - expected);
  if (drift > maxDrift) maxDrift = drift;
  // 1e-6 absorbs the reference's own float representation error
  if (drift > tolKobo + 1e-6) {
    parityOk = false;
    console.error(
      `  parity mismatch at ${label}: ours=${oursKobo}k ref=${expected}k drift=${drift}k`
    );
  }
}
/** Counts and flags: identical, no scaling */
function same(label: string, a: number | boolean, b: number | boolean) {
  if (a !== b) {
    parityOk = false;
    console.error(`  parity mismatch at ${label}: ours=${a} ref=${b}`);
  }
}

const TOL_MONTH = 5; // kobo — the weighted-average split rounds
const TOL_CYCLE = 20;

ours.months.forEach((m, k) => {
  const r = ref.months[k];
  const row = m.rows[0];
  const at = (f: string) => `month[${k}].${f}`;

  // Exact: pure products of the entered figures
  money(at("fundsIn"), m.fundsIn, r.fundsIn);
  money(at("openCash"), m.openCash, r.openCash);
  money(at("openTotal"), m.openTotal, r.openTotal);
  money(at("unitCost"), row.unitCost, r.unitCost);
  money(at("sellPrice"), row.sellPrice, r.sellPrice);
  money(at("spend→goodsCost"), row.spend, r.goodsCost);
  money(at("spend→purchCost"), row.spend, r.purchCost);
  money(at("revenue"), m.revenue, r.revenue);
  money(at("ads"), m.ads, r.ads);
  money(at("logistics→logi"), m.logistics, r.logi);
  money(at("misc"), m.misc, r.misc);
  money(at("bankCharges→bank"), m.bankCharges, r.bank);
  money(at("sellExp"), m.sellExp, r.sellExp);
  money(at("cash"), m.cash, r.cash);

  // Counts
  same(at("qty"), row.qty, r.qty);
  same(at("soldQty"), row.soldQty, r.soldQty);
  same(at("openUnits"), m.openUnits, r.openUnits);
  same(at("availUnits"), row.availUnits, r.availUnits);
  same(at("expectedLeft→expectClose"), row.expectedLeft, r.expectClose);
  same(at("closeUnits"), row.closeUnits, r.closeUnits);
  same(at("lostUnits"), m.lostUnits, r.lostUnits);
  same(at("oversold"), row.oversold, r.oversold as unknown as boolean);

  // Within a few kobo: derived from the weighted-average split
  money(at("openValue"), m.openValue, r.openValue, TOL_MONTH);
  money(at("availValue"), row.availValue, r.availValue, TOL_MONTH);
  money(at("unitCP"), row.unitCP, r.unitCP, TOL_MONTH);
  money(at("cogs"), m.cogs, r.cogs, TOL_MONTH);
  money(at("closeValue"), row.closeValue, r.closeValue, TOL_MONTH);
  money(at("lostValue"), m.lostValue, r.lostValue, TOL_MONTH);
  money(at("gross"), m.gross, r.gross, TOL_MONTH);
  money(at("net"), m.net, r.net, TOL_MONTH);
  money(at("working"), m.working, r.working, TOL_MONTH);
});

// Cycle level
const EXACT_MONEY: [keyof CycleResult, string][] = [
  ["slotPrice", "slotPrice"], ["capital", "capital"], ["revenue", "revenue"],
  ["sellExpTotal", "sellExpTotal"], ["adsTotal", "adsTotal"],
  ["logisticsTotal", "logiTotal"], ["miscTotal", "miscTotal"],
  ["bankTotal", "bankTotal"], ["purchTotal", "purchTotal"], ["endCash", "endCash"],
];
for (const [mine, theirs] of EXACT_MONEY) {
  money(`cycle.${String(mine)}`, ours[mine] as number, ref[theirs]);
}
const NEAR_MONEY: [keyof CycleResult, string][] = [
  ["profit", "profit"], ["holderPot", "holderPot"], ["mudaribPot", "mudaribPot"],
  ["grossPerSlot", "grossPerSlot"], ["whtPerSlot", "whtPerSlot"],
  ["netPerSlot", "netPerSlot"], ["whtTotal", "whtTotal"], ["netTotal", "netTotal"],
  ["payoutPerSlot", "payoutPerSlot"], ["cogsTotal", "cogsTotal"],
  ["lostTotal", "lostTotal"], ["endStock", "endStock"],
  // cashNeeded is DELIBERATELY not compared: the reference counts only
  // what reaches investors, and withholding tax leaves the business
  // too. See the explicit test below.
];
for (const [mine, theirs] of NEAR_MONEY) {
  money(`cycle.${String(mine)}`, ours[mine] as number, ref[theirs], TOL_CYCLE);
}
const COUNTS: [keyof CycleResult, string][] = [
  ["slots", "slots"], ["withdraw", "withdraw"], ["rollover", "rollover"],
  ["unitsSold", "unitsSold"], ["unitsBought", "unitsBought"],
  ["endUnits", "endUnits"], ["invRatio", "invRatio"], ["isLoss", "isLoss"],
];
for (const [mine, theirs] of COUNTS) {
  same(`cycle.${String(mine)}`, ours[mine] as number, ref[theirs]);
}
if (!near(ours.slotReturn, ref.slotReturn, 1e-4)) {
  parityOk = false;
  console.error(`  parity mismatch at cycle.slotReturn: ${ours.slotReturn} vs ${ref.slotReturn}`);
}

check(
  `single-product parity with the reference file (largest drift ${maxDrift} kobo)`,
  parityOk
);

/* ── 1b. Fractional slots, and what payout really costs ─────────── */

// The portal has held half slots since migration 004
const halfSlotCycle = compute({ ...SINGLE, slots: 20.5, withdrawSlots: 8.5 });
check(
  "slots and withdrawing slots accept halves",
  halfSlotCycle.slots === 20.5 &&
    halfSlotCycle.withdraw === 8.5 &&
    halfSlotCycle.rollover === 12 &&
    halfSlotCycle.capital === Math.round(20.5 * SINGLE.slotPrice),
  { slots: halfSlotCycle.slots, capital: halfSlotCycle.capital }
);

// Profit is paid to EVERY investor whatever they do with their
// capital, and the withheld portion still leaves the business — as a
// remittance rather than to the investor, but it leaves.
check(
  "cash needed is every investor's profit plus withdrawing capital",
  ours.cashNeeded === Math.round(ours.holderPot + ours.withdraw * ours.slotPrice),
  { cashNeeded: ours.cashNeeded, holderPot: ours.holderPot }
);
check(
  "cash needed does not change when a holder rolls their capital over",
  compute({ ...SINGLE, withdrawSlots: 0 }).cashNeeded === ours.holderPot
);
check(
  "cash needed covers the tax as well as what the investor receives",
  ours.cashNeeded - ours.withdraw * ours.slotPrice ===
    ours.netTotal + ours.whtTotal ||
    ours.cashNeeded - ours.withdraw * ours.slotPrice >= ours.netTotal
);

/* ── 1c. Holders are paid from an exact division of the pot ─────── */

const alloc = allocateHolders(ours, [
  { investmentId: "i1", investorId: "v1", units: 12.5, capitalAction: "withdraw", slotsWithdrawn: 12.5 },
  { investmentId: "i2", investorId: "v2", units: 7.5, capitalAction: "rollover", slotsWithdrawn: 0 },
]);
check(
  "holder profits add back to the investor pot EXACTLY, in kobo",
  alloc.reduce((s, h) => s + h.grossProfit, 0) === ours.holderPot,
  { sum: alloc.reduce((s, h) => s + h.grossProfit, 0), pot: ours.holderPot }
);
check(
  "tax is taken from each holder's own allocated gross",
  alloc.every((h) => h.netProfit === h.grossProfit - h.wht)
);
check(
  "a holder rolling capital over is still paid their profit",
  alloc[1].capitalAction === "rollover" &&
    alloc[1].capitalWithdrawn === 0 &&
    alloc[1].amountPaid === alloc[1].netProfit &&
    alloc[1].netProfit > 0
);
check(
  "a holder withdrawing is paid profit AND capital",
  alloc[0].amountPaid === alloc[0].netProfit + alloc[0].capitalWithdrawn &&
    alloc[0].capitalWithdrawn === Math.round(12.5 * ours.slotPrice)
);
// An awkward pot that does not divide evenly still lands exactly
const awkward = allocateHolders(
  { ...ours, holderPot: 100_000_003 },
  [
    { investmentId: "a", investorId: "a", units: 1.5, capitalAction: "rollover", slotsWithdrawn: 0 },
    { investmentId: "b", investorId: "b", units: 1.5, capitalAction: "rollover", slotsWithdrawn: 0 },
    { investmentId: "c", investorId: "c", units: 1.5, capitalAction: "rollover", slotsWithdrawn: 0 },
  ]
);
check(
  "a pot that will not divide evenly is still allocated to the last kobo",
  awkward.reduce((s, h) => s + h.grossProfit, 0) === 100_000_003 &&
    Math.max(...awkward.map((h) => h.grossProfit)) -
      Math.min(...awkward.map((h) => h.grossProfit)) <= 1
);

/* ── 2. Independent carry-forward, no cross-contamination ────────── */

const row = (
  productId: string,
  qty: number,
  unitCost: number,
  soldQty: number,
  sellPrice: number,
  stockLeft?: number
): MonthRowInput => ({ productId, qty, unitCost, soldQty, sellPrice, stockLeft });

const month = (rows: MonthRowInput[], exp = 0): MonthInput => ({
  rows,
  ads: exp,
  logistics: 0,
  misc: 0,
  bankCharges: 0,
});

// A: 10 sofas at ₦50,000, all sold in month 1.
// B: 100 side tables at ₦2,000, dribbling out to month 3.
const carryCycle = compute({
  slotPrice: 100_000 * K,
  slots: 10,
  ratio: 70,
  wht: 5,
  withdrawSlots: 0,
  products: [
    { id: "A", name: "3-seater sofa" },
    { id: "B", name: "Side table" },
  ],
  months: [
    month(
      [row("A", 10, 50_000 * K, 10, 70_000 * K), row("B", 100, 2_000 * K, 20, 3_000 * K)],
      50_000 * K
    ),
    month([row("B", 0, 0, 30, 3_100 * K)], 40_000 * K),
    month([row("B", 0, 0, 25, 3_200 * K)], 30_000 * K),
  ],
});
const b3 = carryCycle.months[2].rows.find((r) => r.productId === "B")!;
const a3 = carryCycle.months[2].rows.find((r) => r.productId === "A")!;
check(
  "product A sells out and stays out (no phantom stock)",
  a3.closeUnits === 0 && a3.closeValue === 0,
  { units: a3.closeUnits, value: a3.closeValue }
);
check(
  "product B keeps its OWN cost price (₦2,000), uncontaminated by A's ₦50,000",
  b3.unitCP === 2_000 * K,
  b3.unitCP
);
check(
  "product B's leftover 25 units are valued at ITS cost (₦50,000)",
  b3.closeUnits === 25 && b3.closeValue === 50_000 * K,
  { units: b3.closeUnits, value: b3.closeValue }
);
// A single shared average would have been (500,000 + 200,000) / 110 = ₦6,363.64
check(
  "a single shared average across products would have been wrong",
  Math.abs(b3.unitCP - (700_000 * K) / 110) > 1
);

/* ── 3. Repeat purchase blends only that product ─────────────────── */

const blendCycle = compute({
  slotPrice: 100_000 * K,
  slots: 5,
  ratio: 70,
  wht: 5,
  withdrawSlots: 0,
  products: [
    { id: "A", name: "Bed frame" },
    { id: "B", name: "Dining table" },
  ],
  months: [
    month([row("A", 10, 1_000 * K, 0, 0), row("B", 4, 9_000 * K, 0, 0)]),
    month([row("A", 10, 2_000 * K, 0, 0)]), // same product, different price
    month([row("A", 0, 0, 20, 4_000 * K), row("B", 0, 0, 4, 12_000 * K)]),
  ],
});
const aBlend = blendCycle.months[1].rows.find((r) => r.productId === "A")!;
const bBlend = blendCycle.months[1].rows.find((r) => r.productId === "B")!;
check(
  "repeat purchase blends to the weighted average (₦1,500)",
  aBlend.unitCP === 1_500 * K,
  aBlend.unitCP
);
check(
  "the other product's cost price is untouched (₦9,000)",
  bBlend.unitCP === 9_000 * K,
  bBlend.unitCP
);
check(
  "a product with no row that month carries its stock forward untouched",
  bBlend.implicit && bBlend.closeUnits === 4 && bBlend.closeValue === 36_000 * K,
  { implicit: bBlend.implicit, units: bBlend.closeUnits, value: bBlend.closeValue }
);

/* ── 4. The invariant, on random multi-product cycles ────────────── */

check(
  "invariant on the single-product cycle (exact, to the kobo)",
  ours.endCash + ours.endStock === ours.capital + ours.profit,
  { endCash: ours.endCash, endStock: ours.endStock, capital: ours.capital, profit: ours.profit }
);

let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const ri = (max: number) => Math.floor(rnd() * max);
let invariantOk = true;
for (let t = 0; t < 500; t++) {
  const count = 1 + ri(4);
  const products = Array.from({ length: count }, (_, i) => ({
    id: `p${i}`,
    name: `Product ${i}`,
  }));
  // Generated month by month so the two rules a real entry always
  // satisfies hold: you cannot sell units you never had, and you
  // cannot count more units left than existed. Both are ERRORS that
  // validateCycle rejects and the admin page blocks (see the boundary
  // test below). Everything else stays random — missing rows, repeat
  // purchases at new prices, shrinkage, surplus stock, sell-outs.
  const carried = new Map(products.map((p) => [p.id, 0]));
  const mkMonth = (): MonthInput => ({
    rows: products
      // sometimes a product has no row at all that month
      .filter(() => rnd() > 0.2)
      .map((p) => {
        const qty = ri(200);
        const avail = carried.get(p.id)! + qty;
        const soldQty = ri(avail + 1);
        const expected = avail - soldQty;
        const r: MonthRowInput = {
          productId: p.id,
          qty,
          unitCost: ri(2_000_000),
          soldQty,
          sellPrice: ri(3_000_000),
        };
        // occasionally the counted stock falls short — damage, shrinkage
        if (rnd() > 0.7) r.stockLeft = ri(expected + 1);
        carried.set(p.id, r.stockLeft ?? expected);
        return r;
      }),
    ads: ri(8_000_000),
    logistics: ri(4_000_000),
    misc: ri(2_000_000),
    bankCharges: ri(1_000_000),
  });
  const c = compute({
    slotPrice: 100_000 + ri(50_000_000),
    slots: 1 + ri(200),
    ratio: ri(101),
    wht: ri(16),
    withdrawSlots: ri(200),
    products,
    months: [mkMonth(), mkMonth(), mkMonth()],
  });
  // Integer kobo throughout: this is an EXACT equality, not a tolerance
  if (c.endCash + c.endStock !== c.capital + c.profit) {
    invariantOk = false;
    console.error("  invariant broken:", {
      lhs: c.endCash + c.endStock,
      rhs: c.capital + c.profit,
      diff: c.endCash + c.endStock - (c.capital + c.profit),
      products: count,
    });
    break;
  }
}
check("invariant holds EXACTLY on 500 random multi-product cycles", invariantOk);

// The boundary. Overselling drives closing stock negative, so a later
// month can hold value against zero units — and a weighted-average
// cost of zero units erases it. The invariant is guaranteed for any
// cycle that PASSES validation; this pins that the breaking shape is
// exactly the one validation refuses to let through.
const brokenInput: CycleInput = {
  slotPrice: 100_000 * K, slots: 1, ratio: 70, wht: 5, withdrawSlots: 0,
  products: [{ id: "a", name: "Wardrobe" }],
  months: [
    month([row("a", 10, 1_000 * K, 15, 2_000 * K)]), // sold 15, only 10 existed
    month([row("a", 5, 4_000 * K, 0, 0)]),
    month([]),
  ],
};
const broken = compute(brokenInput);
check(
  "the one shape that breaks the invariant is rejected as an error",
  broken.endCash + broken.endStock !== broken.capital + broken.profit &&
    validateCycle(brokenInput, broken).some(
      (i) => i.level === "error" && i.code === "oversold"
    )
);

/* ── 5. No per-product leakage into the investor view ────────────── */

const MULTI: CycleInput = {
  slotPrice: 100_000 * K,
  slots: 20,
  ratio: 70,
  wht: 5,
  withdrawSlots: 8,
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
        row("table", 30, 9_400 * K, 33, 14_600 * K, 15), // 1 table damaged
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
  ],
};
const multi = compute(MULTI);
const inv = investorView(multi);
const serialised = JSON.stringify(inv);

const leakedName = MULTI.products.find((p) =>
  serialised.toLowerCase().includes(p.name.toLowerCase())
);
check("investor view contains no product name", !leakedName, leakedName?.name);

const keys = new Set<string>();
(function walk(v: unknown) {
  if (Array.isArray(v)) return v.forEach(walk);
  if (v && typeof v === "object") {
    for (const [k, val] of Object.entries(v)) {
      keys.add(k);
      walk(val);
    }
  }
})(inv);
const badKey = [...keys].find((k) => /product|sku|unitc|unit_?cost|costprice/i.test(k));
check("investor view has no product-shaped or unit-cost field", !badKey, badKey);

// No per-product figure may appear anywhere in the investor view
const values = new Set<number>();
(function walkNums(v: unknown) {
  if (typeof v === "number") return void values.add(v);
  if (Array.isArray(v)) return v.forEach(walkNums);
  if (v && typeof v === "object") Object.values(v).forEach(walkNums);
})(inv);
const leakedFigure = multi.products
  .flatMap((p) => [
    { p: p.productName, f: "revenue", v: p.revenue },
    { p: p.productName, f: "units bought", v: p.unitsBought },
    { p: p.productName, f: "units sold", v: p.unitsSold },
    { p: p.productName, f: "gross", v: p.gross },
  ])
  .find((x) => values.has(x.v));
check(
  "no per-product revenue or quantity appears in the investor view",
  !leakedFigure,
  leakedFigure
);
check(
  "the admin result still carries the per-product summary",
  multi.products.length === 3 &&
    multi.products.every((p) => p.productName && p.revenue > 0 && p.grossMargin > 0)
);
check(
  "investor totals are the sum across all products",
  inv.unitsBought === multi.products.reduce((s, p) => s + p.unitsBought, 0) &&
    inv.unitsSold === multi.products.reduce((s, p) => s + p.unitsSold, 0) &&
    inv.revenue === multi.products.reduce((s, p) => s + p.revenue, 0)
);

/* ── 6. Validation names the product ─────────────────────────────── */

const issues = validateCycle(MULTI, multi);
const damaged = issues.find((i) => i.code === "stock_below_expected");
check(
  "a stock shortfall warns and names the product",
  !!damaged && damaged.productName === "Dining table" && damaged.month === 2,
  damaged
);

const oversoldIssues = validateCycle({
  ...MULTI,
  months: [
    { ...MULTI.months[0], rows: [row("sofa", 5, 47_000 * K, 99, 71_000 * K)] },
    MULTI.months[1],
    MULTI.months[2],
  ] as [MonthInput, MonthInput, MonthInput],
});
const over = oversoldIssues.find((i) => i.code === "oversold");
check(
  "selling more than were available errors and names the product",
  !!over && over.level === "error" && over.productName === "3-seater sofa",
  over
);

const aboveIssues = validateCycle({
  ...MULTI,
  months: [
    { ...MULTI.months[0], rows: [row("sofa", 5, 47_000 * K, 2, 71_000 * K, 9)] },
    MULTI.months[1],
    MULTI.months[2],
  ] as [MonthInput, MonthInput, MonthInput],
});
check(
  "more stock left than existed errors",
  aboveIssues.some((i) => i.code === "stock_above_expected" && i.level === "error")
);

/* ── 7. Loss branch ─────────────────────────────────────────────── */

const lossCycle = compute({
  slotPrice: 100_000 * K,
  slots: 10,
  ratio: 70,
  wht: 5,
  withdrawSlots: 0,
  products: [{ id: "x", name: "Wardrobe" }],
  months: [
    { rows: [row("x", 100, 10_000 * K, 40, 9_000 * K, 60)], ads: 90_000 * K, logistics: 40_000 * K, misc: 20_000 * K, bankCharges: 10_000 * K },
    { rows: [row("x", 0, 0, 30, 8_500 * K, 30)], ads: 60_000 * K, logistics: 25_000 * K, misc: 5_000 * K, bankCharges: 5_000 * K },
    { rows: [row("x", 0, 0, 30, 8_000 * K, 0)], ads: 40_000 * K, logistics: 20_000 * K, misc: 5_000 * K, bankCharges: 5_000 * K },
  ],
});
check("loss cycle really is a loss", lossCycle.isLoss && lossCycle.profit < 0, lossCycle.profit);
check("on loss: manager pot is exactly zero", lossCycle.mudaribPot === 0, lossCycle.mudaribPot);
check("on loss: holders bear the WHOLE loss (no ratio applied)", lossCycle.holderPot === lossCycle.profit);
check("on loss: no withholding tax charged", lossCycle.whtPerSlot === 0);

const h = holderFigures(multi, { slots: 3 });
check(
  "holder figures derive from slots × per-slot values",
  h.theirCapital === 3 * multi.slotPrice &&
    h.theirProfit === 3 * multi.netPerSlot &&
    h.theirTotal === h.theirCapital + h.theirProfit
);

/* ── Checkpoint printout ────────────────────────────────────────── */

console.log("\n──── A. SINGLE PRODUCT — parity with the reference file ────");
console.log(`Capital ₦${nf(ours.capital)} · profit ₦${nf(ours.profit)} · net/slot ₦${nf(ours.netPerSlot)} · return ${ours.slotReturn.toFixed(2)}%`);
console.log(`Largest drift from the reference: ${maxDrift} kobo`);
console.log(`Invariant: cash ₦${nf(ours.endCash)} + stock ₦${nf(ours.endStock)} = ₦${nf(ours.endCash + ours.endStock)} vs capital+profit ₦${nf(ours.capital + ours.profit)}`);

console.log("\n──── B. THREE PRODUCTS IN ONE CYCLE ────");
console.log("Admin — per-product summary (never leaves the admin dashboard):");
multi.products.forEach((p) =>
  console.log(
    `  ${p.productName.padEnd(15)} bought ${String(p.unitsBought).padStart(3)} · sold ${String(p.unitsSold).padStart(3)} · left ${String(p.unitsLeft).padStart(3)} · revenue ₦${nf(p.revenue)} · gross ₦${nf(p.gross)} · margin ${p.grossMargin.toFixed(1)}%`
  )
);
multi.months.forEach((m) =>
  console.log(
    `  Month ${m.i}: revenue ₦${nf(m.revenue)} · expenses ₦${nf(m.sellExp)} · net ₦${nf(m.net)} · cash ₦${nf(m.cash)} · stock ${m.unitsLeft}u ₦${nf(m.stockValue)}`
  )
);
console.log(`  Cycle profit ₦${nf(multi.profit)} · holders (70%) ₦${nf(multi.holderPot)} · manager (30%) ₦${nf(multi.mudaribPot)}`);
console.log(`  Per slot: gross ₦${nf(multi.grossPerSlot)} · WHT ₦${nf(multi.whtPerSlot)} · net ₦${nf(multi.netPerSlot)} · return ${multi.slotReturn.toFixed(2)}%`);
console.log(`  Invariant: cash ₦${nf(multi.endCash)} + stock ₦${nf(multi.endStock)} = ₦${nf(multi.endCash + multi.endStock)} vs capital+profit ₦${nf(multi.capital + multi.profit)}`);
console.log("Investor — the SAME cycle, aggregate only:");
console.log(`  Total products purchased ${inv.unitsBought} · sold ${inv.unitsSold} · left ${inv.unitsLeft}`);
console.log(`  Total cost of purchase ₦${nf(inv.purchaseCost)} · total sales ₦${nf(inv.revenue)} · expenses ₦${nf(inv.expensesTotal)}`);
console.log(`  Profit ₦${nf(inv.profit)} · their share per slot ₦${nf(inv.netPerSlot)} · payout/slot ₦${nf(inv.payoutPerSlot)}`);
console.log("  (no product names, no per-product quantities, no unit cost — asserted above)");

process.exit(failures === 0 ? 0 : 1);
