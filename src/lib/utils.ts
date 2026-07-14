import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { format, formatDistance, isAfter, isBefore, addMonths, startOfMonth, endOfMonth } from "date-fns";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatCurrency(amount: number, currency = "NGN"): string {
  return new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatDate(date: string | Date): string {
  return format(new Date(date), "dd MMM yyyy");
}

export function formatDateTime(date: string | Date): string {
  return format(new Date(date), "dd MMM yyyy, HH:mm");
}

export function formatRelativeTime(date: string | Date): string {
  return formatDistance(new Date(date), new Date(), { addSuffix: true });
}

export function formatNumber(num: number): string {
  return new Intl.NumberFormat("en-NG").format(num);
}

export function formatPercentage(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

export type SeriesId = "A" | "B" | "C";

export interface CycleDates {
  startDate: Date;
  endDate: Date;
  cycleLabel: string;
}

/**
 * Calculate the start month (0-indexed) for each series in a given year.
 * Series A starts in January (0), B in February (1), C in March (2).
 * Each cycle is 3 months. Given a reference date, find the current cycle.
 */
export function getCurrentCycleForSeries(series: SeriesId, referenceDate = new Date()): CycleDates {
  const seriesStartOffset: Record<SeriesId, number> = { A: 0, B: 1, C: 2 };
  const offset = seriesStartOffset[series];

  // Month indices where cycles start for this series (within a calendar year)
  // Cycle starts: offset, offset+3, offset+6, offset+9
  // But can cross year boundaries for Series B (Nov→Jan) and C (Dec→Feb)

  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-indexed

  // Find which cycle of the series we're in
  let cycleStart: Date | null = null;

  for (let i = -1; i <= 4; i++) {
    const candidateMonth = offset + i * 3;
    const candidateYear = year + Math.floor(candidateMonth / 12);
    const normalizedMonth = ((candidateMonth % 12) + 12) % 12;
    const candidate = new Date(candidateYear, normalizedMonth, 1);
    const candidateEnd = addMonths(candidate, 3);

    if (!isAfter(candidate, referenceDate) && isAfter(candidateEnd, referenceDate)) {
      cycleStart = candidate;
      break;
    }
  }

  if (!cycleStart) {
    // Fallback: calculate next upcoming cycle
    const nextMonth = offset - (((month - offset) % 3 + 3) % 3) + 3;
    const m = ((nextMonth % 12) + 12) % 12;
    const y = year + Math.floor(nextMonth / 12);
    cycleStart = new Date(y, m, 1);
  }

  const cycleEnd = addMonths(cycleStart, 3);
  const cycleLabel = `${format(cycleStart, "MMM yyyy")} – ${format(addMonths(cycleStart, 2), "MMM yyyy")}`;

  return {
    startDate: cycleStart,
    endDate: cycleEnd,
    cycleLabel,
  };
}

export function getNextCycleForSeries(series: SeriesId, currentCycleStart: Date): CycleDates {
  const nextStart = addMonths(currentCycleStart, 3);
  const nextEnd = addMonths(nextStart, 3);
  const cycleLabel = `${format(nextStart, "MMM yyyy")} – ${format(addMonths(nextStart, 2), "MMM yyyy")}`;
  return { startDate: nextStart, endDate: nextEnd, cycleLabel };
}

export function calculateMaturityDate(investmentDate: Date, cycleEndDate: Date): Date {
  return cycleEndDate;
}

export function isInvestmentMatured(maturityDate: string | Date): boolean {
  return isAfter(new Date(), new Date(maturityDate));
}

export function getDaysUntilMaturity(maturityDate: string | Date): number {
  const ms = new Date(maturityDate).getTime() - new Date().getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

export function calculateROI(capital: number, roiRate: number): number {
  return capital * roiRate;
}

export function truncate(str: string, length = 40): string {
  return str.length > length ? `${str.slice(0, length)}...` : str;
}

export function generateInvestmentId(series: string, cycleIndex: number, investorIndex: number): string {
  return `MG-${series}-${String(cycleIndex).padStart(3, "0")}-${String(investorIndex).padStart(4, "0")}`;
}

export function getStatusColor(status: string): string {
  switch (status.toLowerCase()) {
    case "active": return "status-active";
    case "matured": return "status-matured";
    case "completed": return "status-completed";
    case "pending": return "status-pending";
    case "approved": return "status-active";
    case "rejected": return "bg-red-100 text-red-700";
    default: return "bg-gray-100 text-gray-700";
  }
}

export function getSeriesColor(series: string): string {
  switch (series.toUpperCase()) {
    case "A": return "bg-primary-100 text-primary-700";
    case "B": return "bg-gold-100 text-gold-700";
    case "C": return "bg-blue-100 text-blue-700";
    default: return "bg-gray-100 text-gray-700";
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}
