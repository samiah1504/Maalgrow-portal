import Image from "next/image";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-guard";
import { formatDate } from "@/lib/utils";
import { formatBps, formatKobo } from "@/lib/maalrise/format";
import { lagosToday } from "@/lib/maalrise/receipts";
import { isUuid } from "@/lib/maalrise/api";
import { getCycleDetail, mr } from "@/lib/maalrise/db";
import { cycleReport } from "@/lib/maalrise/reports";
import { maturityDate } from "@/lib/maalrise/dates";
import { PrintButton } from "@/app/maalrise-statement/_print-button";

export const metadata: Metadata = { title: "MaalRise Cycle Report" };

/** A Cycle's report for the accountant, outside the admin shell so it prints cleanly. Staff only. */
export default async function MaalRiseCycleReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdminPage();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const d = await getCycleDetail(mr(supabase), id);
  if (!d) notFound();
  const r = cycleReport(d);
  const t = d.approved;
  const th = "py-1.5 px-2 font-medium text-left";
  const td = "py-1.5 px-2";

  return (
    <main className="mx-auto max-w-5xl bg-white p-6 text-sm text-foreground print:p-0">
      <div className="flex items-start justify-between gap-4 border-b border-border pb-4">
        <div className="flex items-center gap-3">
          <Image src="/logo-192.png" alt="MaalVest" width={40} height={40} className="h-10 w-10 rounded-lg" />
          <div>
            <p className="text-lg font-bold">MaalRise Cycle report — {d.cycle.name}</p>
            <p className="text-xs text-muted">Counterparty: {d.counterparty?.name ?? "—"} · Generated {formatDate(lagosToday())}</p>
          </div>
        </div>
        <PrintButton />
      </div>

      <section className="mt-4 grid gap-1 sm:grid-cols-3">
        <p><span className="text-muted">Start:</span> {formatDate(d.cycle.start_date)}</p>
        <p><span className="text-muted">Maturity:</span> {maturityDate(d.cycle.start_date, d.cycle.duration_months) ? formatDate(maturityDate(d.cycle.start_date, d.cycle.duration_months)!) : "—"}</p>
        <p><span className="text-muted">Status:</span> <span className="capitalize">{d.cycle.status}</span></p>
        {t && <>
          <p><span className="text-muted">Cost (capital):</span> {formatKobo(t.cost_kobo)}</p>
          <p><span className="text-muted">Total markup:</span> {formatKobo(t.markup_kobo)}{t.markup_bps !== null ? ` (${formatBps(t.markup_bps)})` : ""}</p>
          <p><span className="text-muted">Service fee:</span> {formatKobo(t.fee_kobo)}</p>
        </>}
      </section>

      <h2 className="mt-6 mb-2 text-base font-semibold">Totals</h2>
      <table className="w-full border-collapse"><tbody>
        {[
          ["Profit received and confirmed", r.totals.profitReceivedKobo],
          ["Service fee taken from it", r.totals.feeKobo],
          ["Net profit for investors", r.totals.netKobo],
          ["Distributed to investors (approved)", r.totals.distributedKobo],
          ["Unsubscribed share (unallocated)", r.totals.unallocatedKobo],
          ["Profit paid to investors", r.totals.profitPaidKobo],
          ["Capital received and confirmed", r.totals.capitalReceivedKobo],
          ["Capital returned to investors", r.totals.capitalReturnedKobo],
        ].map(([k, v]) => (
          <tr key={k as string} className="border-b border-border/60"><td className={td}>{k}</td><td className={`${td} text-right font-medium`}>{formatKobo(v as number)}</td></tr>
        ))}
      </tbody></table>

      <h2 className="mt-6 mb-2 text-base font-semibold">Received from the counterparty</h2>
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-border text-xs text-muted">
          <th className={th}>Date</th><th className={th}>Payment</th><th className={th}>Reference</th>
          <th className={`${th} text-right`}>Amount</th><th className={`${th} text-right`}>Fee</th><th className={`${th} text-right`}>Net</th><th className={th}>Status</th>
        </tr></thead>
        <tbody>
          {r.received.map((x, i) => (
            <tr key={i} className="border-b border-border/60">
              <td className={td}>{formatDate(x.date)}</td><td className={td}>{x.what}</td><td className={td}>{x.reference || "—"}</td>
              <td className={`${td} text-right`}>{formatKobo(x.amountKobo)}</td><td className={`${td} text-right`}>{formatKobo(x.feeKobo)}</td>
              <td className={`${td} text-right`}>{formatKobo(x.netKobo)}</td><td className={td}>{x.status}</td>
            </tr>
          ))}
          {r.received.length === 0 && <tr><td colSpan={7} className={`${td} text-muted`}>Nothing received yet.</td></tr>}
        </tbody>
      </table>

      <h2 className="mt-6 mb-2 text-base font-semibold">Investors</h2>
      <table className="w-full border-collapse">
        <thead><tr className="border-b border-border text-xs text-muted">
          <th className={th}>Investor</th><th className={`${th} text-right`}>Units</th><th className={`${th} text-right`}>Capital</th>
          <th className={`${th} text-right`}>Profit paid</th><th className={`${th} text-right`}>Approved, not yet paid</th><th className={`${th} text-right`}>Capital returned</th>
        </tr></thead>
        <tbody>
          {r.investors.map((i) => (
            <tr key={i.investorId} className="border-b border-border/60">
              <td className={td}>{i.name} <span className="font-mono text-xs text-muted">{i.code}</span></td>
              <td className={`${td} text-right`}>{i.units}</td><td className={`${td} text-right`}>{formatKobo(i.capitalKobo)}</td>
              <td className={`${td} text-right`}>{formatKobo(i.profitPaidKobo)}</td><td className={`${td} text-right`}>{formatKobo(i.profitApprovedKobo)}</td>
              <td className={`${td} text-right`}>{formatKobo(i.capitalReturnedKobo)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-6 text-xs text-muted">No tax has been withheld (tax treatment not configured).</p>
    </main>
  );
}
