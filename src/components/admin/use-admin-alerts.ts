"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

/**
 * Staff alerts (approved 3 Nov 2026): unread investor chat messages and
 * the staff member's own notifications.
 *
 *   * chatUnread  — unread investor messages in the chats THIS person may
 *                   see (the database's chat rules decide: senior staff
 *                   see every chat, others their own and unassigned ones)
 *   * notifUnread — their unread notifications (the database already
 *                   writes one for each new investor message)
 *
 * Chats update live (chat_conversations is on Supabase Realtime since
 * migration 016); everything is also re-checked every 30 seconds and on
 * each page change, so nothing depends on the live connection alone.
 * A new message while staff are elsewhere in the admin shows a pop-up
 * with an Open button; the browser tab shows the unread count.
 * The payment officer has no chats and is left out.
 */
const POLL_MS = 30_000;

type ChatRow = { id: string; admin_unread: number; investor: { full_name: string } | null };

async function myId(): Promise<string | null> {
  const { data: { user } } = await createClient().auth.getUser();
  return user?.id ?? null;
}

/** Unread notifications, as rows (works the same everywhere); the bell shows "9+" beyond 9. */
async function fetchNotifUnread(): Promise<number | null> {
  const uid = await myId();
  if (!uid) return null;
  const { data, error } = await createClient().from("notifications").select("id")
    .eq("user_id", uid).eq("is_read", false).limit(100);
  return error ? null : data?.length ?? 0;
}

async function fetchUnreadChats(): Promise<ChatRow[] | null> {
  const { data, error } = await createClient().from("chat_conversations")
    .select("id, admin_unread, investor:investor_id(full_name)")
    .gt("admin_unread", 0);
  return error ? null : ((data ?? []) as unknown as ChatRow[]);
}

/** Opening a chat clears its alerts in the bell too. */
async function markChatAlertsRead(path: string): Promise<void> {
  const uid = await myId();
  if (!uid) return;
  await createClient().from("notifications").update({ is_read: true })
    .eq("user_id", uid).eq("action_url", path).eq("is_read", false);
}

export function useAdminAlerts(role: string | null) {
  const enabled = !!role && role !== "payment_officer";
  const router = useRouter();
  const pathname = usePathname();
  const [chatUnread, setChatUnread] = useState(0);
  const [notifUnread, setNotifUnread] = useState(0);
  const seen = useRef<Map<string, number> | null>(null);
  const path = useRef(pathname);
  useEffect(() => { path.current = pathname; }, [pathname]);

  const applyNotifs = useCallback((n: number | null) => {
    if (n === null) return;
    setNotifUnread((prev) => {
      // Lets an open Notifications page reload its list.
      if (prev !== n) window.dispatchEvent(new Event("admin-notifications-changed"));
      return n;
    });
  }, []);

  const applyChats = useCallback((rows: ChatRow[] | null) => {
    if (!rows) return;
    const before = seen.current;
    if (before) {
      for (const r of rows) {
        if (r.admin_unread > (before.get(r.id) ?? 0) && path.current !== `/admin/chats/${r.id}`) {
          toast(`New message from ${r.investor?.full_name ?? "an investor"}`, {
            id: `chat-${r.id}`,
            action: { label: "Open", onClick: () => router.push(`/admin/chats/${r.id}`) },
          });
        }
      }
    }
    seen.current = new Map(rows.map((r) => [r.id, r.admin_unread]));
    setChatUnread(rows.reduce((t, r) => t + r.admin_unread, 0));
  }, [router]);

  const refreshNotifs = useCallback(() => fetchNotifUnread().then(applyNotifs), [applyNotifs]);
  const refreshAll = useCallback(() => {
    fetchUnreadChats().then(applyChats).catch(() => {});
    fetchNotifUnread().then(applyNotifs).catch(() => {});
  }, [applyChats, applyNotifs]);

  // Live chat updates, plus a regular re-check.
  useEffect(() => {
    if (!enabled) return;
    const supabase = createClient();
    const channel = supabase
      .channel("admin-chat-alerts")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_conversations" }, () => refreshAll())
      .subscribe();
    const timer = setInterval(refreshAll, POLL_MS);
    return () => { clearInterval(timer); void supabase.removeChannel(channel); };
  }, [enabled, refreshAll]);

  // On every page change (and first load); on a chat page, its alerts are read.
  useEffect(() => {
    if (!enabled) return;
    const onChat = /^\/admin\/chats\/[0-9a-f-]{36}$/.test(pathname);
    (onChat ? markChatAlertsRead(pathname) : Promise.resolve()).then(refreshAll).catch(() => {});
  }, [enabled, pathname, refreshAll]);

  // "(3) MaalGrow Admin" in the browser tab while messages are unread.
  useEffect(() => {
    if (!enabled) return;
    const set = () => {
      const base = document.title.replace(/^\(\d+\+?\) /, "");
      document.title = chatUnread > 0 ? `(${chatUnread > 99 ? "99+" : chatUnread}) ${base}` : base;
    };
    set();
    const t = setTimeout(set, 300); // after the page sets its own title
    return () => clearTimeout(t);
  }, [enabled, chatUnread, pathname]);

  return { chatUnread, notifUnread, refreshNotifs };
}
