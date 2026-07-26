/**
 * Regression tests for src/lib/mudarabah/compute.ts
 *
 * 1. REFERENCE PARITY — extracts the compute() engine out of
 *    reference/mudarabah-report-v4.html (the source of truth) and
 *    executes it on the same cycle; every field of every month and
 *    every cycle figure must match our module exactly.
 * 2. INVARIANT — on random inputs:
 *      endCash + endStockValue === totalCapital + totalProfit
 *    It holds by construction; if it fails, the calculation broke.
 * 3. LOSS BRANCH — on a loss the manager's pot is exactly zero and
 *    holders bear the whole loss.
 *
 * Run: npx tsx scripts/test-mudarabah-compute.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { compute, holderFigures, type CycleInput, type MonthInput } from "../src/lib/mudarabah/compute";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

// ── Run the REFERENCE file's own engine ─────────────────────────────
function referenceCompute(input: CycleInput): Record<string, unknown> {
  const html = readFileSync(
    join(__dirname, "..", "reference", "mudarabah-report-v4.html"),
    "utf8"
  );
  const start = html.indexOf("function compute(){");
  const end = html.indexOf("/* ==================== admin UI");
  if (start < 0 || end < 0) throw new Error("Could not locate compute() in reference file");
  const source = html.slice(start, end);

  // Minimal stand-ins for the reference file's helpers/DOM
  const fields: Record<string, number> = {
    slotPrice: input.slotPrice,
    slots: input.slots,
    ratio: input.ratio,
    wht: input.wht,
    withdrawSlots: input.withdrawSlots,
  };
  const prelude = `
    var state = { months: MONTHS };
    var $ = function(id){ return { value: FIELDS[id] }; };
    function num(v){ var n=parseFloat(v); return isFinite(n)?n:0; }
    function int(v){ var n=parseFloat(v); return isFinite(n)?Math.round(n):0; }
  `;
  const fn = new Function(
    "FIELDS",
    "MONTHS",
    prelude + source + "\nreturn compute();"
  );
  return fn(fields, input.months) as Record<string, unknown>;
}

function assertDeepEqual(name: string, ours: unknown, ref: unknown, path = ""): void {
  if (typeof ours === "number" && typeof ref === "number") {
    // identical operation order → expect exact equality; allow 1e-9 for safety
    if (!(ours === ref || Math.abs(ours - ref) < 1e-9)) {
      failures++;
      console.error(`FAIL: ${name} — mismatch at ${path}: ours=${ours} ref=${ref}`);
    }
    return;
  }
  if (Array.isArray(ours) && Array.isArray(ref)) {
    ours.forEach((v, i) => assertDeepEqual(name, v, ref[i], `${path}[${i}]`));
    return;
  }
  if (ours && ref && typeof ours === "object" && typeof ref === "object") {
    for (const key of Object.keys(ref as object)) {
      assertDeepEqual(
        name,
        (ours as Record<string, unknown>)[key],
        (ref as Record<string, unknown>)[key],
        `${path}.${key}`
      );
    }
    return;
  }
  if (ours !== ref) {
    failures++;
    console.error(`FAIL: ${name} — mismatch at ${path}: ours=${String(ours)} ref=${String(ref)}`);
  }
}

// ── Checkpoint cycle (realistic 3-month furniture trade) ───────────
const SAMPLE: CycleInput = {
  slotPrice: 100_000,
  slots: 20,
  ratio: 70,
  wht: 5,
  withdrawSlots: 8,
  months: [
    { qty: 200, unitCost: 8_000, purchExp: 40_000, soldQty: 150, sellPrice: 12_000, ads: 60_000, logi: 25_000, misc: 10_000, bank: 5_000, stockLeft: 50 },
    { qty: 120, unitCost: 8_500, purchExp: 30_000, soldQty: 140, sellPrice: 12_500, ads: 55_000, logi: 22_000, misc: 8_000, bank: 6_000, stockLeft: 28 }, // 2 units lost
    { qty: 100, unitCost: 9_000, purchExp: 25_000, soldQty: 120, sellPrice: 13_000, ads: 50_000, logi: 20_000, misc: 12_000, bank: 7_000, stockLeft: 8 },
  ],
};

// 1) Reference parity — every field identical
const ours = compute(SAMPLE);
const ref = referenceCompute(SAMPLE);
const before = failures;
assertDeepEqual("reference parity", ours, ref);
if (failures === before) console.log("PASS: reference parity — every month field and cycle figure identical to the reference engine");

// 2) The invariant on the sample
check(
  "invariant on sample: endCash + endStock === capital + profit",
  Math.abs(ours.endCash + ours.endStock - (ours.capital + ours.profit)) < 0.01,
  { endCash: ours.endCash, endStock: ours.endStock, capital: ours.capital, profit: ours.profit }
);

// 3) Invariant on random inputs (seeded LCG for reproducibility)
let seed = 42;
const rnd = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
const ri = (max: number) => Math.floor(rnd() * max);
let invariantOk = true;
for (let t = 0; t < 500; t++) {
  // Months are generated sequentially so the one coherence rule real
  // entries always satisfy holds: purchase expenses only exist when
  // there are units to capitalise them into (weighted-average cost
  // cannot attach value to zero units — the admin UI flags this).
  // Oversells, shortfalls and surplus closing stock stay random:
  // the invariant must survive all of those.
  let carriedUnits = 0;
  const mk = (): MonthInput => {
    const qty = ri(500);
    const availUnits = carriedUnits + qty;
    const purchExp = availUnits > 0 ? Math.round(rnd() * 100000) : 0;
    const soldQty = ri(500);
    const stockLeft = ri(300);
    carriedUnits = stockLeft;
    return {
      qty,
      unitCost: Math.round(rnd() * 20000 * 100) / 100,
      purchExp,
      soldQty,
      sellPrice: Math.round(rnd() * 30000 * 100) / 100,
      ads: ri(80000),
      logi: ri(40000),
      misc: ri(20000),
      bank: ri(10000),
      stockLeft,
    };
  };
  const c = compute({
    slotPrice: 1000 + ri(500000),
    slots: 1 + ri(200),
    ratio: ri(101),
    wht: ri(16),
    withdrawSlots: ri(200),
    months: [mk(), mk(), mk()],
  });
  const lhs = c.endCash + c.endStock;
  const rhs = c.capital + c.profit;
  if (Math.abs(lhs - rhs) > Math.max(0.01, Math.abs(rhs) * 1e-9)) {
    invariantOk = false;
    console.error("  invariant broken:", { lhs, rhs, diff: lhs - rhs });
    break;
  }
}
check("invariant holds on 500 random cycles", invariantOk);

// 4) Loss branch: manager gets ZERO, holders bear the whole loss
const lossCycle = compute({
  slotPrice: 100_000,
  slots: 10,
  ratio: 70,
  wht: 5,
  withdrawSlots: 0,
  months: [
    { qty: 100, unitCost: 10_000, purchExp: 20_000, soldQty: 40, sellPrice: 9_000, ads: 90_000, logi: 40_000, misc: 20_000, bank: 10_000, stockLeft: 60 },
    { qty: 0, unitCost: 0, purchExp: 0, soldQty: 30, sellPrice: 8_500, ads: 60_000, logi: 25_000, misc: 5_000, bank: 5_000, stockLeft: 30 },
    { qty: 0, unitCost: 0, purchExp: 0, soldQty: 30, sellPrice: 8_000, ads: 40_000, logi: 20_000, misc: 5_000, bank: 5_000, stockLeft: 0 },
  ],
});
check("loss cycle really is a loss", lossCycle.isLoss && lossCycle.profit < 0, lossCycle.profit);
check("on loss: manager pot is exactly zero", lossCycle.mudaribPot === 0, lossCycle.mudaribPot);
check("on loss: holders bear the WHOLE loss (no ratio applied)", lossCycle.holderPot === lossCycle.profit);
check("on loss: no withholding tax charged", lossCycle.whtPerSlot === 0);

// 5) Holder figures: capital and profit separate, never merged
const h = holderFigures(ours, { slots: 3 });
check(
  "holder figures derive from slots × per-slot values",
  h.theirCapital === 3 * ours.slotPrice &&
    Math.abs(h.theirProfit - 3 * ours.netPerSlot) < 1e-9 &&
    Math.abs(h.theirTotal - (h.theirCapital + h.theirProfit)) < 1e-9
);

// ── Checkpoint printout ─────────────────────────────────────────────
const nf = (n: number) => n.toLocaleString("en-NG", { maximumFractionDigits: 2 });
console.log("\n──── CHECKPOINT: sample cycle figures (ours === reference) ────");
console.log(`Capital: ₦${nf(ours.capital)}  (20 slots × ₦${nf(ours.slotPrice)})`);
ours.months.forEach((m) =>
  console.log(
    `Month ${m.i}: unitCP ₦${nf(m.unitCP)} · revenue ₦${nf(m.revenue)} · gross ₦${nf(m.gross)} · net ₦${nf(m.net)} · cash ₦${nf(m.cash)} · stock ${m.closeUnits}u ₦${nf(m.closeValue)}${m.lostUnits > 0 ? ` · LOST ${m.lostUnits}u ₦${nf(m.lostValue)}` : ""}`
  )
);
console.log(`Cycle profit: ₦${nf(ours.profit)}`);
console.log(`Holder pot (70%): ₦${nf(ours.holderPot)} · Manager pot (30%): ₦${nf(ours.mudaribPot)}`);
console.log(`Per slot: gross ₦${nf(ours.grossPerSlot)} · WHT(5%) ₦${nf(ours.whtPerSlot)} · net ₦${nf(ours.netPerSlot)} · return ${ours.slotReturn.toFixed(2)}%`);
console.log(`Payout/slot: ₦${nf(ours.payoutPerSlot)} · Cash needed at payout: ₦${nf(ours.cashNeeded)} (8 slots withdrawing)`);
console.log(`End: cash ₦${nf(ours.endCash)} + stock ₦${nf(ours.endStock)} = ₦${nf(ours.endCash + ours.endStock)} vs capital+profit ₦${nf(ours.capital + ours.profit)}`);

process.exit(failures === 0 ? 0 : 1);
