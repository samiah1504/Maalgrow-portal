/**
 * Investor Data Export (approved 21 Oct 2026).
 *
 * Staff pick a MaalGrow series (optionally one cycle) or a MaalRise
 * Cycle, tick the details they want, and download Excel or CSV. This
 * module is pure — no database — so what goes into a file can be
 * tested on its own: the field lists, the one-row-per-person contact
 * list, masking and the file writers.
 *
 *   * contacts     one row per PERSON (an investor who rolled over and
 *                  holds three investments in a series appears once)
 *   * investments  one row per INVESTMENT (MaalGrow), so the totals
 *                  match the series; one row per investor (MaalRise,
 *                  where a Cycle holds one allocation per investor)
 *
 * Bank account numbers are masked unless a super admin asks otherwise.
 * NIN, TIN and login data are never offered.
 */
import * as XLSX from "xlsx";

/** Who may export (approved): super admin and administrator. Only a super admin may unmask account numbers. */
export const EXPORT_ROLES: readonly string[] = ["super_admin", "administrator"];

export type ExportFormat = "xlsx" | "csv";
export type ExportMode = "contacts" | "investments";
type Kind = "text" | "number" | "date";
type Cell = string | number | null;

export type FieldDef<R> = {
  key: string;
  label: string;
  group: string;
  kind?: Kind;
  get: (r: R, o: { unmask: boolean }) => Cell;
};

/** What the screen needs to draw the checkboxes. */
export type FieldOption = { key: string; label: string; group: string };
export const fieldOptions = <R,>(defs: FieldDef<R>[]): FieldOption[] => defs.map(({ key, label, group }) => ({ key, label, group }));

export function maskAccount(acct: string | null | undefined): string {
  if (!acct) return "";
  const d = acct.replace(/\D/g, "");
  return d.length < 4 ? "****" : `******${d.slice(-4)}`;
}

const s = (v: unknown): string => (v === null || v === undefined ? "" : String(v)).trim();
const money = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Math.round(Number(v) * 100) / 100);
const kobo = (k: number | null | undefined): number | null => (k === null || k === undefined ? null : Math.round(k) / 100);

// ------------------------------------------------------------------
// MaalGrow
// ------------------------------------------------------------------
export type MgInvestor = {
  id: string;
  investor_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  residential_street_address?: string | null;
  residential_city?: string | null;
  residential_lga_name?: string | null;
  residential_state_name?: string | null;
  gender: string | null;
  nationality: string | null;
  occupation: string | null;
  kyc_status: string;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
};
export type MgNextOfKin = { investor_id: string; full_name: string | null; relationship: string | null; phone: string | null; email: string | null } | null;
export type MgInvestment = {
  id: string;
  investment_code: string;
  investor_id: string;
  cycle_id: string;
  units: number | string;
  price_per_unit: number | string;
  capital: number | string;
  investment_date: string;
  maturity_date: string;
  status: string;
};

export type MgInvestmentRow = { investor: MgInvestor; nok: MgNextOfKin; inv: MgInvestment; series: string; cycle: string; paid: number };
export type MgContactRow = {
  investor: MgInvestor;
  nok: MgNextOfKin;
  series: string;
  count: number;
  cycles: string;
  slots: number;
  capital: number;
  paid: number;
};

type HasPerson = { investor: MgInvestor; nok: MgNextOfKin };

export function mgAddress(i: MgInvestor): string {
  const parts = [i.residential_street_address, i.residential_city, i.residential_lga_name, i.residential_state_name].map(s).filter(Boolean);
  return parts.length ? parts.join(", ") : s(i.address);
}

const KYC_LABEL: Record<string, string> = { pending: "Pending", approved: "Approved", rejected: "Rejected" };
const GENDER_LABEL: Record<string, string> = { female: "Female", male: "Male", prefer_not_to_say: "Prefer not to say" };

/** Payment status of one investment: the same rule as getPaymentStatus(), in kobo. */
export function paymentStatus(capital: number, paid: number): string {
  const c = Math.round(capital * 100), p = Math.round(paid * 100);
  if (p === 0) return "Unpaid";
  if (p < c) return "Part Paid";
  if (p === c) return "Fully Paid";
  return "Overpaid";
}

function personFields<R extends HasPerson>(): FieldDef<R>[] {
  return [
    { key: "investor_code", label: "Investor code", group: "Contact", kind: "text", get: (r) => r.investor.investor_code },
    { key: "full_name", label: "Full name", group: "Contact", get: (r) => r.investor.full_name },
    { key: "phone", label: "Phone number", group: "Contact", kind: "text", get: (r) => s(r.investor.phone) },
    { key: "email", label: "Email address", group: "Contact", get: (r) => r.investor.email },
    { key: "address", label: "Residential address", group: "Profile", get: (r) => mgAddress(r.investor) },
    { key: "state", label: "State of residence", group: "Profile", get: (r) => s(r.investor.residential_state_name) },
    { key: "gender", label: "Gender", group: "Profile", get: (r) => GENDER_LABEL[s(r.investor.gender)] ?? s(r.investor.gender) },
    { key: "nationality", label: "Nationality", group: "Profile", get: (r) => s(r.investor.nationality) },
    { key: "occupation", label: "Occupation", group: "Profile", get: (r) => s(r.investor.occupation) },
    { key: "kyc_status", label: "KYC status", group: "Profile", get: (r) => KYC_LABEL[r.investor.kyc_status] ?? r.investor.kyc_status },
    { key: "nok_name", label: "Next of kin", group: "Next of kin", get: (r) => s(r.nok?.full_name) },
    { key: "nok_relationship", label: "Next of kin relationship", group: "Next of kin", get: (r) => s(r.nok?.relationship) },
    { key: "nok_phone", label: "Next of kin phone", group: "Next of kin", kind: "text", get: (r) => s(r.nok?.phone) },
    { key: "nok_email", label: "Next of kin email", group: "Next of kin", get: (r) => s(r.nok?.email) },
    { key: "bank_name", label: "Bank name", group: "Bank", get: (r) => s(r.investor.bank_name) },
    { key: "account_name", label: "Account name", group: "Bank", get: (r) => s(r.investor.account_name) },
    { key: "account_number", label: "Account number", group: "Bank", kind: "text",
      get: (r, o) => (o.unmask ? s(r.investor.account_number) : maskAccount(r.investor.account_number)) },
  ];
}

const INV_STATUS: Record<string, string> = { active: "Active", matured: "Matured", completed: "Completed", cancelled: "Cancelled" };

export const MG_INVESTMENT_FIELDS: FieldDef<MgInvestmentRow>[] = [
  ...personFields<MgInvestmentRow>(),
  { key: "series", label: "Series", group: "Investment", get: (r) => `Series ${r.series}` },
  { key: "cycle", label: "Cycle", group: "Investment", get: (r) => r.cycle },
  { key: "investment_code", label: "Investment code", group: "Investment", kind: "text", get: (r) => r.inv.investment_code },
  { key: "slots", label: "Number of slots", group: "Investment", kind: "number", get: (r) => Number(r.inv.units) },
  { key: "price_per_slot", label: "Price per slot (NGN)", group: "Investment", kind: "number", get: (r) => money(r.inv.price_per_unit) },
  { key: "capital", label: "Investment amount (NGN)", group: "Investment", kind: "number", get: (r) => money(r.inv.capital) },
  { key: "amount_paid", label: "Amount paid (NGN)", group: "Investment", kind: "number", get: (r) => money(r.paid) },
  { key: "payment_status", label: "Payment status", group: "Investment", get: (r) => paymentStatus(Number(r.inv.capital), r.paid) },
  { key: "investment_date", label: "Investment date", group: "Investment", kind: "date", get: (r) => r.inv.investment_date },
  { key: "maturity_date", label: "Maturity date", group: "Investment", kind: "date", get: (r) => r.inv.maturity_date },
  { key: "status", label: "Investment status", group: "Investment", get: (r) => INV_STATUS[r.inv.status] ?? r.inv.status },
];

export const MG_CONTACT_FIELDS: FieldDef<MgContactRow>[] = [
  ...personFields<MgContactRow>(),
  { key: "series", label: "Series", group: "Investment (totals)", get: (r) => `Series ${r.series}` },
  { key: "investments", label: "Number of investments", group: "Investment (totals)", kind: "number", get: (r) => r.count },
  { key: "cycles", label: "Cycles", group: "Investment (totals)", get: (r) => r.cycles },
  { key: "slots", label: "Total slots", group: "Investment (totals)", kind: "number", get: (r) => r.slots },
  { key: "capital", label: "Total invested (NGN)", group: "Investment (totals)", kind: "number", get: (r) => money(r.capital) },
  { key: "amount_paid", label: "Total paid (NGN)", group: "Investment (totals)", kind: "number", get: (r) => money(r.paid) },
];

export const CONTACT_PRESET = ["full_name", "phone", "email"];

/** One row per person, in name order; their investments in this series summed. */
export function mgContactRows(rows: MgInvestmentRow[]): MgContactRow[] {
  const by = new Map<string, MgContactRow & { cycleSet: Set<string> }>();
  for (const r of rows) {
    let c = by.get(r.investor.id);
    if (!c) {
      c = { investor: r.investor, nok: r.nok, series: r.series, count: 0, cycles: "", slots: 0, capital: 0, paid: 0, cycleSet: new Set() };
      by.set(r.investor.id, c);
    }
    c.count += 1;
    c.slots = Math.round((c.slots + Number(r.inv.units)) * 100) / 100;
    c.capital = Math.round((c.capital + Number(r.inv.capital)) * 100) / 100;
    c.paid = Math.round((c.paid + r.paid) * 100) / 100;
    c.cycleSet.add(r.cycle);
  }
  return [...by.values()]
    .map(({ cycleSet, ...c }) => ({ ...c, cycles: [...cycleSet].join(", ") }))
    .sort((a, b) => a.investor.full_name.localeCompare(b.investor.full_name));
}

/** Investment rows in a stable order: name, then cycle, then date. */
export function sortInvestmentRows(rows: MgInvestmentRow[]): MgInvestmentRow[] {
  return [...rows].sort((a, b) => a.investor.full_name.localeCompare(b.investor.full_name)
    || a.cycle.localeCompare(b.cycle) || a.inv.investment_date.localeCompare(b.inv.investment_date));
}

// ------------------------------------------------------------------
// MaalRise
// ------------------------------------------------------------------
export type MrRow = {
  investor: {
    investor_code: string; full_name: string; email: string; phone: string | null; kyc_status: string;
    bank_name: string | null; account_name: string | null; account_number: string | null; bank_confirmed_at: string | null;
  };
  cycle: string;
  units: number;
  capitalKobo: number;
  participationBps: number | null;
  expectedProfitKobo: number | null;
  profitPaidKobo: number;
  profitApprovedKobo: number;
  capitalReturnedKobo: number;
  fundingDates: string;
  fundingRefs: string;
};

const MR_KYC: Record<string, string> = { not_started: "Not started", pending_review: "Pending review", verified: "Verified", rejected: "Rejected" };

export const MR_FIELDS: FieldDef<MrRow>[] = [
  { key: "investor_code", label: "Investor code", group: "Contact", kind: "text", get: (r) => r.investor.investor_code },
  { key: "full_name", label: "Full name", group: "Contact", get: (r) => r.investor.full_name },
  { key: "phone", label: "Phone number", group: "Contact", kind: "text", get: (r) => s(r.investor.phone) },
  { key: "email", label: "Email address", group: "Contact", get: (r) => r.investor.email },
  { key: "kyc_status", label: "KYC status", group: "Profile", get: (r) => MR_KYC[r.investor.kyc_status] ?? r.investor.kyc_status },
  { key: "cycle", label: "Cycle", group: "Investment", get: (r) => r.cycle },
  { key: "units", label: "Units", group: "Investment", kind: "number", get: (r) => r.units },
  { key: "capital", label: "Capital (NGN)", group: "Investment", kind: "number", get: (r) => kobo(r.capitalKobo) },
  { key: "participation", label: "Participation (%)", group: "Investment", kind: "number",
    get: (r) => (r.participationBps === null ? null : r.participationBps / 100) },
  { key: "expected_profit", label: "Expected profit for the term (NGN)", group: "Investment", kind: "number", get: (r) => kobo(r.expectedProfitKobo) },
  { key: "profit_paid", label: "Profit paid (NGN)", group: "Investment", kind: "number", get: (r) => kobo(r.profitPaidKobo) },
  { key: "profit_approved", label: "Profit approved, not yet paid (NGN)", group: "Investment", kind: "number", get: (r) => kobo(r.profitApprovedKobo) },
  { key: "capital_returned", label: "Capital returned (NGN)", group: "Investment", kind: "number", get: (r) => kobo(r.capitalReturnedKobo) },
  { key: "funding_dates", label: "Date(s) funding received", group: "Investment", get: (r) => r.fundingDates },
  { key: "funding_refs", label: "Funding bank reference(s)", group: "Investment", kind: "text", get: (r) => r.fundingRefs },
  { key: "bank_name", label: "Bank name", group: "Bank", get: (r) => s(r.investor.bank_name) },
  { key: "account_name", label: "Account name", group: "Bank", get: (r) => s(r.investor.account_name) },
  { key: "account_number", label: "Account number", group: "Bank", kind: "text",
    get: (r, o) => (o.unmask ? s(r.investor.account_number) : maskAccount(r.investor.account_number)) },
  { key: "bank_confirmed", label: "Bank details confirmed", group: "Bank", get: (r) => (r.investor.bank_confirmed_at ? "Yes" : "No") },
];

// ------------------------------------------------------------------
// Choosing fields and writing the file
// ------------------------------------------------------------------
/** The chosen fields, in the list's order; unknown keys are refused. */
export function pickFields<R>(defs: FieldDef<R>[], keys: string[]): FieldDef<R>[] | { error: string } {
  const known = new Set(defs.map((d) => d.key));
  const bad = keys.filter((k) => !known.has(k));
  if (bad.length) return { error: `Unknown field(s): ${bad.join(", ")}` };
  const want = new Set(keys);
  const picked = defs.filter((d) => want.has(d.key));
  return picked.length ? picked : { error: "Choose at least one detail to export." };
}

export function table<R>(fields: FieldDef<R>[], rows: R[], unmask: boolean): { head: string[]; body: Cell[][]; kinds: Kind[] } {
  return {
    head: fields.map((f) => f.label),
    body: rows.map((r) => fields.map((f) => f.get(r, { unmask }))),
    kinds: fields.map((f) => f.kind ?? "text"),
  };
}

/**
 * Text a spreadsheet could run as a formula gets a leading apostrophe.
 * A plain number or phone ("+234 803…", "-5") is left alone: Excel
 * reads those as numbers, never as code.
 */
export function neutralize(v: string): string {
  if (/^[=@\t\r]/.test(v)) return `'${v}`;
  if (/^[+-]/.test(v) && !/^[+-]?[\d\s().-]+$/.test(v)) return `'${v}`;
  return v;
}

function csvCell(v: Cell): string {
  const t = v === null ? "" : typeof v === "number" ? String(v) : neutralize(v);
  return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/** UTF-8 with a byte-order mark, so Excel shows ₦ and accented names correctly. */
export function toCsvBytes(head: string[], body: Cell[][]): Buffer {
  const text = [head, ...body].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
  return Buffer.from("﻿" + text, "utf8");
}

/**
 * Excel: text columns (phones, codes, account numbers) are stored as
 * text so leading zeros stay; amounts and counts as numbers. Values in
 * a text cell are never evaluated, but they are neutralised anyway in
 * case the sheet is later saved as CSV.
 */
export function toXlsxBytes(sheetName: string, head: string[], body: Cell[][], kinds: Kind[]): Buffer {
  const aoa: XLSX.CellObject[][] = [
    head.map((h) => ({ t: "s", v: h })),
    ...body.map((r) => r.map((v, i): XLSX.CellObject => {
      if (v === null || v === "") return { t: "s", v: "" };
      if (kinds[i] === "number" && typeof v === "number") return { t: "n", v };
      return { t: "s", v: neutralize(String(v)) };
    })),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = head.map((h, i) => ({ wch: Math.min(48, Math.max(h.length, ...body.slice(0, 200).map((r) => String(r[i] ?? "").length)) + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

export function exportFile(format: ExportFormat, sheet: string, t: { head: string[]; body: Cell[][]; kinds: Kind[] }) {
  return format === "xlsx"
    ? { bytes: toXlsxBytes(sheet, t.head, t.body, t.kinds), type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    : { bytes: toCsvBytes(t.head, t.body), type: "text/csv; charset=utf-8" };
}

export const slug = (x: string) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
