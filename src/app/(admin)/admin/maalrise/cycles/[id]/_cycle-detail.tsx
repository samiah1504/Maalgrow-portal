import Link from "next/link";
import { ArrowLeft, FileText, History, Receipt } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import { allocateCycle } from "@/lib/maalrise/compute";
import { maturityDate } from "@/lib/maalrise/dates";
import {
  CYCLE_STATUS_LABEL,
  CYCLE_STATUS_VARIANT,
  FEE_BASIS_LABEL,
  FEE_TREATMENT_LABEL,
  formatBps,
  formatKobo,
} from "@/lib/maalrise/format";
import type { CycleDetail } from "@/lib/maalrise/db";
import type { TermsRow } from "@/lib/maalrise/types";
import { DetailSection, FieldGrid, SectionIndex } from "@/components/maalrise/section";
import { EmptyState, PhaseNotice } from "@/components/maalrise/sample-notice";
import { ActivationPanel, FundingPanel, TermsWorkflow, type FundingView } from "./_cycle-actions";

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

const TERMS_LABEL: Record<string, { label: string; variant: "pending" | "warning" | "approved" | "upcoming" | "danger" }> = {
  draft: { label: "Draft", variant: "pending" },
  submitted: { label: "Awaiting approval", variant: "warning" },
  approved: { label: "Approved — frozen", variant: "approved" },
  superseded: { label: "Superseded", variant: "upcoming" },
  returned: { label: "Returned", variant: "danger" },
};

const ACTIVITY: Record<string, string> = {
  maalrise_create_cycle: "Created the Cycle",
  maalrise_save_terms: "Saved terms",
  maalrise_submit_terms: "Submitted terms for approval",
  maalrise_return_terms: "Returned terms for changes",
  maalrise_approve_terms: "Approved terms — breakdown frozen",
  maalrise_record_funding: "Recorded funding",
  maalrise_confirm_funding: "Confirmed funding",
  maalrise_reject_funding: "Rejected funding",
  maalrise_activate_cycle: "Activated the Cycle",
  maalrise_register_document: "Registered a document",
};

function markupLine(t: TermsRow) {
  return t.markup_type === "percent"
    ? `${formatKobo(t.markup_kobo)} (${formatBps(t.markup_bps ?? 0)} of cost — total for the whole Cycle)`
    : `${formatKobo(t.markup_kobo)} (fixed amount for the whole Cycle)`;
}

export function CycleDetailView({
  d,
  me,
  role,
  permissions,
  activationOn,
  investorOptions,
}: {
  d: CycleDetail;
  me: string;
  role: string;
  permissions: { prepare: boolean; approve: boolean; finance: boolean };
  activationOn: boolean;
  investorOptions: { id: string; label: string }[];
}) {
  const { cycle } = d;
  const shown = d.approved ?? d.open;
  const workflowTerms = d.open ?? null;
  const lines = shown ? d.schedules[shown.id] ?? [] : [];
  const maturity = maturityDate(cycle.start_date, cycle.duration_months);
  const fundingOpen = ["draft", "terms_submitted", "terms_approved"].includes(cycle.status);

  const alloc = shown
    ? allocateCycle(
        { costKobo: shown.cost_kobo, unitPriceKobo: cycle.unit_price_kobo },
        lines.map((l) => ({ investorNetKobo: l.investor_net_kobo })),
        d.allocations.map((a) => ({ key: a.maalrise_investor_id, units: a.units }))
      )
    : null;
  const allocByInvestor = Object.fromEntries((alloc?.lines ?? []).map((l) => [l.key, l]));

  const fundings: FundingView[] = d.fundings.map((f) => ({
    id: f.id,
    investorName: f.investor ? `${f.investor.full_name} (${f.investor.investor_code})` : "—",
    units: f.units,
    amountKobo: f.amount_kobo,
    receivedOn: f.received_on,
    reference: f.reference,
    status: f.status,
    recordedBy: d.names[f.recorded_by] ?? "—",
    recordedByMe: f.recorded_by === me,
    decidedBy: f.confirmed_by ? d.names[f.confirmed_by] ?? "—" : f.rejected_by ? d.names[f.rejected_by] ?? "—" : null,
    rejectReason: f.reject_reason,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start gap-3">
        <Link href="/admin/maalrise/cycles" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors" aria-label="Back to MaalRise Cycles">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{cycle.name}</h1>
            <Badge variant={CYCLE_STATUS_VARIANT[cycle.status] ?? "pending"}>{CYCLE_STATUS_LABEL[cycle.status] ?? cycle.status}</Badge>
          </div>
          <p className="text-sm text-muted mt-0.5">{cycle.transaction_name}</p>
        </div>
      </div>

      <SectionIndex items={SECTIONS} />

      <DetailSection id="business" title="1. Business and transaction details">
        <FieldGrid
          rows={[
            { label: "Cycle name", value: cycle.name },
            { label: "Business / transaction", value: cycle.transaction_name },
            { label: "Counterparty", value: d.counterparty ? `${d.counterparty.name}${d.counterparty.registration_no ? ` (${d.counterparty.registration_no})` : ""}` : "—" },
            { label: "Counterparty contact", value: d.counterparty?.contact_email || "—" },
            { label: "Transaction start", value: formatDate(cycle.start_date) },
            { label: "Duration", value: `${cycle.duration_months} months` },
            { label: "Maturity", value: maturity ? formatDate(maturity) : "—" },
            { label: "Maturity per contract", value: cycle.stated_maturity_date ? formatDate(cycle.stated_maturity_date) : "Not stated" },
            { label: "Unit price", value: formatKobo(cycle.unit_price_kobo) },
            { label: "Created by", value: cycle.created_by ? d.names[cycle.created_by] ?? "—" : "—" },
          ]}
        />
        {cycle.description && <p className="mt-4 text-sm text-foreground">{cycle.description}</p>}
      </DetailSection>

      <DetailSection
        id="terms"
        title="2. Financial terms"
        description="Terms are versioned. Whoever prepares or submits a version cannot approve it; approval freezes the version and its breakdown."
      >
        {d.versions.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No terms yet">
            Terms are prepared from the contract and then approved by a second authorised person.
          </EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Version</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 text-right font-medium">Cost</th>
                  <th className="px-3 py-2 text-right font-medium">Sale price</th>
                  <th className="px-3 py-2 font-medium">Prepared / submitted</th>
                  <th className="py-2 pl-3 font-medium">Approved / returned</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.versions.map((v) => (
                  <tr key={v.id} className="align-top">
                    <td className="py-2 pr-3">v{v.version}</td>
                    <td className="px-3 py-2"><Badge variant={TERMS_LABEL[v.status]?.variant ?? "pending"}>{TERMS_LABEL[v.status]?.label ?? v.status}</Badge></td>
                    <td className="px-3 py-2 text-right">{formatKobo(v.cost_kobo)}</td>
                    <td className="px-3 py-2 text-right">{formatKobo(v.sale_price_kobo)}</td>
                    <td className="px-3 py-2 text-xs text-muted">
                      {d.names[v.prepared_by] ?? "—"}
                      {v.submitted_by && <> · submitted by {d.names[v.submitted_by] ?? "—"}{v.submitted_at ? `, ${formatDateTime(v.submitted_at)}` : ""}</>}
                    </td>
                    <td className="py-2 pl-3 text-xs text-muted">
                      {v.approved_by ? `${d.names[v.approved_by] ?? "—"}, ${formatDateTime(v.approved_at!)}` : ""}
                      {v.return_reason && <span className="block text-red-700">Returned by {d.names[v.returned_by ?? ""] ?? "—"}: {v.return_reason}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-4">
          <TermsWorkflow
            cycleId={cycle.id}
            terms={workflowTerms ? { id: workflowTerms.id, status: workflowTerms.status } : null}
            canPrepare={permissions.prepare}
            canApprove={permissions.approve}
            isOwnTerms={!!workflowTerms && (workflowTerms.prepared_by === me || workflowTerms.submitted_by === me)}
            cycleStatus={cycle.status}
          />
        </div>
        <div className="mt-6 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted mb-2">Activation</p>
          <ActivationPanel cycleId={cycle.id} cycleStatus={cycle.status} canApprove={permissions.approve} activationOn={activationOn} />
        </div>
      </DetailSection>

      <DetailSection id="fees" title="3. Markup and service fee"
        description={shown ? `Showing version ${shown.version} (${TERMS_LABEL[shown.status]?.label ?? shown.status}). The markup and the fee are separate terms.` : undefined}>
        {!shown ? (
          <p className="text-sm text-muted">No terms yet.</p>
        ) : (
          <dl className="divide-y divide-border text-sm">
            {[
              ["Transaction cost", formatKobo(shown.cost_kobo)],
              ["Murabaha markup", markupLine(shown)],
              ["Agreed sale price", formatKobo(shown.sale_price_kobo)],
              ["Sale price stated in contract", shown.stated_sale_price_kobo != null ? formatKobo(shown.stated_sale_price_kobo) : "Not stated"],
              ["Fee basis", shown.fee_treatment === "waived" ? "Not applicable — fee waived" : FEE_BASIS_LABEL[shown.fee_basis]],
              ["Fee rate / amount", shown.fee_treatment === "waived" ? "—" : shown.fee_basis === "fixed" ? formatKobo(shown.fee_amount_kobo ?? 0) : formatBps(shown.fee_bps ?? 0)],
              ["Fee treatment", FEE_TREATMENT_LABEL[shown.fee_treatment]],
              ["Service fee", formatKobo(shown.fee_kobo)],
              ["Investor profit pool", formatKobo(shown.investor_pool_kobo)],
              ["Total payable by counterparty", formatKobo(shown.counterparty_total_kobo)],
              ["Tax treatment", "Not configured — pending confirmation (A12)"],
              ["Engine version", shown.engine_version],
            ].map(([l, v]) => (
              <div key={l} className="flex justify-between gap-4 py-2">
                <dt className="text-muted">{l}</dt>
                <dd className="text-right font-medium">{v}</dd>
              </div>
            ))}
          </dl>
        )}
      </DetailSection>

      <DetailSection id="allocations" title="4. Investor allocations and funding"
        description="Capital is what each investor actually paid in. Profit is shared per unit of the whole Cycle; the share of unsubscribed units stays unallocated.">
        {alloc && d.allocations.length > 0 ? (
          <div className="overflow-x-auto mb-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Investor</th>
                  <th className="px-3 py-2 text-right font-medium">Units</th>
                  <th className="px-3 py-2 text-right font-medium">Participation</th>
                  <th className="px-3 py-2 text-right font-medium">Allocated capital</th>
                  <th className="py-2 pl-3 text-right font-medium">Expected profit (term)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {d.allocations.map((a) => {
                  const line = allocByInvestor[a.maalrise_investor_id];
                  return (
                    <tr key={a.id}>
                      <td className="py-2 pr-3">
                        <Link href={`/admin/maalrise/investors/${a.maalrise_investor_id}`} className="text-primary-700 hover:underline">
                          {a.investor?.full_name ?? "—"}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right">{a.units}</td>
                      <td className="px-3 py-2 text-right">{line ? formatBps(line.participationBps) : "—"}</td>
                      <td className="px-3 py-2 text-right">{formatKobo(a.capital_kobo)}</td>
                      <td className="py-2 pl-3 text-right">{line ? formatKobo(line.totalProfitKobo) : "—"}</td>
                    </tr>
                  );
                })}
                {alloc.unallocated && (
                  <tr className="text-amber-800">
                    <td className="py-2 pr-3 italic">Unsubscribed — not allocated</td>
                    <td className="px-3 py-2 text-right">{alloc.unallocated.units}</td>
                    <td className="px-3 py-2 text-right">{formatBps(alloc.unallocated.participationBps)}</td>
                    <td className="px-3 py-2 text-right">{formatKobo(0)}</td>
                    <td className="py-2 pl-3 text-right">{formatKobo(alloc.unallocated.totalProfitKobo)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            {alloc.fundingShortfallKobo > 0 && (
              <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                {`Funding shortfall: ${formatKobo(alloc.fundingShortfallKobo)} (${alloc.unitsRequired - alloc.unitsFunded} units unsubscribed). The Cycle cannot be activated until it is fully funded.`}
              </p>
            )}
          </div>
        ) : (
          <p className="mb-4 text-sm text-muted">No confirmed funding yet.</p>
        )}
        <FundingPanel
          cycleId={cycle.id}
          investors={investorOptions}
          fundings={fundings}
          unitPriceKobo={cycle.unit_price_kobo}
          canFinance={permissions.finance}
          open={fundingOpen}
        />
      </DetailSection>

      <DetailSection id="schedule" title="5. Monthly profit schedule"
        description="Expected monthly profit from the terms. Capital is settled separately at maturity (section 7). Payments are tracked from Phase 4.">
        {lines.length === 0 ? (
          <p className="text-sm text-muted">No schedule yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-2 pr-3 font-medium">Month</th>
                  <th className="px-3 py-2 font-medium">Due (provisional, A4)</th>
                  <th className="px-3 py-2 text-right font-medium">Counterparty gross</th>
                  <th className="px-3 py-2 text-right font-medium">Fee (timing A7)</th>
                  <th className="py-2 pl-3 text-right font-medium">Net to investors</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lines.map((l) => (
                  <tr key={l.id}>
                    <td className="py-2 pr-3">{l.period}</td>
                    <td className="px-3 py-2 text-muted">{formatDate(l.due_date)}</td>
                    <td className="px-3 py-2 text-right">{formatKobo(l.counterparty_gross_kobo)}</td>
                    <td className="px-3 py-2 text-right">{formatKobo(l.fee_kobo)}</td>
                    <td className="py-2 pl-3 text-right font-medium">
                      {formatKobo(l.investor_net_kobo)}
                      {l.rounding_adjustment_kobo > 0 && <span className="block text-[10px] text-amber-700">incl. rounding {formatKobo(l.rounding_adjustment_kobo)}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-semibold">
                  <td className="py-2 pr-3" colSpan={2}>Total</td>
                  <td className="px-3 py-2 text-right">{formatKobo(lines.reduce((s, l) => s + l.counterparty_gross_kobo, 0))}</td>
                  <td className="px-3 py-2 text-right">{formatKobo(lines.reduce((s, l) => s + l.fee_kobo, 0))}</td>
                  <td className="py-2 pl-3 text-right">{formatKobo(lines.reduce((s, l) => s + l.investor_net_kobo, 0))}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </DetailSection>

      <DetailSection id="receipts" title="6. Receipts and distributions">
        <EmptyState icon={<Receipt className="h-5 w-5" />} title="No receipts recorded">
          Recording receipts from the counterparty, distributing profit and the Payment Officer&apos;s &quot;Mark as Paid&quot;
          screen arrive in Phase 4. Nothing is paid or sent from this page.
        </EmptyState>
      </DetailSection>

      <DetailSection id="capital" title="7. Capital settlement" description="Separate from monthly profit. Due at maturity, per investor.">
        {d.allocations.length === 0 ? (
          <p className="text-sm text-muted">No capital allocated yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">Investor</th>
                <th className="px-3 py-2 font-medium">Due date</th>
                <th className="px-3 py-2 text-right font-medium">Capital due</th>
                <th className="py-2 pl-3 text-center font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {d.allocations.map((a) => (
                <tr key={a.id}>
                  <td className="py-2 pr-3">{a.investor?.full_name ?? "—"}</td>
                  <td className="px-3 py-2 text-muted">{maturity ? formatDate(maturity) : "—"}</td>
                  <td className="px-3 py-2 text-right">{formatKobo(a.capital_kobo)}</td>
                  <td className="py-2 pl-3 text-center"><Badge variant="upcoming">Not yet due</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DetailSection>

      <DetailSection id="documents" title="8. Documents" description="Original contract and supporting transaction documents.">
        {d.documents.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents uploaded">
            The original contract must be uploaded before the Cycle can be activated.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {d.documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-4 py-2 text-sm">
                <span className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary-600" /> {doc.name}</span>
                <span className="flex items-center gap-2">
                  <Badge variant="outline" className="capitalize">{doc.category}</Badge>
                  <Badge variant={doc.visible_to_investors ? "info" : "upcoming"}>{doc.visible_to_investors ? "Visible to investors" : "Admin only"}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4">
          <PhaseNotice>Uploading documents to private storage is part of the next phase, together with the storage bucket it needs.</PhaseNotice>
        </div>
      </DetailSection>

      <DetailSection id="activity" title="9. Activity history" description="From the existing audit log.">
        {d.activity.length === 0 ? (
          <EmptyState icon={<History className="h-5 w-5" />} title="No activity yet" />
        ) : (
          <ol className="space-y-3">
            {d.activity.map((a) => (
              <li key={a.id} className="flex gap-3 text-sm">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary-400" />
                <div>
                  <p className="text-foreground">{ACTIVITY[a.action] ?? a.action}</p>
                  <p className="text-xs text-muted">{a.user_id ? d.names[a.user_id] ?? "—" : "System"} · {formatDateTime(a.created_at)}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </DetailSection>
      <p className="text-[11px] text-muted">Signed in as {role.replace(/_/g, " ")}.</p>
    </div>
  );
}
