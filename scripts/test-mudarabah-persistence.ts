/**
 * Tests for src/lib/mudarabah/figures.ts — the settlement freeze.
 *
 * The important one is the first: settle a cycle, then change a
 * formula constant in the engine. Draft cycles move. The settled cycle
 * does not, because it is read from its snapshot and the engine is
 * never called for it again.
 *
 * The database side (round trip, multi-product persistence, idempotent
 * settlement, unsettle trail) is covered by
 * supabase/tests/mudarabah_scenarios.sql.
 *
 * Run: npx tsx scripts/test-mudarabah-persistence.ts
 */
import {
  compute,
  ENGINE_VERSION,
  type CycleInput,
  type CycleResult,
  type MonthInput,
  type MonthRowInput,
} from "../src/lib/mudarabah/compute";
import {
  buildSettlement,
  buildSettlementProducts,
  cycleFigures,
  settledHolderFigures,
  type Holding,
  type StoredCycle,
} from "../src/lib/mudarabah/figures";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}
const K = 100; // naira → kobo
const nf = (kobo: number) =>
  (kobo / 100).toLocaleString("en-NG", { maximumFractionDigits: 2 });

const row = (
  productId: string,
  qty: number,
  unitCost: number,
  soldQty: number,
  sellPrice: number,
  stockLeft?: number
): MonthRowInput => ({ productId, qty, unitCost, soldQty, sellPrice, stockLeft });

const INPUT: CycleInput = {
  name: "Cycle 2026-Q1",
  description: undefined,
  startDate: "2026-01-01",
  currency: "NGN",
  slotPrice: 100_000 * K,
  slots: 20,
  ratio: 70,
  wht: 5,
  withdrawSlots: 12,
  products: [
    { id: "sofa", name: "3-seater sofa" },
    { id: "table", name: "Dining table" },
  ],
  months: [
    {
      rows: [row("sofa", 20, 47_000 * K, 13, 71_000 * K), row("table", 50, 9_100 * K, 31, 14_300 * K)],
      ads: 60_000 * K, logistics: 25_000 * K, misc: 10_000 * K, bankCharges: 5_000 * K,
    },
    {
      rows: [row("sofa", 12, 48_500 * K, 14, 72_500 * K), row("table", 30, 9_400 * K, 33, 14_600 * K, 15)],
      ads: 55_000 * K, logistics: 22_000 * K, misc: 8_000 * K, bankCharges: 6_000 * K,
    },
    {
      rows: [row("sofa", 6, 49_000 * K, 9, 73_000 * K), row("table", 20, 9_600 * K, 30, 15_000 * K)],
      ads: 50_000 * K, logistics: 20_000 * K, misc: 12_000 * K, bankCharges: 7_000 * K,
    },
  ] as [MonthInput, MonthInput, MonthInput],
} as CycleInput;

const HOLDINGS: Holding[] = [
  { investorRef: "investor-1", slots: 12, capitalAction: "withdraw" },
  { investorRef: "investor-2", slots: 8, capitalAction: "rollover" },
];

const live = compute(INPUT);
const settlement = buildSettlement("cycle-1", live, HOLDINGS, "2026-04-01T09:00:00.000Z");

/* ── 1. THE FREEZE ──────────────────────────────────────────────── */

const settled: StoredCycle = { id: "cycle-1", status: "settled", input: INPUT, settlement };
const draft: StoredCycle = { id: "cycle-2", status: "active", input: INPUT, settlement: null };

const settledBefore = cycleFigures(settled);
const draftBefore = cycleFigures(draft);

check(
  "before any change, the settled and draft cycles agree",
  settledBefore.view.profit === draftBefore.view.profit &&
    settledBefore.view.netPerSlot === draftBefore.view.netPerSlot,
  { settled: settledBefore.view.profit, draft: draftBefore.view.profit }
);
check("settled figures are marked as coming from the settlement", settledBefore.source === "settlement");
check("draft figures are marked as derived live", draftBefore.source === "live");

// A formula constant changes: the manager's share moves from 30% to
// 40%, so every holder's profit share drops. This is what a genuine
// engine change looks like six months from now.
let engineCalls = 0;
const engineV2 = (input: CycleInput): CycleResult => {
  engineCalls++;
  const c = compute(input);
  const holderPot = Math.round(c.profit * 0.6);
  const grossPerSlot = c.slots > 0 ? Math.round(holderPot / c.slots) : 0;
  const whtPerSlot = grossPerSlot > 0 ? Math.round(grossPerSlot * 0.05) : 0;
  const netPerSlot = grossPerSlot - whtPerSlot;
  return {
    ...c,
    holderPot,
    mudaribPot: c.profit - holderPot,
    grossPerSlot,
    whtPerSlot,
    netPerSlot,
    netTotal: netPerSlot * c.slots,
    payoutPerSlot: c.slotPrice + netPerSlot,
  };
};

const settledAfter = cycleFigures(settled, engineV2);
const callsAfterSettled = engineCalls;
const draftAfter = cycleFigures(draft, engineV2);

check(
  "THE FREEZE: a settled cycle's figures do not move when the engine changes",
  settledAfter.view.profit === settledBefore.view.profit &&
    settledAfter.view.netPerSlot === settledBefore.view.netPerSlot &&
    settledAfter.view.holderPot === settledBefore.view.holderPot &&
    settledAfter.view.payoutPerSlot === settledBefore.view.payoutPerSlot,
  { before: settledBefore.view.netPerSlot, after: settledAfter.view.netPerSlot }
);
check(
  "the engine is never even called for a settled cycle",
  callsAfterSettled === 0,
  callsAfterSettled
);
check(
  "a draft cycle DOES pick up the engine change",
  draftAfter.view.netPerSlot !== draftBefore.view.netPerSlot &&
    draftAfter.view.holderPot !== draftBefore.view.holderPot,
  { before: draftBefore.view.netPerSlot, after: draftAfter.view.netPerSlot }
);
check(
  "every month of a settled cycle reads from the snapshot too",
  settledAfter.view.months.every(
    (m, i) =>
      m.net === settledBefore.view.months[i].net &&
      m.revenue === settledBefore.view.months[i].revenue &&
      m.purchaseCost === settledBefore.view.months[i].purchaseCost
  )
);
check(
  "the snapshot records which rules it was settled under",
  settledAfter.engineVersion === ENGINE_VERSION && settledAfter.settledAt === "2026-04-01T09:00:00.000Z",
  { version: settledAfter.engineVersion, at: settledAfter.settledAt }
);

/* ── 2. Snapshot figures match the engine that produced them ────── */

check(
  "the snapshot carries the same figures compute() produced",
  settlement.computed.profit === live.profit &&
    settlement.computed.holderPot === live.holderPot &&
    settlement.computed.managerPot === live.mudaribPot &&
    settlement.computed.netPerSlot === live.netPerSlot &&
    settlement.computed.endCash === live.endCash &&
    settlement.computed.endStockValue === live.endStock
);
check(
  "the invariant survives the snapshot",
  settlement.computed.endCash + settlement.computed.endStockValue ===
    settlement.computed.capital + settlement.computed.profit
);

/* ── 3. Holders: capital and profit never merged ────────────────── */

const h1 = settledHolderFigures(settlement, "investor-1")!;
const h2 = settledHolderFigures(settlement, "investor-2")!;

check(
  "each holder's capital and profit are recorded separately",
  h1.capital === 12 * live.slotPrice &&
    h1.profit === 12 * live.netPerSlot &&
    h2.capital === 8 * live.slotPrice &&
    h2.profit === 8 * live.netPerSlot
);
check(
  "a withdrawing holder is paid capital plus profit",
  h1.amountPaid === h1.capital + h1.profit,
  h1
);
check(
  "a holder rolling over is paid the profit only — capital stays in",
  h2.amountPaid === h2.profit,
  h2
);

/* ── 4. amountPaid can differ from the computed figure ──────────── */

const adjusted = buildSettlement("cycle-1", live, HOLDINGS, "2026-04-01T09:00:00.000Z", [
  { investorRef: "investor-2", amountPaid: 4_100_000 * K, note: "Rounded up as a goodwill adjustment" },
]);
const a2 = settledHolderFigures(adjusted, "investor-2")!;
check(
  "what actually moved is recorded, with its reason, without touching the computed profit",
  a2.amountPaid === 4_100_000 * K &&
    a2.profit === 8 * live.netPerSlot &&
    a2.amountPaidNote === "Rounded up as a goodwill adjustment",
  a2
);
check(
  "an untouched holder keeps the computed payment",
  settledHolderFigures(adjusted, "investor-1")!.amountPaid === h1.amountPaid
);

/* ── 5. The snapshot leaks no product data ──────────────────────── */

const snapshotText = JSON.stringify(settlement);
const leaked = INPUT.products.find((p) =>
  snapshotText.toLowerCase().includes(p.name.toLowerCase())
);
check("the settlement snapshot contains no product name", !leaked, leaked?.name);
check(
  "the settlement snapshot has no product-shaped field",
  !/product/i.test(Object.keys(settlement.computed).join(",")) &&
    !/product/i.test(snapshotText.replace(/"amountPaidNote":"[^"]*"/g, ""))
);
// The per-product figures exist — separately, for the admin only
const adminProducts = buildSettlementProducts(live);
check(
  "per-product figures are kept apart for the admin",
  adminProducts.length === 2 &&
    adminProducts[0].productName === "3-seater sofa" &&
    adminProducts[0].gross > 0
);

/* ── 6. A loss settles too ──────────────────────────────────────── */

const lossInput: CycleInput = {
  ...INPUT,
  products: [{ id: "x", name: "Wardrobe" }],
  months: [
    { rows: [row("x", 100, 10_000 * K, 40, 9_000 * K, 60)], ads: 90_000 * K, logistics: 40_000 * K, misc: 20_000 * K, bankCharges: 10_000 * K },
    { rows: [row("x", 0, 0, 30, 8_500 * K, 30)], ads: 60_000 * K, logistics: 25_000 * K, misc: 5_000 * K, bankCharges: 5_000 * K },
    { rows: [row("x", 0, 0, 30, 8_000 * K, 0)], ads: 40_000 * K, logistics: 20_000 * K, misc: 5_000 * K, bankCharges: 5_000 * K },
  ] as [MonthInput, MonthInput, MonthInput],
};
const lossCycle = compute(lossInput);
const lossSettlement = buildSettlement("cycle-3", lossCycle, HOLDINGS, "2026-04-01T09:00:00.000Z");
const lossHolder = settledHolderFigures(lossSettlement, "investor-1")!;

check(
  "on a loss the frozen manager share is exactly zero",
  lossSettlement.computed.managerPot === 0 && lossSettlement.computed.isLoss
);
check(
  "on a loss a withdrawing holder gets back capital less their share of the loss",
  lossHolder.profit < 0 && lossHolder.amountPaid === lossHolder.capital + lossHolder.profit,
  lossHolder
);

/* ── Printout ───────────────────────────────────────────────────── */

console.log("\n──── THE FREEZE ────");
console.log(`Cycle settled 2026-04-01 under engine ${settlement.engineVersion}`);
console.log(`  Frozen: profit ₦${nf(settlement.computed.profit)} · net/slot ₦${nf(settlement.computed.netPerSlot)} · payout/slot ₦${nf(settlement.computed.slotPrice + settlement.computed.netPerSlot)}`);
console.log("  Then the manager's share changes from 30% to 40% in the engine:");
console.log(`    settled cycle still shows net/slot ₦${nf(settledAfter.view.netPerSlot)}  (unchanged)`);
console.log(`    draft cycle now shows    net/slot ₦${nf(draftAfter.view.netPerSlot)}  (moved)`);
console.log("\n──── HOLDERS AT SETTLEMENT ────");
settlement.holders.forEach((h) =>
  console.log(
    `  ${h.investorRef}: ${h.slots} slots · capital ₦${nf(h.capital)} · profit ₦${nf(h.profit)} · ${h.capitalAction} · paid ₦${nf(h.amountPaid)}`
  )
);

process.exit(failures === 0 ? 0 : 1);
