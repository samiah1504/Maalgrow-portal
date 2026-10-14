"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, XCircle, ShieldCheck, Send, Undo2, Pencil, Play, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { formatKobo, koboInWords } from "@/lib/maalrise/format";
import { useMaalriseAction } from "@/components/maalrise/use-maalrise-action";
import type { ActivationCheck } from "@/lib/maalrise/types";

const textarea =
  "flex min-h-[64px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

/**
 * Submit / approve / return the open terms. Buttons appear only for
 * roles that may use them; the database decides in the end, including
 * refusing an approver who prepared or submitted the terms.
 */
export function TermsWorkflow({
  cycleId,
  terms,
  canPrepare,
  canApprove,
  isOwnTerms,
  isSuperAdmin = false,
  cycleStatus,
}: {
  cycleId: string;
  terms: { id: string; status: string } | null;
  canPrepare: boolean;
  canApprove: boolean;
  isOwnTerms: boolean;
  /** A super admin may approve their own terms, giving a reason (migration 056). */
  isSuperAdmin?: boolean;
  cycleStatus: string;
}) {
  const { run, busy } = useMaalriseAction();
  const [returning, setReturning] = useState(false);
  const [reason, setReason] = useState("");
  const [selfReason, setSelfReason] = useState("");
  const url = `/api/admin/maalrise/cycles/${cycleId}/actions`;
  const editable = ["draft", "terms_approved"].includes(cycleStatus);

  return (
    <div className="flex flex-wrap items-start gap-2">
      {canPrepare && editable && (!terms || terms.status === "draft") && (
        <Button asChild size="sm" variant="outline">
          <Link href={`/admin/maalrise/cycles/${cycleId}/terms`} className="flex items-center gap-1.5">
            <Pencil className="h-3.5 w-3.5" /> {terms ? "Edit draft terms" : cycleStatus === "terms_approved" ? "Prepare a new version" : "Prepare terms"}
          </Link>
        </Button>
      )}
      {canPrepare && terms?.status === "draft" && (
        <Button size="sm" loading={busy === "submit"}
          onClick={() => run("submit", url, { action: "submit", terms_id: terms.id }, { success: "Terms submitted for approval." })}>
          <Send className="h-3.5 w-3.5" /> Submit for approval
        </Button>
      )}
      {canApprove && terms?.status === "submitted" && (
        isOwnTerms && !isSuperAdmin ? (
          <p className="text-xs text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            You prepared or submitted these terms, so a different authorised person must approve them.
          </p>
        ) : isOwnTerms ? (
          <div className="w-full space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="self-approve-terms">
            <p className="text-xs text-amber-900">
              You prepared or submitted these terms. As a super admin you may approve them yourself — give a reason; it is
              kept with the terms and in the audit log.
            </p>
            <Input label="Reason for approving your own terms" value={selfReason} onChange={(e) => setSelfReason(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={!selfReason.trim()} loading={busy === "approve"}
                onClick={() => run("approve", url, { action: "approve", terms_id: terms.id, self_reason: selfReason },
                  { success: "Terms approved and frozen. Your reason is recorded." })}>
                <ShieldCheck className="h-3.5 w-3.5" /> Approve my own terms
              </Button>
              <Button size="sm" variant="outline" onClick={() => setReturning((v) => !v)}>
                <Undo2 className="h-3.5 w-3.5" /> Return for changes
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button size="sm" loading={busy === "approve"}
              onClick={() => run("approve", url, { action: "approve", terms_id: terms.id }, { success: "Terms approved and frozen." })}>
              <ShieldCheck className="h-3.5 w-3.5" /> Approve terms
            </Button>
            <Button size="sm" variant="outline" onClick={() => setReturning((v) => !v)}>
              <Undo2 className="h-3.5 w-3.5" /> Return for changes
            </Button>
          </>
        )
      )}
      {returning && terms && (
        <div className="w-full space-y-2">
          <textarea className={textarea} placeholder="What needs to change? (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="destructive" disabled={!reason.trim()} loading={busy === "return"}
            onClick={async () => {
              if (await run("return", url, { action: "return", terms_id: terms.id, reason }, { success: "Terms returned to the preparer." })) {
                setReturning(false); setReason("");
              }
            }}>
            Return with this reason
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Run the database's activation checks, and activate. Approver roles
 * only; the database re-runs every check and refuses if any fails.
 */
export function ActivationPanel({
  cycleId,
  cycleStatus,
  canApprove,
}: {
  cycleId: string;
  cycleStatus: string;
  canApprove: boolean;
}) {
  const { run, busy } = useMaalriseAction();
  const [checks, setChecks] = useState<{ all_ok: boolean; checks: ActivationCheck[] } | null>(null);
  const url = `/api/admin/maalrise/cycles/${cycleId}/actions`;
  const warnings = (checks?.checks ?? []).filter((c) => !c.ok && c.blocking === false);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" loading={busy === "check"}
          onClick={() => run("check", url, { action: "check" }, { onDone: (d) => setChecks(d as never) })}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Run activation checks
        </Button>
        {canApprove && cycleStatus === "terms_approved" && (
          <>
            <Button size="sm" disabled={!checks?.all_ok} loading={busy === "activate"}
              title={checks?.all_ok ? undefined : "Run the activation checks; every required one must pass"}
              onClick={() => {
                const note = warnings.length
                  ? `\n\nStill outstanding (does not stop activation):\n${warnings.map((w) => `• ${w.detail}`).join("\n")}`
                  : "";
                if (window.confirm(`Activate this Cycle? Its terms, allocations and monthly schedule become live and its investors can see it.${note}`)) {
                  run("activate", url, { action: "activate" }, { success: "Cycle activated." });
                }
              }}>
              <Play className="h-3.5 w-3.5" /> Activate Cycle
            </Button>
            {!checks?.all_ok && <span className="text-xs text-muted">Activate becomes available when every required check passes. Amber items are warnings only.</span>}
          </>
        )}
      </div>
      {checks && (
        <ul className="grid gap-1.5 sm:grid-cols-2">
          {checks.checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2 text-sm">
              {c.ok ? <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0 text-emerald-600" />
                : c.blocking === false ? <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
                : <XCircle className="h-4 w-4 mt-0.5 shrink-0 text-red-500" />}
              <span className={c.ok ? "text-foreground" : c.blocking === false ? "text-amber-800" : "text-red-700"}>{koboInWords(c.detail)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Migration 060: a super admin puts a mistakenly activated Cycle back to
 * "terms approved" — before any money has moved on it — to correct the
 * terms or add missing funding, then activates it again.
 */
export function ReopenPanel({ cycleId }: { cycleId: string }) {
  const { run, busy } = useMaalriseAction();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/60 p-3 space-y-2" data-testid="reopen-panel">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-amber-900">
          Activated by mistake (wrong cost, missing funding)? A super admin can reopen it before any payment is recorded.
        </p>
        <Button size="xs" variant="outline" onClick={() => setOpen(!open)}><RotateCcw className="h-3 w-3" /> Reopen for correction</Button>
      </div>
      {open && (
        <div className="space-y-2">
          <p className="text-xs text-muted">
            The Cycle goes back to &quot;terms approved&quot; and is hidden from its investors until activated again. Nothing is deleted.
            Then: prepare a new terms version, approve it, record and confirm the missing funding, and activate again.
          </p>
          <textarea className={textarea} placeholder="Reason (required) — e.g. cost is ₦45m, not ₦40m; one investor's funding was missed"
            aria-label="Reason for reopening" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="sm" variant="destructive" disabled={!reason.trim()} loading={busy === "reopen"}
            onClick={async () => {
              if (!window.confirm("Reopen this Cycle? It stops being active and investors will not see it until you activate it again.")) return;
              if (await run("reopen", `/api/admin/maalrise/cycles/${cycleId}/actions`, { action: "reopen", reason },
                { success: "Cycle reopened. Prepare the new terms version, add the missing funding, then activate again." })) {
                setOpen(false); setReason("");
              }
            }}>
            Reopen this Cycle
          </Button>
        </div>
      )}
    </div>
  );
}

export type FundingView = {
  id: string;
  investorName: string;
  units: number;
  amountKobo: number;
  receivedOn: string;
  reference: string;
  status: "recorded" | "confirmed" | "rejected" | "refunded";
  /** Migration 061: when, which reference, who and why. */
  refund?: string | null;
  recordedBy: string;
  recordedByMe: boolean;
  decidedBy: string | null;
  rejectReason: string | null;
};

/** Record funding (finance) and confirm or reject it (a different finance person). */
export function FundingPanel({
  cycleId,
  investors,
  fundings,
  unitPriceKobo,
  canFinance,
  open,
  isSuperAdmin = false,
  canRefund = false,
}: {
  cycleId: string;
  investors: { id: string; label: string }[];
  fundings: FundingView[];
  unitPriceKobo: number;
  canFinance: boolean;
  open: boolean;
  /** A super admin may confirm funding they recorded, giving a reason (migration 056). */
  isSuperAdmin?: boolean;
  /** Super admin and administrator may record a refund of confirmed funding before activation (061). */
  canRefund?: boolean;
}) {
  const { run, busy } = useMaalriseAction();
  const [investorId, setInvestorId] = useState("");
  const [units, setUnits] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [reference, setReference] = useState("");
  const [rejecting, setRejecting] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [selfConfirming, setSelfConfirming] = useState<string | null>(null);
  const [selfReason, setSelfReason] = useState("");
  const [refunding, setRefunding] = useState<string | null>(null);
  const [refundOn, setRefundOn] = useState("");
  const [refundRef, setRefundRef] = useState("");
  const [refundWhy, setRefundWhy] = useState("");
  const n = /^\d+$/.test(units) ? Number(units) : 0;

  return (
    <div className="space-y-4">
      {canFinance && open && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-sm font-medium">Record capital received from an investor</p>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="funding-investor" className="block text-sm font-medium">MaalRise investor</label>
              <select id="funding-investor" value={investorId} onChange={(e) => setInvestorId(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm">
                <option value="">Select…</option>
                {investors.map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
              </select>
            </div>
            <Input label="Units" inputMode="numeric" value={units} onChange={(e) => setUnits(e.target.value.replace(/\D/g, ""))}
              hint={n ? `= ${formatKobo(n * unitPriceKobo)}` : `${formatKobo(unitPriceKobo)} per unit`} />
            <Input label="Date received" type="date" value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)} />
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[200px]">
              <Input label="Bank reference" value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <Button size="sm" disabled={!investorId || !n || !receivedOn || !reference.trim()} loading={busy === "record"}
              onClick={async () => {
                if (await run("record", `/api/admin/maalrise/cycles/${cycleId}/fundings`,
                  { investor_id: investorId, units: n, received_on: receivedOn, reference },
                  { success: "Funding recorded. A different finance person must confirm it." })) {
                  setInvestorId(""); setUnits(""); setReceivedOn(""); setReference("");
                }
              }}>
              Record funding
            </Button>
          </div>
        </div>
      )}

      {fundings.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-2 pr-3 font-medium">Investor</th>
                <th className="px-3 py-2 text-right font-medium">Units</th>
                <th className="px-3 py-2 text-right font-medium">Amount</th>
                <th className="px-3 py-2 font-medium">Received</th>
                <th className="px-3 py-2 font-medium">Reference</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="py-2 pl-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {fundings.map((f) => (
                <tr key={f.id} className="align-top">
                  <td className="py-2 pr-3">{f.investorName}</td>
                  <td className="px-3 py-2 text-right">{f.units}</td>
                  <td className="px-3 py-2 text-right">{formatKobo(f.amountKobo)}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{formatDate(f.receivedOn)}</td>
                  <td className="px-3 py-2 font-mono text-xs">{f.reference}</td>
                  <td className="px-3 py-2">
                    <Badge variant={f.status === "confirmed" ? "approved" : f.status === "rejected" || f.status === "refunded" ? "rejected" : "pending"} className="capitalize">
                      {f.status === "recorded" ? "Awaiting confirmation" : f.status}
                    </Badge>
                    <p className="text-[11px] text-muted mt-0.5">
                      Recorded by {f.recordedBy}{f.decidedBy ? ` · ${f.status === "refunded" ? "confirmed" : f.status} by ${f.decidedBy}` : ""}
                    </p>
                    {f.rejectReason && <p className="text-[11px] text-red-700">{f.rejectReason}</p>}
                    {f.refund && <p className="text-[11px] text-red-700">{f.refund}</p>}
                  </td>
                  <td className="py-2 pl-3 text-right whitespace-nowrap">
                    {canFinance && open && f.status === "recorded" && (
                      f.recordedByMe && !isSuperAdmin ? (
                        <span className="text-[11px] text-muted">Another finance person must confirm</span>
                      ) : f.recordedByMe ? (
                        <span className="inline-flex gap-1">
                          <Button size="xs" onClick={() => setSelfConfirming(selfConfirming === f.id ? null : f.id)}>Confirm (recorded by you)</Button>
                          <Button size="xs" variant="outline" onClick={() => setRejecting(f.id)}>Reject</Button>
                        </span>
                      ) : (
                        <span className="inline-flex gap-1">
                          <Button size="xs" loading={busy === `c-${f.id}`}
                            onClick={() => run(`c-${f.id}`, `/api/admin/maalrise/fundings/${f.id}`, { action: "confirm" }, { success: "Funding confirmed and allocated." })}>
                            Confirm
                          </Button>
                          <Button size="xs" variant="outline" onClick={() => setRejecting(f.id)}>Reject</Button>
                        </span>
                      )
                    )}
                    {canRefund && open && f.status === "confirmed" && refunding !== f.id && (
                      <Button size="xs" variant="outline" onClick={() => { setRefunding(f.id); setRefundOn(""); setRefundRef(""); setRefundWhy(""); }}>
                        Record refund
                      </Button>
                    )}
                    {refunding === f.id && (
                      <div className="mt-2 space-y-2 text-left rounded-md border border-red-200 bg-red-50/50 p-2" data-testid="refund-form">
                        <p className="text-[11px] text-muted">
                          The money has already been sent back. This entry is kept, marked Refunded, and its {f.units} unit(s) leave the Cycle.
                        </p>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input label="Date refunded" type="date" value={refundOn} onChange={(e) => setRefundOn(e.target.value)} />
                          <Input label="Refund bank reference" value={refundRef} onChange={(e) => setRefundRef(e.target.value)} />
                        </div>
                        <Input label="Reason for the refund" value={refundWhy} onChange={(e) => setRefundWhy(e.target.value)} />
                        <div className="flex gap-1 justify-end">
                          <Button size="xs" variant="destructive" disabled={!refundOn || !refundRef.trim() || !refundWhy.trim()} loading={busy === `rf-${f.id}`}
                            onClick={async () => {
                              if (!window.confirm(`Record that ${formatKobo(f.amountKobo)} was refunded to ${f.investorName}? Their ${f.units} unit(s) leave this Cycle.`)) return;
                              if (await run(`rf-${f.id}`, `/api/admin/maalrise/fundings/${f.id}`,
                                { action: "refund", refunded_on: refundOn, reference: refundRef, reason: refundWhy },
                                { success: "Refund recorded. Their units have left the Cycle." })) setRefunding(null);
                            }}>
                            Record refund
                          </Button>
                          <Button size="xs" variant="outline" onClick={() => setRefunding(null)}>Cancel</Button>
                        </div>
                      </div>
                    )}
                    {selfConfirming === f.id && (
                      <div className="mt-2 flex flex-wrap items-end justify-end gap-2 text-left">
                        <div className="min-w-56"><Input label="Reason for confirming your own entry" value={selfReason} onChange={(e) => setSelfReason(e.target.value)} /></div>
                        <Button size="xs" disabled={!selfReason.trim()} loading={busy === `c-${f.id}`}
                          onClick={async () => {
                            if (await run(`c-${f.id}`, `/api/admin/maalrise/fundings/${f.id}`, { action: "confirm", self_reason: selfReason },
                              { success: "Funding confirmed and allocated. Your reason is recorded." })) { setSelfConfirming(null); setSelfReason(""); }
                          }}>
                          Confirm with this reason
                        </Button>
                      </div>
                    )}
                    {rejecting === f.id && (
                      <div className="mt-2 flex gap-1">
                        <input className="h-7 rounded-md border border-border px-2 text-xs" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
                        <Button size="xs" variant="destructive" disabled={!reason.trim()}
                          onClick={async () => {
                            if (await run(`r-${f.id}`, `/api/admin/maalrise/fundings/${f.id}`, { action: "reject", reason }, { success: "Funding rejected." })) {
                              setRejecting(null); setReason("");
                            }
                          }}>Reject</Button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
