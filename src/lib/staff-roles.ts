/**
 * The staff roles, in one place.
 *
 * WHY THIS FILE EXISTS. The list of what counts as staff was written
 * out by hand in the middleware, the users page, is_admin() and the
 * sidebar — four copies that could disagree. They still each need
 * their own form (the database has its own), but everything in the
 * app layer now reads from here.
 *
 * THE ORDER IS DELIBERATE: most powerful first, so a role picker
 * reads as a descending list of authority and the least powerful
 * option is the one nearest the bottom.
 */

export type StaffRole =
  | "super_admin"
  | "administrator"
  | "finance"
  | "operations"
  | "customer_support"
  | "payment_officer";

export type StaffRoleInfo = {
  value: StaffRole;
  label: string;
  /** One line, written for the person receiving the invitation. */
  summary: string;
  /** True when the role is NOT in is_admin() — see migration 038. */
  restricted?: boolean;
};

export const STAFF_ROLES: StaffRoleInfo[] = [
  {
    value: "super_admin",
    label: "Super Admin",
    summary: "Full access to every part of the portal, including settings and rollovers.",
  },
  {
    value: "administrator",
    label: "Administrator",
    summary: "Manages investors, investments, cycles and communications.",
  },
  {
    value: "finance",
    label: "Finance",
    summary: "Ledgers, profit declarations, withholding tax and payment requests.",
  },
  {
    value: "operations",
    label: "Operations",
    summary: "Day-to-day investor and investment records.",
  },
  {
    value: "customer_support",
    label: "Customer Support",
    summary: "Investor chats and enquiries.",
  },
  {
    value: "payment_officer",
    label: "Payment Officer",
    summary:
      "The payment queue only — confirming payouts as they are sent. No access to investor records, investments or any other part of the portal.",
    restricted: true,
  },
];

export const STAFF_ROLE_VALUES = STAFF_ROLES.map((r) => r.value);

export function staffRole(value: string | null | undefined): StaffRoleInfo | undefined {
  return STAFF_ROLES.find((r) => r.value === value);
}

/** Roles that pass is_admin() in the database. Payment Officer does not. */
export const ADMIN_ROLE_VALUES = STAFF_ROLES.filter((r) => !r.restricted).map(
  (r) => r.value
);
