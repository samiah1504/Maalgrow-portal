"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  Send,
  Paperclip,
  Loader2,
  AlertCircle,
  FileText,
  Lock,
  Check,
  CheckCheck,
} from "lucide-react";

export type ChatMessage = {
  id: string;
  conversation_id: string;
  sender_id: string;
  sender_type: "investor" | "admin";
  body: string | null;
  attachment_path: string | null;
  attachment_name: string | null;
  attachment_mime: string | null;
  is_internal_note: boolean;
  read_at: string | null;
  created_at: string;
  /** client-only */
  _pending?: boolean;
  _failed?: boolean;
  _clientKey?: string;
};

interface ChatThreadProps {
  conversationId: string;
  /** "investor" or "admin" — controls alignment + capabilities */
  perspective: "investor" | "admin";
  initialMessages: ChatMessage[];
  /** endpoint that accepts {action:"send"|"mark_read", ...} */
  apiPath: string;
  /** admin only: allow the internal-note toggle */
  allowInternalNote?: boolean;
  /** admin only: prefill composer (quick replies) */
  prefill?: string;
  onPrefillConsumed?: () => void;
  disabled?: boolean;
  disabledNotice?: string;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate();
  if (sameDay(d, today)) return "Today";
  if (sameDay(d, yesterday)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function ChatThread({
  conversationId,
  perspective,
  initialMessages,
  apiPath,
  allowInternalNote,
  prefill,
  onPrefillConsumed,
  disabled,
  disabledNotice,
}: ChatThreadProps) {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [draft, setDraft] = useState("");
  const [internalNote, setInternalNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const knownIds = useRef<Set<string>>(new Set(initialMessages.map((m) => m.id)));

  const mine = useCallback(
    (m: ChatMessage) => m.sender_type === perspective,
    [perspective]
  );

  useEffect(() => {
    if (prefill) {
      setDraft(prefill);
      onPrefillConsumed?.();
    }
  }, [prefill, onPrefillConsumed]);

  const markRead = useCallback(() => {
    fetch(apiPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "mark_read", conversation_id: conversationId }),
    }).catch(() => {});
  }, [apiPath, conversationId]);

  // Realtime: new messages appear without refresh. RLS scopes what each
  // side can receive (investors never get internal notes).
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`chat-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "chat_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const m = payload.new as ChatMessage;
          if (knownIds.current.has(m.id)) return; // duplicate prevention
          knownIds.current.add(m.id);
          setMessages((prev) => [...prev, m]);
          if (m.sender_type !== perspective) markRead();
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [conversationId, perspective, markRead]);

  useEffect(() => {
    markRead();
  }, [markRead]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const sendText = async (text: string, clientKey?: string) => {
    const key = clientKey ?? `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const asNote = allowInternalNote && internalNote;

    if (!clientKey) {
      // optimistic bubble
      setMessages((prev) => [
        ...prev,
        {
          id: key,
          _clientKey: key,
          _pending: true,
          conversation_id: conversationId,
          sender_id: "me",
          sender_type: perspective,
          body: text,
          attachment_path: null,
          attachment_name: null,
          attachment_mime: null,
          is_internal_note: Boolean(asNote),
          read_at: null,
          created_at: new Date().toISOString(),
        },
      ]);
    } else {
      setMessages((prev) =>
        prev.map((m) =>
          m._clientKey === key ? { ...m, _pending: true, _failed: false } : m
        )
      );
    }

    setSending(true);
    try {
      const res = await fetch(apiPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send",
          conversation_id: conversationId,
          message: text,
          internal_note: Boolean(asNote),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Send failed");

      const realId = json.result?.message_id as string | undefined;
      setMessages((prev) =>
        prev.map((m) =>
          m._clientKey === key
            ? {
                ...m,
                id: realId ?? m.id,
                _pending: false,
                _failed: false,
                created_at: json.result?.created_at ?? m.created_at,
              }
            : m
        )
      );
      if (realId) knownIds.current.add(realId);
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m._clientKey === key ? { ...m, _pending: false, _failed: true } : m
        )
      );
      toast.error(err instanceof Error ? err.message : "Message not sent");
    } finally {
      setSending(false);
    }
  };

  const handleSend = async () => {
    const text = draft.trim();
    if (!text || sending || disabled) return;
    setDraft("");
    await sendText(text);
    setInternalNote(false);
  };

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const form = new FormData();
      form.append("conversation_id", conversationId);
      form.append("file", file);
      if (allowInternalNote && internalNote) form.append("internal_note", "true");
      const res = await fetch("/api/chat/attachment", { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Upload failed");
      // realtime will deliver the message; add fallback insert
      const realId = json.result?.message_id as string | undefined;
      if (realId && !knownIds.current.has(realId)) {
        knownIds.current.add(realId);
        setMessages((prev) => [
          ...prev,
          {
            id: realId,
            conversation_id: conversationId,
            sender_id: "me",
            sender_type: perspective,
            body: null,
            attachment_path: "uploaded",
            attachment_name: file.name,
            attachment_mime: file.type,
            is_internal_note: Boolean(allowInternalNote && internalNote),
            read_at: null,
            created_at: new Date().toISOString(),
          },
        ]);
      }
      toast.success("Attachment sent");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const grouped = useMemo(() => {
    const groups: { day: string; items: ChatMessage[] }[] = [];
    for (const m of messages) {
      const day = dayLabel(m.created_at);
      const last = groups[groups.length - 1];
      if (last && last.day === day) last.items.push(m);
      else groups.push({ day, items: [m] });
    }
    return groups;
  }, [messages]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4 bg-surface-2/40">
        {grouped.length === 0 && (
          <p className="text-center text-sm text-muted py-10">
            No messages yet — start the conversation below.
          </p>
        )}
        {grouped.map((g) => (
          <div key={g.day}>
            <div className="flex justify-center mb-3">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted bg-white border border-border rounded-full px-2.5 py-0.5">
                {g.day}
              </span>
            </div>
            <div className="space-y-2">
              {g.items.map((m) => {
                const own = mine(m);
                return (
                  <div
                    key={m._clientKey ?? m.id}
                    className={`flex ${own ? "justify-end" : "justify-start"}`}
                  >
                    <div
                      className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                        m.is_internal_note
                          ? "bg-amber-50 border border-amber-200 text-amber-900"
                          : own
                          ? "bg-primary-700 text-white rounded-br-sm"
                          : "bg-white border border-border text-foreground rounded-bl-sm"
                      }`}
                    >
                      {m.is_internal_note && (
                        <p className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide mb-0.5">
                          <Lock className="h-3 w-3" /> Internal note — not visible to
                          the investor
                        </p>
                      )}
                      {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                      {m.attachment_name && (
                        <a
                          href={`/api/chat/attachment?message_id=${m.id}`}
                          target="_blank"
                          rel="noreferrer"
                          className={`mt-1 flex items-center gap-1.5 text-xs underline ${
                            own && !m.is_internal_note ? "text-primary-100" : "text-primary-700"
                          }`}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {m.attachment_name}
                        </a>
                      )}
                      <div
                        className={`mt-1 flex items-center gap-1 text-[10px] ${
                          m.is_internal_note
                            ? "text-amber-700"
                            : own
                            ? "text-primary-200"
                            : "text-muted"
                        }`}
                      >
                        <span>{timeLabel(m.created_at)}</span>
                        {own && !m.is_internal_note && (
                          m._failed ? (
                            <button
                              onClick={() => sendText(m.body ?? "", m._clientKey)}
                              className="flex items-center gap-0.5 text-red-300 font-semibold"
                            >
                              <AlertCircle className="h-3 w-3" /> Message not sent. Tap to retry.
                            </button>
                          ) : m._pending ? (
                            <span>Sending…</span>
                          ) : m.read_at ? (
                            <span className="flex items-center gap-0.5">
                              <CheckCheck className="h-3 w-3" /> Read
                            </span>
                          ) : (
                            <span className="flex items-center gap-0.5">
                              <Check className="h-3 w-3" /> Sent
                            </span>
                          )
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      <div className="border-t border-border bg-white p-3 space-y-2">
        {disabled ? (
          <p className="text-sm text-muted text-center py-2">
            {disabledNotice ?? "This conversation is closed."}
          </p>
        ) : (
          <>
            {allowInternalNote && (
              <label className="flex items-center gap-2 text-xs text-amber-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={internalNote}
                  onChange={(e) => setInternalNote(e.target.checked)}
                />
                <Lock className="h-3 w-3" />
                Internal note (never shown to the investor)
              </label>
            )}
            <div className="flex items-end gap-2">
              <button
                type="button"
                title="Attach PDF, JPG or PNG (max 5 MB)"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="h-10 w-10 shrink-0 rounded-lg border border-border text-muted hover:text-primary-700 hover:border-primary-300 flex items-center justify-center transition-colors"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Paperclip className="h-4 w-4" />
                )}
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                }}
              />
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={Math.min(4, Math.max(1, draft.split("\n").length))}
                placeholder={
                  internalNote ? "Type an internal note…" : "Type your message…"
                }
                className="flex-1 resize-none rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
              <button
                type="button"
                onClick={handleSend}
                disabled={sending || !draft.trim()}
                className="h-10 w-10 shrink-0 rounded-lg bg-primary-700 text-white hover:bg-primary-600 disabled:opacity-50 flex items-center justify-center transition-colors"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
