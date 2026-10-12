/**
 * The MaalRise terms engine: markup, service fee, schedule, allocation.
 *
 * What must never happen: a schedule or an allocation that does not
 * add up to the contract figure to the kobo, a fee treatment chosen by
 * default, or markup and fee being treated as the same thing.
 *
 *   npx tsx scripts/test-maalrise-compute.ts
 */
import {
  allocateCycle,
  apportion,
  applyBps,
  computeAllocations,
  computeTerms,
  splitEqually,
  type TermsInput,
} from "../src/lib/maalrise/compute";
import { koboInWords, parseNairaToKobo, parsePercentToBps } from "../src/lib/maalrise/format";
import { maturityDate, periodDueDate } from "../src/lib/maalrise/dates";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

const N = (naira: number) => naira * 100;

const base: TermsInput = {
  costKobo: N(100_000_000),
  markup: { type: "percent", bps: 1200 },
  statedSalePriceKobo: N(112_000_000),
  fee: { basis: "markup", bps: 500, treatment: "deducted_from_investors" },
  durationMonths: 6,
  schedule: { mode: "equal" },
};

// ── The worked example from the plan ───────────────────────
{
  const b = computeTerms(base);
  check("no errors on the worked example", b.errors.length === 0, b.errors);
  check("markup 12% of ₦100m = ₦12m", b.markupKobo === N(12_000_000), b.markupKobo);
  check("sale price ₦112m", b.salePriceKobo === N(112_000_000));
  check("fee 5% of markup = ₦600k", b.feeKobo === N(600_000), b.feeKobo);
  check("deducted fee leaves investors ₦11.4m", b.investorProfitPoolKobo === N(11_400_000));
  check("counterparty pays the sale price only", b.counterpartyTotalKobo === N(112_000_000));
  check("six months of ₦1.9m", b.schedule.every((l) => l.investorNetKobo === N(1_900_000)));
  check("monthly gross ₦2m", b.schedule.every((l) => l.counterpartyGrossKobo === N(2_000_000)));
  check("schedule net reconciles", b.scheduleTotals.investorNetKobo === b.investorProfitPoolKobo);
  check("schedule fee reconciles", b.scheduleTotals.feeKobo === b.feeKobo);
  check("capital due at maturity is the cost", b.capitalAtMaturityKobo === base.costKobo);
}

// ── Fee treatments are distinct and never defaulted ───────
{
  const c = computeTerms({ ...base, fee: { basis: "markup", bps: 500, treatment: "charged_to_counterparty" } });
  check("charged to counterparty: investors keep the whole markup", c.investorProfitPoolKobo === N(12_000_000));
  check("charged to counterparty: counterparty pays sale price + fee", c.counterpartyTotalKobo === N(112_600_000));

  const w = computeTerms({ ...base, fee: { basis: "markup", bps: 500, treatment: "waived" } });
  check("waived: no fee at all", w.feeKobo === 0 && w.scheduleTotals.feeKobo === 0);
  check("waived: investors keep the markup", w.investorProfitPoolKobo === N(12_000_000));

  const zero = computeTerms({ ...base, fee: { basis: "markup", bps: 0, treatment: "deducted_from_investors" } });
  check("0% is a valid explicit rate", zero.errors.length === 0 && zero.feeKobo === 0);

  const onCost = computeTerms({ ...base, fee: { basis: "cost", bps: 500, treatment: "deducted_from_investors" } });
  check("fee on cost is 5% of cost, not of markup", onCost.feeKobo === N(5_000_000));

  const fixed = computeTerms({ ...base, fee: { basis: "fixed", kobo: N(250_000), treatment: "deducted_from_investors" } });
  check("fixed fee is the amount entered", fixed.feeKobo === N(250_000));

  const tooBig = computeTerms({ ...base, fee: { basis: "cost", bps: 2000, treatment: "deducted_from_investors" } });
  check("a deducted fee larger than the markup is refused", tooBig.errors.some((e) => e.field === "fee"));

  check("the markup does not move when the fee changes", onCost.markupKobo === N(12_000_000) && fixed.markupKobo === N(12_000_000));
}

// ── Markup as an amount; stated sale price checked ────────
{
  const a = computeTerms({ ...base, markup: { type: "amount", kobo: N(12_000_000) } });
  check("markup as an amount gives the same sale price", a.salePriceKobo === N(112_000_000) && a.errors.length === 0);

  const bad = computeTerms({ ...base, statedSalePriceKobo: N(111_999_999) });
  check("a stated sale price that disagrees is a blocking error", bad.errors.some((e) => e.field === "statedSalePrice"));
}

// ── Rounding: exact and visible ──────────────────────────
{
  const odd = computeTerms({ ...base, markup: { type: "amount", kobo: 1_000_001 }, statedSalePriceKobo: null,
    fee: { basis: "fixed", kobo: 0, treatment: "waived" }, durationMonths: 3 });
  const nets = odd.schedule.map((l) => l.investorNetKobo);
  check("uneven split still sums exactly", nets.reduce((s, x) => s + x, 0) === 1_000_001, nets);
  check("remainder goes on the final month", nets[0] === nets[1] && nets[2] === nets[0] + 2, nets);
  check("and is reported as a rounding adjustment", odd.schedule[2].roundingAdjustmentKobo === 2);

  check("applyBps rounds half up", applyBps(1, 5000) === 1 && applyBps(3, 5000) === 2);
  const s = splitEqually(10, 3);
  check("splitEqually 10/3 = 3,3,4", s.amounts.join() === "3,3,4" && s.remainder === 1);
}

// ── Contract-specific schedule must reconcile ─────────────
{
  const ok = computeTerms({ ...base, fee: { basis: "fixed", kobo: 0, treatment: "waived" },
    schedule: { mode: "contract", netKobo: [N(1_000_000), N(1_000_000), N(2_000_000), N(2_000_000), N(3_000_000), N(3_000_000)] } });
  check("contract schedule that reconciles has no errors", ok.errors.length === 0, ok.errors);

  const short = computeTerms({ ...base, fee: { basis: "fixed", kobo: 0, treatment: "waived" },
    schedule: { mode: "contract", netKobo: [N(1_000_000), N(1_000_000), N(2_000_000), N(2_000_000), N(3_000_000), N(2_999_999)] } });
  check("one naira short is a blocking error", short.errors.some((e) => e.field === "schedule"));

  const wrongLen = computeTerms({ ...base, schedule: { mode: "contract", netKobo: [N(11_400_000)] } });
  check("wrong number of months is a blocking error", wrongLen.errors.some((e) => e.field === "schedule"));

  const missing = computeTerms({ ...base, schedule: { mode: "contract", netKobo: [1, 2, NaN, 4, 5, 6] } });
  check("a missing month is an error, not a zero", missing.errors.some((e) => e.message.includes("entered")));
}

// ── Allocation by largest remainder ──────────────────────
{
  check("apportion sums exactly", apportion(100, [1, 1, 1]).reduce((s, x) => s + x, 0) === 100);
  check("ties go to the earlier holder", apportion(100, [1, 1, 1]).join() === "34,33,33");
  check("zero weights give zeros", apportion(100, [0, 0]).join() === "0,0");

  const b = computeTerms(base);
  const allocs = computeAllocations({ capitalKobo: b.capitalAtMaturityKobo, schedule: b.schedule }, [
    { key: "a", units: 400 },
    { key: "b", units: 350 },
    { key: "c", units: 250 },
  ]);
  check("capital apportioned exactly", allocs.reduce((s, a) => s + a.capitalKobo, 0) === b.capitalAtMaturityKobo);
  check("40% of ₦100m = ₦40m", allocs[0].capitalKobo === N(40_000_000));
  for (let m = 0; m < b.schedule.length; m++) {
    const sum = allocs.reduce((s, a) => s + a.monthlyProfitKobo[m], 0);
    if (sum !== b.schedule[m].investorNetKobo) check(`month ${m + 1} apportioned exactly`, false, sum);
  }
  check("every month apportions exactly", true);
  check("participation in bps", allocs.map((a) => a.participationBps).join() === "4000,3500,2500");

  const awkwardTerms = computeTerms({ ...base, markup: { type: "amount", kobo: 1_000_003 },
    statedSalePriceKobo: null, fee: { basis: "fixed", kobo: 0, treatment: "waived" }, durationMonths: 7 });
  const awkward = computeAllocations({ capitalKobo: awkwardTerms.capitalAtMaturityKobo, schedule: awkwardTerms.schedule },
    [{ key: "x", units: 1 }, { key: "y", units: 1 }, { key: "z", units: 1 }]);
  check("awkward totals still reconcile per holder",
    awkward.reduce((s, a) => s + a.totalProfitKobo, 0) === 1_000_003);
}

// ── Part-funded: capital is what was paid in, not the cost ─
{
  const b = computeTerms({ ...base, costKobo: N(40_000_000), statedSalePriceKobo: null });
  const funded = 250 * N(100_000);
  const allocs = computeAllocations({ capitalKobo: funded, schedule: b.schedule }, [
    { key: "two", units: 150 },
    { key: "four", units: 100 },
  ]);
  check("150 funded units at ₦100k = ₦15m, not a share of the full cost", allocs[0].capitalKobo === N(15_000_000), allocs[0].capitalKobo);
  check("part-funded capital sums to what was funded", allocs.reduce((s, a) => s + a.capitalKobo, 0) === funded);
}

// ── allocateCycle: whole-Cycle profit, funded capital ──────
{
  const b = computeTerms({ ...base, costKobo: N(40_000_000), markup: { type: "amount", kobo: N(3_000_000) },
    statedSalePriceKobo: null, fee: { basis: "fixed", kobo: 0, treatment: "waived" }, durationMonths: 4 });
  const part = allocateCycle({ costKobo: N(40_000_000), unitPriceKobo: N(100_000) }, b.schedule,
    [{ key: "three", units: 150 }, { key: "four", units: 100 }]);
  check("part-funded: 400 required, 250 funded, ₦15m short",
    part.unitsRequired === 400 && part.unitsFunded === 250 && part.fundingShortfallKobo === N(15_000_000));
  check("part-funded: capital is what was paid in", part.lines[0].capitalKobo === N(15_000_000) && part.lines[1].capitalKobo === N(10_000_000));
  check("part-funded: profit per unit of the whole Cycle",
    part.lines[0].totalProfitKobo === N(1_125_000) && part.lines[1].totalProfitKobo === N(750_000));
  check("part-funded: the unsubscribed share is unallocated, not given away",
    part.unallocated?.totalProfitKobo === N(1_125_000) && part.unallocated?.units === 150);
  check("part-funded: allocated + unallocated profit = pool",
    part.lines.reduce((s, l) => s + l.totalProfitKobo, 0) + (part.unallocated?.totalProfitKobo ?? 0) === b.investorProfitPoolKobo);

  const full = allocateCycle({ costKobo: N(40_000_000), unitPriceKobo: N(100_000) }, b.schedule,
    [{ key: "a", units: 250 }, { key: "b", units: 150 }]);
  check("fully funded: nothing unallocated", full.unallocated === null && full.fundingShortfallKobo === 0);
  check("fully funded: every kobo of profit allocated",
    full.lines.reduce((s, l) => s + l.totalProfitKobo, 0) === b.investorProfitPoolKobo);

  let threw = false;
  try { allocateCycle({ costKobo: N(40_000_000), unitPriceKobo: N(100_000) }, b.schedule, [{ key: "x", units: 401 }]); }
  catch { threw = true; }
  check("over-subscription is refused", threw);
  threw = false;
  try { allocateCycle({ costKobo: N(40_000_000), unitPriceKobo: N(100_000) }, b.schedule, [{ key: "x", units: 1.5 }]); }
  catch { threw = true; }
  check("fractional units are refused (A11 open)", threw);
}

// ── Markup rate: total for the whole Cycle (confirmed 12 Oct 2026) ─
{
  const at = (bps: number, months: number, cost = N(10_000_000)) =>
    computeTerms({ costKobo: cost, markup: { type: "percent", bps }, statedSalePriceKobo: null,
      fee: { basis: "fixed", kobo: 0, treatment: "waived" }, durationMonths: months, schedule: { mode: "equal" } });

  const ex = at(3500, 12);
  check("₦10m at 35% = ₦3.5m markup", ex.markupKobo === N(3_500_000), ex.markupKobo);
  check("₦10m at 35% = ₦13.5m sale price", ex.salePriceKobo === N(13_500_000), ex.salePriceKobo);

  const six = at(3000, 6), twelve = at(3500, 12);
  check("6-month Cycle at 30% → 30% of cost for the 6 months", six.markupKobo === N(3_000_000));
  check("12-month Cycle at 35% → 35% of cost for the 12 months", twelve.markupKobo === N(3_500_000));

  const rates = [1, 3, 6, 9, 12, 24].map((m) => at(3500, m).markupKobo);
  check("the same rate gives the same markup whatever the duration (never annualised or multiplied)",
    rates.every((r) => r === N(3_500_000)), rates);
  check("not annualised: a 6-month 30% Cycle is not 15%", six.markupKobo !== N(1_500_000));
  check("not per month: a 6-month 30% Cycle is not 180%", six.markupKobo !== N(18_000_000));
  check("the duration only spreads the total across months",
    six.schedule.length === 6 && six.scheduleTotals.investorNetKobo === N(3_000_000));
  check("the rate is set per Cycle (different Cycles, different rates)", six.markupBpsOfCost === 3000 && twelve.markupBpsOfCost === 3500);
}

// ── Input parsing never guesses ──────────────────────────
{
  check("₦1,234.56 → 123456 kobo", parseNairaToKobo("1,234.56") === 123456);
  check("100000000 → kobo", parseNairaToKobo("100000000") === N(100_000_000));
  check("three decimals refused", parseNairaToKobo("1.234") === null);
  check("text refused", parseNairaToKobo("abc") === null);
  check("5% → 500 bps", parsePercentToBps("5") === 500);
  check("5.25% → 525 bps", parsePercentToBps("5.25") === 525);
  check("empty percent refused", parsePercentToBps("") === null);
}

// ── Dates (provisional until A4) ─────────────────────────
{
  check("period 1 is one month after start", periodDueDate("2026-07-01", 1) === "2026-08-01");
  check("maturity = start + duration", maturityDate("2026-07-01", 6) === "2027-01-01");
  check("month-end start clamps", periodDueDate("2026-01-31", 1) === "2026-02-28");
  check("invalid date gives null", periodDueDate("2026-02-30", 1) === null);
}

// ── Database messages shown to staff ─────────────────────
{
  const m = koboInWords("Funding shortfall of 400000000 kobo");
  check("kobo amounts in database messages read as naira", m.includes("4,000,000.00") && !m.includes("kobo"), m);
  check("messages without kobo amounts are unchanged", koboInWords("Unauthorized") === "Unauthorized");
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll MaalRise compute checks passed.");
