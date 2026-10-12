/**
 * MaalRise — the Murabaha terms engine.
 *
 * PURE. No database, no React, no dates beyond what is passed in, so
 * the New Cycle preview, the Cycle details page and (from Phase 2) the
 * figures frozen at approval all come out of the same function.
 *
 * ── MONEY IS KOBO ────────────────────────────────────────────
 *
 * Every amount here is an integer number of kobo and every rate is in
 * basis points (1% = 100 bps). Naira with decimals only exists at the
 * edge, in format.ts. A float that is one kobo out is a reconciliation
 * that never balances, which is the failure this module exists to
 * make impossible.
 *
 * ── WHAT IT DOES NOT ASSUME ──────────────────────────────────
 *
 * The markup and the service fee are separate inputs and are never
 * substituted for one another. The fee's basis (cost, markup or a
 * fixed amount) and its treatment (deducted from investors, charged
 * separately to the counterparty, or waived) both come from the
 * contract — nothing here picks one by default.
 *
 * Still open (Implementation Plan v2, §9) and therefore NOT modelled
 * as fact: A2 (markup quoted flat for the term — the input here is
 * the flat amount for the whole term), A3 (markup paid monthly and
 * cost repaid at maturity), A7 (when within the schedule the fee is
 * taken). The breakdown says so wherever it leans on one of them.
 */

export const ENGINE_VERSION = "maalrise-terms-0.1";

export type MarkupInput =
  | { type: "percent"; bps: number }
  | { type: "amount"; kobo: number };

export type FeeBasis = "cost" | "markup" | "fixed";

export type FeeTreatment =
  | "deducted_from_investors"
  | "charged_to_counterparty"
  | "waived";

export type FeeInput = {
  basis: FeeBasis;
  /** For basis "cost" or "markup". 0 is a valid, explicit rate. */
  bps?: number;
  /** For basis "fixed". */
  kobo?: number;
  treatment: FeeTreatment;
};

export type ScheduleInput =
  | { mode: "equal" }
  /** Contract-specific: the investor-net amount for each month, in order. */
  | { mode: "contract"; netKobo: number[] };

export type TermsInput = {
  costKobo: number;
  markup: MarkupInput;
  /** The sale price written in the contract, if it states one. */
  statedSalePriceKobo?: number | null;
  fee: FeeInput;
  durationMonths: number;
  schedule: ScheduleInput;
};

export type ScheduleLine = {
  period: number;
  /** Net amount due to investors for the month. */
  investorNetKobo: number;
  /** Fee attributed to the month — provisional until A7 is confirmed. */
  feeKobo: number;
  /** What the counterparty is expected to pay towards profit and fee. */
  counterpartyGrossKobo: number;
  /** Kobo added to make the schedule reconcile exactly; shown, never hidden. */
  roundingAdjustmentKobo: number;
};

export type TermsIssue = { field: string; message: string };

export type TermsBreakdown = {
  engineVersion: string;
  costKobo: number;
  markupKobo: number;
  /** Markup as a share of cost, in bps, for display. */
  markupBpsOfCost: number;
  salePriceKobo: number;
  feeKobo: number;
  feeTreatment: FeeTreatment;
  /** Profit belonging to investors over the whole term. */
  investorProfitPoolKobo: number;
  /** Everything the counterparty pays over the term, fee included where it is charged to them. */
  counterpartyTotalKobo: number;
  /** Capital due back at maturity (A3: cost repaid as a single sum). */
  capitalAtMaturityKobo: number;
  schedule: ScheduleLine[];
  scheduleTotals: {
    investorNetKobo: number;
    feeKobo: number;
    counterpartyGrossKobo: number;
  };
  /** Blocking problems. Terms with any of these cannot be submitted. */
  errors: TermsIssue[];
  /** Things a reviewer must look at but which do not block. */
  notes: string[];
};

/** Round half away from zero — the same rule at every step, and stated on screen. */
export function roundHalfUp(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/** `amount × bps / 10 000`, rounded once, half up, to the kobo. */
export function applyBps(amountKobo: number, bps: number): number {
  return roundHalfUp((amountKobo * bps) / 10_000);
}

/**
 * Split `totalKobo` across `n` equal periods. Every period gets the
 * floor; whatever is left over goes on the FINAL period and is reported
 * as that period's rounding adjustment, so the sum is exact and the
 * reason it is uneven is on the page.
 */
export function splitEqually(totalKobo: number, n: number): { amounts: number[]; remainder: number } {
  if (!Number.isInteger(n) || n <= 0) return { amounts: [], remainder: 0 };
  const base = Math.floor(totalKobo / n);
  const remainder = totalKobo - base * n;
  const amounts = Array.from({ length: n }, () => base);
  amounts[n - 1] += remainder;
  return { amounts, remainder };
}

/**
 * Largest-remainder apportionment. Splits `totalKobo` in proportion to
 * `weights` so the parts are whole kobo and sum to the total exactly.
 *
 * Ties in the fractional part go to the EARLIER weight, so the same
 * inputs always give the same answer — an allocation that changes
 * between two page loads is one nobody can sign off.
 */
export function apportion(totalKobo: number, weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (weights.length === 0 || sum <= 0) return weights.map(() => 0);

  const exact = weights.map((w) => (totalKobo * w) / sum);
  const parts = exact.map((x) => Math.floor(x));
  let left = totalKobo - parts.reduce((s, p) => s + p, 0);

  const order = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  for (let k = 0; left > 0 && k < order.length; k++, left--) {
    parts[order[k].i] += 1;
  }
  return parts;
}

function isWholeNonNegative(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

export function computeTerms(input: TermsInput): TermsBreakdown {
  const errors: TermsIssue[] = [];
  const notes: string[] = [];

  const cost = input.costKobo;
  if (!isWholeNonNegative(cost) || cost === 0) {
    errors.push({ field: "cost", message: "Transaction cost must be greater than zero." });
  }

  const n = input.durationMonths;
  if (!Number.isInteger(n) || n <= 0) {
    errors.push({ field: "duration", message: "Duration must be a whole number of months, at least 1." });
  }

  // ── Markup ──────────────────────────────────────────────
  let markup = 0;
  if (input.markup.type === "percent") {
    if (!isWholeNonNegative(input.markup.bps)) {
      errors.push({ field: "markup", message: "Markup rate must be zero or more." });
    } else {
      markup = applyBps(cost || 0, input.markup.bps);
      notes.push(
        "Markup is applied as a flat rate for the whole term (assumption A2 — confirm against the contract)."
      );
    }
  } else if (!isWholeNonNegative(input.markup.kobo)) {
    errors.push({ field: "markup", message: "Markup amount must be zero or more." });
  } else {
    markup = input.markup.kobo;
  }

  const salePrice = (cost || 0) + markup;
  if (input.statedSalePriceKobo != null && input.statedSalePriceKobo !== salePrice) {
    errors.push({
      field: "statedSalePrice",
      message: `The contract's stated sale price does not equal cost + markup (difference ${
        (input.statedSalePriceKobo - salePrice) / 100
      } naira). Correct the terms or the stated price; the system will not reconcile it silently.`,
    });
  }

  // ── Service fee: separate from markup, by contract ──────
  let fee = 0;
  const f = input.fee;
  if (f.treatment !== "waived") {
    if (f.basis === "fixed") {
      if (!isWholeNonNegative(f.kobo)) {
        errors.push({ field: "fee", message: "A fixed fee needs an amount of zero or more." });
      } else fee = f.kobo;
    } else if (!isWholeNonNegative(f.bps)) {
      errors.push({ field: "fee", message: "Fee rate must be zero or more." });
    } else {
      fee = applyBps(f.basis === "cost" ? cost || 0 : markup, f.bps);
    }
  }

  let investorPool = markup;
  let counterpartyTotal = salePrice;
  if (f.treatment === "deducted_from_investors") {
    investorPool = markup - fee;
    if (investorPool < 0) {
      errors.push({
        field: "fee",
        message: "The fee deducted from investors is larger than the markup — investors would receive negative profit.",
      });
    }
  } else if (f.treatment === "charged_to_counterparty") {
    counterpartyTotal = salePrice + fee;
  }

  // ── Monthly schedule ────────────────────────────────────
  const schedule: ScheduleLine[] = [];
  if (Number.isInteger(n) && n > 0) {
    const feeSplit =
      f.treatment === "waived" ? { amounts: Array(n).fill(0), remainder: 0 } : splitEqually(fee, n);

    let netAmounts: number[] = [];
    let netRemainder = 0;
    if (input.schedule.mode === "equal") {
      const s = splitEqually(Math.max(investorPool, 0), n);
      netAmounts = s.amounts;
      netRemainder = s.remainder;
    } else {
      netAmounts = input.schedule.netKobo.slice(0, n);
      if (input.schedule.netKobo.length !== n) {
        errors.push({
          field: "schedule",
          message: `The contract schedule has ${input.schedule.netKobo.length} month(s) but the duration is ${n}.`,
        });
      }
      const allValid = netAmounts.every(isWholeNonNegative);
      if (!allValid) {
        errors.push({ field: "schedule", message: "Every monthly amount must be entered, as zero or more." });
      }
      const total = netAmounts.reduce((s, a) => s + (isWholeNonNegative(a) ? a : 0), 0);
      if (allValid && total !== investorPool) {
        errors.push({
          field: "schedule",
          message: `Monthly amounts total ${total / 100} naira but the investor profit pool is ${
            investorPool / 100
          } naira. They must reconcile exactly before the terms can be submitted.`,
        });
      }
    }

    for (let i = 0; i < n; i++) {
      const net = isWholeNonNegative(netAmounts[i]) ? netAmounts[i] : 0;
      const feeK = feeSplit.amounts[i] ?? 0;
      // Fee inside the counterparty's monthly payment only where it is
      // taken from the markup or charged to them; a waived fee is nothing.
      const gross = f.treatment === "waived" ? net : net + feeK;
      schedule.push({
        period: i + 1,
        investorNetKobo: net,
        feeKobo: f.treatment === "waived" ? 0 : feeK,
        counterpartyGrossKobo: gross,
        roundingAdjustmentKobo:
          i === n - 1
            ? (input.schedule.mode === "equal" ? netRemainder : 0) + (feeSplit.remainder ?? 0)
            : 0,
      });
    }
    if (f.treatment !== "waived" && fee > 0) {
      notes.push(
        "The fee is shown spread evenly across the months. When it is actually taken from each receipt is assumption A7 and must be confirmed before activation."
      );
    }
  }

  const totals = schedule.reduce(
    (t, l) => ({
      investorNetKobo: t.investorNetKobo + l.investorNetKobo,
      feeKobo: t.feeKobo + l.feeKobo,
      counterpartyGrossKobo: t.counterpartyGrossKobo + l.counterpartyGrossKobo,
    }),
    { investorNetKobo: 0, feeKobo: 0, counterpartyGrossKobo: 0 }
  );

  notes.push(
    "Capital (the transaction cost) is shown as repaid in one sum at maturity and settled separately from monthly profit (assumption A3)."
  );

  return {
    engineVersion: ENGINE_VERSION,
    costKobo: cost || 0,
    markupKobo: markup,
    markupBpsOfCost: cost ? roundHalfUp((markup * 10_000) / cost) : 0,
    salePriceKobo: salePrice,
    feeKobo: fee,
    feeTreatment: f.treatment,
    investorProfitPoolKobo: investorPool,
    counterpartyTotalKobo: counterpartyTotal,
    capitalAtMaturityKobo: cost || 0,
    schedule,
    scheduleTotals: totals,
    errors,
    notes,
  };
}

export type AllocationInput = { key: string; units: number };

export type AllocationLine = {
  key: string;
  units: number;
  /** Participation in bps of total units, for display only. */
  participationBps: number;
  capitalKobo: number;
  /** Expected profit for each schedule period, same order as the schedule. */
  monthlyProfitKobo: number[];
  totalProfitKobo: number;
};

/**
 * Investor allocations from units. Capital and every month's profit are
 * apportioned separately by largest remainder, so each column — not
 * just the grand total — adds up exactly to the Cycle figure.
 *
 * `capitalKobo` is the capital actually FUNDED, passed in by the
 * caller — never the contract cost. Apportioning the full cost over a
 * part-subscribed Cycle would credit each investor with money they
 * never paid in.
 */
export function computeAllocations(
  basis: { capitalKobo: number; schedule: Pick<ScheduleLine, "investorNetKobo">[] },
  holders: AllocationInput[]
): AllocationLine[] {
  const weights = holders.map((h) => h.units);
  const totalUnits = weights.reduce((s, w) => s + w, 0);
  const capital = apportion(basis.capitalKobo, weights);
  const perMonth = basis.schedule.map((l) => apportion(l.investorNetKobo, weights));

  return holders.map((h, i) => {
    const monthly = perMonth.map((m) => m[i]);
    return {
      key: h.key,
      units: h.units,
      participationBps: totalUnits ? roundHalfUp((h.units * 10_000) / totalUnits) : 0,
      capitalKobo: capital[i],
      monthlyProfitKobo: monthly,
      totalProfitKobo: monthly.reduce((s, x) => s + x, 0),
    };
  });
}
