/**
 * Where a report's figures come from.
 *
 * THE RULE: the renderer never queries the database and never calls
 * compute(). This module decides the source, once, so the admin
 * preview, the investor's own view and the email job cannot disagree:
 *
 *   settled  → the frozen snapshot. Never recomputed, so a report
 *              rendered today and the same report in two years are
 *              identical.
 *   draft or
 *   active   → a live compute(), marked PROVISIONAL so nobody can
 *              mistake a working draft for a final statement.
 *
 * All money is integer kobo, as everywhere in this feature.
 */

import { compute, type CycleInput, type CycleResult } from "./compute";
import type { SettlementComputed } from "./figures";

export type CapitalDecision = "withdraw" | "rollover" | "partial" | "none";

/** One investor's holding, from their `investments` record */
export type ReportHolding = {
  investmentId: string;
  investorName: string;
  investorCode: string;
  /** NUMERIC(12,2) — half slots are normal */
  units: number;
  decision: CapitalDecision;
  /** Slots being taken out; equals units on a full exit */
  slotsWithdrawn: number;
};

/** The cycle's own identity, from `cycles` and `series` */
export type ReportCycle = {
  seriesName: string;
  cycleLabel: string;
  startDate: string;
  endDate: string;
  /** A category — "home furniture" — never a list of products */
  description: string | null;
  discloseMode: "full" | "perSlot";
  /** Sum of units across the cycle's active investments */
  totalUnits: number;
  investorCount: number;
};

/** One month, aggregate only. No product ever appears here. */
export type ReportMonth = {
  i: number;
  revenue: number;
  purchaseCost: number;
  expenses: number;
  lostValue: number;
  net: number;
  unitsBought: number;
  unitsSold: number;
  unitsLeft: number;
};

/**
 * Everything the renderer is allowed to see. Aggregate figures only —
 * this type carries no product-shaped field, so a per-product figure
 * cannot reach the report by accident.
 */
export type ReportFigures = {
  source: "settlement" | "live";
  /** True when the cycle is not settled: the report says so, loudly */
  provisional: boolean;
  settledAt: string | null;
  engineVersion: string | null;

  slotPrice: number;
  totalUnits: number;
  capital: number;
  /** Slot holders' share, 0–100 */
  ratio: number;
  whtRate: number;

  profit: number;
  isLoss: boolean;
  holderPot: number;
  managerPot: number;

  /** Per slot, all in kobo */
  grossPerSlot: number;
  whtPerSlot: number;
  netPerSlot: number;
  /** Percent of the slot price, net of tax */
  returnPerSlot: number;
  /** Percent of the slot price, before tax */
  grossReturnPerSlot: number;

  revenue: number;
  purchaseCost: number;
  cogsTotal: number;
  expensesTotal: number;
  lostTotal: number;
  unitsBought: number;
  unitsSold: number;
  unitsLeft: number;
  endCash: number;
  endStock: number;

  months: ReportMonth[];
};

function pct(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/** A settled cycle: read the frozen record, never the engine */
export function figuresFromSettlement(
  computed: SettlementComputed,
  settledAt: string,
  engineVersion: string,
  whtRate: number
): ReportFigures {
  const last = computed.months[computed.months.length - 1];
  return {
    source: "settlement",
    provisional: false,
    settledAt,
    engineVersion,
    slotPrice: computed.slotPrice,
    totalUnits: computed.slots,
    capital: computed.capital,
    ratio: computed.invRatio,
    whtRate,
    profit: computed.profit,
    isLoss: computed.isLoss,
    holderPot: computed.holderPot,
    managerPot: computed.managerPot,
    grossPerSlot: computed.grossPerSlot,
    whtPerSlot: computed.whtPerSlot,
    netPerSlot: computed.netPerSlot,
    returnPerSlot: computed.returnPerSlot,
    grossReturnPerSlot: pct(computed.grossPerSlot, computed.slotPrice),
    revenue: computed.revenue,
    purchaseCost: computed.purchTotal,
    cogsTotal: computed.cogsTotal,
    expensesTotal: computed.sellExpTotal,
    lostTotal: computed.lostTotal,
    unitsBought: computed.unitsBought,
    unitsSold: computed.unitsSold,
    unitsLeft: last?.unitsLeft ?? 0,
    endCash: computed.endCash,
    endStock: computed.endStockValue,
    months: computed.months.map((m) => ({
      i: m.i,
      revenue: m.revenue,
      purchaseCost: m.spend,
      expenses: m.sellExp,
      lostValue: m.lostValue,
      net: m.net,
      unitsBought: m.unitsBought,
      unitsSold: m.unitsSold,
      unitsLeft: m.unitsLeft,
    })),
  };
}

/** A draft or active cycle: derive live, and say so */
export function figuresFromLive(cycle: CycleResult): ReportFigures {
  return {
    source: "live",
    provisional: true,
    settledAt: null,
    engineVersion: null,
    slotPrice: cycle.slotPrice,
    totalUnits: cycle.slots,
    capital: cycle.capital,
    ratio: cycle.invRatio,
    whtRate: cycle.grossPerSlot > 0 ? cycle.whtPerSlot / cycle.grossPerSlot : 0,
    profit: cycle.profit,
    isLoss: cycle.isLoss,
    holderPot: cycle.holderPot,
    managerPot: cycle.mudaribPot,
    grossPerSlot: cycle.grossPerSlot,
    whtPerSlot: cycle.whtPerSlot,
    netPerSlot: cycle.netPerSlot,
    returnPerSlot: cycle.slotReturn,
    grossReturnPerSlot: pct(cycle.grossPerSlot, cycle.slotPrice),
    revenue: cycle.revenue,
    purchaseCost: cycle.purchTotal,
    cogsTotal: cycle.cogsTotal,
    expensesTotal: cycle.sellExpTotal,
    lostTotal: cycle.lostTotal,
    unitsBought: cycle.unitsBought,
    unitsSold: cycle.unitsSold,
    unitsLeft: cycle.unitsLeft,
    endCash: cycle.endCash,
    endStock: cycle.endStock,
    months: cycle.months.map((m) => ({
      i: m.i,
      revenue: m.revenue,
      purchaseCost: m.spend,
      expenses: m.sellExp,
      lostValue: m.lostValue,
      net: m.net,
      unitsBought: m.unitsBought,
      unitsSold: m.unitsSold,
      unitsLeft: m.unitsLeft,
    })),
  };
}

/**
 * THE resolver. One function, used by the preview, the investor's view
 * and the email job alike.
 */
export function reportFigures(stored: {
  status: "draft" | "active" | "settled";
  input?: CycleInput;
  settlement?: {
    computed: SettlementComputed;
    settledAt: string;
    engineVersion: string;
    whtRate: number;
  } | null;
}): ReportFigures {
  if (stored.status === "settled" && stored.settlement) {
    const s = stored.settlement;
    return figuresFromSettlement(s.computed, s.settledAt, s.engineVersion, s.whtRate);
  }
  if (!stored.input) {
    throw new Error("An unsettled cycle needs its inputs to derive figures");
  }
  return figuresFromLive(compute(stored.input));
}

/* ── One investor's own numbers ──────────────────────────────────── */

export type HolderFigures = {
  units: number;
  capital: number;
  grossProfit: number;
  wht: number;
  netProfit: number;
  /** Percent of their capital, before and after tax */
  grossReturn: number;
  netReturn: number;
  decision: CapitalDecision;
  slotsWithdrawn: number;
  slotsContinuing: number;
  capitalWithdrawn: number;
  capitalContinuing: number;
};

/**
 * Everything on page 1 is perSlotValue × units, and units may be a
 * half. Rounded to the kobo per figure — the exact division across
 * holders happens at settlement, in allocateHolders().
 */
export function holderReportFigures(
  f: ReportFigures,
  holding: ReportHolding
): HolderFigures {
  const units = Number(holding.units) || 0;
  const capital = Math.round(units * f.slotPrice);
  const grossProfit = Math.round(units * f.grossPerSlot);
  const wht = Math.round(units * f.whtPerSlot);
  const withdrawn = Math.max(0, Math.min(units, Number(holding.slotsWithdrawn) || 0));
  const continuing = units - withdrawn;
  return {
    units,
    capital,
    grossProfit,
    wht,
    netProfit: grossProfit - wht,
    grossReturn: pct(grossProfit, capital),
    netReturn: pct(grossProfit - wht, capital),
    decision: holding.decision,
    slotsWithdrawn: withdrawn,
    slotsContinuing: continuing,
    capitalWithdrawn: Math.round(withdrawn * f.slotPrice),
    capitalContinuing: Math.round(continuing * f.slotPrice),
  };
}

/** "2.5 slots", "1 slot" — never "1 slots" or "2.5 slot" */
export function slotWord(units: number): string {
  const n = Number(units) || 0;
  const shown = Number.isInteger(n) ? String(n) : String(n);
  return `${shown} ${n === 1 ? "slot" : "slots"}`;
}
