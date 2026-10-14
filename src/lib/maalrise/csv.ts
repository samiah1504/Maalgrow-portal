/** CSV for spreadsheets and accountants: plain naira, quoted where needed, formulas neutralised. */

/** 1234567 kobo → "12345.67". */
export function nairaPlain(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const k = Math.abs(kobo);
  return `${sign}${Math.floor(k / 100)}.${String(k % 100).padStart(2, "0")}`;
}

export function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(head: string[], rows: (string | number | null | undefined)[][]): string {
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
