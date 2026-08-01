"use client";

/**
 * The investors nobody is chasing.
 *
 * Every other tab on this page starts from a payment_requests row. An
 * investor who HAS one is visible; an investor who has none is not,
 * and that is exactly the person at risk — their profit is settled
 * and sitting there and no screen says so.
 *
 * WHY THE REASON IS THE FIRST THING SHOWN. "No payment request" is
 * three different problems wearing one label, and they need three
 * different responses:
 *
 *   no_instruction    they have not answered. Chase the answer; the
 *                     request follows on its own. Time-limited —
 *                     once the window shuts they cannot answer at all
 *                     and the only way through is recording it here.
 *   no_bank_details   they DID answer and the request was silently
 *                     not raised. These people look answered and are
 *                     owed money nobody was tracking. The worst kind.
 *   nothing_payable   a legacy rollover_all. Nothing owed; listed so
 *                     it is not mistaken for a fault.
 *
 * WHAT THE BUTTON DOES. It records the INSTRUCTION, through the same
 * database function the investor's own form calls, which then raises
 * the payment request itself from the settlement's frozen figures.
 * There is deliberately no way here to create a payment request
 * directly — a second source of amounts is a second thing that can
 * disagree with the settlement.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Clock,
  Loader2,
  Mail,
  Search,
  UserCheck,
} from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";

type GapRow = {
  investment_id: string;
  investment_code: string;
  investor_id: string;
  investor_code: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  cycle_id: string;
  cycle_label: string;
  series_name: string;
  units: number;
  capital: number;
  profit_available: number;
  capital_available: number;
  decision: string | null;
  reason: string;
  available_since: string | null;
  days_waiting: number;
  deadline: string | null;
  has_bank_details: boolean;
  manager_name: string | null;
  last_login_at: string | null;
  last_reminder_at: string | null;
  reminders_sent: number;
};

type Counts = {
  awaiting?: number;
  noInstruction?: number;
  noBankDetails?: number;
  notRaised?: number;
  nothingPayable?: number;
  over7?: number;
  over30?: number;
  amount?: number;
  windowOpen?: number;
};

const naira = (kobo: number) =>
  `₦${Math.round((Number(kobo) || 0) / 100).toLocaleString("en-NG")}`;

const REASON_LABEL: Record<string, string> = {
  no_instruction: "No instruction yet",
  no_bank_details: "No bank details",
  not_raised: "Not raised",
  nothing_payable: "Nothing payable",
};

const REASON_VARIANT: Record<string, "warning" | "danger" | "pending"> = {
  no_instruction: "warning",
  no_bank_details: "danger",
  not_raised: "warning",
  nothing_payable: "pending",
};

const REASON_HELP: Record<string, string> = {
  no_instruction:
    "They have not chosen what happens to their capital. The payment request is raised automatically the moment they do.",
  no_bank_details:
    "They answered, but there is no bank account on their record — so nothing was raised. Nobody was told.",
  not_raised:
    "Answered, bank details on file, and still nothing raised. Worth looking at directly.",
  nothing_payable:
    "A legacy rollover_all: profit and capital both continue, so nothing is paid out.",
};

const DECISIONS = [
  { value: "continue", label: "Profit paid · capital continues into the next cycle" },
  { value: "exit", label: "Profit and all capital paid out" },
  { value: "partial_exit", label: "Profit paid · part of the capital withdrawn" },
] as const;

export function AwaitingPaymentRequest({ canRecord }: { canRecord: boolean }) {
  const supabase = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<GapRow[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [reasonFilter, setReasonFilter] = useState<string>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [confirmRemind, setConfirmRemind] = useState<GapRow[] | null>(null);
  const [recording, setRecording] = useState<GapRow | null>(null);

  const load = useCallback(async () => {
    const [list, card] = await Promise.all([
      supabase.rpc("investors_awaiting_payment_request", { p_cycle_id: null }),
      supabase.rpc("payment_request_gap_counts", { p_cycle_id: null }),
    ]);
    setRows((list.data as unknown as GapRow[]) ?? []);
    setCounts((card.data as unknown as Counts) ?? {});
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (reasonFilter !== "all" && r.reason !== reasonFilter) return false;
      if (!q) return true;
      return (
        r.full_name.toLowerCase().includes(q) ||
        r.investor_code.toLowerCase().includes(q) ||
        (r.email ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, search, reasonFilter]);

  // Never offered for somebody who is owed nothing.
  const remindable = useMemo(
    () => visible.filter((r) => r.reason !== "nothing_payable"),
    [visible]
  );
  const chosen = useMemo(
    () => remindable.filter((r) => selected.has(r.investment_id)),
    [remindable, selected]
  );

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/admin/payment-gap", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text.slice(0, 300) || `Request failed (${res.status})` };
    }
    return { ok: res.ok, json };
  };

  const remind = async (targets: GapRow[]) => {
    setBusy(true);
    setConfirmRemind(null);
    try {
      const { ok, json } = await post({
        action: "remind",
        investmentIds: targets.map((t) => t.investment_id),
      });
      if (!ok) {
        toast.error(String(json.error ?? "Could not send the reminders"));
        return;
      }
      // Every outcome, not just the happy one. "12 sent" when four
      // had no address is how four people are quietly never chased.
      const bits = [`${json.sent} sent`];
      if (json.failed) bits.push(`${json.failed} failed`);
      if (json.skipped) bits.push(`${json.skipped} with no address`);
      (json.failed || json.skipped ? toast.warning : toast.success)(bits.join(" · "));
      setSelected(new Set());
      await load();
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-sm text-muted">
        <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
        Checking who is waiting…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* The card. Split by REASON, because one number would hide the
          fact that half of these need a phone call and half need a
          form filled in. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Awaiting a request"
          value={String(counts.awaiting ?? 0)}
          sub={counts.amount ? `${naira(counts.amount)} owed` : undefined}
          tone={counts.awaiting ? "warning" : "plain"}
        />
        <Stat
          label="No instruction yet"
          value={String(counts.noInstruction ?? 0)}
          sub={
            counts.windowOpen != null
              ? `${counts.windowOpen} can still answer themselves`
              : undefined
          }
          tone={counts.noInstruction ? "warning" : "plain"}
        />
        <Stat
          label="No bank details"
          value={String(counts.noBankDetails ?? 0)}
          sub="Answered — nothing raised"
          tone={counts.noBankDetails ? "danger" : "plain"}
        />
        <Stat
          label="Waiting over 7 days"
          value={String(counts.over7 ?? 0)}
          sub={counts.over30 ? `${counts.over30} over 30 days` : undefined}
          tone={counts.over30 ? "danger" : counts.over7 ? "warning" : "plain"}
        />
      </div>

      {/* Filters, and what to do with a selection */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, code or email"
            className="h-9 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm outline-none focus:border-primary-500"
          />
        </div>
        <select
          value={reasonFilter}
          onChange={(e) => setReasonFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-white px-3 text-sm"
        >
          <option value="all">Every reason</option>
          <option value="no_instruction">No instruction yet</option>
          <option value="no_bank_details">No bank details</option>
          <option value="not_raised">Not raised</option>
          <option value="nothing_payable">Nothing payable</option>
        </select>

        <label className="flex items-center gap-1.5 text-xs text-muted">
          <input
            type="checkbox"
            checked={chosen.length > 0 && chosen.length === remindable.length}
            onChange={(e) =>
              setSelected(
                e.target.checked
                  ? new Set(remindable.map((r) => r.investment_id))
                  : new Set()
              )
            }
          />
          Select all ({remindable.length})
        </label>

        {chosen.length > 0 && (
          <Button
            size="sm"
            loading={busy}
            onClick={() => setConfirmRemind(chosen)}
            className="ml-auto"
          >
            <Mail className="h-4 w-4" />
            Email {chosen.length} reminder{chosen.length === 1 ? "" : "s"}
          </Button>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-6 text-center text-sm text-emerald-900">
          <CheckCircle2 className="mx-auto mb-2 h-6 w-6 text-emerald-600" />
          Everyone whose profit has settled has a payment request.
        </div>
      ) : (
        <div className="divide-y divide-border rounded-xl border border-border bg-white">
          {visible.map((r) => (
            <Row
              key={r.investment_id}
              row={r}
              selected={selected.has(r.investment_id)}
              onToggle={() =>
                setSelected((s) => {
                  const next = new Set(s);
                  if (next.has(r.investment_id)) next.delete(r.investment_id);
                  else next.add(r.investment_id);
                  return next;
                })
              }
              onRemind={() => setConfirmRemind([r])}
              onRecord={() => setRecording(r)}
              canRecord={canRecord}
              busy={busy}
            />
          ))}
        </div>
      )}

      <RemindDialog
        targets={confirmRemind}
        onCancel={() => setConfirmRemind(null)}
        onSend={remind}
      />
      <RecordDialog
        key={recording?.investment_id ?? "none"}
        row={recording}
        onClose={() => setRecording(null)}
        onDone={async () => {
          setRecording(null);
          await load();
        }}
        post={post}
      />
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone: "plain" | "warning" | "danger";
}) {
  const ring =
    tone === "danger"
      ? "border-danger/40 bg-danger/5"
      : tone === "warning"
      ? "border-amber-300 bg-amber-50/60"
      : "border-border bg-white";
  return (
    <div className={`rounded-xl border p-4 ${ring}`}>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Row({
  row: r,
  selected,
  onToggle,
  onRemind,
  onRecord,
  canRecord,
  busy,
}: {
  row: GapRow;
  selected: boolean;
  onToggle: () => void;
  onRemind: () => void;
  onRecord: () => void;
  canRecord: boolean;
  busy: boolean;
}) {
  const payable = r.reason !== "nothing_payable";
  const windowShut = r.deadline ? new Date(r.deadline) < new Date() : false;

  return (
    <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start">
      <div className="flex items-start gap-3 lg:w-72 lg:shrink-0">
        {payable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="mt-1"
            aria-label={`Select ${r.full_name}`}
          />
        )}
        <div className="min-w-0">
          <p className="truncate font-medium text-foreground">{r.full_name}</p>
          <p className="font-mono text-[11px] text-muted">
            {r.investor_code} · {r.investment_code}
          </p>
          <p className="truncate text-xs text-muted">
            {r.email || "No email address"}
          </p>
          {r.phone && <p className="text-xs text-muted">{r.phone}</p>}
        </div>
      </div>

      <div className="flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={REASON_VARIANT[r.reason] ?? "pending"}>
            {REASON_LABEL[r.reason] ?? r.reason}
          </Badge>
          <span className="text-xs text-muted">
            Series {r.series_name} · {r.cycle_label}
          </span>
          {/* Days waiting, not a date. "41 days" is a number somebody
              acts on; "settled 17 June" is one they have to work out. */}
          <span
            className={`inline-flex items-center gap-1 text-xs ${
              r.days_waiting > 30
                ? "font-semibold text-danger"
                : r.days_waiting > 7
                ? "text-amber-700"
                : "text-muted"
            }`}
          >
            <Clock className="h-3 w-3" />
            {r.days_waiting} day{r.days_waiting === 1 ? "" : "s"} waiting
          </span>
        </div>

        <p className="text-xs text-muted">{REASON_HELP[r.reason]}</p>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="text-foreground">
            Profit <strong className="tabular-nums">{naira(r.profit_available)}</strong>
          </span>
          {r.capital_available > 0 && (
            <span className="text-foreground">
              Capital{" "}
              <strong className="tabular-nums">{naira(r.capital_available)}</strong>
            </span>
          )}
          <span className="text-muted">{r.units} slots</span>
          {r.manager_name && (
            <span className="text-muted">Manager: {r.manager_name}</span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted">
          <span>
            {r.last_login_at
              ? `Last signed in ${formatDate(r.last_login_at)}`
              : "Has never signed in"}
          </span>
          <span>
            {r.reminders_sent > 0
              ? `${r.reminders_sent} reminder${r.reminders_sent === 1 ? "" : "s"} · last ${formatDate(r.last_reminder_at!)}`
              : "Never reminded"}
          </span>
          {r.reason === "no_instruction" && r.deadline && (
            <span className={windowShut ? "font-medium text-danger" : ""}>
              {windowShut
                ? `Window closed ${formatDate(r.deadline)} — they can no longer answer`
                : `Can answer until ${formatDate(r.deadline)}`}
            </span>
          )}
        </div>
      </div>

      <div className="flex shrink-0 flex-wrap gap-2">
        <Link href={`/admin/investors/${r.investor_id}`}>
          <Button size="sm" variant="ghost">
            Profile
          </Button>
        </Link>
        {payable && (
          <Button size="sm" variant="outline" disabled={busy} onClick={onRemind}>
            <Mail className="h-4 w-4" />
            Remind
          </Button>
        )}
        {/* Only where an instruction is what is missing. Recording one
            for somebody who has already given theirs would overwrite
            a decision they made, which is not a correction. */}
        {payable && canRecord && r.reason === "no_instruction" && (
          <Button size="sm" disabled={busy} onClick={onRecord}>
            <UserCheck className="h-4 w-4" />
            Record instruction
          </Button>
        )}
      </div>
    </div>
  );
}

function RemindDialog({
  targets,
  onCancel,
  onSend,
}: {
  targets: GapRow[] | null;
  onCancel: () => void;
  onSend: (t: GapRow[]) => void;
}) {
  const noAddress = (targets ?? []).filter((t) => !(t.email ?? "").trim());
  return (
    <Dialog open={!!targets} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            Email {targets?.length ?? 0} reminder{targets?.length === 1 ? "" : "s"}?
          </DialogTitle>
          <DialogDescription>
            Each investor is told what their profit is and what is needed to
            release it — an answer about their capital, or their bank details.
          </DialogDescription>
        </DialogHeader>
        <div className="px-6 pb-2 text-xs text-muted">
          <p>
            The email does <strong>not</strong> ask them to submit a payment
            request. There is no such button in the portal, and asking would send
            them looking for one.
          </p>
          {noAddress.length > 0 && (
            <p className="mt-2 text-amber-700">
              {noAddress.length} of these have no email address and will be
              skipped: {noAddress.map((t) => t.full_name).join(", ")}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => targets && onSend(targets)}>
            <Mail className="h-4 w-4" />
            Send now
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordDialog({
  row,
  onClose,
  onDone,
  post,
}: {
  row: GapRow | null;
  onClose: () => void;
  onDone: () => void;
  post: (b: Record<string, unknown>) => Promise<{ ok: boolean; json: Record<string, unknown> }>;
}) {
  // Fresh state per investor comes from the `key` on this component,
  // not from clearing fields in an effect — a dialog that reset itself
  // afterwards could show one investor's half-typed comment against
  // another's name for a frame.
  const [decision, setDecision] = useState<string>("");
  const [slots, setSlots] = useState("");
  const [reason, setReason] = useState("");
  const [comment, setComment] = useState("");
  const [reasons, setReasons] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/payment-gap")
      .then((r) => r.json())
      .then((j) => {
        if (live) setReasons(j.reasons ?? []);
      })
      .catch(() => {
        if (live) setReasons([]);
      });
    return () => {
      live = false;
    };
  }, []);

  if (!row) return null;

  const needsComment = reason === "Other";
  const ready =
    decision !== "" &&
    reason !== "" &&
    (!needsComment || comment.trim().length >= 5) &&
    (decision !== "partial_exit" || Number(slots) > 0);

  const submit = async () => {
    setBusy(true);
    try {
      const { ok, json } = await post({
        action: "record-instruction",
        investmentId: row.investment_id,
        decision,
        slotsToWithdraw: decision === "partial_exit" ? Number(slots) : null,
        reason,
        comment,
      });
      if (!ok) {
        toast.error(String(json.error ?? "Could not record the instruction"));
        return;
      }
      toast.success(
        `Recorded for ${row.full_name} — the payment request has been raised`
      );
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record {row.full_name}&rsquo;s instruction</DialogTitle>
          <DialogDescription>
            For an investor who told you by phone, WhatsApp or email, or who
            cannot sign in. This is recorded against your name.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 px-6 pb-2">
          <div className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <span className="text-muted">Investor</span>
              <span className="text-right font-medium">{row.investor_code}</span>
              <span className="text-muted">Slots held</span>
              <span className="text-right tabular-nums">{row.units}</span>
              <span className="text-muted">Capital</span>
              <span className="text-right tabular-nums">{naira(row.capital)}</span>
              <span className="text-muted">Profit waiting</span>
              <span className="text-right font-semibold tabular-nums">
                {naira(row.profit_available)}
              </span>
            </div>
          </div>

          {!row.has_bank_details && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              There are no bank details on this investor&rsquo;s record. The
              instruction will be saved, but no payment request can be raised
              until an account is added.
            </p>
          )}

          <div className="space-y-1.5">
            <label className="text-sm font-medium">What did they ask for?</label>
            {DECISIONS.map((d) => (
              <label
                key={d.value}
                className="flex items-start gap-2 rounded-lg border border-border p-2.5 text-sm"
              >
                <input
                  type="radio"
                  name="decision"
                  className="mt-0.5"
                  checked={decision === d.value}
                  onChange={() => setDecision(d.value)}
                />
                <span>{d.label}</span>
              </label>
            ))}
          </div>

          {decision === "partial_exit" && (
            <input
              value={slots}
              onChange={(e) => setSlots(e.target.value)}
              placeholder={`Slots to withdraw (of ${row.units})`}
              inputMode="decimal"
              className="h-9 w-full rounded-lg border border-border px-3 text-sm"
            />
          )}

          {/* MANDATORY. In a year somebody has to be able to see why a
              member of staff answered on an investor's behalf. */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Why are you recording this for them?
              <span className="ml-0.5 text-danger">*</span>
            </label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-9 w-full rounded-lg border border-border bg-white px-3 text-sm"
            >
              <option value="">Choose a reason…</option>
              {reasons.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              placeholder={
                needsComment
                  ? "Required — describe what happened"
                  : "Anything else worth recording (optional)"
              }
              className="w-full rounded-lg border border-border px-3 py-2 text-sm"
            />
          </div>

          <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
            <Ban className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            An instruction is final once recorded — for them as much as for you.
            Be sure this is what they asked for.
          </p>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} loading={busy} onClick={submit}>
            <UserCheck className="h-4 w-4" />
            Record instruction
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
