/**
 * Shared KYC helpers.
 *
 * The database keeps kyc_status as pending / approved / rejected.
 * "Update Required" and "Incomplete" are DERIVED here (mirroring the
 * SQL function kyc_missing_fields), so existing approved investors
 * whose records predate the new fields are flagged without being
 * rejected or losing data.
 */

import { storedAddressMissing } from "./residential-address";

export type KycInvestorFields = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  /** The pre-042 single field. Read for display only — never for completeness. */
  address: string | null;
  residential_street_address?: string | null;
  residential_state_code?: string | null;
  residential_state_name?: string | null;
  residential_lga_code?: string | null;
  residential_lga_name?: string | null;
  residential_city?: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  gender: string | null;
  nationality: string | null;
  occupation: string | null;
  kyc_status: "pending" | "approved" | "rejected";
  kyc_submitted_at: string | null;
};

export type NextOfKinFields = {
  full_name: string | null;
  relationship: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
} | null;

export type DerivedKycStatus =
  | "Incomplete"
  | "Submitted"
  | "Approved"
  | "Rejected"
  | "Update Required";

const filled = (v: string | null | undefined) => Boolean(v && v.trim() !== "");

/** Mirror of the SQL kyc_missing_fields() function */
export function kycMissingFields(
  inv: KycInvestorFields,
  nok: NextOfKinFields
): string[] {
  const missing: string[] = [];
  if (!filled(inv.full_name)) missing.push("Full name");
  if (!filled(inv.email)) missing.push("Email");
  if (!filled(inv.phone)) missing.push("Phone number");
  // 042. Four parts, each named, in the order the form asks for them.
  // "Address" told nobody which box to go back to, and it passed on
  // the strength of somebody having typed "Lagos".
  missing.push(...storedAddressMissing(inv));
  if (
    !filled(inv.bank_name) ||
    !filled(inv.account_name) ||
    !filled(inv.account_number)
  )
    missing.push("Bank details");
  if (!filled(inv.gender)) missing.push("Gender");
  if (!filled(inv.nationality)) missing.push("Nationality");
  if (!filled(inv.occupation)) missing.push("Occupation");
  if (
    !nok ||
    !filled(nok.full_name) ||
    !filled(nok.relationship) ||
    !filled(nok.phone) ||
    !filled(nok.address) ||
    !filled(nok.city) ||
    !filled(nok.state) ||
    !filled(nok.country)
  )
    missing.push("Next-of-kin details");
  return missing;
}

export function deriveKycStatus(
  inv: KycInvestorFields,
  nok: NextOfKinFields
): DerivedKycStatus {
  const missing = kycMissingFields(inv, nok);
  if (inv.kyc_status === "rejected") return "Rejected";
  if (inv.kyc_status === "approved") {
    return missing.length === 0 ? "Approved" : "Update Required";
  }
  if (!inv.kyc_submitted_at) return "Incomplete";
  return missing.length === 0 ? "Submitted" : "Incomplete";
}

export function maskAccountNumber(acct: string | null): string {
  if (!acct) return "—";
  const digits = acct.replace(/\D/g, "");
  if (digits.length < 4) return "••••";
  return `••••••${digits.slice(-4)}`;
}

export const GENDER_OPTIONS = [
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
] as const;

export function genderLabel(value: string | null): string {
  return GENDER_OPTIONS.find((g) => g.value === value)?.label ?? "—";
}

export const OCCUPATION_OPTIONS = [
  "Business owner",
  "Civil servant",
  "Medical professional",
  "Teacher",
  "Engineer",
  "Trader",
  "Student",
  "Retired",
  "Other",
] as const;

export const RELATIONSHIP_OPTIONS = [
  "Spouse",
  "Parent",
  "Child",
  "Sibling",
  "Relative",
  "Friend",
  "Guardian",
  "Other",
] as const;

export const NATIONALITY_OPTIONS = [
  "Nigerian",
  "Ghanaian",
  "Beninese",
  "Cameroonian",
  "Nigerien",
  "Togolese",
  "Ivorian",
  "Senegalese",
  "Kenyan",
  "South African",
  "Egyptian",
  "British",
  "American",
  "Canadian",
  "Indian",
  "Pakistani",
  "Lebanese",
  "Chinese",
  "Emirati",
  "Saudi Arabian",
  "Other",
] as const;
