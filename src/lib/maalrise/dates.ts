/**
 * MaalRise calendar helpers.
 *
 * Provisional until A4 is confirmed: the first monthly payment falls
 * one month after the start date, period k falls k months after it,
 * and maturity is the start date plus the duration. date-fns clamps a
 * month-end start (31 Jan + 1 month = 28/29 Feb). No weekend or public
 * holiday adjustment is made — that is the contract's to specify.
 */
import { addMonths, format } from "date-fns";

/** Parse "yyyy-mm-dd" as a calendar date, not a UTC instant. */
export function parseIsoDate(iso: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return d.getMonth() === Number(m[2]) - 1 ? d : null;
}

export function toIsoDate(d: Date): string {
  return format(d, "yyyy-MM-dd");
}

export function periodDueDate(startIso: string, period: number): string | null {
  const start = parseIsoDate(startIso);
  return start ? toIsoDate(addMonths(start, period)) : null;
}

export function maturityDate(startIso: string, durationMonths: number): string | null {
  return periodDueDate(startIso, durationMonths);
}
