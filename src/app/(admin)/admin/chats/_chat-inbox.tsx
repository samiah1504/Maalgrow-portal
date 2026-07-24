"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  Download,
  MessageCircle,
  Users,
  Settings2,
  Loader2,
  Flag,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

export type InboxRow = {
  id: string;
  investor_id: string;
  investor_name: string;
  investor_code: string;
  investor_email: string;
  investor_phone: string;
  manager_name: string | null;
  assigned_manager_id: string | null;
  category: string;
  status: string;
  priority: string;
  admin_unread: number;
  last_message_at: string | null;
  created_at: string;
  first_admin_reply_at: string | null;
  resolved_at: string | null;
};

export type StaffOption = {
  id: string;
  name: string;
  role: string;
  assigned_investors: number;
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  awaiting_admin: "Awaiting Admin Response",
  awaiting_investor: "Awaiting Investor Response",
  resolved: "Resolved",
  archived: "Archived",
};

const STATUS_STYLE: Record<string, string> = {
  awaiting_admin: "bg-amber-50 text-amber-700",
  awaiting_investor: "bg-blue-50 text-blue-700",
  resolved: "bg-green-50 text-green-700",
  archived: "bg-gray-100 text-gray-500",
  open: "bg-primary-50 text-primary-700",
};

export function ChatInbox({
  rows,
  staff,
  investors,
  currentUserId,
  isSenior,
  supportNotice,
  quickReplies,
}: {
  rows: InboxRow[];
  staff: StaffOption[];
  investors: {
    id: string;
    full_name: string;
    investor_code: string;
    manager_name: string | null;
    assigned_manager_id: string | null;
  }[];
  currentUserId: string;
  isSenior: boolean;
  supportNotice: string;
  quickReplies: { id: string; title: string; message: string; active: boolean }[];
}) {
  const router = useRouter();
  const [tab, setTab] = useState<"inbox" | "managers" | "settings">("inbox");
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [flagFilter, setFlagFilter] = useState("");

  // Managers tab state
  const [selectedInvestors, setSelectedInvestors] = useState<Set<string>>(new Set());
  const [bulkManager, setBulkManager] = useState("");
  const [busy, setBusy] = useState(false);

  // Settings tab state
  const [notice, setNotice] = useState(supportNotice);
  const [newQrTitle, setNewQrTitle] = useState("");
  const [newQrMessage, setNewQrMessage] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && r.status !== statusFilter) return false;
      if (flagFilter === "unread" && r.admin_unread === 0) return false;
      if (flagFilter === "mine" && r.assigned_manager_id !== currentUserId) return false;
      if (flagFilter === "unassigned" && r.assigned_manager_id !== null) return false;
      if (flagFilter === "high" && r.priority !== "high") return false;
      if (!q) return true;
      return [r.investor_name, r.investor_code, r.investor_email, r.investor_phone, r.category]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [rows, query, statusFilter, flagFilter, currentUserId]);

  const stats = useMemo(
    () => ({
      total: rows.length,
      open: rows.filter((r) => r.status !== "resolved" && r.status !== "archived").length,
      unread: rows.reduce((s, r) => s + r.admin_unread, 0),
      resolved: rows.filter((r) => r.status === "resolved").length,
      awaiting: rows.filter((r) => r.status === "awaiting_admin").length,
    }),
    [rows]
  );

  const exportCsv = () => {
    const lines = [
      "Investor,Code,Category,Status,Priority,Manager,Unread,Last Message,Created,Resolved",
      ...filtered.map((r) =>
        [
          `"${r.investor_name}"`,
          r.investor_code,
          `"${r.category}"`,
          STATUS_LABEL[r.status] ?? r.status,
          r.priority,
          `"${r.manager_name ?? "Unassigned"}"`,
          r.admin_unread,
          r.last_message_at ? formatDate(r.last_message_at) : "",
          formatDate(r.created_at),
          r.resolved_at ? formatDate(r.resolved_at) : "",
        ].join(",")
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `maalgrow-chats-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    fetch("/api/admin/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "log_export", count: filtered.length }),
    }).catch(() => {});
  };

  const runBulkAssign = async () => {
    if (selectedInvestors.size === 0) {
      toast.error("Select at least one investor");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_assign_manager",
          investor_ids: Array.from(selectedInvestors),
          manager_id: bulkManager || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Assignment failed");
      toast.success(`${json.result.updated} investor(s) updated`);
      setSelectedInvestors(new Set());
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Assignment failed");
    } finally {
      setBusy(false);
    }
  };

  const saveSettings = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "update_settings", support_notice: notice }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Support notice updated");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const saveQuickReply = async () => {
    if (!newQrTitle.trim() || !newQrMessage.trim()) {
      toast.error("Enter a title and message");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "save_quick_reply",
          quick_reply: { title: newQrTitle.trim(), message: newQrMessage.trim() },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error);
      toast.success("Quick reply saved");
      setNewQrTitle("");
      setNewQrMessage("");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  const toggleQuickReply = async (id: string, active: boolean) => {
    await fetch("/api/admin/chats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save_quick_reply", quick_reply: { id, active } }),
    });
    router.refresh();
  };

  const inputCls =
    "h-9 rounded-lg border border-border bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

  return (
    <div className="space-y-4">
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          ["Total", stats.total],
          ["Open", stats.open],
          ["Awaiting Admin", stats.awaiting],
          ["Unread", stats.unread],
          ["Resolved", stats.resolved],
        ].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-border bg-white p-3 text-center">
            <p className="text-[10px] uppercase tracking-wide text-muted">{k}</p>
            <p className="text-xl font-bold text-foreground">{v}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border">
        {(
          [
            ["inbox", "Inbox", MessageCircle],
            ...(isSenior
              ? ([
                  ["managers", "Manager Assignment", Users],
                  ["settings", "Settings & Quick Replies", Settings2],
                ] as const)
              : []),
          ] as [string, string, typeof MessageCircle][]
        ).map(([key, label, Icon]) => (
          <button
            key={key}
            onClick={() => setTab(key as typeof tab)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? "border-primary-600 text-primary-700"
                : "border-transparent text-muted hover:text-foreground"
            }`}
          >
            <Icon className="h-4 w-4" /> {label}
          </button>
        ))}
      </div>

      {tab === "inbox" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search name, code, email, phone…"
                className={`${inputCls} w-64 pl-9`}
              />
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={inputCls}>
              <option value="">All statuses</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
            <select value={flagFilter} onChange={(e) => setFlagFilter(e.target.value)} className={inputCls}>
              <option value="">All conversations</option>
              <option value="unread">Unread</option>
              <option value="mine">Assigned to me</option>
              <option value="unassigned">Unassigned</option>
              <option value="high">High priority</option>
            </select>
            <Button variant="outline" size="sm" onClick={exportCsv} className="ml-auto">
              <Download className="h-4 w-4" /> Export CSV
            </Button>
          </div>

          <div className="rounded-xl border border-border bg-white divide-y divide-border overflow-hidden">
            {filtered.length === 0 ? (
              <p className="px-4 py-10 text-center text-sm text-muted">
                No conversations match the current filters.
              </p>
            ) : (
              filtered.map((r) => (
                <Link
                  key={r.id}
                  href={`/admin/chats/${r.id}`}
                  className="flex items-center gap-3 px-4 py-3 hover:bg-surface-2/60 transition-colors"
                >
                  <div className="relative shrink-0">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold">
                      {r.investor_name.charAt(0).toUpperCase()}
                    </div>
                    {r.admin_unread > 0 && (
                      <span className="absolute -top-1 -right-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-primary-900">
                        {r.admin_unread > 9 ? "9+" : r.admin_unread}
                      </span>
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">{r.investor_name}</span>
                      <span className="font-mono text-xs text-muted">{r.investor_code}</span>
                      {r.priority === "high" && (
                        <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600">
                          <Flag className="h-3 w-3" /> HIGH
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted truncate">
                      {r.category} · {r.manager_name ? `Manager: ${r.manager_name}` : "Unassigned — general queue"}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_STYLE[r.status] ?? "bg-gray-100 text-gray-600"}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                    <p className="text-[11px] text-muted mt-1">
                      {r.last_message_at ? formatDate(r.last_message_at) : "—"}
                    </p>
                  </div>
                </Link>
              ))
            )}
          </div>
        </>
      )}

      {tab === "managers" && isSenior && (
        <div className="space-y-4">
          {/* Manager workloads */}
          <div className="grid sm:grid-cols-3 gap-3">
            {staff.map((s) => (
              <div key={s.id} className="rounded-xl border border-border bg-white p-3">
                <p className="text-sm font-semibold text-foreground">{s.name}</p>
                <p className="text-xs text-muted capitalize">{s.role.replace("_", " ")}</p>
                <p className="text-xs text-primary-700 mt-1 font-medium">
                  {s.assigned_investors} investor{s.assigned_investors === 1 ? "" : "s"} assigned
                </p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-muted">
              {selectedInvestors.size} investor{selectedInvestors.size === 1 ? "" : "s"} selected
            </span>
            <select value={bulkManager} onChange={(e) => setBulkManager(e.target.value)} className={inputCls}>
              <option value="">— Unassign (general support) —</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <Button size="sm" onClick={runBulkAssign} disabled={busy || selectedInvestors.size === 0}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Assign Manager
            </Button>
            {selectedInvestors.size > 0 && (
              <button onClick={() => setSelectedInvestors(new Set())} className="text-xs text-muted hover:underline">
                Clear
              </button>
            )}
          </div>

          <div className="rounded-xl border border-border bg-white divide-y divide-border max-h-[28rem] overflow-y-auto">
            {investors.map((i) => (
              <label key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm cursor-pointer hover:bg-surface-2/60">
                <input
                  type="checkbox"
                  checked={selectedInvestors.has(i.id)}
                  onChange={() =>
                    setSelectedInvestors((prev) => {
                      const next = new Set(prev);
                      if (next.has(i.id)) next.delete(i.id);
                      else next.add(i.id);
                      return next;
                    })
                  }
                />
                <span className="font-medium">{i.full_name}</span>
                <span className="font-mono text-xs text-muted">{i.investor_code}</span>
                <span className="ml-auto text-xs text-muted">
                  {i.manager_name ?? "General support"}
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {tab === "settings" && isSenior && (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold">Working hours & response notice</h3>
            <p className="text-xs text-muted">
              Shown to investors at the top of their chat.
            </p>
            <textarea
              value={notice}
              onChange={(e) => setNotice(e.target.value)}
              rows={4}
              className="w-full rounded-lg border border-border px-3 py-2 text-sm resize-none focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
            <Button size="sm" onClick={saveSettings} disabled={busy}>Save Notice</Button>
          </div>

          <div className="rounded-xl border border-border bg-white p-4 space-y-3">
            <h3 className="text-sm font-semibold">Quick replies</h3>
            <div className="max-h-48 overflow-y-auto divide-y divide-border">
              {quickReplies.map((q) => (
                <div key={q.id} className="py-2 flex items-start justify-between gap-2">
                  <div className={q.active ? "" : "opacity-50"}>
                    <p className="text-xs font-semibold">{q.title}</p>
                    <p className="text-xs text-muted line-clamp-2">{q.message}</p>
                  </div>
                  <button
                    onClick={() => toggleQuickReply(q.id, !q.active)}
                    className="text-xs text-primary-600 hover:underline shrink-0"
                  >
                    {q.active ? "Disable" : "Enable"}
                  </button>
                </div>
              ))}
            </div>
            <div className="space-y-2 border-t border-border pt-3">
              <input
                value={newQrTitle}
                onChange={(e) => setNewQrTitle(e.target.value)}
                placeholder="New quick reply title"
                className={`${inputCls} w-full`}
              />
              <textarea
                value={newQrMessage}
                onChange={(e) => setNewQrMessage(e.target.value)}
                rows={2}
                placeholder="Message text"
                className="w-full rounded-lg border border-border px-3 py-2 text-sm resize-none focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
              <Button size="sm" variant="outline" onClick={saveQuickReply} disabled={busy}>
                Add Quick Reply
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
