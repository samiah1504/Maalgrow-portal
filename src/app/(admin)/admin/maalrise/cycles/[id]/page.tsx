import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, CheckCircle2, XCircle, FileText, History, Receipt, Coins } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import {
  CYCLE_STATUS_LABEL,
  CYCLE_STATUS_VARIANT,
  FEE_BASIS_LABEL,
  FEE_TREATMENT_LABEL,
  formatBps,
  formatKobo,
} from "@/lib/maalrise/format";
import {
  SAMPLE_ACTIVITY,
  SAMPLE_AS_OF,
  SAMPLE_DOCUMENTS,
  SAMPLE_RECEIPTS,
  isSampleId,
  sampleCycle,
  sampleInvestor,
} from "@/lib/maalrise/sample-data";
import { SAMPLE_RECEIPT_RULE, sampleCycleFigures } from "@/lib/maalrise/sample-summary";
import { DetailSection, FieldGrid, SectionIndex } from "@/components/maalrise/section";
import { EmptyState, PhaseNotice, SampleDataBanner, SampleTag } from "@/components/maalrise/sample-notice";

export const metadata: Metadata = { title: "MaalRise Cycle | Admin" };

const SECTIONS = [
  { id: "business", label: "Business & transaction" },
  { id: "terms", label: "Financial terms" },
  { id: "fees", label: "Markup & service fee" },
  { id: "allocations", label: "Investor allocations" },
  { id: "schedule", label: "Monthly profit schedule" },
  { id: "receipts", label: "Receipts & distributions" },
  { id: "capital", label: "Capital settlement" },
  { id: "documents", label: "Documents" },
  { id: "activity", label: "Activity history" },
];

const PERIOD_BADGE: Record<string, { variant: "paid" | "warning" | "pending" | "upcoming"; label: string }> = {
  paid: { variant: "paid", label: "Paid" },
  partly_paid: { variant: "warning", label: "Part-paid" },
  pending: { variant: "pending", label: "Pending" },
  upcoming: { variant: "upcoming", label: "Upcoming" },
};

export default async function MaalRiseCycleDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdminPage();
  const { id } = await params;

  // No MaalRise table exists in Phase 1, so the only Cycles that can be
  // shown are the labelled samples. Anything else genuinely does not exist.
  const cycle = isSampleId(id) ? sampleCycle(id) : null;
  if (!cycle) notFound();

  const f = sampleCycleFigures(cycle);
  const b = f.breakdown;
  const isActive = cycle.status === "active";

  const checks = [
    { ok: !!cycle.approvedBy, label: "Terms approved by a second authorised person" },
    { ok: f.fundingShortfallKobo === 0, label: f.fundingShortfallKobo === 0 ? "Fully funded" : `Funding shortfall of ${formatKobo(f.fundingShortfallKobo)}` },
    { ok: f.allocations.length > 0, label: "Investor allocations reconcile to funding" },
    { ok: f.allocations.every((a) => ["verified", "verified_via_maalgrow"].includes(sampleInvestor(a.key)?.kycStatus ?? "")), label: "Every investor has completed KYC" },
    { ok: f.allocations.every((a) => sampleInvestor(a.key)?.bank.confirmed), label: "Every investor's bank details are confirmed" },
    { ok: SAMPLE_DOCUMENTS.some((d) => d.cycleId === cycle.id && d.category === "Contract"), label: "Original contract uploaded" },
    { ok: b.errors.length === 0, label: "Terms and schedule reconcile" },
  ];

  const receipts = SAMPLE_RECEIPTS.filter((r) => r.cycleId === cycle.id);
  const documents = SAMPLE_DOCUMENTS.filter((d) => d.cycleId === cycle.id);
  const activity = SAMPLE_ACTIVITY.filter((a) => a.cycleId === cycle.id);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start gap-3">
        <Link
          href="/admin/maalrise/cycles?sample=1"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
          aria-label="Back to MaalRise Cycles"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{cycle.name}</h1>
            <Badge variant={CYCLE_STATUS_VARIANT[cycle.status] ?? "pending"}>
              {CYCLE_STATUS_LABEL[cycle.status] ?? cycle.status}
            </Badge>
            <SampleTag />
          </div>
          <p className="text-sm text-muted mt-0.5">{cycle.transactionName}</p>
        </div>
      </div>

      <SampleDataBanner asOf={SAMPLE_AS_OF} />
      <SectionIndex items={SECTIONS} />

      <DetailSection id="business" title="1. Business and transaction details">
        <FieldGrid
          rows={[
            { label: "Cycle name", value: cycle.name },
            { label: "Business / transaction", value: cycle.transactionName },
            { label: "Counterparty", value: `${cycle.counterparty.name} (${cycle.counterparty.registration})` },
            { label: "Counterparty contact", value: cycle.counterparty.contact },
            { label: "Transaction start", value: formatDate(cycle.startDate) },
            { label: "Duration", value: `${cycle.durationMonths} months` },
            { label: "Maturity", value: f.maturity ? formatDate(f.maturity) : "—" },
            { label: "Prepared by / approved by", value: `${cycle.preparedBy} / ${cycle.approvedBy ?? "Not yet approved"}` },
          ]}
        />
        <p className="mt-4 text-sm text-foreground">{cycle.description}</p>
      </DetailSection>

      <DetailSection
        id="terms"
        title="2. Financial terms"
        description="Terms are versioned. Approval freezes the version and its breakdown; any change after that needs a new version and re-approval."
      >
        <FieldGrid
          rows={[
            { label: "Transaction cost", value: formatKobo(b.costKobo) },
            { label: "Unit price", value: formatKobo(cycle.unitPriceKobo) },
            { label: "Units to fully fund", value: f.unitsRequired.toLocaleString("en-NG") },
            { label: "Units funded", value: f.unitsFunded.toLocaleString("en-NG") },
            { label: "Agreed sale price", value: formatKobo(b.salePriceKobo) },
            { label: "Sale price stated in contract", value: cycle.statedSalePriceKobo != null ? formatKobo(cycle.statedSalePriceKobo) : "Not stated" },
            { label: "Tax treatment", value: cycle.taxTreatment },
            { label: "Engine version", value: <code className="text-xs">{b.engineVersion}</code> },
          ]}
        />
        <div className="mt-4">
          <p className="text-xs font-medium text-muted mb-2">Activation checks</p>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {checks.map((c) => (
              <li key={c.label} className="flex items-center gap-2 text-sm">
                {c.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <XCircle className="h-4 w-4 text-red-500" />}
                <span className={c.ok ? "text-foreground" : "text-red-700"}>{c.label}</span>
              </li>
            ))}
          </ul>
          {!isActive && checks.some((c) => !c.ok) && (
            <p className="mt-2 text-xs text-red-700">This Cycle cannot be activated until every check passes.</p>
          )}
        </div>
      </DetailSection>

      <DetailSection id="fees" title="3. Markup and service fee" description="The markup and the fee are separate terms and are never interchanged.">
        <dl className="divide-y divide-border text-sm">
          {[
            ["Transaction cost", formatKobo(b.costKobo)],
            ["Murabaha markup", `${formatKobo(b.markupKobo)} (${formatBps(b.markupBpsOfCost)} of cost${cycle.markup.type === "percent" ? ", total for the whole Cycle" : ", fixed amount"})`],
            ["Agreed sale price", formatKobo(b.salePriceKobo)],
            ["Fee basis", cycle.fee.treatment === "waived" ? "Not applicable — fee waived" : FEE_BASIS_LABEL[cycle.fee.basis]],
            ["Fee rate / amount", cycle.fee.treatment === "waived" ? "—" : cycle.fee.basis === "fixed" ? formatKobo(cycle.fee.kobo ?? 0) : formatBps(cycle.fee.bps ?? 0)],
            ["Fee treatment", FEE_TREATMENT_LABEL[cycle.fee.treatment]],
            ["Service fee", formatKobo(b.feeKobo)],
            ["Investor profit pool", formatKobo(b.investorProfitPoolKobo)],
            ["Total payable by counterparty", formatKobo(b.counterpartyTotalKobo)],
          ].map(([l, v]) => (
            <div key={l} className="flex justify-between gap-4 py-2">
              <dt className="text-muted">{l}</dt>
              <dd className="text-right font-medium">{v}</dd>
            </div>
          ))}
        </dl>
        <ul className="mt-4 space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          {b.notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      </DetailSection>

      <DetailSection id="allocations" title="4. Investor allocations" description="Capital and each month's profit are apportioned by largest remainder, so every column reconciles to the kobo.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 font-medium">Investor</th>
                <th className="py-2 text-right font-medium">Units</th>
                <th className="py-2 text-right font-medium">Participation</th>
                <th className="py-2 text-right font-medium">Allocated capital</th>
                <th className="py-2 text-right font-medium">Expected profit (term)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {f.allocations.map((a) => {
                const inv = sampleInvestor(a.key);
                return (
                  <tr key={a.key}>
                    <td className="py-2">
                      <Link href={`/admin/maalrise/investors/${a.key}`} className="text-primary-700 hover:underline">{inv?.fullName}</Link>
                    </td>
                    <td className="py-2 text-right">{a.units}</td>
                    <td className="py-2 text-right">{formatBps(a.participationBps)}</td>
                    <td className="py-2 text-right">{formatKobo(a.capitalKobo)}</td>
                    <td className="py-2 text-right">{formatKobo(a.totalProfitKobo)}</td>
                  </tr>
                );
              })}
              {f.unallocated && (
                <tr className="text-amber-800">
                  <td className="py-2 italic">Unsubscribed — not allocated</td>
                  <td className="py-2 text-right">{f.unallocated.units}</td>
                  <td className="py-2 text-right">{formatBps(f.unallocated.participationBps)}</td>
                  <td className="py-2 text-right">{formatKobo(0)}</td>
                  <td className="py-2 text-right">{formatKobo(f.unallocated.totalProfitKobo)}</td>
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="border-t border-border font-semibold">
                <td className="py-2">Total</td>
                <td className="py-2 text-right">{f.unitsRequired}</td>
                <td className="py-2 text-right">100.00%</td>
                <td className="py-2 text-right">{formatKobo(f.allocations.reduce((s, a) => s + a.capitalKobo, 0))}</td>
                <td className="py-2 text-right">{formatKobo(b.investorProfitPoolKobo)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
        {f.fundingShortfallKobo > 0 && (
          <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            {`Funding shortfall: ${formatKobo(f.fundingShortfallKobo)} (${f.unitsUnsubscribed} units unsubscribed). `}
            Capital above is what each investor has funded. Profit is shared per unit of the whole Cycle, so the
            unsubscribed units&apos; share stays unallocated rather than inflating funded investors. The Cycle cannot be
            activated until it is fully funded.
          </p>
        )}
      </DetailSection>

      <DetailSection id="schedule" title="5. Monthly profit schedule" description="Expected monthly profit only. Capital is settled separately at maturity (section 7).">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 font-medium">Month</th>
                <th className="py-2 font-medium">Due</th>
                <th className="py-2 text-right font-medium">Counterparty gross</th>
                <th className="py-2 text-right font-medium">Fee</th>
                <th className="py-2 text-right font-medium">Net to investors</th>
                <th className="py-2 text-right font-medium">Paid</th>
                <th className="py-2 text-right font-medium">Outstanding (due)</th>
                <th className="py-2 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {f.periods.map((p) => (
                <tr key={p.period}>
                  <td className="py-2">{p.period}</td>
                  <td className="py-2 text-muted">{p.dueDate ? formatDate(p.dueDate) : "—"}</td>
                  <td className="py-2 text-right">{formatKobo(p.counterpartyGrossKobo)}</td>
                  <td className="py-2 text-right">{formatKobo(p.feeKobo)}</td>
                  <td className="py-2 text-right font-medium">{formatKobo(p.investorNetKobo)}</td>
                  <td className="py-2 text-right">{formatKobo(p.paidKobo)}</td>
                  <td className="py-2 text-right">{formatKobo(p.outstandingKobo)}</td>
                  <td className="py-2 text-center">
                    <Badge variant={PERIOD_BADGE[p.status].variant}>{PERIOD_BADGE[p.status].label}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DetailSection>

      <DetailSection id="receipts" title="6. Receipts and distributions" description="Gross receipts, fees, the amount available for distribution and the amount distributed are kept as separate figures.">
        {receipts.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No receipts recorded">
            Receipts from the counterparty are recorded here once the Cycle is active.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 font-medium">Received</th>
                  <th className="py-2 font-medium">Period</th>
                  <th className="py-2 font-medium">Reference</th>
                  <th className="py-2 text-right font-medium">Gross received</th>
                  <th className="py-2 text-right font-medium">Expected gross</th>
                  <th className="py-2 text-right font-medium">Fee retained</th>
                  <th className="py-2 text-right font-medium">Distributed to investors</th>
                  <th className="py-2 text-right font-medium">Shortfall</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {receipts.map((r) => {
                  const p = f.periods[r.period - 1];
                  const expected = p?.counterpartyGrossKobo ?? 0;
                  const shortfall = Math.max(expected - r.grossKobo, 0);
                  return (
                    <tr key={r.reference}>
                      <td className="py-2 text-muted">{formatDate(r.receivedOn)}</td>
                      <td className="py-2">Month {r.period}</td>
                      <td className="py-2 font-mono text-xs">{r.reference}</td>
                      <td className="py-2 text-right">{formatKobo(r.grossKobo)}</td>
                      <td className="py-2 text-right">{formatKobo(expected)}</td>
                      <td className="py-2 text-right">{formatKobo(p?.feeRetainedKobo ?? 0)}</td>
                      <td className="py-2 text-right">{formatKobo(p?.paidKobo ?? 0)}</td>
                      <td className={`py-2 text-right ${shortfall > 0 ? "text-red-700" : ""}`}>{formatKobo(shortfall)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {receipts.length > 0 && <p className="mt-3 text-xs text-amber-800">{SAMPLE_RECEIPT_RULE}</p>}
        <div className="mt-4">
          <PhaseNotice>
            Recording receipts, applying the fee, &quot;Distribute Profit&quot; and the Payment Officer&apos;s &quot;Mark as Paid&quot;
            screen are built in Phase 3. No payment is processed and no email is sent in this phase.
          </PhaseNotice>
        </div>
      </DetailSection>

      <DetailSection id="capital" title="7. Capital settlement" description="Separate from monthly profit. Due at maturity, per investor.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 font-medium">Investor</th>
                <th className="py-2 font-medium">Due date</th>
                <th className="py-2 text-right font-medium">Capital due</th>
                <th className="py-2 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {f.allocations.map((a) => (
                <tr key={a.key}>
                  <td className="py-2">{sampleInvestor(a.key)?.fullName}</td>
                  <td className="py-2 text-muted">{f.maturity ? formatDate(f.maturity) : "—"}</td>
                  <td className="py-2 text-right">{formatKobo(a.capitalKobo)}</td>
                  <td className="py-2 text-center"><Badge variant="upcoming">Not yet due</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {f.allocations.length === 0 && (
          <EmptyState icon={<Coins className="h-5 w-5" />} title="No capital settlement records" />
        )}
      </DetailSection>

      <DetailSection id="documents" title="8. Documents" description="Original contract and supporting transaction documents. Visibility to investors is set per file.">
        {documents.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents uploaded">
            The original contract must be uploaded before the Cycle can be activated.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {documents.map((d) => (
              <li key={d.name} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary-600" /> {d.name}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline">{d.category}</Badge>
                  <Badge variant={d.visibleToInvestors ? "info" : "upcoming"}>
                    {d.visibleToInvestors ? "Visible to investors" : "Admin only"}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <PhaseNotice>Uploads go to a private storage bucket, connected in Phase 2. Sample file names only — there are no files.</PhaseNotice>
        </div>
      </DetailSection>

      <DetailSection id="activity" title="9. Activity history" description="From Phase 2 every action is written to the existing audit log.">
        {activity.length === 0 ? (
          <EmptyState icon={<History className="h-5 w-5" />} title="No activity yet" />
        ) : (
          <ol className="space-y-3">
            {activity.map((a) => (
              <li key={a.at} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-400" />
                <div>
                  <p className="text-foreground">{a.what}</p>
                  <p className="text-xs text-muted">{a.who} · {formatDateTime(a.at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DetailSection>
    </div>
  );
}
