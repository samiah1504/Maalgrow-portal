/**
 * Settlement tests — part A.
 *
 * Test 7 first, because it protects every other one: a failing
 * assertion must block the commit and write nothing.
 *
 *  1. Largest-remainder allocation is exact across fractional holdings
 *  2. Withholding tax per holder sums to the declaration's total
 *  6. No capital decision defaults to payout and is warned about
 *  7. A failing assertion blocks the commit
 *  8. Settlement allocates no credit note references
 *  9. No cross-cycle leakage
 *
 * Tests 3, 4 and 5 (idempotency, unsettle/re-settle, write-through)
 * are database behaviour and live in supabase/tests.
 *
 * Run: npx tsx scripts/test-mudarabah-settlement.ts
 */
import {
  compute,
  type CycleInput,
  type MonthInput,
  type MonthRowInput,
} from "../src/lib/mudarabah/compute";
import {
  settlementPayload,
  settlementPreview,
  type Participant,
} from "../src/lib/mudarabah/settlement";

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

function cycleOf(slots: number, ratio = 70, wht = 10): CycleInput {
  return {
    slotPrice: 100_000 * K,
    slots,
    ratio,
    wht,
    withdrawSlots: 0,
    products: [{ id: "a", name: "Widget" }],
    months: [
      {
        rows: [row("a", 40, 40_000 * K, 30, 61_000 * K)],
        ads: 50_000 * K, logistics: 20_000 * K, misc: 7_000 * K, bankCharges: 3_000 * K,
      },
      {
        rows: [row("a", 20, 41_000 * K, 22, 62_000 * K)],
        ads: 40_000 * K, logistics: 18_000 * K, misc: 6_000 * K, bankCharges: 4_000 * K,
      },
      {
        rows: [row("a", 10, 42_000 * K, 15, 63_000 * K)],
        ads: 35_000 * K, logistics: 15_000 * K, misc: 5_000 * K, bankCharges: 5_000 * K,
      },
    ] as [MonthInput, MonthInput, MonthInput],
  };
}

const holder = (
  n: number, units: number,
  decision: Participant["decision"] = "rollover",
  slotsWithdrawn = 0,
  tin: string | null = `TIN-${n}`
): Participant => ({
  investmentId: `inv-${n}`,
  investorId: `investor-${n}`,
  investorName: `Investor ${n}`,
  investorCode: `MG${String(n).padStart(4, "0")}`,
  units,
  decision,
  slotsWithdrawn,
  tin,
});

/* ── 7. A failing assertion blocks the commit ────────────────────── */
// Written first, because everything else leans on it.

{
  // 20 slots in the ledger, but only 15 held. The engine's pot is
  // sized for 20 — the holders cannot add up to the cycle.
  const input = cycleOf(20);
  const short = [holder(1, 10), holder(2, 5)];
  const p = settlementPreview(input, short);

  const unitsAssertion = p.assertions.find((a) => a.name.includes("Slots held"));
  check("7. a mismatch between slots held and slots in the cycle fails an assertion",
    unitsAssertion?.passed === false, unitsAssertion);
  check("7. and a failed assertion blocks the commit", p.blocked === true);
  check("7. the other assertions still report their own result",
    p.assertions.length === 3 && p.assertions.every((a) => typeof a.passed === "boolean"));
  check("7. the preview still renders every holder rather than throwing",
    p.holders.length === 2, p.holders.length);

  // The commit path refuses. Nothing is written because nothing is sent.
  const clean = settlementPreview(cycleOf(15), short);
  check("7. the same holders against the right cycle are not blocked",
    clean.blocked === false, clean.assertions.filter((a) => !a.passed));
}

/* ── 1. Largest remainder is exact ───────────────────────────────── */

{
  const input = cycleOf(20);
  const cycle = compute(input);
  const p = settlementPreview(input, [holder(1, 12.5), holder(2, 7.5)]);

  check("1. 12.5 and 7.5 slots allocate to the kobo",
    p.totals.gross === cycle.holderPot,
    { allocated: p.totals.gross, pot: cycle.holderPot });
  check("1. and that assertion is shown passing",
    p.assertions[0].passed === true);

  // Many half slots, where naive per-holder rounding drifts
  const many: Participant[] = Array.from({ length: 33 }, (_, i) => holder(i + 1, 0.5));
  const inputMany = cycleOf(16.5);
  const cycleMany = compute(inputMany);
  const pm = settlementPreview(inputMany, many);

  check("1. 33 half slots allocate to the kobo with no drift",
    pm.totals.gross === cycleMany.holderPot,
    { allocated: pm.totals.gross, pot: cycleMany.holderPot });

  const naive = many.reduce(
    (t, h) => t + Math.round((cycleMany.holderPot * h.units) / 16.5),
    0
  );
  check("1. and naive rounding really would have drifted",
    naive !== cycleMany.holderPot || cycleMany.holderPot % 33 === 0,
    { naive, pot: cycleMany.holderPot });

  const spread = new Set(pm.holders.map((h) => h.grossProfit));
  check("1. holders with equal units differ by at most one kobo",
    Math.max(...spread) - Math.min(...spread) <= 1,
    [...spread]);
}

/* ── 2. Tax sums to the declaration's total ──────────────────────── */

{
  const input = cycleOf(20);
  const cycle = compute(input);
  const p = settlementPreview(input, [holder(1, 12.5), holder(2, 7.5)]);

  check("2. net plus withheld equals the investors' share exactly",
    p.totals.net + p.totals.wht === cycle.holderPot,
    { net: p.totals.net, wht: p.totals.wht, pot: cycle.holderPot });
  check("2. and that assertion is shown passing", p.assertions[1].passed === true);

  // Tax is charged on each holder's ALLOCATED gross, not on the pot
  const rate = cycle.whtPerSlot / cycle.grossPerSlot;
  const perHolder = p.holders.every(
    (h) => h.wht === Math.round(h.grossProfit * rate)
  );
  check("2. each holder's tax is charged on their own allocated gross", perHolder);
  check("2. so what is remitted for someone matches their statement",
    p.holders.every((h) => h.netProfit === h.grossProfit - h.wht));
}

/* ── 6. No decision commits nothing, and says so ─────────────────
 *
 * This asserted that silence meant "pay the capital out". It stopped
 * being true when the default became "undecided": settling pays the
 * PROFIT and leaves the capital question open, because an investor
 * who has not answered has not asked for their money back — and
 * telling twenty-eight of them their capital was leaving when it was
 * not would have been the worst version of getting this wrong.
 */

{
  const input = cycleOf(20);
  const p = settlementPreview(input, [
    holder(1, 12.5, null),
    holder(2, 7.5, "rollover"),
  ]);

  const undecided = p.holders.find((h) => h.investmentId === "inv-1")!;
  check("6. an investor with no instruction has their capital left alone",
    undecided.capitalAction === "undecided" && undecided.slotsWithdrawn === 0,
    undecided);
  check("6. and is flagged as defaulted, not as having chosen",
    undecided.defaulted === true && undecided.overridden === false);
  check("6. so only their profit is in the cash needed",
    undecided.amountPaid === undecided.netProfit,
    { amountPaid: undecided.amountPaid, netProfit: undecided.netProfit });

  const warn = p.warnings.find((w) => w.kind === "no-decision");
  check("6. the preview warns, naming them", warn?.investors.includes("Investor 1") === true, warn);
  check("6. and the warning says the capital is NOT committed either way",
    /does not commit their capital/i.test(warn?.message ?? "") &&
      !/PAID OUT/i.test(warn?.message ?? ""),
    warn?.message);

  check("6. an investor who did decide is not flagged",
    p.holders.find((h) => h.investmentId === "inv-2")?.defaulted === false);

  // Overridable before commit
  const o = settlementPreview(input, [holder(1, 12.5, null), holder(2, 7.5, "rollover")], [
    { investmentId: "inv-1", action: "rollover" },
  ]);
  const overridden = o.holders.find((h) => h.investmentId === "inv-1")!;
  check("6. the default can be overridden in the preview",
    overridden.capitalAction === "rollover" &&
      overridden.slotsWithdrawn === 0 &&
      overridden.overridden === true &&
      overridden.defaulted === false);
  check("6. overriding removes them from the warning",
    o.warnings.find((w) => w.kind === "no-decision") === undefined);
  check("6. and the allocation still adds up after an override",
    o.totals.gross === o.cycle.holderPot);
}

/* ── 8. Settlement issues no credit notes ────────────────────────── */

{
  const input = cycleOf(20);
  const p = settlementPreview(input, [holder(1, 12.5), holder(2, 7.5)]);
  const payload = settlementPayload(p);
  const text = JSON.stringify(payload);

  check("8. the payload carries no credit note reference",
    !/reference|WHT-\d|certified|remitt/i.test(text), text.slice(0, 200));
  check("8. and no field claims the tax has been remitted",
    payload.every((h) => !("remittedAt" in h) && !("creditNote" in h)));
  check("8. tax is present as withheld only",
    payload.every((h) => typeof h.wht === "number"));
}

/* ── 9. No cross-cycle leakage ───────────────────────────────────── */

{
  const a = settlementPreview(cycleOf(20), [holder(1, 12.5), holder(2, 7.5)]);
  const b = settlementPreview(cycleOf(10, 60, 5), [holder(3, 10)]);

  const aIds = new Set(settlementPayload(a).map((h) => h.investmentId));
  const bIds = new Set(settlementPayload(b).map((h) => h.investmentId));
  check("9. one cycle's payload holds none of another's investors",
    ![...aIds].some((id) => bIds.has(id)));
  check("9. and the two cycles really do differ",
    a.cycle.holderPot !== b.cycle.holderPot);
  check("9. each payload allocates only its own pot",
    a.totals.gross === a.cycle.holderPot && b.totals.gross === b.cycle.holderPot);

  // A holder appearing in both cycles gets each cycle's own figures
  const shared = holder(9, 5);
  const inA = settlementPreview(cycleOf(20), [holder(1, 15), shared]);
  const inB = settlementPreview(cycleOf(10, 60, 5), [holder(3, 5), shared]);
  const fromA = inA.holders.find((h) => h.investmentId === "inv-9")!;
  const fromB = inB.holders.find((h) => h.investmentId === "inv-9")!;
  check("9. the same investor in two cycles gets each cycle's own profit",
    fromA.grossProfit !== fromB.grossProfit, { a: fromA.grossProfit, b: fromB.grossProfit });
}

/* ── Cash, and the acknowledgement ───────────────────────────────── */

{
  const input = cycleOf(20);
  const p = settlementPreview(input, [
    holder(1, 12.5, "withdraw", 12.5),
    holder(2, 7.5, "withdraw", 7.5),
  ]);
  check("cash needed is profit plus the capital actually going out",
    p.totals.cashNeeded === p.totals.net + p.totals.capitalReturning,
    { needed: p.totals.cashNeeded, net: p.totals.net, capital: p.totals.capitalReturning });

  if (!p.cashCovers) {
    check("a shortfall warns rather than blocks",
      p.blocked === false && p.needsAcknowledgement === true);
    check("and the shortfall is quantified", p.shortfall > 0);
  } else {
    check("cash covers the payout, so no acknowledgement is required",
      p.needsAcknowledgement === false || p.warnings.some((w) => w.kind === "ledger"));
  }
}

/* ── Missing tax number never blocks ─────────────────────────────── */

{
  const input = cycleOf(20);
  const p = settlementPreview(input, [
    holder(1, 12.5, "rollover", 0, null),
    holder(2, 7.5),
  ]);
  check("a missing tax number does not block settlement", p.blocked === false);
  check("but it is warned about, naming who is missing one",
    p.warnings.find((w) => w.kind === "no-tin")?.investors.includes("Investor 1") === true);
  check("and their tax is still withheld",
    (p.holders.find((h) => h.investmentId === "inv-1")?.wht ?? 0) > 0);
}

console.log(
  `\n${failures === 0 ? "All settlement tests passed." : `${failures} failed.`}`
);
process.exit(failures === 0 ? 0 : 1);
