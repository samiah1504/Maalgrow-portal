import * as XLSX from "xlsx";
import { isValidSlots, calcCapital } from "@/lib/investment-utils";

// ============================================================
// Template
// ============================================================

export const TEMPLATE_COLUMNS = [
  "Full Name",
  "Phone Number",
  "Email Address",
  "Residential Address",
  "Number of Slots",
  "Amount Paid",
  "Payment Date",
  "Payment Reference",
  "Notes",
] as const;

export function buildTemplateCsv(): string {
  return [
    TEMPLATE_COLUMNS.join(","),
    // Example row — the importer skips any row whose name starts with EXAMPLE
    `"EXAMPLE - delete this row","0803 123 4567","investor@email.com","12 Marina Road Lagos","1.5","750000","2026-06-30","TRF-00123","Migrated from old records"`,
  ].join("\r\n");
}

// ============================================================
// Header mapping — tolerant of naming/spacing/case variations
// ============================================================

const HEADER_MAP: Record<string, string> = {
  fullname: "full_name",
  name: "full_name",
  investorname: "full_name",
  phonenumber: "phone",
  phone: "phone",
  phoneno: "phone",
  mobile: "phone",
  emailaddress: "email",
  email: "email",
  residentialaddress: "address",
  address: "address",
  numberofslots: "slots",
  slots: "slots",
  slot: "slots",
  units: "slots",
  amountpaid: "amount_paid",
  amount: "amount_paid",
  paid: "amount_paid",
  paymentdate: "payment_date",
  datepaid: "payment_date",
  paymentreference: "payment_reference",
  reference: "payment_reference",
  ref: "payment_reference",
  notes: "notes",
  note: "notes",
  comment: "notes",
};

function normalizeHeader(h: string): string | null {
  const key = h.toLowerCase().replace(/[^a-z]/g, "");
  return HEADER_MAP[key] ?? null;
}

// ============================================================
// Value normalization
// ============================================================

/** Canonical phone form used for duplicate matching: last 10 digits. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, "");
  if (digits.length < 7) return null;
  return digits.length > 10 ? digits.slice(-10) : digits;
}

export function normalizeEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const e = String(raw).trim().toLowerCase();
  return e.length > 0 ? e : null;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function parseNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return isFinite(v) ? v : null;
  // Strip currency symbols, thousands separators, and any stray
  // non-numeric characters (including mojibake from bad encodings)
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  if (cleaned === "" || cleaned === "-" || cleaned === ".") return null;
  const n = Number(cleaned);
  return isFinite(n) ? n : null;
}

/** Accepts Date objects, YYYY-MM-DD, DD/MM/YYYY, DD-MM-YYYY. */
export function parseDateValue(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    // Nigerian convention: DD/MM/YYYY
    const [, d, mo, y] = m;
    const day = Number(d);
    const month = Number(mo);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  return null;
}

// ============================================================
// Parsing
// ============================================================

export type ParsedRow = {
  row_number: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  slots: number | null;
  amount_paid: number;
  payment_date: string | null;
  payment_reference: string | null;
  notes: string | null;
  status: "valid" | "invalid";
  issue: string | null;
};

/**
 * Parses an uploaded CSV or XLSX buffer (SheetJS auto-detects the
 * format) into normalized, validated rows. Google Sheets exports
 * arrive here as CSV — identical treatment.
 */
export function parseSpreadsheet(buffer: Buffer): {
  rows: ParsedRow[];
  errors: string[];
} {
  const errors: string[] = [];

  // XLSX/XLS files start with a zip ("PK") or CFB magic; anything else is
  // treated as CSV text and MUST be decoded as UTF-8 explicitly — SheetJS's
  // codepage sniffing otherwise mangles characters like "₦".
  const isBinary =
    buffer.length >= 2 &&
    ((buffer[0] === 0x50 && buffer[1] === 0x4b) ||
      (buffer[0] === 0xd0 && buffer[1] === 0xcf));

  const wb = isBinary
    ? XLSX.read(buffer, { type: "buffer", cellDates: true })
    : XLSX.read(buffer.toString("utf8").replace(/^﻿/, ""), {
        type: "string",
        cellDates: true,
      });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { rows: [], errors: ["The file contains no sheets"] };

  const raw: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: "",
    blankrows: false,
  });

  if (raw.length === 0) return { rows: [], errors: ["The sheet is empty"] };

  // Map headers
  const headerRow = raw[0].map((h) => String(h ?? ""));
  const colMap: (string | null)[] = headerRow.map(normalizeHeader);

  const required = ["full_name", "slots"];
  for (const req of required) {
    if (!colMap.includes(req)) {
      const label = req === "full_name" ? "Full Name" : "Number of Slots";
      errors.push(
        `Missing required column "${label}". Download the migration template to see the expected format.`
      );
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: ParsedRow[] = [];

  for (let i = 1; i < raw.length; i++) {
    const cells = raw[i];
    const get = (field: string): unknown => {
      const idx = colMap.indexOf(field);
      return idx >= 0 ? cells[idx] : "";
    };

    const fullName = String(get("full_name") ?? "").trim();
    const phoneRaw = String(get("phone") ?? "").trim();
    const emailRaw = String(get("email") ?? "").trim();

    // Entirely empty line → ignore silently
    if (!fullName && !phoneRaw && !emailRaw) continue;
    // Template example row → ignore silently
    if (fullName.toUpperCase().startsWith("EXAMPLE")) continue;

    const email = normalizeEmail(emailRaw);
    const phone = normalizePhone(phoneRaw);
    const slots = parseNumber(get("slots"));
    const amountPaid = parseNumber(get("amount_paid")) ?? 0;
    const paymentDate = parseDateValue(get("payment_date"));

    const issues: string[] = [];
    if (fullName.length < 2) issues.push("Full name is required");
    if (!email) issues.push("Email address is required");
    else if (!EMAIL_RE.test(email)) issues.push(`Invalid email "${emailRaw}"`);
    if (!phone) issues.push("Phone number is required");
    if (slots === null) issues.push("Number of slots is required");
    else if (!isValidSlots(slots))
      issues.push(
        `Invalid slot quantity ${slots} — slots must be at least 0.5 and in 0.5 increments (0.5, 1, 1.5, 2, …)`
      );
    if (amountPaid < 0) issues.push("Amount paid cannot be negative");
    if (amountPaid > 0 && !paymentDate)
      issues.push("Payment date is required when an amount was paid (use YYYY-MM-DD or DD/MM/YYYY)");

    rows.push({
      row_number: i + 1, // 1-based including header, matches what staff see
      full_name: fullName,
      phone: phoneRaw ? phoneRaw : null,
      email,
      address: String(get("address") ?? "").trim() || null,
      slots,
      amount_paid: amountPaid,
      payment_date: paymentDate,
      payment_reference: String(get("payment_reference") ?? "").trim() || null,
      notes: String(get("notes") ?? "").trim() || null,
      status: issues.length === 0 ? "valid" : "invalid",
      issue: issues.length > 0 ? issues.join("; ") : null,
    });
  }

  if (rows.length === 0) {
    errors.push("No investor rows found below the header row");
  }

  return { rows, errors };
}

// ============================================================
// Google Sheets
// ============================================================

/**
 * Converts a Google Sheets share link into its CSV export URLs.
 * Works for sheets shared as "Anyone with the link can view".
 *
 * Returns null for links that are not normal spreadsheet URLs, and
 * an error marker for "Publish to web" links (/d/e/2PACX-…), which
 * do not contain the real spreadsheet id.
 */
export function googleSheetsCsvUrl(
  link: string
): { primary: string; fallback: string } | "published_link" | null {
  if (/docs\.google\.com\/spreadsheets\/d\/e\//.test(link)) {
    return "published_link";
  }
  // Real spreadsheet ids are long (typically 40+ chars)
  const m = link.match(/docs\.google\.com\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/);
  if (!m) return null;
  const id = m[1];
  const gidMatch = link.match(/[#?&]gid=(\d+)/);
  // No gid in the link → omit it entirely: Google then exports the
  // first tab, which is correct even when the first tab's gid ≠ 0.
  const gidParam = gidMatch ? `&gid=${gidMatch[1]}` : "";
  return {
    primary: `https://docs.google.com/spreadsheets/d/${id}/export?format=csv${gidParam}`,
    fallback: `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv${gidParam}`,
  };
}

// ============================================================
// Row-level derived figures
// ============================================================

export function expectedCapital(slots: number | null): number {
  return slots !== null && isValidSlots(slots) ? calcCapital(slots) : 0;
}
