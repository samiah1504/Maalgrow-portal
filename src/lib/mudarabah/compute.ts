/**
 * Mudarabah cycle engine — THE single source of truth for every
 * calculation in the Mudarabah cycle feature.
 *
 * This module is a faithful port of the compute() engine in
 * reference/mudarabah-report-v4.html (the working, tested reference
 * implementation). Every rule below is a correctness requirement:
 *
 *  • Purchase logistics are CAPITALISED into the cost of goods and
 *    spread across units. Selling-side logistics is an expense.
 *  • WEIGHTED AVERAGE cost: stock carried in blends with new stock
 *    into one cost price. No batch tracking.
 *  • Closing stock is valued at COST, never at expected selling
 *    price (valuing at selling price books profit before the sale).
 *  • On a loss the manager's share is ZERO — not reduced, zero.
 *    Capital providers bear the financial loss; the manager's loss
 *    is unpaid effort.
 *  • Gross profit excludes selling expenses. Only net profit is
 *    ever shown to investors.
 *
 * Invariant (holds by construction; tested on random inputs):
 *   endCash + endStockValue === totalCapital + totalProfit
 *
 * Import this module from EVERY path that needs cycle figures —
 * browser, server renderer, email job, balance updater. Store only
 * inputs; derive on read. Never persist profit, ROI or unit cost.
 */

export type MonthInput = {
  /** Quantity purchased */
  qty: number;
  /** Cost of each product */
  unitCost: number;
  /** Purchase expenses (delivery in) — capitalised */
  purchExp: number;
  /** Number of products sold */
  soldQty: number;
  /** Selling price per product */
  sellPrice: number;
  ads: number;
  logi: number;
  misc: number;
  bank: number;
  /** Units left unsold at month end (entered, not derived) */
  stockLeft: number;
};

export type CycleInput = {
  slotPrice: number;
  slots: number;
  /** Investor share of profit, 0–100 */
  ratio: number;
  /** Withholding tax percentage, 0–100 */
  wht: number;
  /** Slots withdrawing capital at maturity */
  withdrawSlots: number;
  months: [MonthInput, MonthInput, MonthInput];
};

export type MonthResult = {
  i: number;
  fundsIn: number;
  openCash: number;
  openTotal: number;
  openUnits: number;
  openValue: number;
  qty: number;
  unitCost: number;
  purchExp: number;
  goodsCost: number;
  purchCost: number;
  availUnits: number;
  availValue: number;
  unitCP: number;
  soldQty: number;
  sellPrice: number;
  revenue: number;
  cogs: number;
  ads: number;
  logi: number;
  misc: number;
  bank: number;
  sellExp: number;
  expectClose: number;
  closeUnits: number;
  closeValue: number;
  lostUnits: number;
  lostValue: number;
  gross: number;
  net: number;
  cash: number;
  working: number;
  oversold: boolean;
};

export type CycleResult = {
  months: MonthResult[];
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
  logiTotal: number;
  miscTotal: number;
  bankTotal: number;
  purchTotal: number;
  lostTotal: number;
  unitsSold: number;
  unitsBought: number;
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

export function compute(input: CycleInput): CycleResult {
  const slotPrice = num(input.slotPrice);
  const slots = Math.max(0, int(input.slots));
  const capital = slotPrice * slots;
  const invRatio = num(input.ratio) / 100;
  const whtRate = num(input.wht) / 100;
  const withdraw = Math.min(slots, Math.max(0, int(input.withdrawSlots)));

  let cash = 0;
  let openUnits = 0;
  let openValue = 0;
  const months: MonthResult[] = [];

  for (let k = 0; k < 3; k++) {
    const d = input.months[k];
    const oCash = cash;
    const oUnits = openUnits;
    const oValue = openValue;
    const fundsIn = k === 0 ? capital : 0;
    const openTotal = oCash + fundsIn;

    const qty = int(d.qty);
    const unitCost = num(d.unitCost);
    const purchExp = num(d.purchExp);
    // Purchase logistics CAPITALISED into the cost of the goods
    const goodsCost = qty * unitCost;
    const purchCost = goodsCost + purchExp;
    const availUnits = oUnits + qty;
    const availValue = oValue + purchCost;
    // WEIGHTED AVERAGE cost across carried-in and new stock
    const unitCP = availUnits > 0 ? availValue / availUnits : 0;

    const soldQty = int(d.soldQty);
    const sellPrice = num(d.sellPrice);
    const revenue = soldQty * sellPrice;
    const cogs = soldQty * unitCP;

    const ads = num(d.ads);
    const logi = num(d.logi);
    const misc = num(d.misc);
    const bank = num(d.bank);
    const sellExp = ads + logi + misc + bank;

    const expectClose = availUnits - soldQty;
    const closeUnits = int(d.stockLeft); // entered by admin
    const lostUnits = expectClose - closeUnits;
    // Unaccounted units are charged as a loss AT COST
    const lostValue = lostUnits * unitCP;
    // Closing stock valued at COST, never at selling price
    const closeValue = closeUnits * unitCP;

    // Gross excludes selling expenses; net is what holders share
    const gross = revenue - cogs;
    const net = gross - sellExp - lostValue;
    cash = openTotal + revenue - (goodsCost + purchExp + sellExp);
    openUnits = closeUnits;
    openValue = closeValue;

    months.push({
      i: k + 1,
      fundsIn,
      openCash: oCash,
      openTotal,
      openUnits: oUnits,
      openValue: oValue,
      qty,
      unitCost,
      purchExp,
      goodsCost,
      purchCost,
      availUnits,
      availValue,
      unitCP,
      soldQty,
      sellPrice,
      revenue,
      cogs,
      ads,
      logi,
      misc,
      bank,
      sellExp,
      expectClose,
      closeUnits,
      closeValue,
      lostUnits,
      lostValue,
      gross,
      net,
      cash,
      working: cash + closeValue,
      oversold: soldQty > availUnits,
    });
  }

  const sum = (f: keyof MonthResult): number =>
    months.reduce((s, m) => s + (m[f] as number), 0);

  const profit = sum("net");
  const isLoss = profit < 0;
  // On a loss the manager's share is ZERO — capital providers bear
  // the financial loss; the manager's loss is unpaid effort.
  const holderPot = isLoss ? profit : profit * invRatio;
  const mudaribPot = isLoss ? 0 : profit * (1 - invRatio);
  const grossPerSlot = slots > 0 ? holderPot / slots : 0;
  const whtPerSlot = grossPerSlot > 0 ? grossPerSlot * whtRate : 0;
  const netPerSlot = grossPerSlot - whtPerSlot;

  return {
    months,
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
    logiTotal: sum("logi"),
    miscTotal: sum("misc"),
    bankTotal: sum("bank"),
    purchTotal: sum("purchCost"),
    lostTotal: sum("lostValue"),
    unitsSold: sum("soldQty"),
    unitsBought: sum("qty"),
    endCash: months[2].cash,
    endStock: months[2].closeValue,
    endUnits: months[2].closeUnits,
    cashNeeded: netPerSlot * slots + withdraw * slotPrice,
    invRatio: num(input.ratio),
  };
}

/** Per-holder figures — derived, never stored */
export function holderFigures(
  cycle: CycleResult,
  holding: { slots: number }
): { theirCapital: number; theirProfit: number; theirTotal: number } {
  const theirCapital = holding.slots * cycle.slotPrice;
  const theirProfit = holding.slots * cycle.netPerSlot;
  return { theirCapital, theirProfit, theirTotal: theirCapital + theirProfit };
}
