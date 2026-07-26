/**
 * Regression tests for src/lib/mudarabah/compute.ts
 *
 * 1. SINGLE-PRODUCT PARITY — extracts the compute() engine out of
 *    reference/mudarabah-report-v4.html (the source of truth) and runs
 *    it on the same cycle. A one-product cycle must produce figures
 *    identical to the reference. Purchase expenses are passed as zero,
 *    which is arithmetically identical to the field not existing.
 * 2. INDEPENDENT CARRY-FORWARD — one product sells out while another
 *    carries stock; each keeps its own cost price, no cross-contamination.
 * 3. REPEAT PURCHASE — buying the same product again at a different
 *    price blends only that product's cost price.
 * 4. INVARIANT — on random multi-product inputs:
 *      endCash + sum of final closing values === capital + profit
 * 5. NO PER-PRODUCT LEAKAGE — the investor-facing view contains no
 *    product name, no per-product quantity and no unit cost.
 * 6. LOSS BRANCH — on a loss the manager's pot is exactly zero.
 *
 * Run: npx tsx scripts/test-mudarabah-compute.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
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

/** Runs the REFERENCE file's own compute(), untouched. */
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

/** The checkpoint cycle, as a single-product cycle */
const PARITY_MONTHS: RefMonth[] = [
  { qty: 200, unitCost: 8_000, soldQty: 150, sellPrice: 12_000, ads: 60_000, logi: 25_000, misc: 10_000, bank: 5_000, stockLeft: 50 },
  { qty: 120, unitCost: 8_500, soldQty: 140, sellPrice: 12_500, ads: 55_000, logi: 22_000, misc: 8_000, bank: 6_000, stockLeft: 28 }, // 2 lost
  { qty: 100, unitCost: 9_000, soldQty: 120, sellPrice: 13_000, ads: 50_000, logi: 20_000, misc: 12_000, bank: 7_000, stockLeft: 8 },
];
const PARITY_FIELDS = { slotPrice: 100_000, slots: 20, ratio: 70, wht: 5, withdrawSlots: 8 };

const SINGLE: CycleInput = {
  ...PARITY_FIELDS,
  products: [{ id: "p1", name: "3-seater sofa" }],
  months: PARITY_MONTHS.map((m) => ({
    rows: [
      {
        productId: "p1",
        qty: m.qty,
        unitCost: m.unitCost,
        soldQty: m.soldQty,
        sellPrice: m.sellPrice,
        stockLeft: m.stockLeft,
      },
    ],
    ads: m.ads,
    logistics: m.logi,
    misc: m.misc,
    bankCharges: m.bank,
  })) as [MonthInput, MonthInput, MonthInput],
};

const ours = compute(SINGLE);
const ref = referenceCompute(PARITY_FIELDS, PARITY_MONTHS);

let parityOk = true;
function parity(label: string, a: number | boolean, b: number | boolean) {
  const ok = typeof a === "number" && typeof b === "number" ? near(a, b) : a === b;
  if (!ok) {
    parityOk = false;
    console.error(`  parity mismatch at ${label}: ours=${a} ref=${b}`);
  }
}

// Month-level and (single) row-level fields, against their reference names
ours.months.forEach((m, k) => {
  const r = ref.months[k];
  const row = m.rows[0];
  const at = (f: string) => `month[${k}].${f}`;
  parity(at("fundsIn"), m.fundsIn, r.fundsIn);
  parity(at("openCash"), m.openCash, r.openCash);
  parity(at("openTotal"), m.openTotal, r.openTotal);
  parity(at("openUnits"), m.openUnits, r.openUnits);
  parity(at("openValue"), m.openValue, r.openValue);
  parity(at("qty"), row.qty, r.qty);
  parity(at("unitCost"), row.unitCost, r.unitCost);
  parity(at("spend→goodsCost"), row.spend, r.goodsCost);
  parity(at("spend→purchCost"), row.spend, r.purchCost);
  parity(at("availUnits"), row.availUnits, r.availUnits);
  parity(at("availValue"), row.availValue, r.availValue);
  parity(at("unitCP"), row.unitCP, r.unitCP);
  parity(at("soldQty"), row.soldQty, r.soldQty);
  parity(at("sellPrice"), row.sellPrice, r.sellPrice);
  parity(at("revenue"), m.revenue, r.revenue);
  parity(at("cogs"), m.cogs, r.cogs);
  parity(at("ads"), m.ads, r.ads);
  parity(at("logistics→logi"), m.logistics, r.logi);
  parity(at("misc"), m.misc, r.misc);
  parity(at("bankCharges→bank"), m.bankCharges, r.bank);
  parity(at("sellExp"), m.sellExp, r.sellExp);
  parity(at("expectedLeft→expectClose"), row.expectedLeft, r.expectClose);
  parity(at("closeUnits"), row.closeUnits, r.closeUnits);
  parity(at("closeValue"), row.closeValue, r.closeValue);
  parity(at("lostUnits"), m.lostUnits, r.lostUnits);
  parity(at("lostValue"), m.lostValue, r.lostValue);
  parity(at("gross"), m.gross, r.gross);
  parity(at("net"), m.net, r.net);
  parity(at("cash"), m.cash, r.cash);
  parity(at("working"), m.working, r.working);
  parity(at("oversold"), row.oversold, r.oversold as unknown as boolean);
});

// Cycle-level fields
const CYCLE_PAIRS: [keyof CycleResult, string][] = [
  ["slotPrice", "slotPrice"], ["slots", "slots"], ["capital", "capital"],
  ["withdraw", "withdraw"], ["rollover", "rollover"], ["profit", "profit"],
  ["isLoss", "isLoss"], ["holderPot", "holderPot"], ["mudaribPot", "mudaribPot"],
  ["grossPerSlot", "grossPerSlot"], ["whtPerSlot", "whtPerSlot"],
  ["netPerSlot", "netPerSlot"], ["whtTotal", "whtTotal"], ["netTotal", "netTotal"],
  ["slotReturn", "slotReturn"], ["payoutPerSlot", "payoutPerSlot"],
  ["revenue", "revenue"], ["cogsTotal", "cogsTotal"], ["sellExpTotal", "sellExpTotal"],
  ["adsTotal", "adsTotal"], ["logisticsTotal", "logiTotal"], ["miscTotal", "miscTotal"],
  ["bankTotal", "bankTotal"], ["purchTotal", "purchTotal"], ["lostTotal", "lostTotal"],
  ["unitsSold", "unitsSold"], ["unitsBought", "unitsBought"], ["endCash", "endCash"],
  ["endStock", "endStock"], ["endUnits", "endUnits"], ["cashNeeded", "cashNeeded"],
  ["invRatio", "invRatio"],
];
for (const [mine, theirs] of CYCLE_PAIRS) {
  parity(`cycle.${String(mine)}`, ours[mine] as number, ref[theirs]);
}
check("single-product parity — figures identical to the reference file", parityOk);

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

// A: 10 sofas @ ₦50,000, all sold in month 1.
// B: 100 side tables @ ₦2,000, dribbling out to month 3.
const carryCycle = compute({
  slotPrice: 100_000,
  slots: 10,
  ratio: 70,
  wht: 5,
  withdrawSlots: 0,
  products: [
    { id: "A", name: "3-seater sofa" },
    { id: "B", name: "Side table" },
  ],
  months: [
    month([row("A", 10, 50_000, 10, 70_000), row("B", 100, 2_000, 20, 3_000)], 50_000),
    month([row("B", 0, 0, 30, 3_100)], 40_000),
    month([row("B", 0, 0, 25, 3_200)], 30_000),
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
  near(b3.unitCP, 2_000),
  b3.unitCP
);
check(
  "product B's leftover 25 units are valued at ITS cost (₦50,000)",
  b3.closeUnits === 25 && near(b3.closeValue, 50_000),
  { units: b3.closeUnits, value: b3.closeValue }
);
// A single shared average would have been (500,000 + 200,000) / 110 = ₦6,363.64
check(
  "a single shared average across products would have been wrong",
  !near(b3.unitCP, 700_000 / 110, 0.01)
);

/* ── 3. Repeat purchase blends only that product ─────────────────── */

const blendCycle = compute({
  slotPrice: 100_000,
  slots: 5,
  ratio: 70,
  wht: 5,
  withdrawSlots: 0,
  products: [
    { id: "A", name: "Bed frame" },
    { id: "B", name: "Dining table" },
  ],
  months: [
    month([row("A", 10, 1_000, 0, 0), row("B", 4, 9_000, 0, 0)]),
    month([row("A", 10, 2_000, 0, 0)]), // same product, different price
    month([row("A", 0, 0, 20, 4_000), row("B", 0, 0, 4, 12_000)]),
  ],
});
const aBlend = blendCycle.months[1].rows.find((r) => r.productId === "A")!;
const bBlend = blendCycle.months[1].rows.find((r) => r.productId === "B")!;
check(
  "repeat purchase blends to the weighted average (₦1,500)",
  near(aBlend.unitCP, 1_500),
  aBlend.unitCP
);
check(
  "the other product's cost price is untouched (₦9,000)",
  near(bBlend.unitCP, 9_000),
  bBlend.unitCP
);
check(
  "a product with no row that month carries its stock forward untouched",
  bBlend.implicit && bBlend.closeUnits === 4 && near(bBlend.closeValue, 36_000),
  { implicit: bBlend.implicit, units: bBlend.closeUnits, value: bBlend.closeValue }
);

/* ── 4. The invariant, on random multi-product cycles ────────────── */

check(
  "invariant on the single-product cycle",
  near(ours.endCash + ours.endStock, ours.capital + ours.profit, 0.01),
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
          unitCost: Math.round(rnd() * 20_000 * 100) / 100,
          soldQty,
          sellPrice: Math.round(rnd() * 30_000 * 100) / 100,
        };
        // occasionally the counted stock falls short — damage, shrinkage
        if (rnd() > 0.7) r.stockLeft = ri(expected + 1);
        carried.set(p.id, r.stockLeft ?? expected);
        return r;
      }),
    ads: ri(80_000),
    logistics: ri(40_000),
    misc: ri(20_000),
    bankCharges: ri(10_000),
  });
  const c = compute({
    slotPrice: 1_000 + ri(500_000),
    slots: 1 + ri(200),
    ratio: ri(101),
    wht: ri(16),
    withdrawSlots: ri(200),
    products,
    months: [mkMonth(), mkMonth(), mkMonth()],
  });
  const lhs = c.endCash + c.endStock;
  const rhs = c.capital + c.profit;
  if (Math.abs(lhs - rhs) > Math.max(0.01, Math.abs(rhs) * 1e-9)) {
    invariantOk = false;
    console.error("  invariant broken:", { lhs, rhs, diff: lhs - rhs, products: count });
    break;
  }
}
check("invariant holds on 500 random multi-product cycles", invariantOk);

// The boundary. Overselling drives closing stock negative, so a later
// month can hold value against zero units — and a weighted-average
// cost of zero units erases it. The invariant is guaranteed for any
// cycle that PASSES validation; this pins that the breaking shape is
// exactly the one validation refuses to let through.
const brokenInput: CycleInput = {
  slotPrice: 100_000, slots: 1, ratio: 70, wht: 5, withdrawSlots: 0,
  products: [{ id: "a", name: "Wardrobe" }],
  months: [
    month([row("a", 10, 1_000, 15, 2_000)]), // sold 15, only 10 existed
    month([row("a", 5, 4_000, 0, 0)]),
    month([]),
  ],
};
const broken = compute(brokenInput);
check(
  "the one shape that breaks the invariant is rejected as an error",
  Math.abs(broken.endCash + broken.endStock - (broken.capital + broken.profit)) > 0.01 &&
    validateCycle(brokenInput, broken).some(
      (i) => i.level === "error" && i.code === "oversold"
    )
);

/* ── 5. No per-product leakage into the investor view ────────────── */

const MULTI: CycleInput = {
  slotPrice: 100_000,
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
        row("sofa", 20, 47_000, 13, 71_000),
        row("table", 50, 9_100, 31, 14_300),
        row("bed", 25, 21_000, 17, 31_000),
      ],
      ads: 60_000, logistics: 25_000, misc: 10_000, bankCharges: 5_000,
    },
    {
      rows: [
        row("sofa", 12, 48_500, 14, 72_500),
        row("table", 30, 9_400, 33, 14_600, 15), // 1 table damaged
        row("bed", 10, 21_500, 12, 31_500),
      ],
      ads: 55_000, logistics: 22_000, misc: 8_000, bankCharges: 6_000,
    },
    {
      rows: [
        row("sofa", 6, 49_000, 9, 73_000),
        row("table", 20, 9_600, 30, 15_000),
        row("bed", 8, 22_000, 13, 32_000),
      ],
      ads: 50_000, logistics: 20_000, misc: 12_000, bankCharges: 7_000,
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
  if (typeof v === "number") return void values.add(Math.round(v * 100) / 100);
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
  .find((x) => values.has(Math.round(x.v * 100) / 100));
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
    near(inv.revenue, multi.products.reduce((s, p) => s + p.revenue, 0), 1e-6)
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
    { ...MULTI.months[0], rows: [row("sofa", 5, 47_000, 99, 71_000)] },
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
    { ...MULTI.months[0], rows: [row("sofa", 5, 47_000, 2, 71_000, 9)] },
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
  slotPrice: 100_000,
  slots: 10,
  ratio: 70,
  wht: 5,
  withdrawSlots: 0,
  products: [{ id: "x", name: "Wardrobe" }],
  months: [
    { rows: [row("x", 100, 10_000, 40, 9_000, 60)], ads: 90_000, logistics: 40_000, misc: 20_000, bankCharges: 10_000 },
    { rows: [row("x", 0, 0, 30, 8_500, 30)], ads: 60_000, logistics: 25_000, misc: 5_000, bankCharges: 5_000 },
    { rows: [row("x", 0, 0, 30, 8_000, 0)], ads: 40_000, logistics: 20_000, misc: 5_000, bankCharges: 5_000 },
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
    near(h.theirProfit, 3 * multi.netPerSlot) &&
    near(h.theirTotal, h.theirCapital + h.theirProfit)
);

/* ── Checkpoint printout ────────────────────────────────────────── */

const nf = (n: number) => n.toLocaleString("en-NG", { maximumFractionDigits: 2 });

console.log("\n──── A. SINGLE PRODUCT — ours === reference file ────");
console.log(`Capital ₦${nf(ours.capital)} · profit ₦${nf(ours.profit)} · net/slot ₦${nf(ours.netPerSlot)} · return ${ours.slotReturn.toFixed(2)}%`);
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
