/**
 * The role list, and the one thing about it that must never drift.
 *
 * THE INVARIANT. payment_officer must NOT be in ADMIN_ROLE_VALUES,
 * because that list is what the middleware waves through every /admin
 * route and it is meant to mirror is_admin() in the database. If the
 * two ever disagree the failure is silent and in the worse direction:
 * the app lets her in, the database refuses every query, and the
 * portal looks broken rather than restricted — or, if is_admin() is
 * the one that changed, she is quietly given write access to every
 * table in the portal.
 *
 * The database side of this is asserted by O9 in
 * payment_officer_scenarios.sql. This is the app side.
 *
 *   npx tsx scripts/test-staff-roles.ts
 */
import {
  STAFF_ROLES,
  STAFF_ROLE_VALUES,
  ADMIN_ROLE_VALUES,
  staffRole,
} from "../src/lib/staff-roles";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, extra ?? "");
  }
}

// THE ONE THAT MATTERS.
check(
  "payment_officer is NOT an admin role",
  !ADMIN_ROLE_VALUES.includes("payment_officer" as never),
  ADMIN_ROLE_VALUES
);

// The five that are, exactly — mirroring is_admin() in migration 002.
const EXPECTED_ADMINS = [
  "super_admin",
  "administrator",
  "finance",
  "operations",
  "customer_support",
];
check(
  "the admin roles match is_admin() exactly",
  ADMIN_ROLE_VALUES.length === EXPECTED_ADMINS.length &&
    EXPECTED_ADMINS.every((r) => ADMIN_ROLE_VALUES.includes(r as never)),
  ADMIN_ROLE_VALUES
);

// A payment officer is still STAFF — she must appear in the users
// list and be creatable, just not be an admin.
check(
  "payment_officer is still a staff role",
  STAFF_ROLE_VALUES.includes("payment_officer" as never)
);

check(
  "restricted is what separates the two lists",
  STAFF_ROLES.filter((r) => r.restricted).map((r) => r.value).join() ===
    "payment_officer",
  STAFF_ROLES.filter((r) => r.restricted).map((r) => r.value)
);

// Every role a person can be given must be able to explain itself:
// the summary is what goes into their invitation email.
for (const r of STAFF_ROLES) {
  check(
    `${r.value} has a label and a summary for the invitation`,
    r.label.length > 0 && r.summary.length > 20,
    r
  );
}

// The officer's summary has to say plainly what she cannot reach,
// because that is the expectation being set before she logs in and
// finds a single menu item.
const officer = staffRole("payment_officer");
check(
  "the officer's summary says what she cannot reach",
  Boolean(officer && /no access/i.test(officer.summary)),
  officer?.summary
);

check("an unknown role resolves to nothing", staffRole("wizard") === undefined);
check("a null role resolves to nothing", staffRole(null) === undefined);

// Most powerful first: a picker should read as descending authority.
check(
  "super_admin is the first option and payment_officer the last",
  STAFF_ROLES[0].value === "super_admin" &&
    STAFF_ROLES[STAFF_ROLES.length - 1].value === "payment_officer"
);

console.log(failures === 0 ? "\nALL STAFF ROLE TESTS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
