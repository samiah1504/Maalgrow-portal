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
import { capitalPosition, lagosToday, monthPositions, suggestedPeriod } from "../src/lib/maalrise/receipts";
import { portfolioSummary, statementCsv, type MyCycle, type MyMonth, type MyPayment } from "../src/lib/maalrise/portal";

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

// ── Payments received against the schedule (Phase 4) ────
{
  const lines = [1, 2, 3, 4, 5].map((p) => ({ period: p, due_date: periodDueDate("2026-06-10", p)!, counterparty_gross_kobo: 200_000_000 }));
  // today 2026-10-15: m1 due 07-10, m2 08-10, m3 09-10 (35 days), m4 10-10 (5 days), m5 11-10 (upcoming)
  const rec = (period: number, amount: number, status: string, applied: number | null = null, held: number | null = null) =>
    ({ period, amount_kobo: amount, status, applied_kobo: applied, held_kobo: held });
  const pos = monthPositions(lines, [
    rec(1, 201_000_000, "confirmed", 200_000_000, 1_000_000),
    rec(2, 50_000_000, "confirmed", 50_000_000, 0),
    rec(3, 200_000_000, "recorded"),
    rec(3, 999, "rejected"),
  ], "2026-10-15");
  const st = Object.fromEntries(pos.map((p) => [p.period, p]));
  check("fully received month", st[1].status === "received" && st[1].heldKobo === 1_000_000 && st[1].outstandingKobo === 0);
  check("part-paid month keeps the rest outstanding, flagged after 5 days", st[2].status === "part_paid" && st[2].outstandingKobo === 150_000_000 && st[2].followUp);
  check("recorded-but-unconfirmed month is not flagged, still outstanding", st[3].status === "awaiting" && !st[3].followUp && st[3].pendingKobo === 200_000_000 && st[3].outstandingKobo === 200_000_000);
  check("rejected entries count for nothing", st[3].confirmedKobo === 0);
  check("exactly 5 days late with nothing recorded → follow up", st[4].daysLate === 5 && st[4].status === "follow_up");
  check("4 days late → awaiting, not yet follow-up",
    monthPositions(lines, [], "2026-10-14")[3].status === "awaiting" && !monthPositions(lines, [], "2026-10-14")[3].followUp);
  check("on the scheduled date → due today", monthPositions(lines, [], "2026-10-10")[3].status === "due_today");
  check("future month → upcoming", st[5].status === "upcoming");
  check("a passing date never counts as paid", monthPositions(lines, [], "2027-12-31").every((p) => p.confirmedKobo === 0 && p.outstandingKobo === 200_000_000));
  check("suggested month = earliest not fully recorded", suggestedPeriod(pos) === 2);
  check("Lagos date: 23:30 UTC is already the next day in Lagos", lagosToday(new Date("2026-10-12T23:30:00Z")) === "2026-10-13");
}

// ── Capital at maturity (Phase 5) ────────────────────────
{
  const due = 10_000_000_000;
  const cap = (rs: { amount_kobo: number; status: string }[], today: string) => capitalPosition(due, "2026-12-10", rs, today);
  check("capital before maturity → not yet due", cap([], "2026-12-01").status === "upcoming");
  check("capital on maturity → due today", cap([], "2026-12-10").status === "due_today");
  check("capital 5 days after maturity, nothing recorded → follow up", cap([], "2026-12-15").status === "follow_up" && cap([], "2026-12-15").followUp);
  check("capital fully recorded but unconfirmed → awaiting, no follow-up",
    cap([{ amount_kobo: due, status: "recorded" }], "2026-12-20").status === "awaiting" && !cap([{ amount_kobo: due, status: "recorded" }], "2026-12-20").followUp);
  const part = cap([{ amount_kobo: 4_000_000_000, status: "confirmed" }, { amount_kobo: 1_000_000_000, status: "recorded" }, { amount_kobo: 9, status: "rejected" }], "2026-12-11");
  check("split capital: part confirmed, part pending; rejected ignored",
    part.status === "part_received" && part.confirmedKobo === 4_000_000_000 && part.pendingKobo === 1_000_000_000
      && part.recordableKobo === 5_000_000_000 && part.outstandingKobo === 6_000_000_000);
  check("full capital confirmed → received", cap([{ amount_kobo: due, status: "confirmed" }], "2026-12-11").status === "received");
  check("reversed capital entries count for nothing", cap([{ amount_kobo: due, status: "reversed" }], "2026-12-11").confirmedKobo === 0);
  const m = monthPositions([{ period: 1, due_date: "2026-11-10", counterparty_gross_kobo: 600 }],
    [{ period: 1, amount_kobo: 200, status: "confirmed", applied_kobo: 200, held_kobo: 0 }, { period: 1, amount_kobo: 100, status: "recorded", applied_kobo: null, held_kobo: null },
     { period: 1, amount_kobo: 300, status: "reversed", applied_kobo: 300, held_kobo: 0 }], "2026-11-12")[0];
  check("monthly: only ₦3 left to record after ₦2 confirmed + ₦1 pending; reversed ignored", m.recordableKobo === 300 && m.confirmedKobo === 200);
}

// ------------------------------------------------------------------
// Investor portal figures (Phase 6)
// ------------------------------------------------------------------
{
  const month = (period: number, due: string, over: Partial<MyMonth> = {}): MyMonth => ({
    period, due_date: due, expected_kobo: 321_911, paid_kobo: 0, approved_kobo: 0, processing_kobo: 0,
    paid_on: null, references: null, status: "scheduled", ...over,
  });
  const cycle = (over: Partial<MyCycle>): MyCycle => ({
    id: "c1", name: "Kanziy 1", counterparty_name: "Kanziy", description: null, status: "active",
    start_date: "2026-09-07", maturity_date: "2026-12-07", duration_months: 3, units: 333, unit_price_kobo: 100_000,
    capital_kobo: 33_300_000, months: [], capital: { due_date: "2026-12-07", expected_kobo: 33_300_000, paid_kobo: 0, paid_on: null,
      reference: null, account_ending: null, status: "scheduled" }, ...over,
  });
  const a = cycle({
    months: [
      month(1, "2026-10-07", { status: "paid", paid_kobo: 321_911, paid_on: "2026-10-13" }),
      month(2, "2026-11-07", { status: "approved", approved_kobo: 160_000 }),
      month(3, "2026-12-07"),
    ],
  });
  const b = cycle({
    id: "c2", name: "Alpha", status: "closed", capital_kobo: 10_000_000,
    months: [month(1, "2026-06-01", { status: "paid", expected_kobo: 50_000, paid_kobo: 50_000 })],
    capital: { due_date: "2026-07-01", expected_kobo: 10_000_000, paid_kobo: 10_000_000, paid_on: "2026-07-03", reference: "C1",
      account_ending: "0001", status: "paid" },
  });
  const s = portfolioSummary([a, b], "2026-10-20");
  check("portfolio: repaid capital is no longer counted as invested", s.capitalInvestedKobo === 33_300_000 && s.capitalRepaidKobo === 10_000_000);
  check("portfolio: profit paid counts only months marked paid", s.profitPaidKobo === 321_911 + 50_000);
  check("portfolio: approved-not-paid shown separately", s.awaitingTransferKobo === 160_000);
  check("portfolio: profit to come = expected − paid", s.profitToComeKobo === 321_911 * 2);
  check("portfolio: closed Cycles are not in progress", s.activeCycles === 1);
  check("portfolio: next payment is the earliest unpaid date from today",
    s.next?.label === "Profit · month 2" && s.next.dueDate === "2026-11-07" && s.next.expectedKobo === 321_911);
  check("portfolio: nothing ahead → no next payment", portfolioSummary([b], "2026-10-20").next === null);
  const nextCap = portfolioSummary([cycle({ months: [month(3, "2026-12-07", { status: "paid", paid_kobo: 321_911 })] })], "2026-12-01").next;
  check("portfolio: capital repayment is a next payment", nextCap?.label === "Capital repayment" && nextCap.expectedKobo === 33_300_000);

  const pay = (over: Partial<MyPayment>): MyPayment => ({
    id: "p", kind: "profit", cycle_id: "c1", cycle_name: "Kanziy 1", period: 1, amount_kobo: 321_911, status: "paid",
    paid_on: "2026-10-13", reference: "TRF-1", bank_name: "GTB", account_ending: "0001", ...over,
  });
  const csv = statementCsv([
    pay({}),
    pay({ id: "q", status: "payable", paid_on: null, reference: null }),
    pay({ id: "r", kind: "capital", period: null, amount_kobo: 33_300_000, reference: "=HYPERLINK(\"x\")", cycle_name: "A, B" }),
  ]);
  const lines = csv.trim().split("\r\n");
  check("statement: header plus paid payments only", lines.length === 3 && lines[0].startsWith("Date paid,Cycle,Payment"));
  check("statement: naira to the kobo, account masked", lines[1] === "2026-10-13,Kanziy 1,Profit · month 1,3219.11,TRF-1,GTB,****0001", lines[1]);
  check("statement: commas quoted; spreadsheet formulas neutralised",
    lines[2].includes('"A, B"') && lines[2].includes(`"'=HYPERLINK(""x"")"`) && lines[2].includes("Capital repayment,333000.00"), lines[2]);
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll MaalRise compute checks passed.");
