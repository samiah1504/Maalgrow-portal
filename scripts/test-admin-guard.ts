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

console.log(
  failures === 0 ? "\nALL ADMIN GUARD TESTS PASSED" : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
