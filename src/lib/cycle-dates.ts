import { addMonths, format } from "date-fns";

/**
 * Parse a YYYY-MM-DD string as a local calendar date.
 * Avoids UTC-shift issues from `new Date("2026-01-25")` (parsed as midnight UTC).
 */
export function parseCycleDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Format a Date back to YYYY-MM-DD for DB storage.
 */
export function formatCycleDateISO(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Calculate maturity as exactly +3 calendar months using date-fns addMonths.
 * Month-end clamping is handled automatically:
 *   31 Jan 2026 → 30 Apr 2026  (April has 30 days)
 *   30 Nov 2026 → 28 Feb 2027  (February 2027 has 28 days)
 *   29 Feb 2028 → 29 May 2028  (2028 is a leap year)
 */
export function calcMaturityDate(startDateStr: string): Date {
  const start = parseCycleDate(startDateStr);
  return addMonths(start, 3);
}

/**
 * Same as calcMaturityDate but returns a YYYY-MM-DD string for form fields.
 */
export function calcMaturityDateStr(startDateStr: string): string {
  return formatCycleDateISO(calcMaturityDate(startDateStr));
}

/**
 * Build a human-readable cycle label from the start date.
 * e.g. start=2026-01-25 → "Jan 2026 – Mar 2026"
 */
export function calcCycleLabel(startDateStr: string): string {
  const start = parseCycleDate(startDateStr);
  const lastMonth = addMonths(start, 2);
  return `${format(start, "MMM yyyy")} – ${format(lastMonth, "MMM yyyy")}`;
}
