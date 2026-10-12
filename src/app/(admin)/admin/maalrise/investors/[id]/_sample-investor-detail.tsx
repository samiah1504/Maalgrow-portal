import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, AlertCircle, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { KYC_STATUS_LABEL, KYC_STATUS_VARIANT, formatBps, formatKobo } from "@/lib/maalrise/format";
import { SAMPLE_ALLOCATIONS, SAMPLE_AS_OF, isSampleId, sampleCycle, sampleInvestor } from "@/lib/maalrise/sample-data";
import { sampleCycleFigures } from "@/lib/maalrise/sample-summary";
import { DetailSection, FieldGrid, SectionIndex } from "@/components/maalrise/section";
import { EmptyState, PhaseNotice, SampleDataBanner, SampleTag } from "@/components/maalrise/sample-notice";

const SECTIONS = [
  { id: "contact", label: "Contact" },
  { id: "bank", label: "Bank details" },
  { id: "kyc", label: "KYC" },
  { id: "allocations", label: "Cycle allocations" },
];

export function SampleInvestorDetail({ id }: { id: string }) {

  const inv = isSampleId(id) ? sampleInvestor(id) : null;
  if (!inv) notFound();

  const allocations = SAMPLE_ALLOCATIONS.filter((a) => a.investorId === inv.id).flatMap((a) => {
    const cycle = sampleCycle(a.cycleId);
    if (!cycle) return [];
    const f = sampleCycleFigures(cycle);
    const line = f.allocations.find((l) => l.key === inv.id);
    return line ? [{ cycle, f, line }] : [];
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start gap-3">
        <Link
          href="/admin/maalrise/investors?sample=1"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
          aria-label="Back to MaalRise Investors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{inv.fullName}</h1>
            <Badge variant={KYC_STATUS_VARIANT[inv.kycStatus]}>{KYC_STATUS_LABEL[inv.kycStatus]}</Badge>
            <SampleTag />
          </div>
          <p className="text-sm text-muted mt-0.5 font-mono">{inv.investorCode}</p>
        </div>
      </div>

      <SampleDataBanner asOf={SAMPLE_AS_OF} />
      <SectionIndex items={SECTIONS} />

      <DetailSection id="contact" title="1. Contact information">
        <FieldGrid
          rows={[
            { label: "Full name", value: inv.fullName },
            { label: "Email (login)", value: inv.email },
            { label: "Phone", value: inv.phone },
            { label: "Account status", value: <span className="capitalize">{inv.status}</span> },
            { label: "Product access", value: inv.alsoMaalGrow ? "MaalRise and MaalGrow (one login)" : "MaalRise only" },
            { label: "Added", value: formatDate(inv.addedOn) },
          ]}
        />
      </DetailSection>

      <DetailSection id="bank" title="2. Bank details" description="Each payment records the destination account it was sent to; later changes never alter past payments.">
        {inv.bank.accountNumber ? (
          <>
            <FieldGrid
              rows={[
                { label: "Bank", value: inv.bank.bankName },
                { label: "Account name", value: inv.bank.accountName },
                { label: "Account number", value: <span className="font-mono">{inv.bank.accountNumber}</span> },
                {
                  label: "Confirmation",
                  value: inv.bank.confirmed ? (
                    <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Confirmed by an admin</span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-700"><AlertCircle className="h-4 w-4" /> Awaiting admin confirmation</span>
                  ),
                },
              ]}
            />
          </>
        ) : (
          <EmptyState icon={<Wallet className="h-5 w-5" />} title="No bank details provided" />
        )}
      </DetailSection>

      <DetailSection id="kyc" title="3. KYC status">
        <FieldGrid
          rows={[
            { label: "Status", value: <Badge variant={KYC_STATUS_VARIANT[inv.kycStatus]}>{KYC_STATUS_LABEL[inv.kycStatus]}</Badge> },
            {
              label: "Source",
              value:
                inv.kycStatus === "verified_via_maalgrow"
                  ? "Reused from verified MaalGrow KYC (re-checked at activation)"
                  : "MaalRise verification",
            },
          ]}
        />
        <div className="mt-4">
          <PhaseNotice>KYC review and the MaalRise verification form are built in later phases. Bank details alone never count as KYC.</PhaseNotice>
        </div>
      </DetailSection>

      <DetailSection id="allocations" title="4. Cycle allocations">
        {allocations.length === 0 ? (
          <EmptyState icon={<Wallet className="h-5 w-5" />} title="Not allocated to any Cycle" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-4 font-medium">Cycle</th>
                  <th className="px-4 py-2 text-right font-medium">Units</th>
                  <th className="px-4 py-2 text-right font-medium">Participation</th>
                  <th className="px-4 py-2 text-right font-medium">Allocated capital</th>
                  <th className="px-4 py-2 text-right font-medium">Expected monthly profit (term total)</th>
                  <th className="py-2 pl-6 font-medium">Capital due (maturity)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {allocations.map(({ cycle, f, line }) => (
                  <tr key={cycle.id}>
                    <td className="py-2 pr-4">
                      <Link href={`/admin/maalrise/cycles/${cycle.id}`} className="text-primary-700 hover:underline">{cycle.name}</Link>
                    </td>
                    <td className="px-4 py-2 text-right">{line.units}</td>
                    <td className="px-4 py-2 text-right">{formatBps(line.participationBps)}</td>
                    <td className="px-4 py-2 text-right">{formatKobo(line.capitalKobo)}</td>
                    <td className="px-4 py-2 text-right">{formatKobo(line.totalProfitKobo)}</td>
                    <td className="py-2 pl-6 text-muted whitespace-nowrap">{f.maturity ? formatDate(f.maturity) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </DetailSection>
    </div>
  );
}
