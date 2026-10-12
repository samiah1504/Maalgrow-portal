/**
 * Dashboard figures derived from the SAMPLE data. Illustrative only —
 * see sample-data.ts. Kept apart so the dashboard page never computes
 * a "total" that a reader could mistake for one over real records.
 */
import { computeAllocations, computeTerms } from "./compute";
import { periodDueDate, maturityDate } from "./dates";
import {
  SAMPLE_ALLOCATIONS,
  SAMPLE_CYCLES,
  SAMPLE_INVESTORS,
  SAMPLE_PERIOD_STATUS,
  type SampleCycle,
} from "./sample-data";

/** Illustrative: how much of a part-paid period has gone out. */
export const SAMPLE_PARTIAL_PAID_KOBO: Record<string, Record<number, number>> = {
  "sample-cycle-1": { 3: 1_400_000_00 },
};

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
  const unitsFunded = holders.reduce((s, h) => s + h.units, 0);
  const unitsRequired = Math.ceil(cycle.costKobo / cycle.unitPriceKobo);
  const fundedKobo = unitsFunded * cycle.unitPriceKobo;
  const allocations = computeAllocations(
    { capitalKobo: fundedKobo, schedule: breakdown.schedule },
    holders.map((h) => ({ key: h.investorId, units: h.units }))
  );
  const statuses = SAMPLE_PERIOD_STATUS[cycle.id] ?? [];
  const partial = SAMPLE_PARTIAL_PAID_KOBO[cycle.id] ?? {};

  const periods = breakdown.schedule.map((line, i) => {
    const status = statuses[i] ?? "upcoming";
    const paid =
      status === "paid" ? line.investorNetKobo : status === "partly_paid" ? partial[line.period] ?? 0 : 0;
    return {
      ...line,
      dueDate: periodDueDate(cycle.startDate, line.period),
      status,
      paidKobo: paid,
      outstandingKobo: status === "upcoming" ? 0 : line.investorNetKobo - paid,
    };
  });

  return {
    breakdown,
    allocations,
    unitsFunded,
    unitsRequired,
    fundedKobo,
    fundingShortfallKobo: Math.max(cycle.costKobo - fundedKobo, 0),
    maturity: maturityDate(cycle.startDate, cycle.durationMonths),
    periods,
  };
}

export function sampleDashboard() {
  const perCycle = SAMPLE_CYCLES.map((c) => ({ cycle: c, f: sampleCycleFigures(c) }));
  const active = perCycle.filter((x) => x.cycle.status === "active");

  const due = active.flatMap(({ cycle, f }) =>
    f.periods
      .filter((p) => p.status === "pending" || p.status === "partly_paid")
      .map((p) => ({ cycle, period: p.period, dueDate: p.dueDate, amountKobo: p.outstandingKobo, status: p.status }))
  );

  const completedKobo = active.reduce((s, x) => s + x.f.periods.reduce((t, p) => t + p.paidKobo, 0), 0);
  const outstandingKobo = active.reduce((s, x) => s + x.f.periods.reduce((t, p) => t + p.outstandingKobo, 0), 0);

  return {
    investorCount: SAMPLE_INVESTORS.length,
    activeCycleCount: active.length,
    allocatedCapitalKobo: perCycle.reduce((s, x) => s + x.f.fundedKobo, 0),
    due,
    dueKobo: due.reduce((s, d) => s + d.amountKobo, 0),
    completedKobo,
    outstandingKobo,
    capitalSettlements: active.map(({ cycle, f }) => ({
      cycle,
      dueDate: f.maturity,
      amountKobo: f.fundedKobo,
      holders: f.allocations.length,
    })),
  };
}
