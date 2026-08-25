/**
 * The role check on an admin page, done on the page.
 *
 * WHY, WHEN THE MIDDLEWARE ALREADY DOES THIS. Because the middleware
 * is the only thing doing it, and these pages read with the
 * SERVICE-ROLE client — which bypasses row-level security completely.
 * Every other screen in this portal has the database as a second line:
 * if a check in the application is wrong, RLS still refuses. These
 * pages have no second line at all. One middleware miss — a profile
 * lookup that returns nothing, a route that stops matching, a
 * redirect that does not fire — and the page hands over every
 * investor's name, email, phone and bank details.
 *
 * The comment these pages carried said "already role-gated by
 * middleware/layout". That is the assumption worth removing: a
 * Payment Officer, whose whole point is being confined to one screen,
 * was reported seeing one of them.
 *
 * WHAT IT COSTS. One profile lookup per page render, on pages that
 * already make several queries. That is the wrong thing to economise
 * on.
 *
 * ONE LIST, NOT A FIFTH COPY. ADMIN_ROLE_VALUES is the same list the
 * middleware uses and mirrors is_admin() in the database. The Payment
 * Officer is deliberately not in it.
 */

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ADMIN_ROLE_VALUES } from "@/lib/staff-roles";

const PAYMENT_OFFICER = "payment_officer";
const PAYMENT_OFFICER_HOME = "/admin/payment-requests";

/**
 * Where this role belongs, given the page it asked for.
 *
 * Split out from requireAdminPage so the decision can be exercised
 * without a request — see scripts/test-admin-guard.ts. A test that
 * re-implemented these four lines could pass while the guard drifted
 * away from it, which is worse than no test.
 *
 * "ALLOW" rather than null, so a caller that forgets to compare gets
 * a truthy path it will notice rather than a silent pass.
 */
export function adminPageDestination(
  role: string | null | undefined,
  allow?: readonly string[]
): string {
  const r = role ?? "";

  // Confined, and sent where their job actually is — not to a dead
  // end that reads as the portal being broken for them.
  if (r === PAYMENT_OFFICER) return PAYMENT_OFFICER_HOME;

  // Includes the case where the profile could not be read at all.
  // An unknown role is not an admin: the failure has to close, and a
  // lookup that returns nothing is exactly when it matters most.
  if (!ADMIN_ROLE_VALUES.includes(r as never)) return "/dashboard";

  // They ARE staff, just not staff for this.
  if (allow && !allow.includes(r)) return "/admin/dashboard";

  return "ALLOW";
}

/**
 * Establish that whoever is asking may see this page.
 *
 * Returns the session client as well, so a page does not build a
 * second one — and so that adopting this is a replacement for the
 * `getUser()` block rather than an addition to it. A guard that is
 * extra work to use is a guard somebody skips.
 *
 * `allow` narrows further, for pages only some admins should reach.
 * Being sent to the admin dashboard is the right refusal there: they
 * ARE staff, just not staff for this.
 */
export async function requireAdminPage(allow?: readonly string[]) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  const role = profile?.role ?? "";

  const where = adminPageDestination(role, allow);
  if (where !== "ALLOW") redirect(where);

  return { supabase, user, role, fullName: profile?.full_name ?? null };
}
