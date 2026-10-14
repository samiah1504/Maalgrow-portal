import Link from "next/link";
import { CheckCircle2, ChevronRight, Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
export function CycleCard({ c, href }: { c: MyCycle; href?: string }) {
  const t = cycleProfitTotals(c);
  const pct = t.expected > 0 ? Math.min(100, Math.round((t.paid / t.expected) * 100)) : 0;
  return (
    <Link href={href ?? `/maalrise/cycles/${c.id}`}
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

const LEGEND: MonthStatus[] = ["scheduled", "due", "processing", "approved", "part_paid", "paid"];

/**
 * One Cycle in full, as its investor sees it: their holding, expected
 * profit month by month, the capital repayment and what the statuses
 * mean. Shared by the investor's own page and the staff "View as
 * investor" preview, so the two cannot differ.
 */
export function CycleDetailBody({ c }: { c: MyCycle }) {
  const t = cycleProfitTotals(c);
  return (
    <>
      <Card>
        <CardHeader><CardTitle className="text-base">Your holding</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted">Units</dt><dd className="font-medium">{c.units.toLocaleString("en-NG")} × {formatKobo(c.unit_price_kobo)}</dd></div>
            <div><dt className="text-xs text-muted">Your capital</dt><dd className="font-medium">{formatKobo(c.capital_kobo)}</dd></div>
            <div><dt className="text-xs text-muted">Duration</dt><dd className="font-medium">{c.duration_months} months</dd></div>
            <div><dt className="text-xs text-muted">Start date</dt><dd className="font-medium">{formatDate(c.start_date)}</dd></div>
            <div><dt className="text-xs text-muted">Maturity date</dt><dd className="font-medium">{formatDate(c.maturity_date)}</dd></div>
            <div>
              <dt className="text-xs text-muted">Profit paid / expected</dt>
              <dd className="font-medium">{formatKobo(t.paid)} <span className="text-muted">of {formatKobo(t.expected)}</span></dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Monthly profit</CardTitle>
          <p className="text-xs text-muted">
            Expected amounts are your share of each month&apos;s profit under the approved schedule. A month shows Paid only once
            MaalVest has recorded the transfer to your account.
          </p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <table className="w-full text-sm" id="months">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-4 font-medium">Month</th>
                <th className="px-4 py-2 font-medium">Payment date</th>
                <th className="px-4 py-2 text-right font-medium">Expected</th>
                <th className="px-4 py-2 text-right font-medium">Paid to you</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="py-2 pl-4 font-medium">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {c.months.map((m) => (
                <tr key={m.period} data-month={m.period}>
                  <td className="py-2 pr-4">Month {m.period}</td>
                  <td className="px-4 py-2 whitespace-nowrap">{formatDate(m.due_date)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap">{formatKobo(m.expected_kobo)}</td>
                  <td className="px-4 py-2 text-right whitespace-nowrap font-medium">{m.paid_kobo > 0 ? formatKobo(m.paid_kobo) : "—"}</td>
                  <td className="px-4 py-2"><MonthStatusBadge status={m.status} /></td>
                  <td className="py-2 pl-4 text-xs text-muted">
                    {m.paid_on && <span className="block">Paid {formatDate(m.paid_on)}{m.references?.length ? ` · Ref ${m.references.join(", ")}` : ""}</span>}
                    {m.approved_kobo > 0 && <span className="block">{formatKobo(m.approved_kobo)} approved, being transferred</span>}
                    {m.processing_kobo > 0 && <span className="block">{formatKobo(m.processing_kobo)} being processed</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card id="capital">
        <CardHeader>
          <CardTitle className="text-base">Capital repayment</CardTitle>
          <p className="text-xs text-muted">Your capital is repaid in full at maturity, to your confirmed bank account. No fee is taken from capital.</p>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-4">
            <div><dt className="text-xs text-muted">Due</dt><dd className="font-medium">{formatDate(c.capital.due_date)}</dd></div>
            <div><dt className="text-xs text-muted">Amount</dt><dd className="font-medium">{formatKobo(c.capital.expected_kobo)}</dd></div>
            <div><dt className="text-xs text-muted">Status</dt><dd><MonthStatusBadge status={c.capital.status} /></dd></div>
            <div>
              <dt className="text-xs text-muted">Details</dt>
              <dd className="text-xs text-muted">
                {c.capital.status === "paid"
                  ? `Paid ${formatDate(c.capital.paid_on!)}${c.capital.reference ? ` · Ref ${c.capital.reference}` : ""}${c.capital.account_ending ? ` · account ····${c.capital.account_ending}` : ""}`
                  : MONTH_STATUS_HELP[c.capital.status]}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <div className="rounded-xl border border-border bg-surface p-4 text-xs text-muted">
        <p className="mb-2 flex items-center gap-1.5 font-medium text-foreground"><Info className="h-3.5 w-3.5" /> What the statuses mean</p>
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {LEGEND.map((s) => (
            <li key={s}><span className="font-medium text-foreground">{MONTH_STATUS_LABEL[s]}:</span> {MONTH_STATUS_HELP[s]}</li>
          ))}
        </ul>
      </div>
    </>
  );
}
