import Link from "next/link";
import type { Metadata } from "next";
import { Download, FileText } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate } from "@/lib/utils";
import { CYCLE_STATUS_LABEL, formatKobo } from "@/lib/maalrise/format";
import { lagosToday } from "@/lib/maalrise/receipts";
import { listCycles, loadRegister, mr } from "@/lib/maalrise/db";
import { monthRange, registerRows } from "@/lib/maalrise/reports";

export const metadata: Metadata = { title: "MaalRise Reports | Admin" };

const linkBtn = "inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-primary-700 hover:border-primary-300";

/**
 * The payments register for a month (reconcile it against the bank
 * statement) and each Cycle's report for the accountant.
 */
export default async function MaalRiseReportsPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { supabase } = await requireAdminPage();
  const db = mr(supabase);
  const asked = (await searchParams).month ?? "";
  const month = monthRange(asked) ? asked : lagosToday().slice(0, 7);
  const range = monthRange(month)!;
  const [reg, cycles] = await Promise.all([loadRegister(db, range.from, range.to), listCycles(db)]);
  const rows = registerRows(reg.profit, reg.capital, reg.names);
  const total = rows.reduce((t, r) => t + r.amountKobo, 0);
  const reportable = cycles.filter((c) => ["active", "matured", "closed"].includes(c.status));

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">MaalRise Reports</h1>
        <p className="text-sm text-muted mt-1">Payments register for bank reconciliation, and each Cycle&apos;s report and audit trail.</p>
      </div>

      <Card id="register">
        <CardHeader className="flex flex-row flex-wrap items-end justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base">Payments register</CardTitle>
            <p className="text-xs text-muted mt-1">Every investor payment marked paid in the month, with the account and transfer reference.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <form className="flex items-end gap-2" action="/admin/maalrise/reports">
              <label className="text-xs text-muted">Month
                <input type="month" name="month" defaultValue={month} className="ml-2 h-8 rounded-md border border-border px-2 text-sm" />
              </label>
              <button className={linkBtn} type="submit">Show</button>
            </form>
            <a className={linkBtn} href={`/api/admin/maalrise/reports/register?month=${month}`}><Download className="h-3 w-3" /> CSV</a>
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {rows.length === 0 ? (
            <p className="py-4 text-sm text-muted">No payments were marked paid in {month}.</p>
          ) : (
            <table className="w-full text-sm" data-testid="register">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Date paid</th>
                  <th className="px-3 py-2 font-medium">Cycle</th>
                  <th className="px-3 py-2 font-medium">Payment</th>
                  <th className="px-3 py-2 font-medium">Investor</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="py-2 pl-3 font-medium">Reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.paidOn)}</td>
                    <td className="px-3 py-2">{r.cycleName}</td>
                    <td className="px-3 py-2">{r.payment}</td>
                    <td className="px-3 py-2">{r.investorName} <span className="text-xs text-muted font-mono">{r.investorCode}</span></td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">{formatKobo(r.amountKobo)}</td>
                    <td className="px-3 py-2 text-xs">{r.bankName} · {r.accountName} · <span className="font-mono">{r.accountNumber}</span></td>
                    <td className="py-2 pl-3 text-xs">{r.reference || "—"}{r.markedBy && <span className="block text-muted">by {r.markedBy}</span>}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-semibold">
                  <td colSpan={4} className="py-2 pr-3 text-right">Total paid in {month} ({rows.length})</td>
                  <td className="px-3 py-2 text-right">{formatKobo(total)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          )}
        </CardContent>
      </Card>

      <Card id="cycles">
        <CardHeader>
          <CardTitle className="text-base">Cycle reports</CardTitle>
          <p className="text-xs text-muted mt-1">Received from the counterparty, fees, what each investor was paid and capital returned, and the full audit trail.</p>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {reportable.length === 0 ? (
            <p className="py-4 text-sm text-muted">No Cycle has been activated yet.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-border">
                {reportable.map((c) => (
                  <tr key={c.id}>
                    <td className="py-2 pr-3">
                      <Link href={`/admin/maalrise/cycles/${c.id}`} className="font-medium text-primary-700 hover:underline">{c.name}</Link>
                      <span className="ml-2 text-xs text-muted">{CYCLE_STATUS_LABEL[c.status] ?? c.status}</span>
                    </td>
                    <td className="py-2 pl-3">
                      <div className="flex flex-wrap justify-end gap-2">
                        <Link className={linkBtn} href={`/maalrise-cycle-report/${c.id}`} target="_blank"><FileText className="h-3 w-3" /> Printable report</Link>
                        <a className={linkBtn} href={`/api/admin/maalrise/reports/cycle/${c.id}?kind=received`}><Download className="h-3 w-3" /> Received CSV</a>
                        <a className={linkBtn} href={`/api/admin/maalrise/reports/cycle/${c.id}?kind=investors`}><Download className="h-3 w-3" /> Investors CSV</a>
                        <a className={linkBtn} href={`/api/admin/maalrise/reports/cycle/${c.id}?kind=audit`}><Download className="h-3 w-3" /> Audit trail CSV</a>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
