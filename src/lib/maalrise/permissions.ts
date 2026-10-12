/**
 * Who may do what in MaalRise — Implementation Plan v2, D8.
 *
 * Phase 1 only uses these to decide who may OPEN a form; nothing is
 * saved yet. From Phase 2 the database functions enforce the same
 * lists, which is the half that matters. Every role here is already
 * inside is_admin(); the Payment Officer is in none of them.
 */
export const MAALRISE_PREPARE_ROLES = ["super_admin", "administrator", "operations"] as const;
export const MAALRISE_APPROVE_ROLES = ["super_admin", "administrator"] as const;
export const MAALRISE_FINANCE_ROLES = ["super_admin", "administrator", "finance"] as const;
export const MAALRISE_REVERSE_ROLES = ["super_admin"] as const;
