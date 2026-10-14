import Link from "next/link";
import { AlertTriangle, ArrowLeft, Download, FileText, History, Receipt } from "lucide-react";
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
import {
  MONTH_STATUS_LABEL,
  MONTH_STATUS_VARIANT,
  PAYMENT_STATUS_LABEL,
  CAPITAL_STATUS_LABEL,
  CAPITAL_STATUS_VARIANT,
  capitalPosition,
  lagosToday,
  monthPositions,
  suggestedPeriod,
} from "@/lib/maalrise/receipts";
import { DetailSection, FieldGrid, SectionIndex } from "@/components/maalrise/section";
import { EmptyState } from "@/components/maalrise/sample-notice";
import { ActivationPanel, FundingPanel, ReopenPanel, TermsWorkflow, type FundingView } from "./_cycle-actions";
import { BulkImportPanel, ConfirmAllFunding, CycleEmailPanel } from "./_bulk-actions";
import {
  ClosePanel,
  DistributionActions,
  DocumentUpload,
  ReceiptActions,
  RecordCapitalForm,
  RecordPaymentForm,
  ReverseEntry,
} from "./_payment-actions";

const SECTIONS = [
  { id: "business", label: "Business & transaction" },
  { id: "terms", label: "Financial terms" },
  { id: "fees", label: "Markup & service fee" },
  { id: "allocations", label: "Investor allocations" },
  { id: "schedule", label: "Monthly profit schedule" },
  { id: "receipts", label: "Payments received" },
  { id: "distributions", label: "Profit distributions" },
  { id: "capital", label: "Capital settlement" },
  { id: "closing", label: "Closing & summary" },
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
  maalrise_move_funding: "Moved funding to the right investor",
  maalrise_activate_cycle: "Activated the Cycle",
  maalrise_register_document: "Uploaded a document",
  maalrise_record_receipt: "Recorded a payment received",
  maalrise_confirm_receipt: "Confirmed a payment — distribution calculated",
  maalrise_reject_receipt: "Rejected a payment entry",
  maalrise_approve_distribution: "Approved a profit distribution",
  maalrise_refresh_distribution: "Refreshed a distribution's bank details",
  maalrise_reverse_receipt: "Reversed a confirmed payment entry",
  maalrise_record_capital: "Recorded capital received",
  maalrise_confirm_capital: "Confirmed capital",
  maalrise_reject_capital: "Rejected a capital entry",
  maalrise_reverse_capital: "Reversed a confirmed capital entry",
  maalrise_approve_capital_settlement: "Approved the capital settlement",
  maalrise_refresh_capital_settlement: "Refreshed the capital settlement's bank details",
  maalrise_close_cycle: "Closed the Cycle",
  maalrise_reopen_cycle: "Reopened the Cycle for correction (super admin)",
};

const PAY_VARIANT = { pending_approval: "upcoming", payable: "warning", paid: "approved" } as const;
const RECEIPT_LABEL = { recorded: "Awaiting confirmation", confirmed: "Confirmed", rejected: "Rejected", reversed: "Reversed" } as const;
const RECEIPT_VARIANT = { recorded: "warning", confirmed: "approved", rejected: "rejected", reversed: "rejected" } as const;

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
  investorOptions,
}: {
  d: CycleDetail;
  me: string;
  role: string;
  permissions: { prepare: boolean; approve: boolean; finance: boolean; pay: boolean; superAdmin: boolean };
  investorOptions: { id: string; label: string }[];
}) {
  const { cycle } = d;
  const shown = d.approved ?? d.open;
  const workflowTerms = d.open ?? null;
  const lines = shown ? d.schedules[shown.id] ?? [] : [];
  const maturity = maturityDate(cycle.start_date, cycle.duration_months);
  const fundingOpen = ["draft", "terms_submitted", "terms_approved"].includes(cycle.status);
  const today = lagosToday();
  const approvedLines = d.approved ? d.schedules[d.approved.id] ?? [] : [];
  const positions = monthPositions(approvedLines, d.receipts, today);
  const active = cycle.status === "active";
  const distStatus = Object.fromEntries(d.distributions.map((x) => [x.id, x.status]));
  const capitalDue = d.approved?.cost_kobo ?? 0;
  const capital = maturity ? capitalPosition(capitalDue, maturity, d.capitalReceipts, today) : null;
  const liveSettlement = d.capitalSettlements.find((x) => x.status !== "cancelled") ?? null;
  const cpName = d.counterparty?.name ?? "the counterparty";
  const currentBank = Object.fromEntries(
    d.allocations.map((a) => [a.maalrise_investor_id, a.investor?.bank_confirmed_at ? a.investor.account_number : null])
  );

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
    investorId: f.maalrise_investor_id,
    investorName: f.investor ? `${f.investor.full_name} (${f.investor.investor_code})` : "—",
    units: f.units,
    amountKobo: f.amount_kobo,
    receivedOn: f.received_on,
    reference: f.reference,
    status: f.status,
    recordedBy: d.names[f.recorded_by] ?? "—",
    recordedByMe: f.recorded_by === me,
    decidedBy: f.confirmed_by ? d.names[f.confirmed_by] ?? "—" : f.rejected_by ? d.names[f.rejected_by] ?? "—" : null,
    rejectReason: f.reject_reason ?? (f.self_confirm_reason ? `Self-confirmed by a super admin: ${f.self_confirm_reason}` : null),
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
        description="Terms are versioned. Whoever prepares or submits a version cannot approve it (a super admin may, giving a reason); approval freezes the version and its breakdown."
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
                      {v.self_approval_reason && <span className="block text-amber-800">Self-approved by a super admin: {v.self_approval_reason}</span>}
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
            isSuperAdmin={role === "super_admin"}
            cycleStatus={cycle.status}
          />
        </div>
        <div className="mt-6 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted mb-2">Activation</p>
          <ActivationPanel cycleId={cycle.id} cycleStatus={cycle.status} canApprove={permissions.approve} />
          {permissions.superAdmin && active && d.receipts.length === 0 && d.capitalReceipts.length === 0
            && d.distributions.length === 0 && d.capitalSettlements.length === 0 && <ReopenPanel cycleId={cycle.id} />}
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
        {permissions.approve && fundingOpen && <div className="mb-4"><BulkImportPanel cycleId={cycle.id} /></div>}
        {permissions.finance && fundingOpen && fundings.some((f) => f.status === "recorded") && (
          <div className="mb-4">
            <ConfirmAllFunding cycleId={cycle.id} isSuperAdmin={role === "super_admin"}
              recorded={fundings.filter((f) => f.status === "recorded").length}
              recordedByMe={fundings.filter((f) => f.status === "recorded" && f.recordedByMe).length} />
          </div>
        )}
        {permissions.approve && d.allocations.length > 0 && !["cancelled", "closed"].includes(cycle.status) && (
          <div className="mb-4"><CycleEmailPanel cycleId={cycle.id} investors={d.allocations.length} /></div>
        )}
        <FundingPanel
          cycleId={cycle.id}
          investors={investorOptions}
          fundings={fundings}
          unitPriceKobo={cycle.unit_price_kobo}
          canFinance={permissions.finance}
          open={fundingOpen}
          isSuperAdmin={role === "super_admin"}
          canMove={permissions.approve}
        />
      </DetailSection>

      <DetailSection id="schedule" title="5. Monthly profit schedule"
        description="Expected monthly profit from the terms. Capital is settled separately at maturity (section 8). What has actually been received is in section 6.">
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

      <DetailSection id="receipts" title="6. Payments received from the counterparty"
        description={`What ${cpName} has actually paid against each scheduled month. The scheduled date and the date money arrived are kept apart; nothing is assumed paid because a date passed. A month not fully paid five days after its date is flagged for follow-up.`}>
        {!d.approved ? (
          <p className="text-sm text-muted">The monthly schedule exists once terms are approved.</p>
        ) : (
          <div className="space-y-5">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="py-2 pr-3 font-medium">Month</th>
                    <th className="px-3 py-2 font-medium">Scheduled date</th>
                    <th className="px-3 py-2 text-right font-medium">Scheduled</th>
                    <th className="px-3 py-2 text-right font-medium">Received (confirmed)</th>
                    <th className="px-3 py-2 text-right font-medium">Awaiting confirmation</th>
                    <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                    <th className="py-2 pl-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {positions.map((p) => (
                    <tr key={p.period}>
                      <td className="py-2 pr-3">{p.period}</td>
                      <td className="px-3 py-2 text-muted">{formatDate(p.dueDate)}</td>
                      <td className="px-3 py-2 text-right">{formatKobo(p.scheduledKobo)}</td>
                      <td className="px-3 py-2 text-right">
                        {p.confirmedKobo ? formatKobo(p.confirmedKobo) : "—"}
                        {p.heldKobo > 0 && <span className="block text-[10px] text-amber-700">{`+ ${formatKobo(p.heldKobo)} held (excess)`}</span>}
                      </td>
                      <td className="px-3 py-2 text-right text-muted">{p.pendingKobo ? formatKobo(p.pendingKobo) : "—"}</td>
                      <td className="px-3 py-2 text-right font-medium">{p.outstandingKobo ? formatKobo(p.outstandingKobo) : "—"}</td>
                      <td className="py-2 pl-3">
                        <Badge variant={MONTH_STATUS_VARIANT[p.status]}>{MONTH_STATUS_LABEL[p.status]}</Badge>
                        {p.followUp && p.status === "part_paid" && <Badge variant="danger" className="ml-1">Follow up</Badge>}
                        {p.daysLate > 0 && p.outstandingKobo > 0 && <span className="block text-[10px] text-muted">{`${p.daysLate} day(s) after the scheduled date`}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border font-semibold">
                    <td className="py-2 pr-3" colSpan={2}>Total</td>
                    <td className="px-3 py-2 text-right">{formatKobo(positions.reduce((t, p) => t + p.scheduledKobo, 0))}</td>
                    <td className="px-3 py-2 text-right">{formatKobo(positions.reduce((t, p) => t + p.confirmedKobo, 0))}</td>
                    <td className="px-3 py-2 text-right">{formatKobo(positions.reduce((t, p) => t + p.pendingKobo, 0))}</td>
                    <td className="px-3 py-2 text-right">{formatKobo(positions.reduce((t, p) => t + p.outstandingKobo, 0))}</td>
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>

            {active && permissions.finance ? (
              <RecordPaymentForm
                cycleId={cycle.id}
                counterparty={cpName}
                months={positions.map((p) => ({ period: p.period, dueDate: p.dueDate, outstandingKobo: p.outstandingKobo, scheduledKobo: p.scheduledKobo, recordableKobo: p.recordableKobo }))}
                suggested={suggestedPeriod(positions)}
                today={today}
                canConfirm={permissions.approve}
              />
            ) : !active ? (
              <p className="text-xs text-muted">Payments can be recorded once the Cycle is active.</p>
            ) : null}

            {d.receipts.length === 0 ? (
              <EmptyState icon={<Receipt className="h-5 w-5" />} title="No payments recorded yet" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="py-2 pr-3 font-medium">Received on</th>
                      <th className="px-3 py-2 font-medium">Month</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Reference</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="px-3 py-2 font-medium">How it was used</th>
                      <th className="py-2 pl-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.receipts.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.received_on)}</td>
                        <td className="px-3 py-2">{r.period}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatKobo(r.amount_kobo)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.reference ?? "—"}</td>
                        <td className="px-3 py-2">
                          <Badge variant={RECEIPT_VARIANT[r.status]}>{RECEIPT_LABEL[r.status]}</Badge>
                          <p className="text-[11px] text-muted mt-0.5">
                            {`Recorded by ${d.names[r.recorded_by] ?? "—"}`}
                            {r.confirmed_by ? ` · confirmed by ${d.names[r.confirmed_by] ?? "—"}` : ""}
                            {r.rejected_by ? ` · rejected by ${d.names[r.rejected_by] ?? "—"}` : ""}
                          </p>
                          {r.reject_reason && <p className="text-[11px] text-red-700">{r.reject_reason}</p>}
                          {r.reverse_reason && (
                            <p className="text-[11px] text-red-700">{`Reversed by ${d.names[r.reversed_by ?? ""] ?? "—"}: ${r.reverse_reason}`}</p>
                          )}
                          {r.notes && <p className="text-[11px] text-muted">{r.notes}</p>}
                        </td>
                        <td className="px-3 py-2 text-xs text-muted">
                          {r.status === "confirmed" || r.status === "reversed"
                            ? `${r.status === "reversed" ? "Was: " : ""}Applied ${formatKobo(r.applied_kobo ?? 0)} · fee ${formatKobo(r.fee_kobo ?? 0)} · to investors ${formatKobo(r.net_kobo ?? 0)}${r.held_kobo ? ` · held ${formatKobo(r.held_kobo)}` : ""}`
                            : "—"}
                        </td>
                        <td className="py-2 pl-3 text-right">
                          {r.status === "recorded" && permissions.approve && <ReceiptActions receiptId={r.id} />}
                          {r.status === "recorded" && !permissions.approve && <span className="text-[11px] text-muted">An administrator confirms</span>}
                          {r.status === "confirmed" && permissions.superAdmin && active && (!r.distribution_id || distStatus[r.distribution_id] === "prepared") && (
                            <ReverseEntry url={`/api/admin/maalrise/receipts/${r.id}`} what="Entry" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </DetailSection>

      <DetailSection id="distributions" title="7. Monthly profit distributions"
        description="Calculated automatically from confirmed payments only: the service fee is taken in proportion to each payment, investors share the rest by units of the whole Cycle to the kobo, and the unsubscribed units' share stays unallocated. Tax: none (not configured). Approval makes each payment payable; nobody is paid automatically.">
        {d.distributions.length === 0 ? (
          <EmptyState icon={<Receipt className="h-5 w-5" />} title="No distributions yet">
            A distribution appears here when a payment from {cpName} is confirmed.
          </EmptyState>
        ) : (
          <div className="space-y-6">
            {d.distributions.map((dist) => {
              const missing = dist.lines.filter((l) => !l.account_number || currentBank[l.maalrise_investor_id] !== l.account_number);
              return (
                <div key={dist.id} className="rounded-lg border border-border p-4 space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {`Month ${dist.period}${dist.sequence > 1 ? ` — follow-on #${dist.sequence}` : ""}`}{" "}
                      <span className="text-xs text-muted">{`(scheduled ${formatDate(dist.due_date)})`}</span>
                    </p>
                    <Badge variant={dist.status === "approved" ? "approved" : "warning"}>
                      {dist.status === "approved" ? "Approved" : "Prepared — awaiting approval"}
                    </Badge>
                  </div>
                  <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-3">
                    {[
                      ["Received and applied", formatKobo(dist.applied_kobo)],
                      ["Service fee taken", formatKobo(dist.fee_kobo)],
                      ["Tax", `${formatKobo(dist.tax_kobo)} (not configured)`],
                      ["Net for investors", formatKobo(dist.net_kobo)],
                      ["Shared among investors", formatKobo(dist.allocated_kobo)],
                      ["Unallocated (unsubscribed units)", formatKobo(dist.unallocated_kobo)],
                    ].map(([l, v]) => (
                      <div key={l} className="flex justify-between gap-2"><dt className="text-muted">{l}</dt><dd className="font-medium">{v}</dd></div>
                    ))}
                  </dl>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs text-muted">
                          <th className="py-2 pr-3 font-medium">Investor</th>
                          <th className="px-3 py-2 text-right font-medium">Units</th>
                          <th className="px-3 py-2 text-right font-medium">Amount</th>
                          <th className="px-3 py-2 font-medium">Pay to (confirmed account)</th>
                          <th className="py-2 pl-3 font-medium">Payment status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {dist.lines.map((l) => (
                          <tr key={l.id} className="align-top">
                            <td className="py-2 pr-3">{l.investor_name} <span className="text-xs text-muted font-mono">{l.investor_code}</span></td>
                            <td className="px-3 py-2 text-right">{l.units}</td>
                            <td className="px-3 py-2 text-right font-medium">{formatKobo(l.amount_kobo)}</td>
                            <td className="px-3 py-2 text-xs">
                              {l.account_number
                                ? <>{l.bank_name} · {l.account_name} · <span className="font-mono">{l.account_number}</span></>
                                : <span className="text-red-700">No confirmed bank account</span>}
                            </td>
                            <td className="py-2 pl-3">
                              <Badge variant={PAY_VARIANT[l.status]}>{PAYMENT_STATUS_LABEL[l.status]}</Badge>
                              {l.status === "paid" && (
                                <p className="text-[11px] text-muted mt-0.5">
                                  {`${formatDate(l.paid_on!)}${l.paid_reference ? ` · ref ${l.paid_reference}` : ""} · by ${d.names[l.paid_by ?? ""] ?? "—"}`}
                                </p>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-[11px] text-muted">
                    {`Prepared by ${d.names[dist.prepared_by] ?? "—"}, ${formatDateTime(dist.prepared_at)}`}
                    {dist.approved_by ? ` · approved by ${d.names[dist.approved_by] ?? "—"}, ${formatDateTime(dist.approved_at!)}` : ""}
                  </p>
                  {dist.status === "prepared" && missing.length > 0 && (
                    <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      {`Bank details are unconfirmed or have changed for ${missing.map((l) => l.investor_name).join(", ")}. Confirm them on the investor's page, then refresh this distribution.`}
                    </p>
                  )}
                  {dist.status === "prepared" && dist.net_kobo === 0 && (
                    <p className="text-xs text-muted">Empty — its entries were reversed. The next confirmed payment for this month fills it.</p>
                  )}
                  {dist.status === "prepared" && dist.net_kobo > 0 && permissions.approve && (
                    <DistributionActions distributionId={dist.id} blocked={missing.length > 0} />
                  )}
                  {dist.status === "approved" && dist.lines.some((l) => l.status === "payable") && (
                    <p className="text-xs text-muted">
                      Make the bank transfers outside MaalRise, then record each one on{" "}
                      <Link href="/admin/payment-requests/maalrise" className="text-primary-700 hover:underline">MaalRise Payments</Link>.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </DetailSection>

      <DetailSection id="capital" title="8. Capital settlement"
        description={`The capital (${formatKobo(capitalDue)}) is repaid by ${cpName} in one sum at maturity and returned to investors separately from monthly profit — no fee or tax is taken from it. Investors are paid out only once the full capital is confirmed.`}>
        {!d.approved || !capital ? (
          <p className="text-sm text-muted">Capital settlement applies once terms are approved.</p>
        ) : (
          <div className="space-y-5">
            <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
              {[
                ["Capital due", formatKobo(capital.dueKobo)],
                ["Maturity date", formatDate(capital.dueDate)],
                ["Received (confirmed)", formatKobo(capital.confirmedKobo)],
                ["Awaiting confirmation", capital.pendingKobo ? formatKobo(capital.pendingKobo) : "—"],
                ["Still owed", capital.outstandingKobo ? formatKobo(capital.outstandingKobo) : "—"],
              ].map(([l, v]) => (
                <div key={l} className="flex justify-between gap-2"><dt className="text-muted">{l}</dt><dd className="font-medium">{v}</dd></div>
              ))}
              <div className="flex justify-between gap-2">
                <dt className="text-muted">Status</dt>
                <dd>
                  <Badge variant={CAPITAL_STATUS_VARIANT[capital.status]}>{CAPITAL_STATUS_LABEL[capital.status]}</Badge>
                  {capital.followUp && capital.status === "part_received" && <Badge variant="danger" className="ml-1">Follow up</Badge>}
                </dd>
              </div>
            </dl>

            {active && permissions.finance && capital.recordableKobo > 0 && (
              <RecordCapitalForm cycleId={cycle.id} counterparty={cpName} recordableKobo={capital.recordableKobo} today={today} canConfirm={permissions.approve} />
            )}

            {d.capitalReceipts.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs text-muted">
                      <th className="py-2 pr-3 font-medium">Received on</th>
                      <th className="px-3 py-2 text-right font-medium">Amount</th>
                      <th className="px-3 py-2 font-medium">Reference</th>
                      <th className="px-3 py-2 font-medium">Status</th>
                      <th className="py-2 pl-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {d.capitalReceipts.map((r) => (
                      <tr key={r.id} className="align-top">
                        <td className="py-2 pr-3 whitespace-nowrap">{formatDate(r.received_on)}</td>
                        <td className="px-3 py-2 text-right font-medium">{formatKobo(r.amount_kobo)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{r.reference ?? "—"}</td>
                        <td className="px-3 py-2">
                          <Badge variant={RECEIPT_VARIANT[r.status]}>{RECEIPT_LABEL[r.status]}</Badge>
                          <p className="text-[11px] text-muted mt-0.5">
                            {`Recorded by ${d.names[r.recorded_by] ?? "—"}`}
                            {r.confirmed_by ? ` · confirmed by ${d.names[r.confirmed_by] ?? "—"}` : ""}
                          </p>
                          {r.reject_reason && <p className="text-[11px] text-red-700">{r.reject_reason}</p>}
                          {r.reverse_reason && <p className="text-[11px] text-red-700">{`Reversed by ${d.names[r.reversed_by ?? ""] ?? "—"}: ${r.reverse_reason}`}</p>}
                        </td>
                        <td className="py-2 pl-3 text-right">
                          {r.status === "recorded" && permissions.approve && <ReceiptActions receiptId={r.id} base="capital" />}
                          {r.status === "recorded" && !permissions.approve && <span className="text-[11px] text-muted">An administrator confirms</span>}
                          {r.status === "confirmed" && permissions.superAdmin && active && liveSettlement?.status !== "approved" && (
                            <ReverseEntry url={`/api/admin/maalrise/capital/${r.id}`} what="Capital entry" />
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {!liveSettlement ? (
              <p className="text-xs text-muted">
                {capital.confirmedKobo > 0
                  ? `${formatKobo(capital.outstandingKobo)} of capital still to be confirmed before investors can be repaid.`
                  : "Each investor's capital repayment is prepared here once the full capital is confirmed."}
              </p>
            ) : (
              <div className="rounded-lg border border-border p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-medium">Capital repayment to investors</p>
                  <Badge variant={liveSettlement.status === "approved" ? "approved" : "warning"}>
                    {liveSettlement.status === "approved" ? "Approved" : "Prepared — awaiting approval"}
                  </Badge>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border text-left text-xs text-muted">
                        <th className="py-2 pr-3 font-medium">Investor</th>
                        <th className="px-3 py-2 text-right font-medium">Units</th>
                        <th className="px-3 py-2 text-right font-medium">Capital returned</th>
                        <th className="px-3 py-2 font-medium">Pay to (confirmed account)</th>
                        <th className="py-2 pl-3 font-medium">Payment status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {liveSettlement.payments.map((l) => (
                        <tr key={l.id} className="align-top">
                          <td className="py-2 pr-3">{l.investor_name} <span className="text-xs text-muted font-mono">{l.investor_code}</span></td>
                          <td className="px-3 py-2 text-right">{l.units}</td>
                          <td className="px-3 py-2 text-right font-medium">{formatKobo(l.amount_kobo)}</td>
                          <td className="px-3 py-2 text-xs">
                            {l.account_number
                              ? <>{l.bank_name} · {l.account_name} · <span className="font-mono">{l.account_number}</span></>
                              : <span className="text-red-700">No confirmed bank account</span>}
                          </td>
                          <td className="py-2 pl-3">
                            <Badge variant={PAY_VARIANT[l.status]}>{PAYMENT_STATUS_LABEL[l.status]}</Badge>
                            {l.status === "paid" && (
                              <p className="text-[11px] text-muted mt-0.5">{`${formatDate(l.paid_on!)}${l.paid_reference ? ` · ref ${l.paid_reference}` : ""}`}</p>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-[11px] text-muted">
                  {`Prepared by ${d.names[liveSettlement.prepared_by] ?? "—"}, ${formatDateTime(liveSettlement.prepared_at)}`}
                  {liveSettlement.approved_by ? ` · approved by ${d.names[liveSettlement.approved_by] ?? "—"}, ${formatDateTime(liveSettlement.approved_at!)}` : ""}
                </p>
                {liveSettlement.status === "prepared" && permissions.approve && (
                  <DistributionActions distributionId={liveSettlement.id} base="capital-settlements"
                    blocked={liveSettlement.payments.some((l) => !l.account_number || currentBank[l.maalrise_investor_id] !== l.account_number)} />
                )}
                {liveSettlement.status === "approved" && liveSettlement.payments.some((l) => l.status === "payable") && (
                  <p className="text-xs text-muted">
                    Make the bank transfers outside MaalRise, then record each one on{" "}
                    <Link href="/admin/payment-requests/maalrise" className="text-primary-700 hover:underline">MaalRise Payments</Link>.
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </DetailSection>

      <DetailSection id="closing" title="9. Closing and summary"
        description="A Cycle closes only when every month's profit and the capital have been received, distributed, approved and marked paid. There are no write-offs, and every investor is paid out.">
        <ClosingSummary d={d} />
        {active && (
          <div className="mt-4 border-t border-border pt-4">
            <ClosePanel cycleId={cycle.id} canClose={permissions.approve} />
          </div>
        )}
        {cycle.status === "closed" && (
          <p className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            This Cycle is closed. All profit and capital was received and paid; its records are final.
          </p>
        )}
      </DetailSection>

      <DetailSection id="documents" title="10. Documents" description="Original contract and supporting transaction documents. The contract must be uploaded before the Cycle can be activated.">
        {d.documents.length === 0 ? (
          <EmptyState icon={<FileText className="h-5 w-5" />} title="No documents uploaded">
            The original contract must be uploaded before the Cycle can be activated.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {d.documents.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-center justify-between gap-4 py-2 text-sm">
                <a href={`/api/admin/maalrise/documents/${doc.id}`} className="flex items-center gap-2 text-primary-700 hover:underline">
                  <FileText className="h-4 w-4 text-primary-600" /> {doc.name} <Download className="h-3.5 w-3.5" />
                </a>
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted">{formatDateTime(doc.created_at)}</span>
                  <Badge variant="outline" className="capitalize">{doc.category}</Badge>
                  <Badge variant={doc.visible_to_investors ? "info" : "upcoming"}>{doc.visible_to_investors ? "Visible to investors" : "Admin only"}</Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
        {permissions.prepare && (
          <div className="mt-4">
            <DocumentUpload cycleId={cycle.id} hasContract={d.documents.some((x) => x.category === "contract")} />
          </div>
        )}
      </DetailSection>

      <DetailSection id="activity" title="11. Activity history" description="From the existing audit log.">
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

/** Per investor: capital in, profit paid, capital returned — and the Cycle's fees and unallocated share. */
function ClosingSummary({ d }: { d: CycleDetail }) {
  const profitPaid = (inv: string) =>
    d.distributions.flatMap((x) => x.lines).filter((l) => l.maalrise_investor_id === inv && l.status === "paid").reduce((s, l) => s + l.amount_kobo, 0);
  const capitalReturned = (inv: string) =>
    d.capitalSettlements.filter((x) => x.status !== "cancelled").flatMap((x) => x.payments)
      .filter((l) => l.maalrise_investor_id === inv && l.status === "paid").reduce((s, l) => s + l.amount_kobo, 0);
  const fees = d.distributions.reduce((s, x) => s + x.fee_kobo, 0);
  const unallocated = d.distributions.reduce((s, x) => s + x.unallocated_kobo, 0);
  const received = d.receipts.filter((r) => r.status === "confirmed").reduce((s, r) => s + (r.applied_kobo ?? 0), 0)
    + d.capitalReceipts.filter((r) => r.status === "confirmed").reduce((s, r) => s + r.amount_kobo, 0);
  if (d.allocations.length === 0) return <p className="text-sm text-muted">No investors allocated.</p>;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">Investor</th>
              <th className="px-3 py-2 text-right font-medium">Capital in</th>
              <th className="px-3 py-2 text-right font-medium">Profit paid</th>
              <th className="py-2 pl-3 text-right font-medium">Capital returned</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {d.allocations.map((a) => (
              <tr key={a.id}>
                <td className="py-2 pr-3">{a.investor?.full_name ?? "—"}</td>
                <td className="px-3 py-2 text-right">{formatKobo(a.capital_kobo)}</td>
                <td className="px-3 py-2 text-right">{formatKobo(profitPaid(a.maalrise_investor_id))}</td>
                <td className="py-2 pl-3 text-right">{formatKobo(capitalReturned(a.maalrise_investor_id))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border font-semibold">
              <td className="py-2 pr-3">Total</td>
              <td className="px-3 py-2 text-right">{formatKobo(d.allocations.reduce((s, a) => s + a.capital_kobo, 0))}</td>
              <td className="px-3 py-2 text-right">{formatKobo(d.allocations.reduce((s, a) => s + profitPaid(a.maalrise_investor_id), 0))}</td>
              <td className="py-2 pl-3 text-right">{formatKobo(d.allocations.reduce((s, a) => s + capitalReturned(a.maalrise_investor_id), 0))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p className="text-xs text-muted">
        {`Received from the counterparty (confirmed): ${formatKobo(received)} · service fees taken: ${formatKobo(fees)} · unsubscribed share unallocated: ${formatKobo(unallocated)} · tax: none (not configured)`}
      </p>
    </div>
  );
}
