/**
 * Row shapes of the MaalRise tables (migration 051).
 *
 * Written by hand: database.types.ts is generated from MaalGrow's
 * schema and is left untouched. Money is kobo, rates basis points —
 * the same units as the database, converted only for display.
 */

export type CycleStatus =
  | "draft"
  | "terms_submitted"
  | "terms_approved"
  | "active"
  | "matured"
  | "closed"
  | "cancelled";

export type TermsStatus = "draft" | "submitted" | "approved" | "returned" | "superseded";

export type Counterparty = {
  id: string;
  name: string;
  registration_no: string | null;
  contact_email: string | null;
  contact_phone: string | null;
};

export type CycleRow = {
  id: string;
  name: string;
  transaction_name: string;
  description: string | null;
  counterparty_id: string;
  start_date: string;
  duration_months: number;
  stated_maturity_date: string | null;
  unit_price_kobo: number;
  status: CycleStatus;
  approved_terms_id: string | null;
  activated_by: string | null;
  activated_at: string | null;
  created_by: string | null;
  created_at: string;
};

export type TermsRow = {
  id: string;
  cycle_id: string;
  version: number;
  status: TermsStatus;
  cost_kobo: number;
  markup_type: "percent" | "amount";
  markup_bps: number | null;
  markup_amount_kobo: number | null;
  stated_sale_price_kobo: number | null;
  fee_basis: "cost" | "markup" | "fixed";
  fee_bps: number | null;
  fee_amount_kobo: number | null;
  fee_treatment: "deducted_from_investors" | "charged_to_counterparty" | "waived";
  schedule_mode: "equal" | "contract";
  tax_treatment: string;
  markup_kobo: number;
  sale_price_kobo: number;
  fee_kobo: number;
  investor_pool_kobo: number;
  counterparty_total_kobo: number;
  engine_version: string;
  prepared_by: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  returned_by: string | null;
  returned_at: string | null;
  return_reason: string | null;
  created_at: string;
};

export type ScheduleLineRow = {
  id: string;
  terms_id: string;
  period: number;
  due_date: string;
  counterparty_gross_kobo: number;
  fee_kobo: number;
  investor_net_kobo: number;
  rounding_adjustment_kobo: number;
};

export type KycStatus = "not_started" | "pending_review" | "verified" | "rejected";

export type InvestorRow = {
  id: string;
  profile_id: string;
  investor_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: "invited" | "active" | "suspended";
  kyc_status: KycStatus;
  kyc_source: "maalgrow" | "maalrise" | null;
  maalgrow_investor_id: string | null;
  kyc_reviewed_by: string | null;
  kyc_reviewed_at: string | null;
  kyc_notes: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  bank_confirmed_by: string | null;
  bank_confirmed_at: string | null;
  created_at: string;
};

export type KycSubmissionRow = {
  id: string;
  maalrise_investor_id: string;
  details: Record<string, unknown>;
  status: "pending_review" | "verified" | "rejected";
  submitted_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
};

export type BankHistoryRow = {
  id: string;
  maalrise_investor_id: string;
  event: "prefilled_from_maalgrow" | "set" | "confirmed";
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  actor: string | null;
  created_at: string;
};

export type FundingRow = {
  id: string;
  cycle_id: string;
  maalrise_investor_id: string;
  units: number;
  amount_kobo: number;
  received_on: string;
  reference: string;
  status: "recorded" | "confirmed" | "rejected";
  recorded_by: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  created_at: string;
};

export type AllocationRow = {
  id: string;
  cycle_id: string;
  maalrise_investor_id: string;
  units: number;
  capital_kobo: number;
};

export type DocumentRow = {
  id: string;
  cycle_id: string | null;
  maalrise_investor_id: string | null;
  category: string;
  name: string;
  visible_to_investors: boolean;
  created_at: string;
};

export type AuditRow = {
  id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  new_values: Record<string, unknown> | null;
  created_at: string;
};

export type ActivationCheck = { key: string; ok: boolean; detail: string };
