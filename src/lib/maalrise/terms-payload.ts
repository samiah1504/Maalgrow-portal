/**
 * The arguments for maalrise_save_terms(), built from the terms engine.
 *
 * The database recalculates every figure here and refuses the terms
 * unless it reaches the same numbers to the kobo. This file is the one
 * place the shape of that contract is written down on the app side;
 * scripts/test-maalrise-sql-contract.ts runs it against the SQL.
 *
 * Pure: no Supabase import, so a Phase 2 route and a test use it alike.
 */
import type { TermsBreakdown, TermsInput } from "./compute";

export type SaveTermsArgs = {
  p_terms: Record<string, string | number | null>;
  p_schedule: {
    period: number;
    investor_net_kobo: number;
    fee_kobo: number;
    counterparty_gross_kobo: number;
    rounding_adjustment_kobo: number;
  }[];
};

export function saveTermsArgs(input: TermsInput, b: TermsBreakdown): SaveTermsArgs {
  if (b.errors.length > 0) {
    throw new Error(`Terms have unresolved errors: ${b.errors.map((e) => e.message).join("; ")}`);
  }
  const waived = input.fee.treatment === "waived";
  return {
    p_terms: {
      cost_kobo: input.costKobo,
      markup_type: input.markup.type,
      markup_bps: input.markup.type === "percent" ? input.markup.bps : null,
      markup_amount_kobo: input.markup.type === "amount" ? input.markup.kobo : null,
      stated_sale_price_kobo: input.statedSalePriceKobo ?? null,
      fee_basis: input.fee.basis,
      fee_bps: !waived && input.fee.basis !== "fixed" ? input.fee.bps ?? null : null,
      fee_amount_kobo: !waived && input.fee.basis === "fixed" ? input.fee.kobo ?? null : null,
      fee_treatment: input.fee.treatment,
      schedule_mode: input.schedule.mode,
      markup_kobo: b.markupKobo,
      sale_price_kobo: b.salePriceKobo,
      fee_kobo: b.feeKobo,
      investor_pool_kobo: b.investorProfitPoolKobo,
      counterparty_total_kobo: b.counterpartyTotalKobo,
      engine_version: b.engineVersion,
    },
    p_schedule: b.schedule.map((l) => ({
      period: l.period,
      investor_net_kobo: l.investorNetKobo,
      fee_kobo: l.feeKobo,
      counterparty_gross_kobo: l.counterpartyGrossKobo,
      rounding_adjustment_kobo: l.roundingAdjustmentKobo,
    })),
  };
}
