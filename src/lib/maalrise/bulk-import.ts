/**
 * Bulk import of a Cycle's investors and their funding, from a file
 * (CSV or Excel) or a Google Sheet. Pure functions — no database — so
 * they can be tested on their own.
 *
 * One row = one investor's capital for this Cycle. Importing a row
 * gives the person MaalRise access (a new login for someone who has
 * none — NOTHING is sent) and RECORDS the funding; confirming it is a
 * separate step, as for funding typed in by hand.
 */
import * as XLSX from "xlsx";
import { normalizeEmail, parseDateValue } from "@/lib/migration-parse";

export const IMPORT_COLUMNS = [
  "Email", "Full name", "Phone", "Units", "Date received", "Bank reference",
  "Bank name", "Account name", "Account number",
] as const;

export function importTemplateCsv(): string {
  return [
    IMPORT_COLUMNS.join(","),
    // The importer skips any row whose name starts with EXAMPLE.
    `"investor@email.com","EXAMPLE - delete this row","0803 123 4567","10","15/10/2026","TRF-00123","Access Bank","Amina Bello","0123456789"`,
  ].join("\r\n");
}

type Field = "email" | "full_name" | "phone" | "units" | "received_on" | "reference" | "bank_name" | "account_name" | "account_number";

const HEADERS: Record<string, Field> = {
  email: "email", emailaddress: "email",
  fullname: "full_name", name: "full_name", investorname: "full_name",
  phone: "phone", phonenumber: "phone", mobile: "phone",
  units: "units", numberofunits: "units", unit: "units",
  datereceived: "received_on", date: "received_on", paymentdate: "received_on", datepaid: "received_on",
  bankreference: "reference", reference: "reference", paymentreference: "reference", ref: "reference",
  bankname: "bank_name", bank: "bank_name",
  accountname: "account_name",
  accountnumber: "account_number", accountno: "account_number",
};

export type ImportRow = {
  row: number;
  email: string;
  full_name: string;
  phone: string;
  units: number | null;
  received_on: string | null;
  reference: string;
  bank_name: string;
  account_name: string;
  account_number: string;
};

const text = (v: unknown) => (v === null || v === undefined ? "" : v instanceof Date ? "" : String(v)).trim();

/** A spreadsheet number loses an account number's leading zero; put it back. */
function accountNumber(v: unknown): string {
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return String(v).padStart(10, "0");
  return text(v).replace(/\s/g, "");
}

function units(v: unknown): number | null {
  if (typeof v === "number") return v;
  const s = text(v).replace(/,/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

/** Reads the first sheet. CSV text is read as text, so 05/10/2026 stays 5 October (DD/MM/YYYY). */
export function parseImportSheet(buffer: Buffer): { rows: ImportRow[]; error: string | null } {
  const binary = buffer.length >= 2 && ((buffer[0] === 0x50 && buffer[1] === 0x4b) || (buffer[0] === 0xd0 && buffer[1] === 0xcf));
  let wb: XLSX.WorkBook;
  try {
    wb = binary
      ? XLSX.read(buffer, { type: "buffer", cellDates: true })
      : XLSX.read(buffer.toString("utf8").replace(/^﻿/, ""), { type: "string", raw: true });
  } catch {
    return { rows: [], error: "The file could not be read. Upload a CSV or Excel file." };
  }
  const sheet = wb.SheetNames[0] ? wb.Sheets[wb.SheetNames[0]] : null;
  if (!sheet) return { rows: [], error: "The file contains no sheets." };
  const raw: unknown[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: false });
  if (raw.length === 0) return { rows: [], error: "The sheet is empty." };

  const cols = raw[0].map((h) => HEADERS[String(h ?? "").toLowerCase().replace(/[^a-z]/g, "")] ?? null);
  const missing = (["email", "units", "received_on", "reference"] as Field[]).filter((f) => !cols.includes(f));
  if (missing.length) {
    const label: Record<string, string> = { email: "Email", units: "Units", received_on: "Date received", reference: "Bank reference" };
    return { rows: [], error: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.map((m) => label[m]).join(", ")}. Download the template to see the format.` };
  }

  const rows: ImportRow[] = [];
  for (let i = 1; i < raw.length; i++) {
    const get = (f: Field): unknown => { const k = cols.indexOf(f); return k >= 0 ? raw[i][k] : ""; };
    const name = text(get("full_name"));
    if (name.toUpperCase().startsWith("EXAMPLE")) continue;
    const row: ImportRow = {
      row: i + 1,
      email: normalizeEmail(text(get("email"))) ?? "",
      full_name: name,
      phone: text(get("phone")),
      units: units(get("units")),
      received_on: parseDateValue(get("received_on")),
      reference: text(get("reference")),
      bank_name: text(get("bank_name")),
      account_name: text(get("account_name")),
      account_number: accountNumber(get("account_number")),
    };
    if (!row.email && !row.full_name && row.units === null && !row.reference) continue;
    rows.push(row);
  }
  if (rows.length === 0) return { rows: [], error: "No investor rows were found below the header row." };
  if (rows.length > 500) return { rows: [], error: "Import at most 500 rows at a time." };
  return { rows, error: null };
}

/** What the import already knows about a row's email address. */
export type PersonStatus =
  | { kind: "new" }
  | { kind: "login"; name: string | null }
  | { kind: "maalrise"; name: string }
  | { kind: "staff" };

export type CheckedRow = ImportRow & {
  person: "new" | "login" | "maalrise" | "staff";
  /** "already imported": this reference is already recorded in this Cycle — the row is skipped. */
  status: "ready" | "already_imported" | "error";
  issues: string[];
  amount_kobo: number;
};

export type ImportContext = {
  today: string;
  unitPriceKobo: number;
  /** Units the Cycle still needs: required minus everything recorded or confirmed. */
  unitsAvailable: number;
  /** References already used in this Cycle (lower-cased, not rejected). */
  usedReferences: Set<string>;
  people: Record<string, PersonStatus>;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function checkImportRows(rows: ImportRow[], ctx: ImportContext): { rows: CheckedRow[]; summary: ImportSummary } {
  const seenRef = new Map<string, number>();
  const seenEmail = new Map<string, number>();
  for (const r of rows) {
    const ref = r.reference.toLowerCase();
    if (ref) seenRef.set(ref, (seenRef.get(ref) ?? 0) + 1);
    if (r.email) seenEmail.set(r.email, (seenEmail.get(r.email) ?? 0) + 1);
  }

  let unitsLeft = ctx.unitsAvailable;
  const out: CheckedRow[] = rows.map((r) => {
    const issues: string[] = [];
    const person = r.email ? ctx.people[r.email] ?? { kind: "new" as const } : { kind: "new" as const };
    const ref = r.reference.toLowerCase();
    if (!r.email) issues.push("Email is required");
    else if (!EMAIL_RE.test(r.email)) issues.push(`“${r.email}” is not a valid email`);
    else if ((seenEmail.get(r.email) ?? 0) > 1) issues.push("This email appears more than once — put one investor on one row");
    if (person.kind === "staff") issues.push("This is a staff account; staff cannot be MaalRise investors");
    if (person.kind === "new" && r.full_name.length < 2) issues.push("Full name is required for a new person");
    if (r.units === null) issues.push("Units are required");
    else if (!Number.isInteger(r.units) || r.units <= 0) issues.push("Units must be a whole number greater than zero");
    if (!r.received_on) issues.push("Date received is required (DD/MM/YYYY or YYYY-MM-DD)");
    else if (r.received_on > ctx.today) issues.push("Date received cannot be in the future");
    if (!r.reference) issues.push("Bank reference is required");
    else if (!ctx.usedReferences.has(ref) && (seenRef.get(ref) ?? 0) > 1) issues.push("This bank reference appears more than once");
    const anyBank = !!(r.bank_name || r.account_name || r.account_number);
    if (anyBank && person.kind !== "maalrise" && (!r.bank_name || !r.account_name || !/^\d{10}$/.test(r.account_number))) {
      issues.push("Bank details need a bank name, an account name and a 10-digit account number (or leave all three empty)");
    }

    const already = !!r.reference && ctx.usedReferences.has(ref);
    let status: CheckedRow["status"] = already ? "already_imported" : issues.length ? "error" : "ready";
    if (status === "ready") {
      if ((r.units as number) > unitsLeft) {
        issues.push(`Only ${unitsLeft} unit${unitsLeft === 1 ? "" : "s"} still needed in this Cycle`);
        status = "error";
      } else unitsLeft -= r.units as number;
    }
    return {
      ...r,
      person: person.kind,
      status,
      issues: already ? [] : issues,
      amount_kobo: status === "error" || r.units === null || !Number.isInteger(r.units) ? 0 : r.units * ctx.unitPriceKobo,
    };
  });
  return { rows: out, summary: summarize(out) };
}

export type ImportSummary = {
  ready: number;
  errors: number;
  alreadyImported: number;
  newPeople: number;
  existingLogins: number;
  units: number;
  amountKobo: number;
};

export function summarize(rows: CheckedRow[]): ImportSummary {
  const ready = rows.filter((r) => r.status === "ready");
  return {
    ready: ready.length,
    errors: rows.filter((r) => r.status === "error").length,
    alreadyImported: rows.filter((r) => r.status === "already_imported").length,
    newPeople: ready.filter((r) => r.person === "new").length,
    existingLogins: ready.filter((r) => r.person !== "new").length,
    units: ready.reduce((t, r) => t + (r.units ?? 0), 0),
    amountKobo: ready.reduce((t, r) => t + r.amount_kobo, 0),
  };
}

/** Rows sent back by the browser for the import step: re-shaped, then checked again on the server. */
export function sanitizeImportRows(input: unknown): ImportRow[] | null {
  if (!Array.isArray(input) || input.length === 0 || input.length > 500) return null;
  const s = (v: unknown, max = 200) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return input.map((x, i) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return {
      row: Number.isInteger(o.row) ? (o.row as number) : i + 2,
      email: normalizeEmail(s(o.email)) ?? "",
      full_name: s(o.full_name),
      phone: s(o.phone, 40),
      units: typeof o.units === "number" && Number.isFinite(o.units) ? o.units : null,
      received_on: typeof o.received_on === "string" && /^\d{4}-\d{2}-\d{2}$/.test(o.received_on) ? o.received_on : null,
      reference: s(o.reference, 120),
      bank_name: s(o.bank_name, 120),
      account_name: s(o.account_name, 120),
      account_number: s(o.account_number, 20),
    };
  });
}
