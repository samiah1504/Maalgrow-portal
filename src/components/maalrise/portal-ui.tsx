import Link from "next/link";
import { CheckCircle2, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { formatKobo } from "@/lib/maalrise/format";
import {
  CYCLE_PORTAL_LABEL,
  CYCLE_PORTAL_VARIANT,
  MONTH_STATUS_HELP,
  MONTH_STATUS_LABEL,
  MONTH_STATUS_VARIANT,
  cycleProfitTotals,
  paymentLabel,
  type MonthStatus,
  type MyCycle,
  type MyPayment,
} from "@/lib/maalrise/portal";

/** A month's (or the capital's) status. Paid is green, with a tick. */
export function MonthStatusBadge({ status }: { status: MonthStatus }) {
  return (
    <Badge variant={MONTH_STATUS_VARIANT[status]} title={MONTH_STATUS_HELP[status]} data-status={status}>
      {status === "paid" && <CheckCircle2 className="h-3 w-3" />}
      {MONTH_STATUS_LABEL[status]}
    </Badge>
  );
}

export function PortalHeading({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gold-600">MaalRise</p>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** One Cycle in a list: what it is, what the investor holds, and how far profit has been paid. */
export function CycleCard({ c }: { c: MyCycle }) {
  const t = cycleProfitTotals(c);
  const pct = t.expected > 0 ? Math.min(100, Math.round((t.paid / t.expected) * 100)) : 0;
  return (
    <Link href={`/maalrise/cycles/${c.id}`}
      className="block rounded-xl border border-border bg-white p-4 transition-colors hover:border-primary-300">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-semibold text-foreground">{c.name}</p>
          <p className="text-xs text-muted">{c.counterparty_name}</p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={CYCLE_PORTAL_VARIANT[c.status]}>{CYCLE_PORTAL_LABEL[c.status]}</Badge>
          <ChevronRight className="h-4 w-4 text-muted" />
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><dt className="text-xs text-muted">Your capital</dt><dd className="font-medium">{formatKobo(c.capital_kobo)}</dd></div>
        <div><dt className="text-xs text-muted">Units</dt><dd className="font-medium">{c.units.toLocaleString("en-NG")}</dd></div>
        <div><dt className="text-xs text-muted">Started</dt><dd className="font-medium">{formatDate(c.start_date)}</dd></div>
        <div><dt className="text-xs text-muted">Matures</dt><dd className="font-medium">{formatDate(c.maturity_date)}</dd></div>
      </dl>
      <div className="mt-3">
        <div className="flex justify-between text-xs text-muted">
          <span>Profit paid {formatKobo(t.paid)} of {formatKobo(t.expected)} expected</span>
          <span>{pct}%</span>
        </div>
        <div className="mt-1 h-1.5 rounded-full bg-surface-2">
          <div className="h-1.5 rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </Link>
  );
}

/** Approved and paid payments. The account appears by its last four digits only. */
export function PaymentsTable({ payments, showCycle = true }: { payments: MyPayment[]; showCycle?: boolean }) {
  if (payments.length === 0) {
    return <p className="py-6 text-center text-sm text-muted">No payments yet. Approved and paid payments appear here.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="py-2 pr-4 font-medium">Date paid</th>
            {showCycle && <th className="px-4 py-2 font-medium">Cycle</th>}
            <th className="px-4 py-2 font-medium">Payment</th>
            <th className="px-4 py-2 text-right font-medium">Amount</th>
            <th className="px-4 py-2 font-medium">Status</th>
            <th className="py-2 pl-4 font-medium">Sent to</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {payments.map((p) => (
            <tr key={`${p.kind}-${p.id}`} data-payment={p.kind}>
              <td className="py-2 pr-4 whitespace-nowrap">{p.paid_on ? formatDate(p.paid_on) : "—"}</td>
              {showCycle && (
                <td className="px-4 py-2">
                  <Link href={`/maalrise/cycles/${p.cycle_id}`} className="text-primary-700 hover:underline">{p.cycle_name}</Link>
                </td>
              )}
              <td className="px-4 py-2">{paymentLabel(p)}</td>
              <td className="px-4 py-2 text-right font-medium whitespace-nowrap">{formatKobo(p.amount_kobo)}</td>
              <td className="px-4 py-2"><MonthStatusBadge status={p.status === "paid" ? "paid" : "approved"} /></td>
              <td className="py-2 pl-4 text-xs text-muted whitespace-nowrap">
                {p.bank_name ?? "—"}{p.account_ending ? ` ····${p.account_ending}` : ""}
                {p.reference && <span className="block">Ref {p.reference}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
