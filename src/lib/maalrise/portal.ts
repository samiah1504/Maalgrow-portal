/**
 * The MaalRise investor portal: what an investor sees, and nothing else.
 *
 * Every figure comes from the maalrise_my_* functions (migration 054),
 * called with the investor's own session. They return only the
 * investor's own units, capital and payments — never the Cycle's total
 * size, markup rate, fee workings or other investors — and a month
 * reads "paid" only once staff recorded the transfer.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type MonthStatus = "scheduled" | "due" | "processing" | "approved" | "part_paid" | "paid";

export type MyMonth = {
  period: number;
  due_date: string;
  expected_kobo: number;
  paid_kobo: number;
  approved_kobo: number;
  processing_kobo: number;
  paid_on: string | null;
  references: string[] | null;
  status: MonthStatus;
};

export type MyCapital = {
  due_date: string;
  expected_kobo: number;
  paid_kobo: number;
  paid_on: string | null;
  reference: string | null;
  account_ending: string | null;
  status: Exclude<MonthStatus, "part_paid">;
};

export type MyCycle = {
  id: string;
  name: string;
  counterparty_name: string;
  description: string | null;
  status: "active" | "matured" | "closed";
  start_date: string;
  maturity_date: string;
  duration_months: number;
  units: number;
  unit_price_kobo: number;
  capital_kobo: number;
  months: MyMonth[];
  capital: MyCapital;
};

export type MyPayment = {
  id: string;
  kind: "profit" | "capital";
  cycle_id: string;
  cycle_name: string;
  period: number | null;
  amount_kobo: number;
  status: "payable" | "paid";
  paid_on: string | null;
  reference: string | null;
  bank_name: string | null;
  account_ending: string | null;
};

export type MyProfile = {
  investor_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  status: string;
  kyc_status: string;
  bank: { bank_name: string; account_name: string; account_number: string; confirmed: boolean } | null;
  pending_request: { id: string; bank_name: string; account_name: string; account_number: string; requested_at: string } | null;
  last_decision: { status: "approved" | "rejected"; reason: string | null; reviewed_at: string; account_ending: string } | null;
};

export type MyAccess = { maalrise: boolean; maalgrow: boolean };

async function rpc<T>(db: SupabaseClient, fn: string, args?: Record<string, unknown>): Promise<T> {
  const res = await db.rpc(fn, args);
  if (res.error) throw new Error(`Could not load your MaalRise ${fn.replace("maalrise_my_", "")}: ${res.error.message}`);
  return res.data as T;
}

export const getMyProfile = (db: SupabaseClient) => rpc<MyProfile | null>(db, "maalrise_my_profile");
export const listMyCycles = async (db: SupabaseClient) => (await rpc<MyCycle[] | null>(db, "maalrise_my_cycles")) ?? [];
export const getMyCycle = (db: SupabaseClient, id: string) => rpc<MyCycle | null>(db, "maalrise_my_cycle", { p_cycle: id });
export const listMyPayments = async (db: SupabaseClient) => (await rpc<MyPayment[] | null>(db, "maalrise_my_payments")) ?? [];

// ------------------------------------------------------------------
// Labels
// ------------------------------------------------------------------
export const MONTH_STATUS_LABEL: Record<MonthStatus, string> = {
  scheduled: "Scheduled",
  due: "Awaiting payment",
  processing: "Being processed",
  approved: "Approved for payment",
  part_paid: "Part paid",
  paid: "Paid",
};

export const MONTH_STATUS_VARIANT: Record<MonthStatus, "upcoming" | "warning" | "processing" | "pending" | "matured" | "paid"> = {
  scheduled: "upcoming",
  due: "warning",
  processing: "processing",
  approved: "pending",
  part_paid: "matured",
  paid: "paid",
};

export const MONTH_STATUS_HELP: Record<MonthStatus, string> = {
  scheduled: "The payment date has not arrived yet.",
  due: "The payment date has passed; it has not yet been received and recorded.",
  processing: "Payment received; your share is being reviewed before approval.",
  approved: "Your payment is approved and will be transferred to your account.",
  part_paid: "Part of this month has been paid to you; the rest follows when received.",
  paid: "Transferred to your account.",
};

export const CYCLE_PORTAL_LABEL: Record<MyCycle["status"], string> = { active: "Active", matured: "Matured", closed: "Closed" };
export const CYCLE_PORTAL_VARIANT: Record<MyCycle["status"], "active" | "matured" | "completed"> = {
  active: "active",
  matured: "matured",
  closed: "completed",
};

export function paymentLabel(p: Pick<MyPayment, "kind" | "period">): string {
  return p.kind === "capital" ? "Capital repayment" : `Profit · month ${p.period}`;
}

// ------------------------------------------------------------------
// Figures (pure, so they can be tested without a database)
// ------------------------------------------------------------------
export type NextPayment = { cycleId: string; cycleName: string; label: string; dueDate: string; expectedKobo: number };

export type PortfolioSummary = {
  /** Capital in Cycles whose capital has not yet been repaid. */
  capitalInvestedKobo: number;
  profitPaidKobo: number;
  capitalRepaidKobo: number;
  /** Approved for payment, not yet marked paid. */
  awaitingTransferKobo: number;
  /** Expected profit not yet paid, across every Cycle. */
  profitToComeKobo: number;
  activeCycles: number;
  next: NextPayment | null;
};

export function portfolioSummary(cycles: MyCycle[], today: string): PortfolioSummary {
  let capitalInvestedKobo = 0, profitPaidKobo = 0, capitalRepaidKobo = 0, awaitingTransferKobo = 0, profitToComeKobo = 0;
  const upcoming: NextPayment[] = [];
  for (const c of cycles) {
    if (c.capital.status !== "paid") capitalInvestedKobo += c.capital_kobo;
    capitalRepaidKobo += c.capital.paid_kobo;
    if (c.capital.status === "approved") awaitingTransferKobo += c.capital.expected_kobo;
    for (const m of c.months) {
      profitPaidKobo += m.paid_kobo;
      awaitingTransferKobo += m.approved_kobo;
      profitToComeKobo += Math.max(0, m.expected_kobo - m.paid_kobo);
      if (m.status !== "paid" && m.due_date >= today) {
        upcoming.push({ cycleId: c.id, cycleName: c.name, label: `Profit · month ${m.period}`, dueDate: m.due_date, expectedKobo: m.expected_kobo });
      }
    }
    if (c.capital.status !== "paid" && c.capital.due_date >= today) {
      upcoming.push({ cycleId: c.id, cycleName: c.name, label: "Capital repayment", dueDate: c.capital.due_date, expectedKobo: c.capital.expected_kobo });
    }
  }
  upcoming.sort((a, b) => (a.dueDate === b.dueDate ? a.cycleName.localeCompare(b.cycleName) : a.dueDate < b.dueDate ? -1 : 1));
  return {
    capitalInvestedKobo,
    profitPaidKobo,
    capitalRepaidKobo,
    awaitingTransferKobo,
    profitToComeKobo,
    activeCycles: cycles.filter((c) => c.status !== "closed").length,
    next: upcoming[0] ?? null,
  };
}

/** Totals for one Cycle's months. */
export function cycleProfitTotals(c: MyCycle) {
  return c.months.reduce(
    (t, m) => ({ expected: t.expected + m.expected_kobo, paid: t.paid + m.paid_kobo }),
    { expected: 0, paid: 0 }
  );
}

/** "1234567" kobo → "12345.67": plain, spreadsheet-safe naira. */
function nairaPlain(kobo: number): string {
  const sign = kobo < 0 ? "-" : "";
  const k = Math.abs(kobo);
  return `${sign}${Math.floor(k / 100)}.${String(k % 100).padStart(2, "0")}`;
}

function csvCell(v: string): string {
  // A leading = + - @ would run as a formula in a spreadsheet.
  const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Paid payments only: a statement lists money that actually reached the investor. */
export function statementCsv(payments: MyPayment[]): string {
  const rows = payments
    .filter((p) => p.status === "paid")
    .map((p) => [p.paid_on ?? "", p.cycle_name, paymentLabel(p), nairaPlain(p.amount_kobo), p.reference ?? "", p.bank_name ?? "",
                 p.account_ending ? `****${p.account_ending}` : ""]);
  const head = ["Date paid", "Cycle", "Payment", "Amount (NGN)", "Transfer reference", "Bank", "Account"];
  return [head, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
