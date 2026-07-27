/**
 * Mudarabah cycle engine — THE single source of truth for every
 * calculation in the Mudarabah cycle feature.
 *
 * ── MONEY IS INTEGER KOBO ──────────────────────────────────────────
 * Every money value in and out of this module is a whole number of
 * kobo. Never naira, never a float. ₦8,000 is 800_000. Formatting to
 * naira happens at the edge, in the UI, and nowhere else.
 *
 * Value is split between sold / lost / left units by largest
 * remainder, so the three parts add back to the stock's value exactly.
 * That keeps the books whole to the kobo instead of drifting a
 * fraction at a time, which is why the invariant below is an exact
 * integer equality rather than an approximate one.
 * ───────────────────────────────────────────────────────────────────
 *
 * A cycle trades several products at once. Products are declared once
 * per cycle and keep a stable identity across all three months, because
 * a product bought in month 1 may still be selling in month 3.
 *
 * Every rule below is a correctness requirement:
 *
 *  • WEIGHTED AVERAGE cost, PER PRODUCT. Stock carried in blends with
 *    newly bought stock into one cost price for that product. Never one
 *    shared average across different products — that would value
 *    leftover sofas at the blended cost of sofas and side tables.
 *  • Closing stock is valued at COST, never at expected selling price
 *    (valuing at selling price books profit before the sale).
 *  • Delivery is already included in what we pay per product, so there
 *    is no separate freight cost to capitalise or allocate.
 *  • Selling expenses (ads, logistics, misc, bank charges) are
 *    MONTH-LEVEL and are never allocated to products. So gross profit
 *    is reported per product, but net profit only per month and per
 *    cycle. Splitting shared ad spend across products needs an
 *    arbitrary rule, and an arbitrary rule produces per-product "net
 *    profit" that looks authoritative while being invented.
 *  • On a loss the manager's share is ZERO — not reduced, zero.
 *    Capital providers bear the financial loss; the manager's loss is
 *    unpaid effort.
 *  • Gross profit excludes selling expenses. Only net profit is ever
 *    shown to investors.
 *
 * Units left is DERIVED (openUnits + bought - sold) and only overridden
 * when the real count differs — damage, a bad return, shrinkage. Any
 * gap is charged as a loss at that product's own cost price.
 *
 * Invariant (holds by construction; tested on random inputs):
 *   endCash + sum of every product's final closing value
 *     === totalCapital + totalProfit          (exact, to the kobo)
 *
 * Import this module from EVERY path that needs cycle figures —
 * browser, server renderer, email job, balance updater. Store only
 * inputs; derive on read. Never persist profit, ROI or unit cost.
 *
 * The ONE exception is the settlement snapshot: once a cycle is
 * settled its figures are frozen and read back from that record, never
 * recomputed. See figures.ts.
 *
 * Investor-facing code must consume investorView() and nothing else:
 * the investor report must never break figures down by product.
 */

/**
 * Bumped BY HAND whenever a formula changes. Every settlement is
 * stamped with it, so "which rules was this cycle settled under?"
 * always has an answer.
 */
export const ENGINE_VERSION = "1.0.0";

export type ProductRef = {
  id: string;
  name: string;
};

/** One product's activity within one month. Four numbers are typed. */
export type MonthRowInput = {
  productId: string;
  /** How many we got */
  qty: number;
  /** Cost of each, in KOBO (delivery already included) */
  unitCost: number;
  /** How many sold */
  soldQty: number;
  /** Selling price per product, in KOBO */
  sellPrice: number;
  /**
   * Units left at month end. DERIVED — leave undefined and the engine
   * fills in openUnits + qty - soldQty. Only set it when the real count
   * differs from the expected one.
   */
  stockLeft?: number | null;
};

export type MonthInput = {
  rows: MonthRowInput[];
  /** Month-level selling expenses in KOBO — never split per product */
  ads: number;
  logistics: number;
  misc: number;
  bankCharges: number;
};

export type CycleInput = {
  name?: string;
  startDate?: string;
  currency?: string;
  /** In KOBO */
  slotPrice: number;
  slots: number;
  /** Investor share of profit, 0–100 */
  ratio: number;
  /** Withholding tax percentage, 0–100 */
  wht: number;
  /** Slots withdrawing capital at maturity */
  withdrawSlots: number;
  products: ProductRef[];
  months: [MonthInput, MonthInput, MonthInput];
};

export type RowResult = {
  productId: string;
  productName: string;
  openUnits: number;
  openValue: number;
  qty: number;
  unitCost: number;
  spend: number;
  availUnits: number;
  availValue: number;
  /**
   * Weighted average cost price for THIS product, in kobo. A rate, not
   * a money amount — kept exact and never rounded or stored.
   */
  unitCP: number;
  soldQty: number;
  sellPrice: number;
  revenue: number;
  cogs: number;
  expectedLeft: number;
  closeUnits: number;
  closeValue: number;
  lostUnits: number;
  lostValue: number;
  /** Per product — real and reportable, unlike a per-product net */
  gross: number;
  oversold: boolean;
  /** Units left was typed over the derived figure */
  adjusted: boolean;
  /** No row was entered — stock carries forward untouched */
  implicit: boolean;
};

export type MonthResult = {
  i: number;
  rows: RowResult[];
  fundsIn: number;
  openCash: number;
  openTotal: number;
  openUnits: number;
  openValue: number;
  revenue: number;
  cogs: number;
  /** Total paid for goods this month */
  spend: number;
  lostValue: number;
  lostUnits: number;
  ads: number;
  logistics: number;
  misc: number;
  bankCharges: number;
  sellExp: number;
  gross: number;
  net: number;
  cash: number;
  unitsBought: number;
  unitsSold: number;
  unitsLeft: number;
  stockValue: number;
  working: number;
};

export type ProductSummary = {
  productId: string;
  productName: string;
  unitsBought: number;
  unitsSold: number;
  unitsLeft: number;
  revenue: number;
  cogs: number;
  gross: number;
  /** Gross margin on revenue, percent */
  grossMargin: number;
  lostUnits: number;
  lostValue: number;
  stockValue: number;
};

export type CycleResult = {
  months: MonthResult[];
  products: ProductSummary[];
  slotPrice: number;
  slots: number;
  capital: number;
  withdraw: number;
  rollover: number;
  profit: number;
  isLoss: boolean;
  holderPot: number;
  mudaribPot: number;
  grossPerSlot: number;
  whtPerSlot: number;
  netPerSlot: number;
  whtTotal: number;
  netTotal: number;
  slotReturn: number;
  payoutPerSlot: number;
  revenue: number;
  cogsTotal: number;
  sellExpTotal: number;
  adsTotal: number;
  logisticsTotal: number;
  miscTotal: number;
  bankTotal: number;
  /** Total cost of purchase, every product added together */
  purchTotal: number;
  lostTotal: number;
  unitsSold: number;
  unitsBought: number;
  unitsLeft: number;
  endCash: number;
  endStock: number;
  endUnits: number;
  cashNeeded: number;
  invRatio: number;
};

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

/**
 * Split a whole-kobo amount across weights so the parts add back to
 * the total EXACTLY. Each part takes the floor of its exact share and
 * the leftover kobo go to the largest remainders.
 *
 * A weight of zero always receives zero — a bucket holding no units
 * never picks up a phantom kobo of stock.
 */
function allocate(total: number, weights: number[]): number[] {
  const totalWeight = weights.reduce((s, w) => s + w, 0);
  if (totalWeight === 0) return weights.map(() => 0);
  const exact = weights.map((w) => (total * w) / totalWeight);
  const parts = exact.map(Math.floor);
  let leftover = total - parts.reduce((s, p) => s + p, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r);
  for (let k = 0; k < byRemainder.length && leftover > 0; k++) {
    parts[byRemainder[k].i] += 1;
    leftover -= 1;
  }
  return parts;
}

/**
 * Declared products, plus any product a month row references but the
 * cycle never declared. Including the stragglers keeps their value
 * inside the books — silently dropping a row would break the invariant.
 * validateCycle() flags them.
 */
function resolveProducts(input: CycleInput): ProductRef[] {
  const out: ProductRef[] = [];
  const seen = new Set<string>();
  for (const p of input.products ?? []) {
    if (p && !seen.has(p.id)) {
      seen.add(p.id);
      out.push({ id: p.id, name: p.name });
    }
  }
  for (const m of input.months ?? []) {
    for (const r of m?.rows ?? []) {
      if (r && !seen.has(r.productId)) {
        seen.add(r.productId);
        out.push({ id: r.productId, name: r.productId });
      }
    }
  }
  return out;
}

/**
 * One row per product per month. Two rows for the same product in the
 * same month are merged (cost and selling price weighted by quantity)
 * rather than dropped, so no value escapes the books.
 */
function mergeRows(rows: MonthRowInput[]): Map<string, MonthRowInput> {
  const byId = new Map<string, MonthRowInput>();
  for (const r of rows ?? []) {
    if (!r) continue;
    const prev = byId.get(r.productId);
    if (!prev) {
      byId.set(r.productId, { ...r });
      continue;
    }
    const qtyA = int(prev.qty);
    const qtyB = int(r.qty);
    const soldA = int(prev.soldQty);
    const soldB = int(r.soldQty);
    const qty = qtyA + qtyB;
    const soldQty = soldA + soldB;
    const entered = r.stockLeft ?? prev.stockLeft;
    byId.set(r.productId, {
      productId: r.productId,
      qty,
      unitCost:
        qty > 0
          ? Math.round(
              (qtyA * num(prev.unitCost) + qtyB * num(r.unitCost)) / qty
            )
          : int(r.unitCost),
      soldQty,
      sellPrice:
        soldQty > 0
          ? Math.round(
              (soldA * num(prev.sellPrice) + soldB * num(r.sellPrice)) / soldQty
            )
          : int(r.sellPrice),
      stockLeft: entered ?? null,
    });
  }
  return byId;
}

export function compute(input: CycleInput): CycleResult {
  const slotPrice = int(input.slotPrice);
  // Slots are NOT whole numbers. The portal has held half slots since
  // migration 004 and investments.units is NUMERIC(12,2).
  const slots = Math.max(0, num(input.slots));
  const capital = Math.round(slotPrice * slots);
  const invRatio = num(input.ratio) / 100;
  const whtRate = num(input.wht) / 100;
  const withdraw = Math.min(slots, Math.max(0, num(input.withdrawSlots)));

  const products = resolveProducts(input);
  // Each product carries its own stock and its own cost price forward
  const carry = new Map<string, { units: number; value: number }>();
  products.forEach((p) => carry.set(p.id, { units: 0, value: 0 }));

  let cash = 0;
  const months: MonthResult[] = [];

  for (let k = 0; k < 3; k++) {
    const m = input.months[k];
    const entered = mergeRows(m?.rows ?? []);
    const oCash = cash;
    const fundsIn = k === 0 ? capital : 0;
    const openTotal = oCash + fundsIn;

    const rows: RowResult[] = products.map((p) => {
      const state = carry.get(p.id)!;
      const raw = entered.get(p.id);
      const openUnits = state.units;
      const openValue = state.value;

      const qty = int(raw?.qty ?? 0);
      const unitCost = int(raw?.unitCost ?? 0);
      const spend = qty * unitCost;
      const availUnits = openUnits + qty;
      const availValue = openValue + spend;
      // WEIGHTED AVERAGE cost for THIS product only — exact, unrounded
      const unitCP = availUnits > 0 ? availValue / availUnits : 0;

      const soldQty = int(raw?.soldQty ?? 0);
      const sellPrice = int(raw?.sellPrice ?? 0);
      const revenue = soldQty * sellPrice;

      const expectedLeft = availUnits - soldQty;
      const typed = raw?.stockLeft;
      const hasTyped = typed !== undefined && typed !== null;
      const closeUnits = hasTyped ? int(typed) : expectedLeft;
      const lostUnits = expectedLeft - closeUnits;

      // The stock's value splits three ways and must add back exactly:
      // what was sold, what went missing, what is still on the shelf.
      // Unaccounted units are charged AT THAT PRODUCT'S COST; closing
      // stock is valued at COST, never at selling price.
      const [cogs, lostValue, closeValue] = allocate(availValue, [
        soldQty,
        lostUnits,
        closeUnits,
      ]);

      state.units = closeUnits;
      state.value = closeValue;

      return {
        productId: p.id,
        productName: p.name,
        openUnits,
        openValue,
        qty,
        unitCost,
        spend,
        availUnits,
        availValue,
        unitCP,
        soldQty,
        sellPrice,
        revenue,
        cogs,
        expectedLeft,
        closeUnits,
        closeValue,
        lostUnits,
        lostValue,
        gross: revenue - cogs,
        oversold: soldQty > availUnits,
        adjusted: hasTyped && closeUnits !== expectedLeft,
        implicit: raw === undefined,
      };
    });

    const rowSum = (f: keyof RowResult): number =>
      rows.reduce((s, r) => s + (r[f] as number), 0);

    const revenue = rowSum("revenue");
    const cogs = rowSum("cogs");
    const lostValue = rowSum("lostValue");
    const spend = rowSum("spend");
    const stockValue = rowSum("closeValue");

    const ads = int(m?.ads);
    const logistics = int(m?.logistics);
    const misc = int(m?.misc);
    const bankCharges = int(m?.bankCharges);
    const sellExp = ads + logistics + misc + bankCharges;

    // Gross excludes selling expenses; net is what holders share
    const gross = revenue - cogs;
    const net = gross - sellExp - lostValue;
    cash = openTotal + revenue - spend - sellExp;

    months.push({
      i: k + 1,
      rows,
      fundsIn,
      openCash: oCash,
      openTotal,
      openUnits: rowSum("openUnits"),
      openValue: rowSum("openValue"),
      revenue,
      cogs,
      spend,
      lostValue,
      lostUnits: rowSum("lostUnits"),
      ads,
      logistics,
      misc,
      bankCharges,
      sellExp,
      gross,
      net,
      cash,
      unitsBought: rowSum("qty"),
      unitsSold: rowSum("soldQty"),
      unitsLeft: rowSum("closeUnits"),
      stockValue,
      working: cash + stockValue,
    });
  }

  const sum = (f: keyof MonthResult): number =>
    months.reduce((s, m) => s + (m[f] as number), 0);

  // Per-product cycle summary — ADMIN ONLY. Never reaches an investor.
  const summary: ProductSummary[] = products.map((p, idx) => {
    const mine = months.map((m) => m.rows[idx]);
    const s = (f: keyof RowResult): number =>
      mine.reduce((t, r) => t + (r[f] as number), 0);
    const revenue = s("revenue");
    const gross = s("gross");
    const last = mine[mine.length - 1];
    return {
      productId: p.id,
      productName: p.name,
      unitsBought: s("qty"),
      unitsSold: s("soldQty"),
      unitsLeft: last.closeUnits,
      revenue,
      cogs: s("cogs"),
      gross,
      grossMargin: revenue !== 0 ? (gross / revenue) * 100 : 0,
      lostUnits: s("lostUnits"),
      lostValue: s("lostValue"),
      stockValue: last.closeValue,
    };
  });

  const profit = sum("net");
  const isLoss = profit < 0;
  // On a loss the manager's share is ZERO — capital providers bear
  // the financial loss; the manager's loss is unpaid effort.
  // The two pots are split so they add back to the profit exactly.
  const holderPot = isLoss ? profit : Math.round(profit * invRatio);
  const mudaribPot = isLoss ? 0 : profit - holderPot;
  // Per-slot figures are a RATE shown to investors, rounded for
  // display. Individual holders are paid from allocateHolders(),
  // which divides the pot exactly — never slots × a rounded rate.
  const grossPerSlot = slots > 0 ? Math.round(holderPot / slots) : 0;
  const whtPerSlot = grossPerSlot > 0 ? Math.round(grossPerSlot * whtRate) : 0;
  const netPerSlot = grossPerSlot - whtPerSlot;
  const last = months[2];

  return {
    months,
    products: summary,
    slotPrice,
    slots,
    capital,
    withdraw,
    rollover: slots - withdraw,
    profit,
    isLoss,
    holderPot,
    mudaribPot,
    grossPerSlot,
    whtPerSlot,
    netPerSlot,
    whtTotal: whtPerSlot * slots,
    netTotal: netPerSlot * slots,
    slotReturn: slotPrice > 0 ? (netPerSlot / slotPrice) * 100 : 0,
    payoutPerSlot: slotPrice + netPerSlot,
    revenue: sum("revenue"),
    cogsTotal: sum("cogs"),
    sellExpTotal: sum("sellExp"),
    adsTotal: sum("ads"),
    logisticsTotal: sum("logistics"),
    miscTotal: sum("misc"),
    bankTotal: sum("bankCharges"),
    purchTotal: sum("spend"),
    lostTotal: sum("lostValue"),
    unitsSold: sum("unitsSold"),
    unitsBought: sum("unitsBought"),
    unitsLeft: last.unitsLeft,
    endCash: last.cash,
    endStock: last.stockValue,
    endUnits: last.unitsLeft,
    // Every investor is paid their profit, whatever they do with
    // their capital, so the whole investor pot leaves the business —
    // the withheld portion as a remittance rather than to the
    // investor, but it leaves all the same. Capital leaves only for
    // the slots being withdrawn.
    cashNeeded: Math.round(holderPot + withdraw * slotPrice),
    invRatio: num(input.ratio),
  };
}

/* ── Validation ──────────────────────────────────────────────────── */

export type CycleIssue = {
  level: "error" | "warning";
  code:
    | "oversold"
    | "stock_above_expected"
    | "stock_below_expected"
    | "undeclared_product"
    | "negative_cash"
    | "cash_shortfall";
  month: number | null;
  productId: string | null;
  productName: string | null;
  message: string;
};

export function validateCycle(
  input: CycleInput,
  cycle: CycleResult = compute(input)
): CycleIssue[] {
  const issues: CycleIssue[] = [];
  const declared = new Set((input.products ?? []).map((p) => p.id));

  for (const m of cycle.months) {
    for (const r of m.rows) {
      if (r.oversold) {
        issues.push({
          level: "error",
          code: "oversold",
          month: m.i,
          productId: r.productId,
          productName: r.productName,
          message: `Month ${m.i}: ${r.soldQty} ${r.productName} sold, but only ${r.availUnits} were available.`,
        });
      }
      if (r.lostUnits < 0) {
        issues.push({
          level: "error",
          code: "stock_above_expected",
          month: m.i,
          productId: r.productId,
          productName: r.productName,
          message: `Month ${m.i}: ${r.closeUnits} ${r.productName} left, but only ${r.expectedLeft} existed. That is more stock than there was.`,
        });
      } else if (r.lostUnits > 0) {
        issues.push({
          level: "warning",
          code: "stock_below_expected",
          month: m.i,
          productId: r.productId,
          productName: r.productName,
          message: `Month ${m.i}: ${r.lostUnits} ${r.productName} unaccounted for — charged as a loss at cost.`,
        });
      }
      if (!declared.has(r.productId)) {
        issues.push({
          level: "error",
          code: "undeclared_product",
          month: m.i,
          productId: r.productId,
          productName: r.productName,
          message: `Month ${m.i} refers to a product that is not on the cycle's product list.`,
        });
      }
    }
    if (m.cash < 0) {
      issues.push({
        level: "error",
        code: "negative_cash",
        month: m.i,
        productId: null,
        productName: null,
        message: `Month ${m.i} ends with negative cash — more was spent than was available.`,
      });
    }
  }

  if (cycle.cashNeeded > cycle.endCash) {
    issues.push({
      level: "error",
      code: "cash_shortfall",
      month: null,
      productId: null,
      productName: null,
      message:
        "Cash needed at payout is more than the cash in hand — stock would have to be sold to settle.",
    });
  }

  return issues;
}

/* ── Investor-facing view ────────────────────────────────────────── */

/**
 * The ONLY shape investor-facing renderers may consume.
 *
 * Business confidentiality: the investor report must never break
 * figures down by product. No product names, no per-product
 * quantities, no per-product revenue, and no unit cost anywhere.
 * Totals only. Never divide cost of purchase by quantity — in any
 * label, caption or tooltip.
 *
 * This type carries no product-shaped field, so a per-product figure
 * cannot reach the investor template by accident.
 */
export type InvestorMonthView = {
  i: number;
  revenue: number;
  purchaseCost: number;
  expenses: number;
  gross: number;
  net: number;
  unitsBought: number;
  unitsSold: number;
  unitsLeft: number;
};

export type InvestorCycleView = {
  months: InvestorMonthView[];
  slotPrice: number;
  slots: number;
  capital: number;
  profit: number;
  isLoss: boolean;
  holderPot: number;
  mudaribPot: number;
  grossPerSlot: number;
  whtPerSlot: number;
  netPerSlot: number;
  slotReturn: number;
  payoutPerSlot: number;
  revenue: number;
  purchaseCost: number;
  expensesTotal: number;
  unitsBought: number;
  unitsSold: number;
  unitsLeft: number;
  invRatio: number;
};

export function investorView(cycle: CycleResult): InvestorCycleView {
  return {
    months: cycle.months.map((m) => ({
      i: m.i,
      revenue: m.revenue,
      purchaseCost: m.spend,
      expenses: m.sellExp,
      gross: m.gross,
      net: m.net,
      unitsBought: m.unitsBought,
      unitsSold: m.unitsSold,
      unitsLeft: m.unitsLeft,
    })),
    slotPrice: cycle.slotPrice,
    slots: cycle.slots,
    capital: cycle.capital,
    profit: cycle.profit,
    isLoss: cycle.isLoss,
    holderPot: cycle.holderPot,
    mudaribPot: cycle.mudaribPot,
    grossPerSlot: cycle.grossPerSlot,
    whtPerSlot: cycle.whtPerSlot,
    netPerSlot: cycle.netPerSlot,
    slotReturn: cycle.slotReturn,
    payoutPerSlot: cycle.payoutPerSlot,
    revenue: cycle.revenue,
    purchaseCost: cycle.purchTotal,
    expensesTotal: cycle.sellExpTotal,
    unitsBought: cycle.unitsBought,
    unitsSold: cycle.unitsSold,
    unitsLeft: cycle.unitsLeft,
    invRatio: cycle.invRatio,
  };
}

/* ── Per-holder allocation ───────────────────────────────────────── */

export type HolderInput = {
  investmentId: string;
  investorId: string;
  /** May be a half slot — investments.units is NUMERIC(12,2) */
  units: number;
  /** Capital only: profit is ALWAYS paid out */
  capitalAction: "withdraw" | "rollover" | "partial";
  slotsWithdrawn: number;
};

export type HolderAllocation = {
  investmentId: string;
  investorId: string;
  units: number;
  capital: number;
  grossProfit: number;
  wht: number;
  netProfit: number;
  capitalAction: "withdraw" | "rollover" | "partial";
  slotsWithdrawn: number;
  capitalWithdrawn: number;
  /** What actually moves: profit always, plus withdrawn capital */
  amountPaid: number;
};

/**
 * Divide the investor pot across holders EXACTLY.
 *
 * With fractional units and integer kobo, `round(perSlot × units)` per
 * holder does not add back to the pot. The residual is a few kobo, and
 * it has to go somewhere deliberate rather than falling out of a
 * floating-point comparison. Largest remainder: each holder takes the
 * floor of their exact share, then the leftover kobo go one at a time
 * to the largest fractional remainders. Nobody is systematically
 * shortchanged and the total is exact.
 *
 * This mirrors declare_cycle_profit in migration 018 — the same method
 * on both sides, so the report and the portal cannot disagree.
 *
 * Tax is computed on each holder's ALLOCATED gross, not on the pot
 * before allocation, so the amount remitted for an investor matches
 * the amount on their statement.
 */
/**
 * The allocation itself, with NO final check.
 *
 * The settlement preview has to be able to display an allocation that
 * does not add up — an assertion the administrator can see failing is
 * worth far more than a stack trace. Everything that commits goes
 * through allocateHolders() below, which refuses to return at all
 * unless the total is exact.
 */
export function allocateHoldersUnchecked(
  cycle: CycleResult,
  holders: HolderInput[],
  whtRate = cycle.slots > 0 && cycle.grossPerSlot > 0
    ? cycle.whtPerSlot / cycle.grossPerSlot
    : 0
): HolderAllocation[] {
  const totalUnits = holders.reduce((s, h) => s + num(h.units), 0);
  const pot = cycle.holderPot;

  if (holders.length === 0) return [];

  const exact = holders.map((h) =>
    totalUnits > 0 ? (pot * num(h.units)) / totalUnits : 0
  );
  const gross = exact.map(Math.floor);
  let leftover = pot - gross.reduce((s, g) => s + g, 0);
  const byRemainder = exact
    .map((e, i) => ({ i, r: e - Math.floor(e) }))
    .sort((a, b) => b.r - a.r);
  for (let k = 0; k < byRemainder.length && leftover > 0; k++) {
    gross[byRemainder[k].i] += 1;
    leftover -= 1;
  }

  const out = holders.map((h, i) => {
    const g = gross[i];
    const wht = g > 0 ? Math.round(g * whtRate) : 0;
    const net = g - wht;
    const capital = Math.round(num(h.units) * cycle.slotPrice);
    const capitalWithdrawn = Math.round(num(h.slotsWithdrawn) * cycle.slotPrice);
    return {
      investmentId: h.investmentId,
      investorId: h.investorId,
      units: num(h.units),
      capital,
      grossProfit: g,
      wht,
      netProfit: net,
      capitalAction: h.capitalAction,
      slotsWithdrawn: num(h.slotsWithdrawn),
      capitalWithdrawn,
      // Profit is paid whatever they decide about capital
      amountPaid: net + capitalWithdrawn,
    };
  });

  return out;
}

/**
 * The allocation, checked. Nothing may be written from an allocation
 * that does not add up to the pot exactly, in kobo — that is a defect,
 * not a rounding difference to be absorbed.
 */
export function allocateHolders(
  cycle: CycleResult,
  holders: HolderInput[],
  whtRate = cycle.slots > 0 && cycle.grossPerSlot > 0
    ? cycle.whtPerSlot / cycle.grossPerSlot
    : 0
): HolderAllocation[] {
  const out = allocateHoldersUnchecked(cycle, holders, whtRate);
  const sum = out.reduce((s, h) => s + h.grossProfit, 0);
  if (out.length > 0 && sum !== cycle.holderPot) {
    throw new Error(
      `Holder allocation does not add up: holders total ${sum} kobo, investor pot is ${cycle.holderPot} kobo`
    );
  }
  return out;
}

/** Per-holder figures — derived, never stored */
export function holderFigures(
  cycle: CycleResult,
  holding: { slots: number }
): { theirCapital: number; theirProfit: number; theirTotal: number } {
  const theirCapital = Math.round(holding.slots * cycle.slotPrice);
  const theirProfit = Math.round(holding.slots * cycle.netPerSlot);
  return { theirCapital, theirProfit, theirTotal: theirCapital + theirProfit };
}
