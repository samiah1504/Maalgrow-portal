import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { formatKobo } from "@/lib/maalrise/format";
import { isUuid } from "@/lib/maalrise/api";
import {
  CYCLE_PORTAL_LABEL,
  CYCLE_PORTAL_VARIANT,
  MONTH_STATUS_HELP,
  MONTH_STATUS_LABEL,
  cycleProfitTotals,
  getMyCycle,
  type MonthStatus,
} from "@/lib/maalrise/portal";
import { requireMaalriseInvestorPage } from "@/lib/maalrise/portal-guard";
import { MonthStatusBadge } from "@/components/maalrise/portal-ui";

export const metadata: Metadata = { title: "MaalRise Cycle" };

const LEGEND: MonthStatus[] = ["scheduled", "due", "processing", "approved", "part_paid", "paid"];

/**
 * One Cycle as its investor sees it: their units and capital, their
 * expected profit for each month, and each payment's status as staff
 * recorded it. The Cycle's total size, markup and fee are not shown.
 */
export default async function MyCyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await requireMaalriseInvestorPage();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const c = await getMyCycle(db, id);
  if (!c) notFound();
  const t = cycleProfitTotals(c);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start gap-3">
        <Link href="/maalrise/cycles" aria-label="Back to My Cycles"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-600">MaalRise Cycle</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{c.name}</h1>
            <Badge variant={CYCLE_PORTAL_VARIANT[c.status]}>{CYCLE_PORTAL_LABEL[c.status]}</Badge>
          </div>
          <p className="text-sm text-muted">Counterparty: {c.counterparty_name}</p>
          {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}
        </div>
      </div>

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
    </div>
  );
}
