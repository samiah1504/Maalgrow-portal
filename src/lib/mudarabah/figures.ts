/**
 * The settlement freeze.
 *
 * Everywhere else in this feature we store inputs and derive on read.
 * That is right for a cycle still being worked on, and wrong the
 * moment money has moved: because the figures are derived, changing a
 * formula later would recalculate every past cycle, not just future
 * ones. An investor who received a statement saying ₦42,820.74 could
 * open the portal months later and see a different number against the
 * same cycle. Money already paid, figures already published, quietly
 * rewritten.
 *
 * So settling a cycle freezes it. compute() runs ONCE, the result is
 * written to a settlement record, and from then on every path — portal
 * view, PDF, email, balances, history — reads that record and never
 * calls the engine again for that cycle.
 *
 * The snapshot is not a cache of a display value. It is the record of
 * a real event: this is what we computed, on this date, under these
 * rules, and this is what we actually paid.
 *
 * All money is integer KOBO, as in compute.ts.
 */

import {
  compute,
  investorView,
  ENGINE_VERSION,
  type CycleInput,
  type CycleResult,
  type InvestorCycleView,
} from "./compute";

export type CapitalAction = "withdraw" | "rollover";

export type Holding = {
  /** The investors.id of an existing investor record */
  investorRef: string;
  slots: number;
  capitalAction: CapitalAction;
};

/**
 * The frozen figures. Aggregate only — no per-product breakdown ever
 * enters this record, so nothing downstream of a settlement can leak
 * one. The admin per-product summary is stored separately.
 */
export type SettlementMonth = {
  i: number;
  revenue: number;
  cogs: number;
  /** What was paid for goods that month */
  spend: number;
  sellExp: number;
  /**
   * How sellExp was made up. OPTIONAL because cycles settled before
   * this was recorded have a snapshot without it, and a frozen
   * snapshot is never rewritten.
   */
  ads?: number;
  logistics?: number;
  misc?: number;
  bankCharges?: number;
  lostValue: number;
  net: number;
  cash: number;
  stockValue: number;
  unitsBought: number;
  unitsSold: number;
  unitsLeft: number;
};

export type SettlementComputed = {
  months: SettlementMonth[];
  revenue: number;
  cogsTotal: number;
  /** Total cost of purchase, every product added together */
  purchTotal: number;
  sellExpTotal: number;
  lostTotal: number;
  unitsBought: number;
  unitsSold: number;
  profit: number;
  holderPot: number;
  managerPot: number;
  grossPerSlot: number;
  whtPerSlot: number;
  netPerSlot: number;
  returnPerSlot: number;
  endCash: number;
  endStockValue: number;
  slotPrice: number;
  slots: number;
  capital: number;
  isLoss: boolean;
  invRatio: number;
};

export type SettlementHolder = {
  investorRef: string;
  slots: number;
  capital: number;
  profit: number;
  capitalAction: CapitalAction;
  /**
   * What actually moved — deliberately separate from `profit`. If a
   * payment differs for any reason (rounding, a goodwill adjustment, a
   * partial transfer) the record shows what genuinely happened rather
   * than what the formula said should happen.
   */
  amountPaid: number;
  amountPaidNote?: string | null;
};

export type Settlement = {
  cycleId: string;
  settledAt: string;
  engineVersion: string;
  computed: SettlementComputed;
  holders: SettlementHolder[];
};

/** Admin-only per-product record. Stored apart from the snapshot. */
export type SettlementProduct = {
  productId: string;
  productName: string;
  unitsBought: number;
  unitsSold: number;
  unitsLeft: number;
  revenue: number;
  cogs: number;
  gross: number;
  grossMargin: number;
};

/** An override for a single holder's payment, with the reason for it */
export type PaymentOverride = {
  investorRef: string;
  amountPaid: number;
  note: string;
};

/**
 * Freeze a computed cycle. `settledAt` is passed in rather than read
 * from the clock so the caller owns the timestamp and the function
 * stays pure.
 */
export function buildSettlement(
  cycleId: string,
  cycle: CycleResult,
  holdings: Holding[],
  settledAt: string,
  overrides: PaymentOverride[] = []
): Settlement {
  const byRef = new Map(overrides.map((o) => [o.investorRef, o]));

  const holders: SettlementHolder[] = holdings.map((h) => {
    const capital = h.slots * cycle.slotPrice;
    const profit = h.slots * cycle.netPerSlot;
    // What moves at payout: the profit share always, plus the capital
    // for anyone withdrawing rather than rolling over.
    const computedPayment = profit + (h.capitalAction === "withdraw" ? capital : 0);
    const override = byRef.get(h.investorRef);
    return {
      investorRef: h.investorRef,
      slots: h.slots,
      capital,
      profit,
      capitalAction: h.capitalAction,
      amountPaid: override ? override.amountPaid : computedPayment,
      amountPaidNote: override ? override.note : null,
    };
  });

  return {
    cycleId,
    settledAt,
    engineVersion: ENGINE_VERSION,
    computed: {
      months: cycle.months.map((m) => ({
        i: m.i,
        revenue: m.revenue,
        cogs: m.cogs,
        spend: m.spend,
        sellExp: m.sellExp,
        // The split as well as the total: the report shows how the
        // running costs were made up, and a snapshot that kept only the
        // total could never answer that afterwards.
        ads: m.ads,
        logistics: m.logistics,
        misc: m.misc,
        bankCharges: m.bankCharges,
        lostValue: m.lostValue,
        net: m.net,
        cash: m.cash,
        stockValue: m.stockValue,
        unitsBought: m.unitsBought,
        unitsSold: m.unitsSold,
        unitsLeft: m.unitsLeft,
      })),
      revenue: cycle.revenue,
      cogsTotal: cycle.cogsTotal,
      purchTotal: cycle.purchTotal,
      sellExpTotal: cycle.sellExpTotal,
      lostTotal: cycle.lostTotal,
      unitsBought: cycle.unitsBought,
      unitsSold: cycle.unitsSold,
      profit: cycle.profit,
      holderPot: cycle.holderPot,
      managerPot: cycle.mudaribPot,
      grossPerSlot: cycle.grossPerSlot,
      whtPerSlot: cycle.whtPerSlot,
      netPerSlot: cycle.netPerSlot,
      returnPerSlot: cycle.slotReturn,
      endCash: cycle.endCash,
      endStockValue: cycle.endStock,
      slotPrice: cycle.slotPrice,
      slots: cycle.slots,
      capital: cycle.capital,
      isLoss: cycle.isLoss,
      invRatio: cycle.invRatio,
    },
    holders,
  };
}

export function buildSettlementProducts(cycle: CycleResult): SettlementProduct[] {
  return cycle.products.map((p) => ({
    productId: p.productId,
    productName: p.productName,
    unitsBought: p.unitsBought,
    unitsSold: p.unitsSold,
    unitsLeft: p.unitsLeft,
    revenue: p.revenue,
    cogs: p.cogs,
    gross: p.gross,
    grossMargin: p.grossMargin,
  }));
}

/* ── Reading figures back ────────────────────────────────────────── */

export type CycleStatus = "draft" | "active" | "settled";

export type StoredCycle = {
  id: string;
  status: CycleStatus;
  input: CycleInput;
  /** The current snapshot. Present once the cycle is settled. */
  settlement?: Settlement | null;
};

export type CycleFigures = {
  /** Where the numbers came from — frozen or derived live */
  source: "settlement" | "live";
  settledAt: string | null;
  engineVersion: string | null;
  view: InvestorCycleView;
};

/**
 * THE read path. Every display of a cycle's figures goes through here.
 *
 * A settled cycle returns its snapshot and the engine is never called.
 * A draft or active cycle derives live, exactly as in step 1.
 *
 * `engine` is injectable so the freeze can be tested against a
 * deliberately altered engine; production always uses compute().
 */
export function cycleFigures(
  stored: StoredCycle,
  engine: (input: CycleInput) => CycleResult = compute
): CycleFigures {
  if (stored.status === "settled" && stored.settlement) {
    const c = stored.settlement.computed;
    return {
      source: "settlement",
      settledAt: stored.settlement.settledAt,
      engineVersion: stored.settlement.engineVersion,
      view: {
        months: c.months.map((m) => ({
          i: m.i,
          revenue: m.revenue,
          purchaseCost: m.spend,
          expenses: m.sellExp,
          gross: m.revenue - m.cogs,
          net: m.net,
          unitsBought: m.unitsBought,
          unitsSold: m.unitsSold,
          unitsLeft: m.unitsLeft,
        })),
        slotPrice: c.slotPrice,
        slots: c.slots,
        capital: c.capital,
        profit: c.profit,
        isLoss: c.isLoss,
        holderPot: c.holderPot,
        mudaribPot: c.managerPot,
        grossPerSlot: c.grossPerSlot,
        whtPerSlot: c.whtPerSlot,
        netPerSlot: c.netPerSlot,
        slotReturn: c.returnPerSlot,
        payoutPerSlot: c.slotPrice + c.netPerSlot,
        revenue: c.revenue,
        purchaseCost: c.purchTotal,
        expensesTotal: c.sellExpTotal,
        unitsBought: c.unitsBought,
        unitsSold: c.unitsSold,
        unitsLeft: c.months[c.months.length - 1]?.unitsLeft ?? 0,
        invRatio: c.invRatio,
      },
    };
  }
  return {
    source: "live",
    settledAt: null,
    engineVersion: null,
    view: investorView(engine(stored.input)),
  };
}

/** A settled holder's figures come from the snapshot, not the engine */
export function settledHolderFigures(
  settlement: Settlement,
  investorRef: string
): SettlementHolder | null {
  return settlement.holders.find((h) => h.investorRef === investorRef) ?? null;
}
