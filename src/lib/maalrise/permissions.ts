/**
 * Who may do what in MaalRise — Implementation Plan v2, D8.
 *
 * The pages and API routes use these to decide what to offer; the
 * database functions in migration 051 enforce the same lists
 * (maalrise_can_prepare / _can_approve / _can_finance), which is the
 * half that matters. Every role here is inside is_admin(); the
 * Payment Officer is in none of them.
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

/**
 * Switches for actions that need the business's explicit go-ahead
 * before they may happen in production. Both are OFF unless the
 * environment variable is set to exactly "true".
 *
 *   MAALRISE_ACTIVATION_ENABLED — the Activate button. Activation
 *     makes a Cycle visible to its investors; no real Cycle is to be
 *     activated without approval.
 *   MAALRISE_NEW_LOGINS_ENABLED — reserved: creating a login (and
 *     sending an invitation) for an email with no account. Not built
 *     yet; adding investors works only for people who already have a
 *     login, e.g. existing MaalGrow investors.
 */
export function activationEnabled() {
  return process.env.MAALRISE_ACTIVATION_ENABLED === "true";
}
