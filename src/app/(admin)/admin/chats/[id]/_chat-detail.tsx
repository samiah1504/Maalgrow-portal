"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Flag, CheckCircle2, RotateCcw, Archive, Zap } from "lucide-react";
import { ChatThread, type ChatMessage } from "@/components/chat/chat-thread";
import { formatDate } from "@/lib/utils";

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  awaiting_admin: "Awaiting Admin Response",
  awaiting_investor: "Awaiting Investor Response",
  resolved: "Resolved",
  archived: "Archived",
};

export function ChatDetail({
  conversation,
  investor,
  relatedLabel,
  messages,
  staff,
  quickReplies,
  isSenior,
}: {
  conversation: {
    id: string;
    category: string;
    status: string;
    priority: string;
    assigned_manager_id: string | null;
    created_at: string;
  };
  investor: {
    id: string;
    full_name: string;
    investor_code: string;
    email: string;
    phone: string | null;
  };
  relatedLabel: string | null;
  messages: ChatMessage[];
  staff: { id: string; name: string; role: string }[];
  quickReplies: { id: string; title: string; message: string }[];
  isSenior: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [prefill, setPrefill] = useState<string | undefined>(undefined);

  const act = async (
    action: string,
    extra: Record<string, unknown> = {},
    successMsg?: string
  ) => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/chats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, conversation_id: conversation.id, ...extra }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Action failed");
      if (successMsg) toast.success(successMsg);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  const selectCls =
    "h-8 rounded-lg border border-border bg-white px-2 text-xs focus:border-primary-500 focus:outline-none";

  return (
    <div className="flex flex-col h-[calc(100vh-11rem)] rounded-xl border border-border bg-white overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/admin/investors/${investor.id}`}
            className="text-base font-bold text-primary-700 hover:underline"
          >
            {investor.full_name}
          </Link>
          <span className="font-mono text-xs text-muted">{investor.investor_code}</span>
          <span className="text-xs text-muted">· {investor.email}</span>
          {investor.phone && <span className="text-xs text-muted">· {investor.phone}</span>}
          {conversation.priority === "high" && (
            <span className="flex items-center gap-0.5 text-[10px] font-bold text-red-600">
              <Flag className="h-3 w-3" /> HIGH PRIORITY
            </span>
          )}
        </div>
        <p className="text-xs text-muted">
          {conversation.category}
          {relatedLabel ? ` · Related to: ${relatedLabel}` : ""} · Started{" "}
          {formatDate(conversation.created_at)} ·{" "}
          <span className="font-medium">{STATUS_LABEL[conversation.status]}</span>
        </p>

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={conversation.assigned_manager_id ?? ""}
            disabled={busy}
            onChange={(e) =>
              act("assign", { manager_id: e.target.value || null }, "Conversation reassigned")
            }
            className={selectCls}
            title="Assign / transfer this conversation"
          >
            <option value="">Unassigned (general queue)</option>
            {staff.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.role.replace("_", " ")})
              </option>
            ))}
          </select>
          <button
            disabled={busy}
            onClick={() =>
              act(
                conversation.priority === "high" ? "priority_normal" : "priority_high",
                {},
                "Priority updated"
              )
            }
            className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs hover:border-red-300 hover:text-red-600 transition-colors"
          >
            <Flag className="h-3 w-3" />
            {conversation.priority === "high" ? "Set Normal Priority" : "Mark High Priority"}
          </button>
          {conversation.status !== "resolved" && conversation.status !== "archived" && (
            <button
              disabled={busy}
              onClick={() => act("resolve", {}, "Marked as resolved")}
              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs hover:border-green-300 hover:text-green-700 transition-colors"
            >
              <CheckCircle2 className="h-3 w-3" /> Mark Resolved
            </button>
          )}
          {conversation.status === "resolved" && (
            <button
              disabled={busy}
              onClick={() => act("reopen", {}, "Conversation reopened")}
              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs hover:border-primary-300 transition-colors"
            >
              <RotateCcw className="h-3 w-3" /> Reopen
            </button>
          )}
          {isSenior && conversation.status !== "archived" && (
            <button
              disabled={busy}
              onClick={() => act("archive", {}, "Conversation archived")}
              className="flex items-center gap-1 rounded-lg border border-border px-2 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
            >
              <Archive className="h-3 w-3" /> Archive
            </button>
          )}
          {quickReplies.length > 0 && (
            <select
              value=""
              onChange={(e) => {
                const qr = quickReplies.find((q) => q.id === e.target.value);
                if (qr) setPrefill(qr.message);
              }}
              className={`${selectCls} ml-auto`}
              title="Insert a quick reply (editable before sending)"
            >
              <option value="">
                ⚡ Quick replies…
              </option>
              {quickReplies.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.title}
                </option>
              ))}
            </select>
          )}
          <Zap className="hidden" />
        </div>
      </div>

      <ChatThread
        conversationId={conversation.id}
        perspective="admin"
        initialMessages={messages}
        apiPath="/api/admin/chats"
        allowInternalNote
        prefill={prefill}
        onPrefillConsumed={() => setPrefill(undefined)}
        disabled={conversation.status === "archived"}
        disabledNotice="This conversation is archived."
      />
    </div>
  );
}
