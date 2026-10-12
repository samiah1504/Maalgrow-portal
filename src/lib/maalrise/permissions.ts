/**
 * Who may do what in MaalRise — Implementation Plan v2, D8.
 *
 * The pages and API routes use these to decide what to offer; the
 * database functions in migrations 051 and 052 enforce the same lists
 * (maalrise_can_prepare / _can_approve / _can_finance / _can_pay),
 * which is the half that matters. The Payment Officer is outside
 * is_admin() and appears only in MAALRISE_PAY_ROLES.
 */
export const MAALRISE_PREPARE_ROLES = ["super_admin", "administrator", "operations"] as const;
export const MAALRISE_APPROVE_ROLES = ["super_admin", "administrator"] as const;
export const MAALRISE_FINANCE_ROLES = ["super_admin", "administrator", "finance"] as const;
export const MAALRISE_REVERSE_ROLES = ["super_admin"] as const;

export function canPrepare(role: string | null | undefined) {
  return (MAALRISE_PREPARE_ROLES as readonly string[]).includes(role ?? "");
}
export function canApprove(role: string | null | undefined) {
  return (MAALRISE_APPROVE_ROLES as readonly string[]).includes(role ?? "");
}
export function canFinance(role: string | null | undefined) {
  return (MAALRISE_FINANCE_ROLES as readonly string[]).includes(role ?? "");
}

/** Recording a payment received from the counterparty (finance + admins). */
export const MAALRISE_RECEIPT_ROLES = MAALRISE_FINANCE_ROLES;
/** Recording that an approved investor payment was transferred. */
export const MAALRISE_PAY_ROLES = ["payment_officer", "super_admin", "administrator"] as const;

export function canPay(role: string | null | undefined) {
  return (MAALRISE_PAY_ROLES as readonly string[]).includes(role ?? "");
}

/*
 * Activation is controlled by the approver roles above and the
 * database's activation checklist (maalrise_activation_checks). The
 * earlier MAALRISE_ACTIVATION_ENABLED switch was removed in Phase 4,
 * as agreed, once payment tracking and distributions were in place.
 *
 * Creating NEW logins (and sending invitations) for people with no
 * account is still not built; adding investors works only for people
 * who already have a login.
 */
