/**
 * The admin cycle-entry page's logic, kept out of the component so it
 * can be tested without a browser.
 *
 * The draft holds what the admin typed — strings, because a field
 * being empty is different from it being zero. toCycleInput() turns a
 * draft into the shared engine's input (integer kobo), and every
 * computed figure on the page comes back through compute().
 *
 * Nothing here calculates money. It maps, validates and phrases.
 */

import {
  compute,
  validateCycle,
  type CycleInput,
  type CycleIssue,
  type CycleResult,
  type MonthInput,
  type MonthRowInput,
} from "./compute";
import { naira, parseCount, parseNairaToKobo } from "./format";

export type DraftRow = {
  productId: string;
  /** Cost of each, as typed in naira */
  unitCost: string;
  /** How many we got */
  qty: string;
  /** How many sold */
  soldQty: string;
  /** Selling price, as typed in naira */
  sellPrice: string;
  /**
   * Units left. Empty means "use the derived figure" — the page shows
   * the expectation and only records an override when it is typed over.
   */
  stockLeft: string;
};

export type DraftMonth = {
  rows: Record<string, DraftRow>;
  ads: string;
  logistics: string;
  misc: string;
  bankCharges: string;
};

export type DraftProduct = { id: string; name: string };

/**
 * What the admin types. The slot value, the number of slots, the
 * ratio, the withholding rate, the dates and the investor list are NOT
 * here — they live on the existing cycle, series and investments, and
 * arrive as CycleTerms.
 */
export type Draft = {
  cycleId: string;
  description: string;
  status: "draft" | "active" | "settled";
  discloseMode: "full" | "perSlot";
  products: DraftProduct[];
  months: [DraftMonth, DraftMonth, DraftMonth];
};

/** One member of the cycle, read from investments — never typed here */
export type CycleHolder = {
  investmentId: string;
  investorId: string;
  investorName: string;
  investorCode: string;
  /** For the settlement preview's "who has no tax number" warning */
  investorTin: string | null;
  units: number;
  /**
   * NULL when no maturity instruction was ever recorded. Deliberately
   * not folded into "rollover": someone who never answered is not
   * someone who chose to leave their capital in, and settlement has to
   * be able to tell them apart.
   */
  capitalAction: "withdraw" | "rollover" | "partial" | null;
  slotsWithdrawn: number;
};

/**
 * Everything the ledger reads from the EXISTING records. Read-only on
 * this page except the ratio and withholding rate, and those only
 * while subscriptions are still open.
 */
export type CycleTerms = {
  cycleId: string;
  seriesName: string;
  cycleLabel: string;
  cycleStatus: string;
  startDate: string;
  endDate: string;
  termsLocked: boolean;
  /** Kobo */
  unitValue: number;
  /** Slot holders' share, 0–1 as stored on the cycle or series */
  ratio: number;
  /** 0–1 */
  whtRate: number;
  /** Sum of units over active investments — may be fractional */
  totalUnits: number;
  /** cycles.total_slots, kept separately so a mismatch is visible */
  cycleTotalSlots: number;
  /** Kobo: units × unit value, the capital actually pooled */
  pooledCapital: number;
  /** Kobo */
  amountReceived: number;
  totalCapital: number;
  withdrawSlots: number;
  holders: CycleHolder[];
  /**
   * Enrolments in this cycle whose slots and confirmed payments do not
   * agree, worst first. Kobo. Empty on a healthy cycle, and empty on a
   * database that has not yet run migration 024.
   */
  fundingGaps: FundingGap[];
};

/** One investor whose slots and money are out of step. Kobo. */
export type FundingGap = {
  investmentId: string;
  investorName: string;
  investorCode: string;
  units: number;
  capital: number;
  confirmedPaid: number;
  /** Positive: slots not paid for. Negative: money not credited. */
  gap: number;
};

export function emptyRow(productId: string): DraftRow {
  return { productId, unitCost: "", qty: "", soldQty: "", sellPrice: "", stockLeft: "" };
}

export function emptyMonth(): DraftMonth {
  return { rows: {}, ads: "", logistics: "", misc: "", bankCharges: "" };
}

export function emptyDraft(cycleId: string): Draft {
  return {
    cycleId,
    description: "",
    status: "draft",
    discloseMode: "perSlot",
    products: [],
    months: [emptyMonth(), emptyMonth(), emptyMonth()],
  };
}

const kobo = (s: string): number => parseNairaToKobo(s) ?? 0;
const count = (s: string): number => parseCount(s) ?? 0;

export function toCycleInput(draft: Draft, terms: CycleTerms): CycleInput {
  const months = draft.months.map((m): MonthInput => ({
    rows: draft.products.map((p): MonthRowInput => {
      const r = m.rows[p.id] ?? emptyRow(p.id);
      const typed = parseCount(r.stockLeft);
      return {
        productId: p.id,
        qty: count(r.qty),
        unitCost: kobo(r.unitCost),
        soldQty: count(r.soldQty),
        sellPrice: kobo(r.sellPrice),
        // Empty means "use the derived figure"
        stockLeft: r.stockLeft.trim() === "" ? null : typed,
      };
    }),
    ads: kobo(m.ads),
    logistics: kobo(m.logistics),
    misc: kobo(m.misc),
    bankCharges: kobo(m.bankCharges),
  })) as [MonthInput, MonthInput, MonthInput];

  return {
    name: terms.cycleLabel,
    startDate: terms.startDate,
    currency: "₦",
    // From the existing cycle and series, never typed on this page
    slotPrice: terms.unitValue,
    slots: terms.totalUnits,
    ratio: terms.ratio * 100,
    wht: terms.whtRate * 100,
    withdrawSlots: terms.withdrawSlots,
    products: draft.products.map((p) => ({ id: p.id, name: p.name })),
    months,
  };
}

/** The payload the save endpoint takes — inputs only, money in kobo */
export function toSavePayload(draft: Draft, terms: CycleTerms): Record<string, unknown> {
  const input = toCycleInput(draft, terms);
  return {
    cycleId: draft.cycleId,
    description: draft.description,
    status: draft.status,
    discloseMode: draft.discloseMode,
    products: input.products,
    months: input.months.map((m) => ({
      ads: m.ads,
      logistics: m.logistics,
      misc: m.misc,
      bankCharges: m.bankCharges,
      rows: m.rows.map((r) => ({
        productId: r.productId,
        qty: r.qty,
        unitCost: r.unitCost,
        soldQty: r.soldQty,
        sellPrice: r.sellPrice,
        stockLeft: r.stockLeft ?? 0,
      })),
    })),
  };
}

/** The shape mudarabah_get_ledger returns */
export type LedgerPayload = {
  cycleId: string;
  hasLedger: boolean;
  seriesName: string;
  cycleLabel: string;
  cycleStatus: string;
  startDate: string;
  endDate: string;
  termsLocked: boolean;
  unitValue: number;
  ratio: number;
  whtRate: number;
  totalUnits: number;
  cycleTotalSlots: number;
  pooledCapital: number;
  amountReceived: number;
  totalCapital: number;
  withdrawSlots: number;
  description: string | null;
  discloseMode: string;
  status: string;
  products: { id: string; name: string }[];
  months: {
    ads: number;
    logistics: number;
    misc: number;
    bankCharges: number;
    rows: {
      productId: string;
      qty: number;
      unitCost: number;
      soldQty: number;
      sellPrice: number;
      stockLeft: number;
    }[];
  }[];
  holders: {
    investmentId: string;
    investorId: string;
    investorName: string;
    investorCode: string;
    units: number;
    capitalAction: string | null;
    investorTin: string | null;
    slotsWithdrawn: number;
  }[];
  /**
   * Migration 024. Absent on a database that has not run it yet — the
   * page must render either way, so this is optional and defaults to
   * empty rather than being assumed present.
   */
  fundingGaps?: {
    investmentId: string;
    investorName: string;
    investorCode: string;
    units: number;
    capital: number;
    confirmedPaid: number;
    gap: number;
  }[];
};

/** Naira from the portal's own columns into the ledger's kobo */
const toKobo = (naira: number) => Math.round(Number(naira ?? 0) * 100);

export function termsFromLedger(p: LedgerPayload): CycleTerms {
  return {
    cycleId: p.cycleId,
    seriesName: p.seriesName,
    cycleLabel: p.cycleLabel,
    cycleStatus: p.cycleStatus,
    startDate: p.startDate,
    endDate: p.endDate,
    termsLocked: p.termsLocked,
    unitValue: toKobo(p.unitValue),
    ratio: Number(p.ratio ?? 0),
    whtRate: Number(p.whtRate ?? 0),
    totalUnits: Number(p.totalUnits ?? 0),
    cycleTotalSlots: Number(p.cycleTotalSlots ?? 0),
    pooledCapital: toKobo(p.pooledCapital),
    amountReceived: toKobo(p.amountReceived),
    totalCapital: toKobo(p.totalCapital),
    withdrawSlots: Number(p.withdrawSlots ?? 0),
    fundingGaps: (p.fundingGaps ?? []).map((g) => ({
      investmentId: g.investmentId,
      investorName: g.investorName,
      investorCode: g.investorCode,
      units: Number(g.units ?? 0),
      capital: toKobo(g.capital),
      confirmedPaid: toKobo(g.confirmedPaid),
      gap: toKobo(g.gap),
    })),
    holders: (p.holders ?? []).map((h) => ({
      investmentId: h.investmentId,
      investorId: h.investorId,
      investorName: h.investorName,
      investorCode: h.investorCode,
      units: Number(h.units),
      investorTin: h.investorTin ?? null,
      capitalAction:
        h.capitalAction === "withdraw"
          ? "withdraw"
          : h.capitalAction === "partial"
          ? "partial"
          : h.capitalAction === "rollover"
          ? "rollover"
          : null,
      slotsWithdrawn: Number(h.slotsWithdrawn ?? 0),
    })),
  };
}

export function draftFromLedger(p: LedgerPayload): Draft {
  const asNaira = (k: number) => (k === 0 ? "" : String(k / 100));
  const asCount = (n: number) => (n === 0 ? "" : String(n));

  const months = [0, 1, 2].map((i): DraftMonth => {
    const m = p.months?.[i];
    if (!m) return emptyMonth();
    const rows: Record<string, DraftRow> = {};
    for (const r of m.rows ?? []) {
      rows[r.productId] = {
        productId: r.productId,
        qty: asCount(r.qty),
        unitCost: asNaira(r.unitCost),
        soldQty: asCount(r.soldQty),
        sellPrice: asNaira(r.sellPrice),
        // Stored either way, so history cannot shift under a later change
        stockLeft: String(r.stockLeft),
      };
    }
    return {
      rows,
      ads: asNaira(m.ads),
      logistics: asNaira(m.logistics),
      misc: asNaira(m.misc),
      bankCharges: asNaira(m.bankCharges),
    };
  }) as [DraftMonth, DraftMonth, DraftMonth];

  return {
    cycleId: p.cycleId,
    description: p.description ?? "",
    status: (["draft", "active", "settled"].includes(p.status)
      ? p.status
      : "draft") as Draft["status"],
    discloseMode: p.discloseMode === "full" ? "full" : "perSlot",
    products: (p.products ?? []).map((x) => ({ id: x.id, name: x.name })),
    months,
  };
}

/* ── What the admin sees when something is off ───────────────────── */

export type Notice = {
  level: "error" | "warning" | "ok";
  /** Where it belongs on the page */
  scope: "row" | "month" | "cycle";
  month: number | null;
  productId: string | null;
  text: string;
};

/**
 * An error means a figure is WRONG. A warning means the figures are
 * right and reality needs attention. They are phrased differently on
 * purpose — someone reading a warning should know what to do next, not
 * think they mistyped.
 */
export function noticesFor(
  input: CycleInput,
  cycle: CycleResult,
  terms?: CycleTerms
): Notice[] {
  const out: Notice[] = [];
  const symbol = input.currency || "₦";
  const issues: CycleIssue[] = validateCycle(input, cycle);

  for (const issue of issues) {
    if (issue.code === "cash_shortfall" || issue.code === "negative_cash") continue;
    if (issue.code === "undeclared_product") continue;

    if (issue.code === "oversold") {
      const row = findRow(cycle, issue.month!, issue.productId!);
      out.push({
        level: "error",
        scope: "row",
        month: issue.month,
        productId: issue.productId,
        text: `${row?.soldQty ?? 0} sold, but only ${row?.availUnits ?? 0} ${issue.productName} were available this month.`,
      });
    } else if (issue.code === "stock_above_expected") {
      const row = findRow(cycle, issue.month!, issue.productId!);
      out.push({
        level: "error",
        scope: "row",
        month: issue.month,
        productId: issue.productId,
        text: `${row?.closeUnits ?? 0} left is more ${issue.productName} than existed — ${row?.expectedLeft ?? 0} were available after sales.`,
      });
    } else if (issue.code === "stock_below_expected") {
      const row = findRow(cycle, issue.month!, issue.productId!);
      const lost = row?.lostUnits ?? 0;
      out.push({
        level: "warning",
        scope: "row",
        month: issue.month,
        productId: issue.productId,
        text: `${lost} ${issue.productName}${lost === 1 ? "" : "s"} unaccounted for — damage, a return or shrinkage. Charged as a loss of ${naira(row?.lostValue ?? 0, symbol)} at cost.`,
      });
    }
  }

  // Month-level: cash going negative
  for (const m of cycle.months) {
    if (m.cash < 0) {
      out.push({
        level: "error",
        scope: "month",
        month: m.i,
        productId: null,
        text: `Month ${m.i} ends ${naira(Math.abs(m.cash), symbol)} short. That means the month was funded from outside the cycle — record where the money came from rather than absorbing it here.`,
      });
    }
  }

  // Cycle-level: can we actually pay out?
  const shortfall = cycle.cashNeeded - cycle.endCash;
  if (shortfall > 0) {
    out.push({
      level: "warning",
      scope: "cycle",
      month: null,
      productId: null,
      text: `Paying out needs ${naira(shortfall, symbol)} more than the cash in hand, with ${naira(cycle.endStock, symbol)} tied up in ${cycle.endUnits} unsold unit${cycle.endUnits === 1 ? "" : "s"}. Either sell the stock down before the payout date, or ask more holders to roll their capital over.`,
    });
  } else {
    out.push({
      level: "ok",
      scope: "cycle",
      month: null,
      productId: null,
      text: `Cash covers the payout, with ${naira(-shortfall, symbol)} spare.`,
    });
  }

  return out;
}

function findRow(cycle: CycleResult, month: number, productId: string) {
  return cycle.months[month - 1]?.rows.find((r) => r.productId === productId);
}

export function noticesForRow(
  notices: Notice[],
  month: number,
  productId: string
): Notice[] {
  return notices.filter(
    (n) => n.scope === "row" && n.month === month && n.productId === productId
  );
}

export function noticesForMonth(notices: Notice[], month: number): Notice[] {
  return notices.filter((n) => n.scope === "month" && n.month === month);
}

export function cycleNotices(notices: Notice[]): Notice[] {
  return notices.filter((n) => n.scope === "cycle");
}

export function hasErrors(notices: Notice[]): boolean {
  return notices.some((n) => n.level === "error");
}

/* ── Read-only once settled ──────────────────────────────────────── */

/**
 * A settled cycle is not editable here. Correcting one goes through
 * the unsettle action, which asks for a reason and leaves a trail —
 * there is deliberately no inline edit path that bypasses it.
 */
export function isReadOnly(draft: Pick<Draft, "status">): boolean {
  return draft.status === "settled";
}

/** Removing a product that already has figures should warn, not discard */
export function productHasFigures(draft: Draft, productId: string): boolean {
  return draft.months.some((m) => {
    const r = m.rows[productId];
    if (!r) return false;
    return [r.qty, r.unitCost, r.soldQty, r.sellPrice, r.stockLeft].some(
      (v) => v.trim() !== "" && v.trim() !== "0"
    );
  });
}

export function removeProduct(draft: Draft, productId: string): Draft {
  return {
    ...draft,
    products: draft.products.filter((p) => p.id !== productId),
    months: draft.months.map((m) => {
      const rows = { ...m.rows };
      delete rows[productId];
      return { ...m, rows };
    }) as [DraftMonth, DraftMonth, DraftMonth],
  };
}

export function addProduct(draft: Draft, name: string): Draft {
  const base = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  let id = base || "product";
  let n = 2;
  while (draft.products.some((p) => p.id === id)) id = `${base}-${n++}`;
  return { ...draft, products: [...draft.products, { id, name: name.trim() }] };
}

/** Live figures for the page. One call, one source of truth. */
export function draftFigures(
  draft: Draft,
  terms: CycleTerms
): { input: CycleInput; cycle: CycleResult; notices: Notice[] } {
  const input = toCycleInput(draft, terms);
  const cycle = compute(input);
  return { input, cycle, notices: noticesFor(input, cycle, terms) };
}
