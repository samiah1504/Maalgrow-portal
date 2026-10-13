import Image from "next/image";
import type { Metadata } from "next";
import { formatDate } from "@/lib/utils";
import { formatKobo } from "@/lib/maalrise/format";
import { lagosToday } from "@/lib/maalrise/receipts";
import { cycleProfitTotals, listMyCycles, listMyPayments, paymentLabel } from "@/lib/maalrise/portal";
import { requireMaalriseInvestorPage } from "@/lib/maalrise/portal-guard";
import { PrintButton } from "./_print-button";

export const metadata: Metadata = { title: "MaalRise Statement" };

/**
 * A printable MaalRise statement: holdings, and every payment marked
 * paid. Outside the portal shell so it prints as a clean page.
 */
export default async function MaalRiseStatementPage() {
  const { db, profile } = await requireMaalriseInvestorPage();
  const [cycles, payments] = await Promise.all([listMyCycles(db), listMyPayments(db)]);
  const paid = payments.filter((p) => p.status === "paid");
  const total = paid.reduce((s, p) => s + p.amount_kobo, 0);

  return (
    <main className="mx-auto max-w-4xl bg-white p-6 text-sm text-foreground print:p-0">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Image src="/logo-192.png" alt="MaalVest" width={40} height={40} className="h-10 w-10 rounded-lg" />
          <div>
            <p className="text-lg font-bold">MaalRise statement</p>
            <p className="text-xs text-muted">A MaalVest platform · Generated {formatDate(lagosToday())}</p>
          </div>
        </div>
        <PrintButton />
      </div>

      <section className="mt-4 grid gap-1 sm:grid-cols-2">
        <p><span className="text-muted">Investor:</span> {profile.full_name}</p>
        <p><span className="text-muted">Investor code:</span> <span className="font-mono">{profile.investor_code}</span></p>
        <p><span className="text-muted">Email:</span> {profile.email}</p>
      </section>

      <h2 className="mt-6 mb-2 text-base font-semibold">Holdings</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="py-1.5 pr-3 font-medium">Cycle</th>
            <th className="px-3 py-1.5 font-medium">Start – maturity</th>
            <th className="px-3 py-1.5 text-right font-medium">Units</th>
            <th className="px-3 py-1.5 text-right font-medium">Capital</th>
            <th className="py-1.5 pl-3 text-right font-medium">Profit paid / expected</th>
          </tr>
        </thead>
        <tbody>
          {cycles.map((c) => {
            const t = cycleProfitTotals(c);
            return (
              <tr key={c.id} className="border-b border-border/60">
                <td className="py-1.5 pr-3">{c.name}</td>
                <td className="px-3 py-1.5">{formatDate(c.start_date)} – {formatDate(c.maturity_date)}</td>
                <td className="px-3 py-1.5 text-right">{c.units.toLocaleString("en-NG")}</td>
                <td className="px-3 py-1.5 text-right">{formatKobo(c.capital_kobo)}</td>
                <td className="py-1.5 pl-3 text-right">{formatKobo(t.paid)} / {formatKobo(t.expected)}</td>
              </tr>
            );
          })}
          {cycles.length === 0 && <tr><td colSpan={5} className="py-3 text-muted">No Cycles.</td></tr>}
        </tbody>
      </table>

      <h2 className="mt-6 mb-2 text-base font-semibold">Payments received</h2>
      <table className="w-full border-collapse">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="py-1.5 pr-3 font-medium">Date paid</th>
            <th className="px-3 py-1.5 font-medium">Cycle</th>
            <th className="px-3 py-1.5 font-medium">Payment</th>
            <th className="px-3 py-1.5 font-medium">Reference</th>
            <th className="px-3 py-1.5 font-medium">Account</th>
            <th className="py-1.5 pl-3 text-right font-medium">Amount</th>
          </tr>
        </thead>
        <tbody>
          {paid.map((p) => (
            <tr key={`${p.kind}-${p.id}`} className="border-b border-border/60">
              <td className="py-1.5 pr-3">{p.paid_on ? formatDate(p.paid_on) : "—"}</td>
              <td className="px-3 py-1.5">{p.cycle_name}</td>
              <td className="px-3 py-1.5">{paymentLabel(p)}</td>
              <td className="px-3 py-1.5">{p.reference ?? "—"}</td>
              <td className="px-3 py-1.5">{p.bank_name ?? ""}{p.account_ending ? ` ····${p.account_ending}` : ""}</td>
              <td className="py-1.5 pl-3 text-right">{formatKobo(p.amount_kobo)}</td>
            </tr>
          ))}
          {paid.length === 0 && <tr><td colSpan={6} className="py-3 text-muted">No payments have been made yet.</td></tr>}
        </tbody>
        <tfoot>
          <tr className="font-semibold">
            <td colSpan={5} className="py-2 pr-3 text-right">Total received</td>
            <td className="py-2 pl-3 text-right">{formatKobo(total)}</td>
          </tr>
        </tfoot>
      </table>

      <p className="mt-6 text-xs text-muted">
        This statement lists payments MaalVest has recorded as transferred to you. Payments approved but not yet transferred are
        not included. No tax has been withheld.
      </p>
    </main>
  );
}
