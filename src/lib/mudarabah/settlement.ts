/**
 * Settlement: what will be written, before anything is.
 *
 * Two phases, and this module is the first one. It runs compute(),
 * allocates the pot across holders, and returns everything the commit
 * would write — plus assertions the administrator can watch pass or
 * fail. Nothing here touches the database.
 *
 * THE ASSERTIONS ARE THE POINT. An allocation that does not add up is
 * a defect in this code, not a business decision, so a failing
 * assertion blocks the commit outright. Everything else — cash that
 * does not cover the payout, a missing tax number, an investor who
 * never answered — is a judgement for the administrator, and only
 * warns.
 *
 * All money is integer kobo.
 */

import {
  allocateHoldersUnchecked,
  compute,
  validateCycle,
  type CycleInput,
  type CycleResult,
  type HolderAllocation,
} from "./compute";

/** What an investor decided about their CAPITAL. Profit is never part of it. */
export type CapitalAction = "withdraw" | "rollover" | "partial";

/**
 * One member of the cycle, as the ledger and their maturity
 * instruction leave them.
 */
export type Participant = {
  investmentId: string;
  investorId: string;
  investorName: string;
  investorCode: string;
  units: number;
  /**
   * NULL means no instruction was ever recorded. It stays null all the
   * way here rather than being quietly folded into "rollover" — what
   * to do about it is decided below, in the open.
   */
  decision: CapitalAction | null;
  slotsWithdrawn: number;
  tin: string | null;
};

/** An administrator overriding what happens to one investor's capital */
export type CapitalOverride = {
  investmentId: string;
  action: CapitalAction;
  slotsWithdrawn?: number;
};

export type PreviewHolder = HolderAllocation & {
  investorName: string;
  investorCode: string;
  /**
   * True when nothing was on record and the default was applied. The
   * preview lists these prominently; the administrator can override
   * any of them before committing.
   */
  defaulted: boolean;
  overridden: boolean;
  hasTin: boolean;
};

export type Assertion = {
  name: string;
  passed: boolean;
  detail: string;
};

export type Warning = {
  kind: "no-tin" | "no-decision" | "ledger" | "cash" | "no-wht";
  message: string;
  investors: string[];
};

export type SettlementPreview = {
  cycle: CycleResult;
  holders: PreviewHolder[];

  totals: {
    units: number;
    capital: number;
    gross: number;
    wht: number;
    net: number;
    capitalReturning: number;
    cashNeeded: number;
  };

  endCash: number;
  cashCovers: boolean;
  shortfall: number;

  assertions: Assertion[];
  warnings: Warning[];

  /** Any assertion failed. The commit must refuse. */
  blocked: boolean;
  /** Cash does not cover the payout — allowed, but only knowingly */
  needsAcknowledgement: boolean;
};

/**
 * WHEN NOBODY ANSWERED.
 *
 * An investor with no instruction has their capital CONTINUE into the
 * next cycle. Their profit is paid out either way — that was never
 * conditional on answering.
 *
 * This was the other way round until the portal started asking
 * properly. The reasoning then was that keeping someone's money
 * without their say-so is worse than returning money they would
 * rather have left working. Once the maturity window existed — a
 * dialog on arrival and a banner on two pages for ten days — the
 * population changed. Silence stopped meaning "I could not find the
 * form" and started meaning "I am not paying attention", and those
 * people are overwhelmingly the ones who would have continued.
 *
 * Continuing also asks nothing of anybody. Paying out capital nobody
 * requested moves real money to a bank account on a guess, and
 * unwinding that is worse than the reverse. Someone who wanted their
 * capital and missed the window says so, and is answered by a person.
 *
 * Still shown prominently in the preview, and still overridable
 * before the commit — a default is not a decision.
 */
export const DEFAULT_WHEN_UNDECIDED: CapitalAction = "rollover";

function resolve(
  p: Participant,
  override?: CapitalOverride
): { action: CapitalAction; slotsWithdrawn: number; defaulted: boolean; overridden: boolean } {
  if (override) {
    const slots =
      override.action === "withdraw"
        ? p.units
        : override.action === "rollover"
        ? 0
        : Math.max(0, Math.min(p.units, Number(override.slotsWithdrawn ?? 0)));
    return { action: override.action, slotsWithdrawn: slots, defaulted: false, overridden: true };
  }

  if (p.decision === null) {
    return {
      action: DEFAULT_WHEN_UNDECIDED,
      slotsWithdrawn: DEFAULT_WHEN_UNDECIDED === "withdraw" ? p.units : 0,
      defaulted: true,
      overridden: false,
    };
  }

  const slots =
    p.decision === "withdraw"
      ? p.units
      : p.decision === "rollover"
      ? 0
      : Math.max(0, Math.min(p.units, Number(p.slotsWithdrawn ?? 0)));
  return { action: p.decision, slotsWithdrawn: slots, defaulted: false, overridden: false };
}

const names = (hs: { investorName: string }[]) => hs.map((h) => h.investorName);

export function settlementPreview(
  input: CycleInput,
  participants: Participant[],
  overrides: CapitalOverride[] = []
): SettlementPreview {
  const cycle = compute(input);
  const byInvestment = new Map(overrides.map((o) => [o.investmentId, o]));

  const resolved = participants.map((p) => ({
    p,
    r: resolve(p, byInvestment.get(p.investmentId)),
  }));

  const whtRate =
    cycle.grossPerSlot > 0 ? cycle.whtPerSlot / cycle.grossPerSlot : 0;

  // UNCHECKED on purpose: a preview that throws cannot show the
  // administrator which assertion failed.
  const allocation = allocateHoldersUnchecked(
    cycle,
    resolved.map(({ p, r }) => ({
      investmentId: p.investmentId,
      investorId: p.investorId,
      units: p.units,
      capitalAction: r.action,
      slotsWithdrawn: r.slotsWithdrawn,
    })),
    whtRate
  );

  const holders: PreviewHolder[] = allocation.map((a, i) => ({
    ...a,
    investorName: resolved[i].p.investorName,
    investorCode: resolved[i].p.investorCode,
    defaulted: resolved[i].r.defaulted,
    overridden: resolved[i].r.overridden,
    hasTin: Boolean(resolved[i].p.tin && resolved[i].p.tin.trim()),
  }));

  const sum = (pick: (h: PreviewHolder) => number) =>
    holders.reduce((t, h) => t + pick(h), 0);

  const totals = {
    units: sum((h) => h.units),
    capital: sum((h) => h.capital),
    gross: sum((h) => h.grossProfit),
    wht: sum((h) => h.wht),
    net: sum((h) => h.netProfit),
    capitalReturning: sum((h) => h.capitalWithdrawn),
    cashNeeded: sum((h) => h.amountPaid),
  };

  /* ── The assertions ──────────────────────────────────────────── */

  const unitsMatch = Math.abs(totals.units - cycle.slots) < 1e-9;
  const assertions: Assertion[] = [
    {
      name: "Allocated profit adds up to the investors' share, to the kobo",
      passed: holders.length === 0 || totals.gross === cycle.holderPot,
      detail: `allocated ${totals.gross} kobo · investors' share ${cycle.holderPot} kobo`,
    },
    {
      name: "Net profit plus tax withheld adds up to the investors' share",
      passed: holders.length === 0 || totals.net + totals.wht === cycle.holderPot,
      detail: `net ${totals.net} + withheld ${totals.wht} = ${
        totals.net + totals.wht
      } kobo · investors' share ${cycle.holderPot} kobo`,
    },
    {
      name: "Slots held add up to the slots in the cycle",
      passed: unitsMatch,
      detail: `holders ${totals.units} · cycle ${cycle.slots}`,
    },
  ];

  /* ── The warnings ────────────────────────────────────────────── */

  const warnings: Warning[] = [];

  const undecided = holders.filter((h) => h.defaulted);
  if (undecided.length > 0) {
    warnings.push({
      kind: "no-decision",
      message: `${undecided.length} investor${
        undecided.length === 1 ? " has" : "s have"
      } no capital instruction on record. Their capital will CONTINUE into the next cycle and their profit will be paid out, unless you change it below.`,
      investors: names(undecided),
    });
  }

  /*
   * A cycle that withholds nothing.
   *
   * series.default_wht_rate is zero until somebody sets it, and a rate
   * nobody entered looks exactly like a rate deliberately set to zero.
   * Settling freezes it, so the moment before settling is the last one
   * at which anybody will look. Zero can be right — but it should be
   * chosen, not arrived at.
   */
  if (holders.length > 0 && cycle.holderPot > 0 && totals.wht === 0) {
    warnings.push({
      kind: "no-wht",
      message:
        "No withholding tax will be deducted — the rate on this cycle is 0%. Settling freezes that, and no credit note can be issued for a cycle that withheld nothing. Set the rate on the cycle first if tax is due.",
      investors: [],
    });
  }

  const noTin = holders.filter((h) => h.wht > 0 && !h.hasTin);
  if (noTin.length > 0) {
    warnings.push({
      kind: "no-tin",
      message: `${noTin.length} investor${
        noTin.length === 1 ? " has" : "s have"
      } no tax identification number. Settlement is unaffected; they cannot be issued a credit note until they supply one.`,
      investors: names(noTin),
    });
  }

  const ledger = validateCycle(input);
  const ledgerErrors = ledger.filter((n) => n.level === "error");
  if (ledger.length > 0) {
    warnings.push({
      kind: "ledger",
      message: ledgerErrors.length
        ? `The trading ledger has ${ledgerErrors.length} unresolved error${
            ledgerErrors.length === 1 ? "" : "s"
          }. Settling freezes these figures exactly as they are.`
        : "The trading ledger has outstanding notices.",
      investors: ledger.map((n) => `${n.level === "error" ? "Error" : "Notice"}: ${n.message}`),
    });
  }

  const endCash = cycle.endCash;
  const shortfall = Math.max(0, totals.cashNeeded - endCash);
  const cashCovers = shortfall === 0;
  if (!cashCovers) {
    warnings.push({
      kind: "cash",
      message: `Cash at close does not cover the payout. ${shortfall} kobo short.`,
      investors: [],
    });
  }

  return {
    cycle,
    holders,
    totals,
    endCash,
    cashCovers,
    shortfall,
    assertions,
    warnings,
    blocked: assertions.some((a) => !a.passed),
    // Settling on a ledger with unresolved errors freezes those
    // figures for good, which is as consequential as settling short of
    // cash. Both are the administrator's call; neither happens by
    // accident.
    needsAcknowledgement: !cashCovers || ledgerErrors.length > 0,
  };
}

/**
 * The payload the commit sends. Built from the SAME preview the
 * administrator approved — the figures are never derived a second
 * time on the way to the database.
 */
export function settlementPayload(preview: SettlementPreview) {
  return preview.holders.map((h) => ({
    investmentId: h.investmentId,
    investorId: h.investorId,
    units: h.units,
    capital: h.capital,
    grossProfit: h.grossProfit,
    wht: h.wht,
    netProfit: h.netProfit,
    capitalAction: h.capitalAction,
    slotsWithdrawn: h.slotsWithdrawn,
    capitalWithdrawn: h.capitalWithdrawn,
    amountPaid: h.amountPaid,
    amountPaidNote: h.defaulted
      ? "No maturity instruction on record — capital continued by default; profit paid"
      : null,
  }));
}
