/**
 * Where a role belongs when it has not asked for anywhere in particular.
 *
 * THE BUG THIS EXISTS TO END. This rule was written out by hand in
 * four places — the login page, the root page, the middleware, and
 * the admin page guard — as a literal array of admin role names. When
 * payment_officer was added in migration 038 it was added to three of
 * them. The login page kept its own copy:
 *
 *     const isAdmin = ["super_admin", "administrator", "finance",
 *                      "operations", "customer_support"].includes(role)
 *     const destination = isAdmin ? "/admin/dashboard" : redirectTo
 *
 * A Payment Officer is not in that list, so signing in sent her to
 * "/dashboard" — the INVESTOR portal, where she has no investor
 * record, and which greets her with "Investor profile not found.
 * Please contact support."
 *
 * Nothing was broken in the sense of throwing. She was simply put in
 * the wrong building, and the wrong building was polite about it.
 *
 * The middleware already carried a comment warning that this list
 * must never be a fourth hand-written copy. It was already a fourth
 * hand-written copy, in a file the comment could not see.
 *
 * ── PURE, SO EVERYTHING CAN USE IT ───────────────────────────
 *
 * No imports from next/navigation or the Supabase server client, so
 * the client-side login page and the server-side middleware share one
 * definition rather than two that agree today.
 */

import { ADMIN_ROLE_VALUES } from "./staff-roles";

export const PAYMENT_OFFICER = "payment_officer";
export const PAYMENT_OFFICER_HOME = "/admin/payment-requests";
export const ADMIN_HOME = "/admin/dashboard";
export const INVESTOR_HOME = "/dashboard";

/**
 * Staff who may see the admin area generally.
 *
 * Mirrors is_admin() in the database, and excludes the Payment
 * Officer on purpose: every is_admin() policy refuses her, so letting
 * her into an admin route would show a page that then failed to load
 * anything — which reads as a broken portal rather than a closed door.
 */
export function isAdminRole(role?: string | null): boolean {
  return ADMIN_ROLE_VALUES.includes((role ?? "") as never);
}

/**
 * The landing page for a role.
 *
 * An unknown or unreadable role lands on the investor portal, which is
 * the least-privileged of the three. Guessing upward here would be the
 * expensive mistake.
 */
export function homeForRole(role?: string | null): string {
  if (role === PAYMENT_OFFICER) return PAYMENT_OFFICER_HOME;
  return isAdminRole(role) ? ADMIN_HOME : INVESTOR_HOME;
}

/**
 * Where to send someone after they sign in.
 *
 * `requested` is the ?redirect= they were bounced from, and it is
 * honoured ONLY for investors. Staff go to their own home: a Payment
 * Officer bounced off /admin/investors must not be handed back to
 * /admin/investors after logging in, and an administrator does not
 * want to land on an investor page either.
 */
export function loginDestination(
  role: string | null | undefined,
  requested?: string | null
): string {
  const home = homeForRole(role);
  if (home !== INVESTOR_HOME) return home;
  return requested && requested.startsWith("/") ? requested : INVESTOR_HOME;
}
