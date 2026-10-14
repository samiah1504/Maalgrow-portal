/**
 * Staff reports: the monthly payments register (for bank
 * reconciliation) and the per-Cycle report (for the accountant).
 * Pure functions over rows already loaded under staff RLS, so they
 * can be tested without a database.
 */
import type { CycleDetail } from "./db";
import type { AuditRow, CapitalPaymentRow, DistributionLineRow } from "./types";
import { nairaPlain, toCsv } from "./csv";

// ------------------------------------------------------------------
// Monthly payments register
// ------------------------------------------------------------------
export type RegisterRow = {
  paidOn: string;
  cycleName: string;
  payment: string;
  investorName: string;
  investorCode: string;
  amountKobo: number;
  bankName: string;
  accountName: string;
  accountNumber: string;
  reference: string;
  markedBy: string;
};

/** "2026-10" → first and last day. Refuses anything else. */
export function monthRange(month: string): { from: string; to: string } | null {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(month);
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]);
  const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { from: `${m[1]}-${m[2]}-01`, to: `${m[1]}-${m[2]}-${String(last).padStart(2, "0")}` };
}

export function registerRows(
  profit: (DistributionLineRow & { cycle_name: string })[],
  capital: (CapitalPaymentRow & { cycle_name: string })[],
  names: Record<string, string>
): RegisterRow[] {
  const row = (r: DistributionLineRow | CapitalPaymentRow, cycleName: string, payment: string): RegisterRow => ({
    paidOn: r.paid_on ?? "",
    cycleName,
    payment,
    investorName: r.investor_name,
    investorCode: r.investor_code,
    amountKobo: r.amount_kobo,
    bankName: r.bank_name ?? "",
    accountName: r.account_name ?? "",
    accountNumber: r.account_number ?? "",
    reference: r.paid_reference ?? "",
    markedBy: r.paid_by ? names[r.paid_by] ?? "" : "",
  });
  return [
    ...profit.filter((l) => l.status === "paid").map((l) => row(l, l.cycle_name, `Profit · month ${l.period}`)),
    ...capital.filter((p) => p.status === "paid").map((p) => row(p, p.cycle_name, "Capital repayment")),
  ].sort((a, b) => a.paidOn.localeCompare(b.paidOn) || a.cycleName.localeCompare(b.cycleName) || a.investorName.localeCompare(b.investorName));
}

export function registerCsv(rows: RegisterRow[]): string {
  return toCsv(
    ["Date paid", "Cycle", "Payment", "Investor", "Investor code", "Amount (NGN)", "Bank", "Account name", "Account number",
     "Transfer reference", "Marked paid by"],
    rows.map((r) => [r.paidOn, r.cycleName, r.payment, r.investorName, r.investorCode, nairaPlain(r.amountKobo), r.bankName,
                     r.accountName, r.accountNumber, r.reference, r.markedBy])
  );
}

// ------------------------------------------------------------------
// Per-Cycle report
// ------------------------------------------------------------------
export type CycleInvestorLine = {
  investorId: string;
  name: string;
  code: string;
  units: number;
  capitalKobo: number;
  profitPaidKobo: number;
  profitApprovedKobo: number;
  capitalReturnedKobo: number;
};

export type CycleReport = {
  received: { date: string; what: string; reference: string; amountKobo: number; feeKobo: number; netKobo: number; status: string }[];
  totals: { profitReceivedKobo: number; feeKobo: number; netKobo: number; capitalReceivedKobo: number; distributedKobo: number;
            unallocatedKobo: number; profitPaidKobo: number; capitalReturnedKobo: number };
  investors: CycleInvestorLine[];
};

const RECEIPT_STATUS: Record<string, string> = { recorded: "Awaiting confirmation", confirmed: "Confirmed", rejected: "Rejected", reversed: "Reversed" };

export function cycleReport(d: CycleDetail): CycleReport {
  const received = [
    ...d.receipts.map((r) => ({
      date: r.received_on, what: `Profit · month ${r.period}`, reference: r.reference ?? "", amountKobo: r.amount_kobo,
      feeKobo: r.status === "confirmed" ? r.fee_kobo ?? 0 : 0, netKobo: r.status === "confirmed" ? r.net_kobo ?? 0 : 0,
      status: RECEIPT_STATUS[r.status] ?? r.status,
    })),
    ...d.capitalReceipts.map((c) => ({
      date: c.received_on, what: "Capital", reference: c.reference ?? "", amountKobo: c.amount_kobo, feeKobo: 0,
      netKobo: c.status === "confirmed" ? c.amount_kobo : 0, status: RECEIPT_STATUS[c.status] ?? c.status,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.what.localeCompare(b.what));

  const lines = d.distributions.flatMap((x) => x.lines);
  const capPays = d.capitalSettlements.filter((s) => s.status !== "cancelled").flatMap((s) => s.payments);
  const confirmed = d.receipts.filter((r) => r.status === "confirmed");
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);

  const investors: CycleInvestorLine[] = d.allocations.map((a) => {
    const own = lines.filter((l) => l.maalrise_investor_id === a.maalrise_investor_id);
    const cap = capPays.filter((p) => p.maalrise_investor_id === a.maalrise_investor_id);
    return {
      investorId: a.maalrise_investor_id,
      name: a.investor?.full_name ?? "—",
      code: a.investor?.investor_code ?? "",
      units: a.units,
      capitalKobo: a.capital_kobo,
      profitPaidKobo: sum(own.filter((l) => l.status === "paid"), (l) => l.amount_kobo),
      profitApprovedKobo: sum(own.filter((l) => l.status === "payable"), (l) => l.amount_kobo),
      capitalReturnedKobo: sum(cap.filter((p) => p.status === "paid"), (p) => p.amount_kobo),
    };
  }).sort((x, y) => x.name.localeCompare(y.name));

  return {
    received,
    totals: {
      profitReceivedKobo: sum(confirmed, (r) => r.applied_kobo ?? 0),
      feeKobo: sum(confirmed, (r) => r.fee_kobo ?? 0),
      netKobo: sum(confirmed, (r) => r.net_kobo ?? 0),
      capitalReceivedKobo: sum(d.capitalReceipts.filter((c) => c.status === "confirmed"), (c) => c.amount_kobo),
      distributedKobo: sum(d.distributions.filter((x) => x.status === "approved"), (x) => x.allocated_kobo),
      unallocatedKobo: sum(d.distributions.filter((x) => x.status === "approved"), (x) => x.unallocated_kobo),
      profitPaidKobo: sum(investors, (i) => i.profitPaidKobo),
      capitalReturnedKobo: sum(investors, (i) => i.capitalReturnedKobo),
    },
    investors,
  };
}

export function cycleReportCsv(kind: "received" | "investors", r: CycleReport): string {
  if (kind === "received") {
    return toCsv(["Date received", "Payment", "Reference", "Amount (NGN)", "Service fee (NGN)", "Net to investors (NGN)", "Status"],
      r.received.map((x) => [x.date, x.what, x.reference, nairaPlain(x.amountKobo), nairaPlain(x.feeKobo), nairaPlain(x.netKobo), x.status]));
  }
  return toCsv(["Investor", "Investor code", "Units", "Capital (NGN)", "Profit paid (NGN)", "Profit approved, not yet paid (NGN)", "Capital returned (NGN)"],
    r.investors.map((i) => [i.name, i.code, i.units, nairaPlain(i.capitalKobo), nairaPlain(i.profitPaidKobo), nairaPlain(i.profitApprovedKobo),
                            nairaPlain(i.capitalReturnedKobo)]));
}

export function auditCsv(rows: AuditRow[], names: Record<string, string>): string {
  return toCsv(["When", "Action", "By", "Record", "Details"],
    rows.map((a) => [a.created_at, a.action, a.user_id ? names[a.user_id] ?? a.user_id : "System", `${a.entity_type} ${a.entity_id ?? ""}`.trim(),
                     a.new_values ? JSON.stringify(a.new_values) : ""]));
}
