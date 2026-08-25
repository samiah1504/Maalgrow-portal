/**
 * Who may load an admin page.
 *
 * WHY THIS IS TESTED AT ALL. These pages read with the service-role
 * client, which bypasses row-level security completely. Every other
 * screen has the database as a second line — get the check wrong in
 * the application and RLS still refuses. These have none. The role
 * check IS the protection, so it is worth a test that names each way
 * it can be wrong.
 *
 * The redirect targets matter as much as the refusals. Sending a
 * Payment Officer to /dashboard would drop her into an investor
 * portal she has no record in, which reads as the portal being broken
 * rather than as a page not being hers.
 *
 *   npx tsx scripts/test-admin-guard.ts
 */
import { ADMIN_ROLE_VALUES, STAFF_ROLE_VALUES } from "../src/lib/staff-roles";
import { adminPageDestination as destination } from "../src/lib/admin-guard";
import {
  homeForRole,
  loginDestination,
  ADMIN_HOME,
  INVESTOR_HOME,
  PAYMENT_OFFICER_HOME,
} from "../src/lib/home-for-role";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

/* ── The one that was reported ────────────────────────────────── */

check(
  "a payment officer is sent to her queue, not into an admin page",
  destination("payment_officer") === "/admin/payment-requests"
);
// Not /dashboard: she has no investor record, so that is a portal
// that cannot render for her.
check(
  "and not to the investor dashboard",
  destination("payment_officer") !== "/dashboard"
);

/* ── The failure that has to close ────────────────────────────── */

// This is the case the middleware alone could not survive: a profile
// lookup that comes back with nothing. It must NOT fall through to
// the page.
check("an unreadable profile is refused", destination(null) === "/dashboard");
check("so is an empty role", destination("") === "/dashboard");
check("so is a role nobody has heard of", destination("wizard") === "/dashboard");
check("and an investor is refused", destination("investor") === "/dashboard");

/* ── Staff who should get in ──────────────────────────────────── */

for (const role of ADMIN_ROLE_VALUES) {
  check(`${role} may load an admin page`, destination(role) === "ALLOW");
}

// The list is the point: payment_officer must never be in it, or the
// guard waves through exactly the person it exists to stop.
check(
  "payment_officer is not in the admin list",
  !ADMIN_ROLE_VALUES.includes("payment_officer" as never),
  ADMIN_ROLE_VALUES
);
check(
  "but it IS a staff role, so it can still be created",
  STAFF_ROLE_VALUES.includes("payment_officer" as never),
  STAFF_ROLE_VALUES
);
check(
  "and the admin list is a strict subset of the staff list",
  ADMIN_ROLE_VALUES.every((r) => STAFF_ROLE_VALUES.includes(r)) &&
    ADMIN_ROLE_VALUES.length < STAFF_ROLE_VALUES.length
);

/* ── Narrowing further ────────────────────────────────────────── */

check(
  "a page restricted to super_admin lets one in",
  destination("super_admin", ["super_admin"]) === "ALLOW"
);
check(
  "and sends other staff to the admin dashboard, not out of the portal",
  destination("finance", ["super_admin"]) === "/admin/dashboard",
  destination("finance", ["super_admin"])
);
check(
  "while the officer is still confined even on a narrowed page",
  destination("payment_officer", ["super_admin"]) === "/admin/payment-requests"
);

/* ── Where signing in puts you ────────────────────────────────── */

/*
 * THE REPORTED BUG, EXACTLY. The login page carried its own array of
 * admin role names, written before payment_officer existed. She was
 * not in it, so `isAdmin` was false, so she was sent to "/dashboard"
 * — the investor portal, where she has no investor record, and which
 * told her "Investor profile not found. Please contact support."
 */
check(
  "a payment officer signing in lands on her queue",
  loginDestination("payment_officer", "/dashboard") === PAYMENT_OFFICER_HOME,
  loginDestination("payment_officer", "/dashboard")
);
check(
  "and NOT in the investor portal, where she has no record",
  loginDestination("payment_officer", "/dashboard") !== INVESTOR_HOME
);
// She was bounced off an admin page to the login screen; handing her
// straight back to it would bounce her again, forever.
check(
  "nor back to the page she was just refused",
  loginDestination("payment_officer", "/admin/investors") === PAYMENT_OFFICER_HOME
);

/*
 * THE ASSERTION THAT WOULD HAVE CAUGHT IT. Not "payment_officer goes
 * here" — that only tests the role somebody remembered. This says NO
 * staff role may ever be dropped into the investor portal, so the
 * next role added to STAFF_ROLE_VALUES and forgotten somewhere fails
 * here rather than in production.
 */
for (const role of STAFF_ROLE_VALUES) {
  check(
    `${role} never lands in the investor portal on login`,
    loginDestination(role, "/dashboard") !== INVESTOR_HOME,
    loginDestination(role, "/dashboard")
  );
}

check("an admin signing in lands on the admin dashboard", homeForRole("finance") === ADMIN_HOME);
check("an investor lands on the investor portal", homeForRole("investor") === INVESTOR_HOME);
check("and so does an unknown role — never guess upward", homeForRole("wizard") === INVESTOR_HOME);
check("as does no role at all", homeForRole(null) === INVESTOR_HOME);

// An investor's deep link IS honoured — that is the whole purpose of
// ?redirect=, and staff are the exception rather than the rule.
check(
  "an investor is returned to the page they asked for",
  loginDestination("investor", "/investments/abc") === "/investments/abc"
);
check(
  "but staff go to their own home, not an investor page",
  loginDestination("super_admin", "/investments/abc") === ADMIN_HOME
);
// A pasted absolute URL is not a path. Following one would be an open
// redirect straight off the login screen.
check(
  "and an off-site redirect is refused",
  loginDestination("investor", "https://evil.example.com") === INVESTOR_HOME,
  loginDestination("investor", "https://evil.example.com")
);

console.log(
  failures === 0 ? "\nALL ADMIN GUARD TESTS PASSED" : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
