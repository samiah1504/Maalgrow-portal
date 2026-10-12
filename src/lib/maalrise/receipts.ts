/**
 * Where each scheduled month stands against what the counterparty has
 * actually paid. Pure, so the Cycle page, the dashboard and the tests
 * agree on one definition.
 *
 * The scheduled date and the date money arrived are kept apart: a
 * month is never treated as paid, or as zero, because its date passed.
 * Five days after the scheduled date, a month that is still not fully
 * recorded is flagged for follow-up (the database raises the same
 * reminders, see maalrise_sync_reminders in migration 052).
 */
import { differenceInCalendarDays } from "date-fns";
import { parseIsoDate } from "./dates";

export const FOLLOW_UP_AFTER_DAYS = 5;

export type MonthStatus = "upcoming" | "due_today" | "awaiting" | "follow_up" | "part_paid" | "received";

export const MONTH_STATUS_LABEL: Record<MonthStatus, string> = {
  upcoming: "Upcoming",
  due_today: "Due today",
  awaiting: "Awaiting payment",
  follow_up: "Follow up",
  part_paid: "Part-paid",
  received: "Received",
};

export const MONTH_STATUS_VARIANT: Record<MonthStatus, "upcoming" | "warning" | "danger" | "info" | "approved"> = {
  upcoming: "upcoming",
  due_today: "warning",
  awaiting: "warning",
  follow_up: "danger",
  part_paid: "info",
  received: "approved",
};

export type MonthPosition = {
  period: number;
  dueDate: string;
  scheduledKobo: number;
  /** Confirmed money applied to this month (never more than scheduled). */
  confirmedKobo: number;
  /** Recorded but not yet confirmed. */
  pendingKobo: number;
  /** Confirmed money beyond the schedule, held and not distributed. */
  heldKobo: number;
  outstandingKobo: number;
  daysLate: number;
  status: MonthStatus;
  followUp: boolean;
};

type Line = { period: number; due_date: string; counterparty_gross_kobo: number };
type Receipt = { period: number; amount_kobo: number; status: string; applied_kobo: number | null; held_kobo: number | null };

/** "Today" for due dates is the business's day in Lagos. */
export function lagosToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function monthPositions(lines: Line[], receipts: Receipt[], todayIso: string): MonthPosition[] {
  const today = parseIsoDate(todayIso);
  return [...lines]
    .sort((a, b) => a.period - b.period)
    .map((l) => {
      const mine = receipts.filter((r) => r.period === l.period);
      const confirmedKobo = mine.filter((r) => r.status === "confirmed").reduce((s, r) => s + (r.applied_kobo ?? 0), 0);
      const heldKobo = mine.filter((r) => r.status === "confirmed").reduce((s, r) => s + (r.held_kobo ?? 0), 0);
      const pendingKobo = mine.filter((r) => r.status === "recorded").reduce((s, r) => s + r.amount_kobo, 0);
      const outstandingKobo = Math.max(l.counterparty_gross_kobo - confirmedKobo, 0);
      const due = parseIsoDate(l.due_date);
      const daysLate = today && due ? differenceInCalendarDays(today, due) : 0;
      const recordedTotal = confirmedKobo + pendingKobo;
      const fullyRecorded = recordedTotal >= l.counterparty_gross_kobo;

      let status: MonthStatus;
      if (outstandingKobo === 0) status = "received";
      else if (confirmedKobo > 0) status = "part_paid";
      else if (daysLate < 0) status = "upcoming";
      else if (daysLate === 0) status = "due_today";
      else if (daysLate >= FOLLOW_UP_AFTER_DAYS && !fullyRecorded) status = "follow_up";
      else status = "awaiting";

      return {
        period: l.period,
        dueDate: l.due_date,
        scheduledKobo: l.counterparty_gross_kobo,
        confirmedKobo,
        pendingKobo,
        heldKobo,
        outstandingKobo,
        daysLate,
        status,
        followUp: daysLate >= FOLLOW_UP_AFTER_DAYS && !fullyRecorded,
      };
    });
}

/** The month a new payment most likely belongs to: the earliest not yet fully received. */
export function suggestedPeriod(positions: MonthPosition[]): number | null {
  return positions.find((p) => p.outstandingKobo > 0 && p.confirmedKobo + p.pendingKobo < p.scheduledKobo)?.period
    ?? positions.find((p) => p.outstandingKobo > 0)?.period
    ?? null;
}

export const PAYMENT_STATUS_LABEL = {
  pending_approval: "Awaiting approval",
  payable: "Approved — to pay",
  paid: "Paid",
} as const;
