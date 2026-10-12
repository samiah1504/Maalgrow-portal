/**
 * Figures derived from the SAMPLE data. Illustrative only — see
 * sample-data.ts. Every number the sample screens show is computed
 * here from the sample records, so the dashboard, the Cycle pages and
 * the investor pages cannot disagree with one another.
 */
import { allocateCycle, computeTerms } from "./compute";
import { periodDueDate, maturityDate } from "./dates";
import {
  SAMPLE_ALLOCATIONS,
  SAMPLE_AS_OF,
  SAMPLE_CYCLES,
  SAMPLE_INVESTORS,
  SAMPLE_RECEIPTS,
  type SampleCycle,
} from "./sample-data";

export type SamplePeriodStatus = "paid" | "partly_paid" | "pending" | "upcoming";

/**
 * How a sample receipt is split, for illustration only: the period's
 * fee is retained first and the rest goes to investors, capped at what
 * the period owes them. Whether the real fee is taken first, last or
 * pro rata is assumption A7 and is NOT decided by this.
 */
export const SAMPLE_RECEIPT_RULE =
  "Sample receipts are split with the period's fee retained first and the remainder distributed to investors, capped at the amount due. This is illustrative only — the real rule is assumption A7.";

export function sampleCycleFigures(cycle: SampleCycle) {
  const breakdown = computeTerms({
    costKobo: cycle.costKobo,
    markup: cycle.markup,
    statedSalePriceKobo: cycle.statedSalePriceKobo,
    fee: cycle.fee,
    durationMonths: cycle.durationMonths,
    schedule: cycle.schedule,
  });
  const holders = SAMPLE_ALLOCATIONS.filter((a) => a.cycleId === cycle.id);
  // Profit per unit of the whole Cycle; unsubscribed units' share stays
  // unallocated, and capital is only what was paid in. See allocateCycle.
  const alloc = allocateCycle(
    { costKobo: cycle.costKobo, unitPriceKobo: cycle.unitPriceKobo },
    breakdown.schedule,
    holders.map((h) => ({ key: h.investorId, units: h.units }))
  );
  const { unitsFunded, unitsRequired, fundingShortfallKobo } = alloc;
  const unitsUnsubscribed = unitsRequired - unitsFunded;
  const fundedKobo = alloc.fundedCapitalKobo;
  const allocations = alloc.lines;
  const unallocated = alloc.unallocated;

  const receipts = SAMPLE_RECEIPTS.filter((r) => r.cycleId === cycle.id);

  const periods = breakdown.schedule.map((line) => {
    const dueDate = periodDueDate(cycle.startDate, line.period);
    const grossReceived = receipts
      .filter((r) => r.period === line.period)
      .reduce((s, r) => s + r.grossKobo, 0);
    const feeRetained = Math.min(grossReceived, line.feeKobo);
    const paid = Math.min(grossReceived - feeRetained, line.investorNetKobo);
    const isDue = dueDate !== null && dueDate <= SAMPLE_AS_OF;
    const status: SamplePeriodStatus =
      paid >= line.investorNetKobo && line.investorNetKobo > 0
        ? "paid"
        : paid > 0
          ? "partly_paid"
          : isDue
            ? "pending"
            : "upcoming";
    return {
      ...line,
      dueDate,
      grossReceivedKobo: grossReceived,
      feeRetainedKobo: feeRetained,
      status,
      paidKobo: paid,
      /** Owed now: only periods that have fallen due carry an outstanding balance. */
      outstandingKobo: isDue ? line.investorNetKobo - paid : 0,
    };
  });

  return {
    breakdown,
    allocations,
    unallocated,
    unitsFunded,
    unitsRequired,
    unitsUnsubscribed,
    fundedKobo,
    fundingShortfallKobo,
    maturity: maturityDate(cycle.startDate, cycle.durationMonths),
    periods,
  };
}

export function sampleDashboard() {
  const perCycle = SAMPLE_CYCLES.map((c) => ({ cycle: c, f: sampleCycleFigures(c) }));
  const active = perCycle.filter((x) => x.cycle.status === "active");

  const due = active.flatMap(({ cycle, f }) =>
    f.periods
      .filter((p) => p.outstandingKobo > 0)
      .map((p) => ({ cycle, period: p.period, dueDate: p.dueDate, amountKobo: p.outstandingKobo, status: p.status }))
  );

  const activeAllocatedKobo = active.reduce((s, x) => s + x.f.fundedKobo, 0);
  const draftAllocatedKobo = perCycle
    .filter((x) => x.cycle.status !== "active")
    .reduce((s, x) => s + x.f.fundedKobo, 0);

  return {
    asOf: SAMPLE_AS_OF,
    investorCount: SAMPLE_INVESTORS.length,
    activeCycleCount: active.length,
    allocatedCapitalKobo: activeAllocatedKobo + draftAllocatedKobo,
    activeAllocatedKobo,
    draftAllocatedKobo,
    due,
    dueKobo: due.reduce((s, d) => s + d.amountKobo, 0),
    completedKobo: active.reduce((s, x) => s + x.f.periods.reduce((t, p) => t + p.paidKobo, 0), 0),
    outstandingKobo: active.reduce((s, x) => s + x.f.periods.reduce((t, p) => t + p.outstandingKobo, 0), 0),
    capitalSettlements: active.map(({ cycle, f }) => ({
      cycle,
      dueDate: f.maturity,
      amountKobo: f.allocations.reduce((s, a) => s + a.capitalKobo, 0),
      holders: f.allocations.length,
    })),
  };
}
