"use client";

/**
 * The payment queue, built for someone clearing it — not browsing it.
 *
 * WHAT WAS WRONG WITH THE OLD ONE. Every click wrote straight from the
 * browser, then refetched the entire list. On a 38-investor payout
 * that is 38 visible stalls. It also had no search at all, so finding
 * one investor meant reading down the page.
 *
 * WHAT CHANGED, AND WHY EACH THING:
 *
 *   * Optimistic. The row moves the moment it is clicked and reverts
 *     with the server's own message if it is refused. Nothing is
 *     refetched.
 *   * Search filters the loaded set in memory — instant, no round
 *     trip, and it matches name, code, request code and amount
 *     because people search by whichever they happen to have.
 *   * Selection with a running TOTAL. Paying 38 people is one bank
 *     batch; the total is what gets reconciled against it before
 *     anyone confirms.
 *   * Keyboard: / to search, j/k to move, x to select, a to approve,
 *     p to mark paid. A queue can be cleared without the mouse.
 *
 * WHAT IS DELIBERATELY NOT HERE. Any direct table write. Every action
 * goes through the SECURITY DEFINER functions in migration 038, which
 * are the entire surface area of the Payment Officer role — the page
 * cannot grant itself anything by being wrong.
 *
 * The Approve controls are hidden using the SAME predicate the
 * database refuses on (my_payment_permissions), so a button that is
 * visible is never a button that would fail.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  CheckCircle2,
  XCircle,
  CreditCard,
  Search,
  Loader2,
  Landmark,
  Copy,
  Lock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";

type QueueRow = {
  id: string;
  request_code: string;
  type: string;
  amount: number;
  status: string;
  bank_name: string;
  account_name: string;
  account_number: string;
  notes: string | null;
  rejection_reason: string | null;
  payment_ref: string | null;
  created_at: string;
  approved_at: string | null;
  paid_at: string | null;
  investor_name: string;
  investor_code: string;
  investment_code: string | null;
  series_name: string | null;
  cycle_label: string | null;
  approved_by_name: string | null;
  paid_by_name: string | null;
};

type Permissions = {
  canProcess: boolean;
  canAuthorise: boolean;
  isPaymentOfficer: boolean;
  officerCanApprove: boolean;
};

type Counts = Record<string, number>;

type Tab = "pending" | "approved" | "paid" | "rejected" | "all";

const PRIMARY_TABS: { label: string; value: Tab }[] = [
  { label: "Pending", value: "pending" },
  { label: "Approved", value: "approved" },
  { label: "Paid", value: "paid" },
];

const OTHER_TABS: { label: string; value: Tab }[] = [
  { label: "Rejected", value: "rejected" },
  { label: "All", value: "all" },
];

export default function PaymentRequestsAdminPage() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [counts, setCounts] = useState<Counts>({});
  const [perms, setPerms] = useState<Permissions | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("pending");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cursor, setCursor] = useState(0);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [rejecting, setRejecting] = useState<QueueRow | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [confirmBulk, setConfirmBulk] = useState<"approve" | "paid" | null>(null);
  const [reference, setReference] = useState("");

  const searchRef = useRef<HTMLInputElement>(null);
  const supabase = useMemo(() => createClient(), []);

  const loadCounts = useCallback(async () => {
    const { data } = await supabase.rpc("payment_request_counts");
    if (data && typeof data === "object") setCounts(data as Counts);
  }, [supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc("payment_request_queue", {
      p_status: tab === "all" ? null : tab,
      p_limit: 500,
    });
    if (error) toast.error(error.message);
    setRows((data as QueueRow[]) ?? []);
    setSelected(new Set());
    setCursor(0);
    setLoading(false);
    loadCounts();
  }, [supabase, tab, loadCounts]);

  useEffect(() => {
    supabase.rpc("my_payment_permissions").then(({ data }) => {
      if (data) setPerms(data as Permissions);
    });
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  // Matching on several fields at once, because whoever is looking has
  // whichever one they happen to have — a name from a phone call, a
  // code from a statement, or the amount from a bank app.
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    const digits = q.replace(/[^0-9.]/g, "");
    return rows.filter(
      (r) =>
        r.investor_name.toLowerCase().includes(q) ||
        r.investor_code.toLowerCase().includes(q) ||
        r.request_code.toLowerCase().includes(q) ||
        (r.investment_code ?? "").toLowerCase().includes(q) ||
        r.account_number.includes(q) ||
        r.bank_name.toLowerCase().includes(q) ||
        (digits.length > 0 && String(r.amount).startsWith(digits))
    );
  }, [rows, search]);

  const selectedRows = useMemo(
    () => visible.filter((r) => selected.has(r.id)),
    [visible, selected]
  );
  const selectedTotal = selectedRows.reduce((t, r) => t + Number(r.amount), 0);

  /** Optimistic: the row leaves now, and comes back if refused. */
  const runOne = useCallback(
    async (row: QueueRow, action: "approve" | "paid", reason?: string) => {
      setBusy((b) => new Set(b).add(row.id));
      const previous = rows;
      setRows((rs) => rs.filter((r) => r.id !== row.id || tab === "all"));

      const rpc =
        action === "approve"
          ? supabase.rpc("approve_payment_request", { p_id: row.id })
          : supabase.rpc("mark_payment_request_paid", {
              p_id: row.id,
              p_paid_on: null,
              p_reference: reference.trim() || null,
            });

      const { error } = await rpc;
      setBusy((b) => {
        const n = new Set(b);
        n.delete(row.id);
        return n;
      });

      if (error) {
        setRows(previous);
        toast.error(error.message);
        return false;
      }
      toast.success(
        `${row.request_code} — ${action === "approve" ? "approved" : "marked paid"}`
      );
      loadCounts();
      return true;
    },
    [rows, supabase, tab, reference, loadCounts]
  );

  const runBulk = useCallback(
    async (action: "approve" | "paid") => {
      const ids = selectedRows.map((r) => r.id);
      if (ids.length === 0) return;

      setConfirmBulk(null);
      const previous = rows;
      setRows((rs) => (tab === "all" ? rs : rs.filter((r) => !selected.has(r.id))));
      setSelected(new Set());

      const { data, error } = await supabase.rpc("process_payment_requests", {
        p_ids: ids,
        p_action: action,
        p_reason: null,
        p_paid_on: null,
        p_reference: reference.trim() || null,
      });

      if (error) {
        setRows(previous);
        toast.error(error.message);
        return;
      }

      const result = data as { succeeded: number; failed: number; results: { ok: boolean; error?: string }[] };
      if (result.failed > 0) {
        // Put the whole set back and reload: a partial result is
        // exactly when the screen must not be guessed at.
        const firstError = result.results.find((r) => !r.ok)?.error;
        toast.error(
          `${result.succeeded} processed, ${result.failed} refused${firstError ? ` — ${firstError}` : ""}`
        );
        load();
      } else {
        toast.success(`${result.succeeded} request(s) ${action === "approve" ? "approved" : "marked paid"}`);
        loadCounts();
      }
      setReference("");
    },
    [selectedRows, rows, selected, supabase, tab, reference, load, loadCounts]
  );

  const toggle = useCallback((id: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }, []);

  // ── Keyboard ──────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing =
        el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable;

      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && typing) {
        (el as HTMLInputElement).blur();
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

      const row = visible[cursor];
      if (e.key === "j") { e.preventDefault(); setCursor((c) => Math.min(c + 1, visible.length - 1)); }
      else if (e.key === "k") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
      else if (e.key === "x" && row) { e.preventDefault(); toggle(row.id); }
      else if (e.key === "a" && row && perms?.canAuthorise && row.status === "pending") {
        e.preventDefault();
        runOne(row, "approve");
      } else if (e.key === "p" && row && ["approved", "processing"].includes(row.status)) {
        e.preventDefault();
        runOne(row, "paid");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [visible, cursor, perms, runOne, toggle]);

  const canApproveHere = perms?.canAuthorise ?? false;
  const bulkAction: "approve" | "paid" | null =
    tab === "pending" && canApproveHere ? "approve"
    : tab === "approved" ? "paid"
    : null;

  if (perms && !perms.canProcess) {
    return (
      <Card>
        <CardContent className="p-10 text-center text-sm text-muted">
          You do not have access to payment requests.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in pb-24">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payment Requests</h1>
          <p className="text-sm text-muted mt-1">
            {perms?.isPaymentOfficer
              ? "Confirm payments as you send them."
              : "Approve, then confirm once the money has gone."}
          </p>
        </div>
        <div className="flex gap-4 text-right">
          <Figure label="Awaiting approval" value={counts.pending ?? 0} money={counts.pendingAmount} />
          <Figure label="Ready to pay" value={counts.approved ?? 0} money={counts.approvedAmount} gold />
        </div>
      </div>

      {/* An officer who cannot approve should be told so once, plainly,
          rather than wondering where the button went. */}
      {perms?.isPaymentOfficer && !perms.canAuthorise && (
        <div className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted">
          <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            Approving is switched off for your role. Work the{" "}
            <strong className="text-foreground">Approved</strong> tab — those have
            been authorised and are waiting on payment.
          </span>
        </div>
      )}

      {/* Tabs + search on one line: both are how you get to a row. */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border">
        {PRIMARY_TABS.map((t) => (
          <TabButton
            key={t.value}
            label={t.label}
            count={counts[t.value]}
            active={tab === t.value}
            onClick={() => setTab(t.value)}
          />
        ))}
        <div className="mx-1 h-4 w-px bg-border" />
        {OTHER_TABS.map((t) => (
          <TabButton
            key={t.value}
            label={t.label}
            count={t.value === "all" ? undefined : counts[t.value]}
            active={tab === t.value}
            onClick={() => setTab(t.value)}
            muted
          />
        ))}

        <div className="ml-auto relative py-1.5 w-full sm:w-72">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Name, code, account, amount…   /"
            className="w-full rounded-lg border border-border bg-white py-2 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
      </div>

      {loading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-16 rounded-lg bg-surface-2 animate-pulse" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CreditCard className="h-12 w-12 text-border mb-4" />
            <p className="font-semibold text-foreground">
              {search ? "Nothing matches that search" : `No ${tab === "all" ? "" : tab} requests`}
            </p>
            {search && (
              <button
                onClick={() => setSearch("")}
                className="mt-2 text-sm text-primary-600 hover:underline"
              >
                Clear search
              </button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1.5">
          {bulkAction && (
            <label className="flex items-center gap-2 px-3 py-1 text-xs text-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selected.size > 0 && selected.size === visible.length}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(visible.map((r) => r.id)) : new Set())
                }
                className="h-4 w-4 rounded border-border accent-primary-600"
              />
              Select all {visible.length}
              <span className="ml-auto hidden sm:inline text-[11px]">
                <Key>/</Key> search · <Key>j</Key><Key>k</Key> move · <Key>x</Key> select ·{" "}
                {canApproveHere && <><Key>a</Key> approve · </>}<Key>p</Key> paid
              </span>
            </label>
          )}

          {visible.map((row, i) => (
            <RequestRow
              key={row.id}
              row={row}
              focused={i === cursor}
              selected={selected.has(row.id)}
              busy={busy.has(row.id)}
              selectable={Boolean(bulkAction)}
              canApprove={canApproveHere}
              onFocus={() => setCursor(i)}
              onToggle={() => toggle(row.id)}
              onApprove={() => runOne(row, "approve")}
              onPaid={() => runOne(row, "paid")}
              onReject={() => setRejecting(row)}
            />
          ))}
        </div>
      )}

      {/* The batch bar. The TOTAL is the point: it is what gets checked
          against the bank before anyone confirms. */}
      {selected.size > 0 && bulkAction && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur px-4 py-3 shadow-lg">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-3">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-foreground">
                {selected.size} selected
              </p>
              <p className="text-xs text-muted">
                Total {formatCurrency(selectedTotal)}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
            <Button
              size="sm"
              className="ml-auto"
              onClick={() => setConfirmBulk(bulkAction)}
            >
              <CheckCircle2 className="h-4 w-4" />
              {bulkAction === "approve" ? "Approve selected" : "Mark selected as paid"}
            </Button>
          </div>
        </div>
      )}

      {/* Reject */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {rejecting?.request_code}</DialogTitle>
            <DialogDescription>
              {rejecting?.investor_name} is told the reason, so write it for them.
            </DialogDescription>
          </DialogHeader>
          <div className="p-6">
            <textarea
              rows={3}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="e.g. Account name does not match the investor's records"
              className="flex w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={!rejectReason.trim()}
              onClick={async () => {
                if (!rejecting) return;
                const { error } = await supabase.rpc("reject_payment_request", {
                  p_id: rejecting.id,
                  p_reason: rejectReason,
                });
                if (error) toast.error(error.message);
                else {
                  toast.success(`${rejecting.request_code} rejected`);
                  setRows((rs) => rs.filter((r) => r.id !== rejecting.id));
                  loadCounts();
                }
                setRejecting(null);
                setRejectReason("");
              }}
            >
              Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk confirm — with the total again, and one optional
          reference for the whole batch. */}
      <Dialog open={!!confirmBulk} onOpenChange={(o) => !o && setConfirmBulk(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirmBulk === "approve"
                ? `Approve ${selected.size} request(s)?`
                : `Mark ${selected.size} request(s) as paid?`}
            </DialogTitle>
            <DialogDescription>
              {formatCurrency(selectedTotal)} in total. Check this against your bank
              batch before confirming.
            </DialogDescription>
          </DialogHeader>
          {confirmBulk === "paid" && (
            <div className="px-6 pb-2">
              <label className="block text-sm font-medium text-foreground mb-1.5">
                Bank reference (optional)
              </label>
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder="e.g. GTB batch 27/07"
                className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
              <p className="mt-1 text-xs text-muted">
                Recorded on every request in this batch.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirmBulk(null)}>Cancel</Button>
            <Button onClick={() => confirmBulk && runBulk(confirmBulk)}>
              Confirm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── pieces ────────────────────────────────────────────────────

function Figure({
  label,
  value,
  money,
  gold,
}: {
  label: string;
  value: number;
  money?: number;
  gold?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className={`text-lg font-bold ${gold ? "text-gold-600" : "text-foreground"}`}>
        {value}
      </p>
      {money != null && money > 0 && (
        <p className="text-[11px] text-muted">{formatCurrency(money)}</p>
      )}
    </div>
  );
}

function TabButton({
  label,
  count,
  active,
  onClick,
  muted,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  muted?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-primary-600 text-primary-700"
          : `border-transparent hover:text-foreground ${muted ? "text-muted/70" : "text-muted"}`
      }`}
    >
      {label}
      {count != null && count > 0 && (
        <span className="rounded-full bg-surface-2 px-1.5 text-[11px] font-semibold text-muted">
          {count}
        </span>
      )}
    </button>
  );
}

function Key({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="mx-0.5 rounded border border-border bg-surface-2 px-1 font-mono text-[10px]">
      {children}
    </kbd>
  );
}

function RequestRow({
  row,
  focused,
  selected,
  busy,
  selectable,
  canApprove,
  onFocus,
  onToggle,
  onApprove,
  onPaid,
  onReject,
}: {
  row: QueueRow;
  focused: boolean;
  selected: boolean;
  busy: boolean;
  selectable: boolean;
  canApprove: boolean;
  onFocus: () => void;
  onToggle: () => void;
  onApprove: () => void;
  onPaid: () => void;
  onReject: () => void;
}) {
  const isProfit = row.type === "roi";

  return (
    <div
      onMouseEnter={onFocus}
      className={`rounded-lg border bg-surface px-3 py-2.5 transition-colors ${
        selected
          ? "border-primary-400 bg-primary-50/40"
          : focused
            ? "border-primary-200"
            : "border-border"
      }`}
    >
      <div className="flex items-start gap-3">
        {selectable && (
          <input
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            className="mt-1 h-4 w-4 shrink-0 rounded border-border accent-primary-600"
          />
        )}

        {/* Who and how much — the two things read first. */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-semibold text-foreground truncate">
              {row.investor_name}
            </span>
            <span className="font-mono text-[11px] text-muted">{row.investor_code}</span>
            <Badge variant={isProfit ? "success" : "default"} className="text-[10px]">
              {isProfit ? "Profit" : "Capital"}
            </Badge>
            {row.status !== "pending" && row.status !== "approved" && (
              <Badge
                variant={row.status as "paid" | "rejected" | "processing"}
                className="text-[10px]"
              >
                {row.status}
              </Badge>
            )}
          </div>

          {/* The account. Shown in full and copyable, because the whole
              job is typing it into a banking app correctly. */}
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted">
            <span className="inline-flex items-center gap-1 font-medium text-foreground">
              <Landmark className="h-3 w-3 text-muted" />
              {row.bank_name}
            </span>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(row.account_number);
                toast.success("Account number copied");
              }}
              className="inline-flex items-center gap-1 font-mono font-medium text-foreground hover:text-primary-600"
              title="Copy account number"
            >
              {row.account_number}
              <Copy className="h-3 w-3" />
            </button>
            <span className="truncate">{row.account_name}</span>
            <span className="font-mono text-[11px]">{row.request_code}</span>
            {row.cycle_label && <span className="hidden sm:inline">{row.cycle_label}</span>}
          </div>

          {row.status === "paid" && (
            <p className="mt-1 text-[11px] text-emerald-700">
              Paid {formatDate(row.paid_at!)}
              {row.paid_by_name ? ` by ${row.paid_by_name}` : ""}
              {row.approved_by_name ? ` · approved by ${row.approved_by_name}` : ""}
              {row.payment_ref ? ` · ${row.payment_ref}` : ""}
            </p>
          )}
          {row.status === "approved" && row.approved_by_name && (
            <p className="mt-1 text-[11px] text-muted">
              Approved by {row.approved_by_name}
              {row.approved_at ? ` on ${formatDate(row.approved_at)}` : ""}
            </p>
          )}
          {row.rejection_reason && (
            <p className="mt-1 text-[11px] text-danger">Rejected: {row.rejection_reason}</p>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          <p className="text-base font-bold text-foreground tabular-nums">
            {formatCurrency(row.amount)}
          </p>

          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted" />
          ) : (
            <div className="flex gap-1.5">
              {row.status === "pending" && canApprove && (
                <>
                  <Button
                    size="sm"
                    variant="subtle"
                    className="text-success bg-emerald-50 hover:bg-emerald-100 border border-emerald-200"
                    onClick={onApprove}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span className="hidden sm:inline">Approve</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="subtle"
                    className="text-danger bg-red-50 hover:bg-red-100 border border-red-200"
                    onClick={onReject}
                  >
                    <XCircle className="h-4 w-4" />
                  </Button>
                </>
              )}
              {["approved", "processing"].includes(row.status) && (
                <Button size="sm" onClick={onPaid}>
                  <CheckCircle2 className="h-4 w-4" />
                  <span className="hidden sm:inline">Mark as Paid</span>
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
