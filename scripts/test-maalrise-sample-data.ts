/**
 * The MaalRise SAMPLE data must reconcile, and must stay sample data.
 *
 * Phase 1 screens show illustrative Cycles. Illustrative is not the
 * same as approximate: if a sample screen shows figures that do not
 * add up, the screen teaches the wrong thing about the real one. This
 * checks every sample Cycle end to end, the dashboard against the
 * records it summarises, and that nothing in the MaalRise screens can
 * write anywhere.
 *
 *   npx tsx scripts/test-maalrise-sample-data.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { applyBps } from "../src/lib/maalrise/compute";
import {
  SAMPLE_ALLOCATIONS,
  SAMPLE_AS_OF,
  SAMPLE_CYCLES,
  SAMPLE_INVESTORS,
  SAMPLE_RECEIPTS,
  isSampleId,
} from "../src/lib/maalrise/sample-data";
import { sampleCycleFigures, sampleDashboard } from "../src/lib/maalrise/sample-summary";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

for (const c of SAMPLE_CYCLES) {
  const f = sampleCycleFigures(c);
  const b = f.breakdown;
  const tag = `[${c.name}]`;

  // ── Terms ────────────────────────────────────────────────
  check(`${tag} terms have no blocking errors`, b.errors.length === 0, b.errors);
  const expectedMarkup = c.markup.type === "percent" ? applyBps(c.costKobo, c.markup.bps) : c.markup.kobo;
  check(`${tag} markup is computed from the stated terms`, b.markupKobo === expectedMarkup);
  check(`${tag} sale price = cost + markup`, b.salePriceKobo === c.costKobo + b.markupKobo);
  if (c.statedSalePriceKobo != null) check(`${tag} sale price matches the contract`, b.salePriceKobo === c.statedSalePriceKobo);

  const feeBase = c.fee.basis === "cost" ? c.costKobo : b.markupKobo;
  const expectedFee =
    c.fee.treatment === "waived" ? 0 : c.fee.basis === "fixed" ? c.fee.kobo ?? 0 : applyBps(feeBase, c.fee.bps ?? 0);
  check(`${tag} service fee per basis and treatment`, b.feeKobo === expectedFee);

  const expectedPool = c.fee.treatment === "deducted_from_investors" ? b.markupKobo - b.feeKobo : b.markupKobo;
  check(`${tag} investor profit pool`, b.investorProfitPoolKobo === expectedPool);
  const expectedCounterparty = b.salePriceKobo + (c.fee.treatment === "charged_to_counterparty" ? b.feeKobo : 0);
  check(`${tag} counterparty total`, b.counterpartyTotalKobo === expectedCounterparty);

  // ── Schedule ─────────────────────────────────────────────
  check(`${tag} one schedule line per month`, b.schedule.length === c.durationMonths);
  check(`${tag} monthly net reconciles to the pool`, sum(b.schedule.map((l) => l.investorNetKobo)) === b.investorProfitPoolKobo);
  check(`${tag} monthly fee reconciles to the fee`, sum(b.schedule.map((l) => l.feeKobo)) === b.feeKobo);
  check(`${tag} each month: gross = net + fee`, b.schedule.every((l) => l.counterpartyGrossKobo === l.investorNetKobo + l.feeKobo));
  check(
    `${tag} counterparty gross over the term = markup (+ fee if charged to them)`,
    sum(b.schedule.map((l) => l.counterpartyGrossKobo)) === b.counterpartyTotalKobo - c.costKobo
  );

  // ── Funding and allocations ─────────────────────────────
  const holders = SAMPLE_ALLOCATIONS.filter((a) => a.cycleId === c.id);
  check(`${tag} cost is a whole number of units`, c.costKobo % c.unitPriceKobo === 0);
  check(`${tag} units funded = sum of holdings`, f.unitsFunded === sum(holders.map((h) => h.units)));
  check(`${tag} funded + unsubscribed = units required`, f.unitsFunded + f.unitsUnsubscribed === f.unitsRequired);
  check(`${tag} shortfall = cost − funded`, f.fundingShortfallKobo === c.costKobo - f.fundedKobo);
  for (const a of f.allocations) {
    const h = holders.find((x) => x.investorId === a.key)!;
    if (a.capitalKobo !== h.units * c.unitPriceKobo) check(`${tag} ${a.key} capital = units × unit price`, false, a);
  }
  check(`${tag} every allocation's capital = units × unit price`, true);
  check(`${tag} allocated capital = funded capital`, sum(f.allocations.map((a) => a.capitalKobo)) === f.fundedKobo);

  const unalloc = f.unallocated?.monthlyProfitKobo ?? b.schedule.map(() => 0);
  b.schedule.forEach((l, m) => {
    const s = sum(f.allocations.map((a) => a.monthlyProfitKobo[m])) + unalloc[m];
    if (s !== l.investorNetKobo) check(`${tag} month ${m + 1} allocations + unallocated = net`, false, { s, net: l.investorNetKobo });
  });
  check(`${tag} every month: allocations + unallocated = net due`, true);
  check(
    `${tag} participation (incl. unsubscribed) totals 100%`,
    Math.abs(sum(f.allocations.map((a) => a.participationBps)) + (f.unallocated?.participationBps ?? 0) - 10_000) <= 1
  );
  check(
    `${tag} unsubscribed units receive no capital and no investor is credited their profit`,
    (f.unallocated?.capitalKobo ?? 0) === f.unitsUnsubscribed * c.unitPriceKobo
  );

  // ── Capital settlement kept apart from profit ───────────
  check(
    `${tag} capital settlement totals the funded capital, not profit`,
    sum(f.allocations.map((a) => a.capitalKobo)) === f.fundedKobo
  );
  check(`${tag} no schedule line carries capital`, sum(b.schedule.map((l) => l.investorNetKobo)) === b.investorProfitPoolKobo);

  // ── Receipts, statuses and payments ─────────────────────
  for (const p of f.periods) {
    const ok =
      p.paidKobo <= p.investorNetKobo &&
      p.feeRetainedKobo + p.paidKobo <= p.grossReceivedKobo &&
      (p.status !== "paid" || p.paidKobo === p.investorNetKobo) &&
      (p.status !== "partly_paid" || (p.paidKobo > 0 && p.paidKobo < p.investorNetKobo)) &&
      (p.status !== "upcoming" || (p.dueDate! > SAMPLE_AS_OF && p.paidKobo === 0)) &&
      (p.status !== "pending" || (p.dueDate! <= SAMPLE_AS_OF && p.paidKobo === 0)) &&
      p.outstandingKobo === (p.dueDate! <= SAMPLE_AS_OF ? p.investorNetKobo - p.paidKobo : 0);
    if (!ok) check(`${tag} month ${p.period} status and amounts agree`, false, p);
  }
  check(`${tag} every month's status follows from receipts and the as-of date`, true);
  check(`${tag} no receipt is dated before the Cycle starts`,
    SAMPLE_RECEIPTS.filter((r) => r.cycleId === c.id).every((r) => r.receivedOn >= c.startDate));
  check(`${tag} no receipt is dated after the as-of date`,
    SAMPLE_RECEIPTS.filter((r) => r.cycleId === c.id).every((r) => r.receivedOn <= SAMPLE_AS_OF));

  // ── Status consistency ──────────────────────────────────
  if (c.status === "active") {
    check(`${tag} an active Cycle is fully funded`, f.fundingShortfallKobo === 0);
    check(`${tag} an active Cycle has an approver different from the preparer`, !!c.approvedBy && c.approvedBy !== c.preparedBy);
    for (const h of holders) {
      const inv = SAMPLE_INVESTORS.find((i) => i.id === h.investorId)!;
      check(`${tag} ${inv.fullName}: KYC complete`, ["verified", "verified_via_maalgrow"].includes(inv.kycStatus));
      check(`${tag} ${inv.fullName}: bank details confirmed`, inv.bank.confirmed);
      check(`${tag} ${inv.fullName}: added before the Cycle started`, inv.addedOn <= c.startDate);
    }
  } else {
    check(`${tag} a non-active Cycle has no receipts`, SAMPLE_RECEIPTS.every((r) => r.cycleId !== c.id));
    check(`${tag} a non-active Cycle has nothing paid`, sum(f.periods.map((p) => p.paidKobo)) === 0);
  }
}

// ── The worked example, pinned to exact figures ──────────────
{
  const alpha = sampleCycleFigures(SAMPLE_CYCLES[0]);
  const N = (n: number) => n * 100;
  check("Alpha: ₦100m cost, ₦12m markup, ₦112m sale price",
    alpha.breakdown.costKobo === N(100_000_000) && alpha.breakdown.markupKobo === N(12_000_000) && alpha.breakdown.salePriceKobo === N(112_000_000));
  check("Alpha: ₦600k fee, ₦11.4m pool, ₦1.9m a month",
    alpha.breakdown.feeKobo === N(600_000) && alpha.breakdown.investorProfitPoolKobo === N(11_400_000) &&
    alpha.breakdown.schedule.every((l) => l.investorNetKobo === N(1_900_000)));
  check("Alpha: months 1–2 paid, 3 part-paid ₦1.4m, 4–6 upcoming",
    alpha.periods.map((p) => p.status).join() === "paid,paid,partly_paid,upcoming,upcoming,upcoming" &&
    alpha.periods[2].paidKobo === N(1_400_000));
  check("Alpha: ₦60m / ₦40m capital, ₦6.84m / ₦4.56m profit",
    alpha.allocations[0].capitalKobo === N(60_000_000) && alpha.allocations[1].capitalKobo === N(40_000_000) &&
    alpha.allocations[0].totalProfitKobo === N(6_840_000) && alpha.allocations[1].totalProfitKobo === N(4_560_000));

  const beta = sampleCycleFigures(SAMPLE_CYCLES[1]);
  check("Beta: ₦40m cost, ₦3m fixed markup, fee waived, ₦3m pool",
    beta.breakdown.salePriceKobo === N(43_000_000) && beta.breakdown.feeKobo === 0 && beta.breakdown.investorProfitPoolKobo === N(3_000_000));
  check("Beta: 250 of 400 units funded, ₦15m shortfall",
    beta.unitsFunded === 250 && beta.unitsRequired === 400 && beta.fundingShortfallKobo === N(15_000_000));
  check("Beta: ₦15m / ₦10m capital — what was paid in",
    beta.allocations[0].capitalKobo === N(15_000_000) && beta.allocations[1].capitalKobo === N(10_000_000));
  check("Beta: profit per unit of the whole Cycle — ₦1.125m / ₦750k, ₦1.125m unallocated",
    beta.allocations[0].totalProfitKobo === N(1_125_000) && beta.allocations[1].totalProfitKobo === N(750_000) &&
    beta.unallocated?.totalProfitKobo === N(1_125_000));
}

// ── Dashboard = the records it summarises ───────────────────
{
  const d = sampleDashboard();
  const figs = SAMPLE_CYCLES.map((c) => ({ c, f: sampleCycleFigures(c) }));
  const active = figs.filter((x) => x.c.status === "active");

  check("dashboard: investor count = sample investors", d.investorCount === SAMPLE_INVESTORS.length);
  check("dashboard: active Cycles count", d.activeCycleCount === active.length);
  check("dashboard: allocated capital = sum of every allocation's capital",
    d.allocatedCapitalKobo === sum(figs.flatMap((x) => x.f.allocations.map((a) => a.capitalKobo))));
  check("dashboard: active + draft split adds up", d.activeAllocatedKobo + d.draftAllocatedKobo === d.allocatedCapitalKobo);
  check("dashboard: paid = sum of profit paid on active Cycles",
    d.completedKobo === sum(active.flatMap((x) => x.f.periods.map((p) => p.paidKobo))));
  check("dashboard: paid = sample receipts less fees retained",
    d.completedKobo === sum(active.flatMap((x) => x.f.periods.map((p) => p.grossReceivedKobo - p.feeRetainedKobo))));
  check("dashboard: outstanding = due-but-unpaid profit", d.outstandingKobo === sum(active.flatMap((x) => x.f.periods.map((p) => p.outstandingKobo))));
  check("dashboard: 'due' table total = outstanding tile", d.dueKobo === d.outstandingKobo);
  check("dashboard: capital settlements = active Cycles' funded capital",
    sum(d.capitalSettlements.map((c) => c.amountKobo)) === sum(active.map((x) => x.f.fundedKobo)));
  check("dashboard: profit figures exclude capital", d.completedKobo + d.outstandingKobo <= sum(active.map((x) => x.f.breakdown.investorProfitPoolKobo)));
  check("dashboard: Alpha figures — ₦5.2m paid, ₦500k outstanding, ₦100m capital at maturity",
    d.completedKobo === 520_000_000 && d.outstandingKobo === 50_000_000 && d.capitalSettlements[0]?.amountKobo === 10_000_000_000);
}

// ── Sample data can never pass for a record, or write anywhere ─
{
  check("every sample id carries the sample- prefix",
    [...SAMPLE_CYCLES, ...SAMPLE_INVESTORS].every((x) => isSampleId(x.id)));
  check("no sample investor has a real-looking email", SAMPLE_INVESTORS.every((i) => i.email.endsWith("@example.com")));
  check("no sample account number is a real-looking NUBAN",
    SAMPLE_INVESTORS.every((i) => i.bank.accountNumber === "" || /^0{9}\d$/.test(i.bank.accountNumber)));
  check("every sample name says Sample", [...SAMPLE_CYCLES.map((c) => c.name), ...SAMPLE_INVESTORS.map((i) => i.fullName)].every((n) => n.startsWith("Sample")));
  check("every sample receipt reference says SAMPLE", SAMPLE_RECEIPTS.every((r) => r.reference.startsWith("SAMPLE-")));

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? walk(p) : [p];
    });
  const files = [
    ...walk("src/app/(admin)/admin/maalrise"),
    ...walk("src/lib/maalrise"),
    ...walk("src/components/maalrise"),
  ];
  const writers = /\.(insert|update|upsert|delete|rpc)\(|fetch\(|createAdminClient|sendMail|resend|\.storage\b|method:\s*["']POST/i;
  const offenders = files.filter((p) => writers.test(readFileSync(p, "utf8")));
  check("no MaalRise screen or library can write, call an API, upload or email", offenders.length === 0, offenders);
  check("there is no MaalRise API route to save to", !walk("src/app/api").some((p) => p.includes("maalrise")));

  const pages = files.filter((p) => p.endsWith("page.tsx"));
  const showsSample = pages.filter((p) => /SAMPLE_|sample(Cycle|Investor|Dashboard)/.test(readFileSync(p, "utf8")));
  const unbannered = showsSample.filter((p) => !readFileSync(p, "utf8").includes("<SampleDataBanner"));
  check("every page that renders sample data shows the sample banner", unbannered.length === 0, unbannered);
}

if (failures) {
  console.error(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nAll MaalRise sample-data checks passed.");
