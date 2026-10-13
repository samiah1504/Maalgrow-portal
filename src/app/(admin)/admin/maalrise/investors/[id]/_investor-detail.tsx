import Link from "next/link";
import { ArrowLeft, AlertCircle, CheckCircle2, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import { CYCLE_STATUS_LABEL, KYC_STATUS_LABEL, KYC_STATUS_VARIANT, formatKobo } from "@/lib/maalrise/format";
import type { InvestorDetail } from "@/lib/maalrise/db";
import { DetailSection, FieldGrid, SectionIndex } from "@/components/maalrise/section";
import { EmptyState } from "@/components/maalrise/sample-notice";
import { BankActions, BankChangeReview, KycActions } from "./_investor-actions";

const SECTIONS = [
  { id: "contact", label: "Contact" },
  { id: "bank", label: "Bank details" },
  { id: "kyc", label: "KYC" },
  { id: "allocations", label: "Cycle allocations" },
  { id: "activity", label: "Activity" },
];

const BANK_EVENT: Record<string, string> = {
  prefilled_from_maalgrow: "Pre-filled from MaalGrow (unconfirmed)",
  set: "Bank details set",
  confirmed: "Confirmed",
};

const CHANGE_STATUS: Record<string, { label: string; variant: "pending" | "approved" | "rejected" | "upcoming" }> = {
  pending: { label: "Awaiting review", variant: "pending" },
  approved: { label: "Approved", variant: "approved" },
  rejected: { label: "Rejected", variant: "rejected" },
  cancelled: { label: "Withdrawn by investor", variant: "upcoming" },
};

const ACTIVITY: Record<string, string> = {
  maalrise_add_investor: "Given MaalRise access",
  maalrise_set_bank_details: "Bank details changed",
  maalrise_confirm_bank_details: "Bank details confirmed",
  maalrise_record_kyc_submission: "KYC details recorded",
  maalrise_review_kyc: "KYC reviewed",
};

/** "verified" from MaalGrow shows as such; the database keeps status and source apart. */
export function kycDisplay(status: string, source: string | null) {
  return status === "verified" && source === "maalgrow" ? "verified_via_maalgrow" : status === "not_started" ? "not_started" : status;
}

export function InvestorDetailView({ d, canPrepare }: { d: InvestorDetail; canPrepare: boolean }) {
  const inv = d.investor;
  const kyc = kycDisplay(inv.kyc_status, inv.kyc_source);
  const pending = d.kyc.some((k) => k.status === "pending_review");
  const pendingChange = d.bankChanges.find((c) => c.status === "pending");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start gap-3">
        <Link href="/admin/maalrise/investors" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors" aria-label="Back to MaalRise Investors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{inv.full_name}</h1>
            <Badge variant={KYC_STATUS_VARIANT[kyc] ?? "pending"}>{KYC_STATUS_LABEL[kyc] ?? kyc}</Badge>
          </div>
          <p className="text-sm text-muted mt-0.5 font-mono">{inv.investor_code}</p>
        </div>
      </div>

      <SectionIndex items={SECTIONS} />

      <DetailSection id="contact" title="1. Contact information">
        <FieldGrid
          rows={[
            { label: "Full name", value: inv.full_name },
            { label: "Email (login)", value: inv.email },
            { label: "Phone", value: inv.phone || "—" },
            { label: "Account status", value: <span className="capitalize">{inv.status}</span> },
            { label: "Product access", value: inv.maalgrow_investor_id ? "MaalRise and MaalGrow (one login)" : "MaalRise only" },
            { label: "Added", value: formatDate(inv.created_at) },
          ]}
        />
      </DetailSection>

      <DetailSection id="bank" title="2. Bank details" description="Each payment will record the account it was sent to; later changes never alter past payments.">
        {inv.account_number ? (
          <FieldGrid
            rows={[
              { label: "Bank", value: inv.bank_name },
              { label: "Account name", value: inv.account_name },
              { label: "Account number", value: <span className="font-mono">{inv.account_number}</span> },
              {
                label: "Confirmation",
                value: inv.bank_confirmed_at ? (
                  <span className="flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-4 w-4" /> Confirmed by {d.names[inv.bank_confirmed_by ?? ""] ?? "—"}, {formatDateTime(inv.bank_confirmed_at)}
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-amber-700"><AlertCircle className="h-4 w-4" /> Awaiting admin confirmation</span>
                ),
              },
            ]}
          />
        ) : (
          <EmptyState icon={<Wallet className="h-5 w-5" />} title="No bank details provided" />
        )}
        {pendingChange && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm" data-testid="bank-change-request">
            <p className="font-medium text-amber-900">The investor asked to change their payment account</p>
            <p className="mt-1">
              {pendingChange.bank_name} · {pendingChange.account_name} · <span className="font-mono">{pendingChange.account_number}</span>
            </p>
            <p className="mt-1 text-xs text-amber-800">
              Requested {formatDateTime(pendingChange.requested_at)}. Check the account belongs to the investor before approving.
              Payments already approved keep the account they were approved with; distributions awaiting approval must be refreshed.
            </p>
            {canPrepare && <div className="mt-3"><BankChangeReview requestId={pendingChange.id} /></div>}
          </div>
        )}
        {canPrepare && (
          <div className="mt-4">
            <BankActions investorId={inv.id} hasDetails={!!inv.account_number} confirmed={!!inv.bank_confirmed_at} />
          </div>
        )}
        {d.bankChanges.some((c) => c.status !== "pending") && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted mb-2">Requests from the investor</p>
            <ul className="space-y-1.5 text-xs">
              {d.bankChanges.filter((c) => c.status !== "pending").map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-x-2 text-muted">
                  <Badge variant={CHANGE_STATUS[c.status].variant}>{CHANGE_STATUS[c.status].label}</Badge>
                  <span>{c.bank_name} · {c.account_name} · <span className="font-mono">{c.account_number}</span></span>
                  <span>— requested {formatDateTime(c.requested_at)}</span>
                  {c.reviewed_by && <span>· {d.names[c.reviewed_by] ?? "—"}{c.reviewed_at ? `, ${formatDateTime(c.reviewed_at)}` : ""}</span>}
                  {c.reject_reason && <span>· “{c.reject_reason}”</span>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.bankHistory.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted mb-2">History</p>
            <ul className="space-y-1.5 text-xs">
              {d.bankHistory.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-2 text-muted">
                  <span className="text-foreground">{BANK_EVENT[h.event] ?? h.event}</span>
                  <span>{h.bank_name} · {h.account_name} · <span className="font-mono">{h.account_number}</span></span>
                  <span>— {h.actor ? d.names[h.actor] ?? "—" : "System"}, {formatDateTime(h.created_at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DetailSection>

      <DetailSection id="kyc" title="3. KYC" description="Verified MaalGrow KYC is reused. Bank details alone never count as KYC.">
        <FieldGrid
          rows={[
            { label: "Status", value: <Badge variant={KYC_STATUS_VARIANT[kyc] ?? "pending"}>{KYC_STATUS_LABEL[kyc] ?? kyc}</Badge> },
            {
              label: "Source",
              value: inv.kyc_source === "maalgrow" ? "Reused from verified MaalGrow KYC" : inv.kyc_source === "maalrise" ? "MaalRise verification" : "—",
            },
            { label: "Reviewed", value: inv.kyc_reviewed_at ? `${d.names[inv.kyc_reviewed_by ?? ""] ?? "—"}, ${formatDateTime(inv.kyc_reviewed_at)}` : "—" },
            { label: "Notes", value: inv.kyc_notes || "—" },
          ]}
        />
        {canPrepare && inv.kyc_source !== "maalgrow" && (
          <div className="mt-4">
            <KycActions investorId={inv.id} kycStatus={inv.kyc_status} hasPending={pending} />
          </div>
        )}
        {d.kyc.length > 0 && (
          <div className="mt-4">
            <p className="text-xs font-medium text-muted mb-2">Submissions</p>
            <ul className="space-y-1.5 text-xs">
              {d.kyc.map((k) => (
                <li key={k.id} className="text-muted">
                  <span className="text-foreground capitalize">{k.status.replace("_", " ")}</span> · submitted {formatDateTime(k.submitted_at)}
                  {k.reviewed_by && <> · reviewed by {d.names[k.reviewed_by] ?? "—"}</>}
                  {k.review_notes && <> · “{k.review_notes}”</>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </DetailSection>

      <DetailSection id="allocations" title="4. Cycle allocations">
        {d.allocations.length === 0 ? (
          <EmptyState icon={<Wallet className="h-5 w-5" />} title="Not allocated to any Cycle" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-4 font-medium">Cycle</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 text-right font-medium">Units</th>
                <th className="py-2 pl-4 text-right font-medium">Allocated capital</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.allocations.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-4">
                    <Link href={`/admin/maalrise/cycles/${a.cycle_id}`} className="text-primary-700 hover:underline">{a.cycle?.name ?? "—"}</Link>
                  </td>
                  <td className="px-4 py-2 text-muted">{a.cycle ? CYCLE_STATUS_LABEL[a.cycle.status] : "—"}</td>
                  <td className="px-4 py-2 text-right">{a.units}</td>
                  <td className="py-2 pl-4 text-right">{formatKobo(a.capital_kobo)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DetailSection>

      <DetailSection id="activity" title="5. Activity" description="From the existing audit log.">
        {d.activity.length === 0 ? (
          <p className="text-sm text-muted">No activity yet.</p>
        ) : (
          <ol className="space-y-2">
            {d.activity.map((a) => (
              <li key={a.id} className="text-sm">
                <span className="text-foreground">{ACTIVITY[a.action] ?? a.action}</span>
                <span className="text-xs text-muted"> — {a.user_id ? d.names[a.user_id] ?? "—" : "System"}, {formatDateTime(a.created_at)}</span>
              </li>
            ))}
          </ol>
        )}
      </DetailSection>
    </div>
  );
}
