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
  /** Set when a super admin approved their own terms (056). */
  self_approval_reason?: string | null;
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

/** An investor's request to change their payment account (migration 054). */
export type BankChangeRequestRow = {
  id: string;
  maalrise_investor_id: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requested_by: string;
  requested_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  reject_reason: string | null;
};

export type FundingRow = {
  /** Set when a super admin confirmed funding they recorded (056). */
  self_confirm_reason?: string | null;
  id: string;
  cycle_id: string;
  maalrise_investor_id: string;
  units: number;
  amount_kobo: number;
  received_on: string;
  reference: string;
  status: "recorded" | "confirmed" | "rejected" | "refunded";
  recorded_by: string;
  /** Migration 061: money sent back before the Cycle started. */
  refunded_by?: string | null;
  refunded_on?: string | null;
  refund_reference?: string | null;
  refund_reason?: string | null;
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
  mime_type?: string;
  size_bytes?: number;
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

/** blocking: false (migration 058) = a warning; activation may go ahead. Missing on older rows = blocking. */
export type ActivationCheck = { key: string; ok: boolean; detail: string; blocking?: boolean };

export type ReceiptRow = {
  id: string;
  cycle_id: string;
  schedule_line_id: string;
  period: number;
  amount_kobo: number;
  received_on: string;
  reference: string | null;
  notes: string | null;
  status: "recorded" | "confirmed" | "rejected" | "reversed";
  applied_kobo: number | null;
  held_kobo: number | null;
  fee_kobo: number | null;
  net_kobo: number | null;
  distribution_id: string | null;
  recorded_by: string;
  recorded_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  reject_reason: string | null;
  reversed_by: string | null;
  reversed_at: string | null;
  reverse_reason: string | null;
};

export type DistributionRow = {
  id: string;
  cycle_id: string;
  terms_id: string;
  schedule_line_id: string;
  period: number;
  sequence: number;
  due_date: string;
  cycle_name: string;
  counterparty_name: string;
  applied_kobo: number;
  fee_kobo: number;
  tax_kobo: number;
  net_kobo: number;
  allocated_kobo: number;
  unallocated_kobo: number;
  status: "prepared" | "approved";
  prepared_by: string;
  prepared_at: string;
  approved_by: string | null;
  approved_at: string | null;
};

export type PaymentStatus = "pending_approval" | "payable" | "paid";

export type DistributionLineRow = {
  id: string;
  distribution_id: string;
  cycle_id: string;
  period: number;
  maalrise_investor_id: string;
  investor_name: string;
  investor_code: string;
  units: number;
  amount_kobo: number;
  tax_kobo: number;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  status: PaymentStatus;
  paid_on: string | null;
  paid_reference: string | null;
  paid_by: string | null;
  paid_at: string | null;
};

export type PaymentEventRow = {
  id: string;
  line_id: string;
  event: "marked_paid" | "reversed";
  amount_kobo: number;
  paid_on: string | null;
  reference: string | null;
  reason: string | null;
  actor: string;
  created_at: string;
};

export type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
};

export type CapitalReceiptRow = {
  id: string;
  cycle_id: string;
  amount_kobo: number;
  received_on: string;
  reference: string | null;
  notes: string | null;
  status: "recorded" | "confirmed" | "rejected" | "reversed";
  recorded_by: string;
  recorded_at: string;
  confirmed_by: string | null;
  confirmed_at: string | null;
  rejected_by: string | null;
  reject_reason: string | null;
  reversed_by: string | null;
  reverse_reason: string | null;
};

export type CapitalSettlementRow = {
  id: string;
  cycle_id: string;
  cycle_name: string;
  counterparty_name: string;
  maturity_date: string;
  capital_kobo: number;
  status: "prepared" | "approved" | "cancelled";
  prepared_by: string;
  prepared_at: string;
  approved_by: string | null;
  approved_at: string | null;
  cancel_reason: string | null;
};

export type CapitalPaymentRow = {
  id: string;
  settlement_id: string;
  cycle_id: string;
  maalrise_investor_id: string;
  investor_name: string;
  investor_code: string;
  units: number;
  amount_kobo: number;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  status: PaymentStatus;
  paid_on: string | null;
  paid_reference: string | null;
  paid_by: string | null;
  paid_at: string | null;
};

/** A MaalRise email (migration 052; send states from 055). */
export type OutboxRow = {
  id: string;
  kind: string;
  to_user_id: string | null;
  to_email: string;
  subject: string;
  body: string;
  status: "draft" | "queued" | "sent" | "failed" | "discarded";
  attempts: number;
  last_error: string | null;
  sent_at: string | null;
  created_at: string;
  queued_at: string | null;
  provider_id: string | null;
  handled_by: string | null;
  discarded_at: string | null;
};
