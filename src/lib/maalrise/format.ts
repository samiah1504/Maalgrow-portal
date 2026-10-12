/**
 * MaalRise display helpers. The only place kobo becomes naira.
 */
import { formatCurrency } from "@/lib/utils";

export function formatKobo(kobo: number): string {
  return formatCurrency(kobo / 100);
}

/** 500 → "5.00%". */
export function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

/** "1,234.56" → 123456. Empty or malformed → null, never a guessed number. */
export function parseNairaToKobo(input: string): number | null {
  const cleaned = input.replace(/[,\s₦]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** "5" or "5.25" (percent) → bps. Up to two decimals of a percent. */
export function parsePercentToBps(input: string): number | null {
  const cleaned = input.replace(/[%\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const [whole, frac = ""] = cleaned.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

export const CYCLE_STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  terms_submitted: "Terms Submitted",
  terms_approved: "Terms Approved",
  active: "Active",
  matured: "Matured",
  closed: "Closed",
  cancelled: "Cancelled",
};

export const CYCLE_STATUS_VARIANT: Record<
  string,
  "pending" | "warning" | "approved" | "active" | "matured" | "completed" | "danger"
> = {
  draft: "pending",
  terms_submitted: "warning",
  terms_approved: "approved",
  active: "active",
  matured: "matured",
  closed: "completed",
  cancelled: "danger",
};

export const FEE_BASIS_LABEL: Record<string, string> = {
  cost: "Percentage of transaction cost",
  markup: "Percentage of markup",
  fixed: "Fixed amount",
};

export const FEE_TREATMENT_LABEL: Record<string, string> = {
  deducted_from_investors: "Deducted from investor allocation",
  charged_to_counterparty: "Charged separately to the counterparty",
  waived: "Waived",
};

export const KYC_STATUS_LABEL: Record<string, string> = {
  not_started: "Not started",
  pending_review: "Pending review",
  verified_via_maalgrow: "Verified via MaalGrow",
  verified: "Verified",
  rejected: "Rejected",
};

export const KYC_STATUS_VARIANT: Record<string, "upcoming" | "pending" | "approved" | "rejected"> = {
  not_started: "upcoming",
  pending_review: "pending",
  verified_via_maalgrow: "approved",
  verified: "approved",
  rejected: "rejected",
};
