"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";

type Item = { id: string; title: string; message: string; action_url: string | null; is_read: boolean; created_at: string };

async function latest(): Promise<Item[] | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("notifications").select("id, title, message, action_url, is_read, created_at")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(8);
  return (data ?? []) as Item[];
}

/** The admin top-bar bell: unread count, the latest alerts, mark read. */
export function AdminBell({ unread, onChange }: { unread: number; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const load = () => latest().then((rows) => { if (rows) setItems(rows); });

  useEffect(() => {
    if (!open) return;
    latest().then((rows) => { if (rows) setItems(rows); }).catch(() => {});
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function openItem(n: Item) {
    if (!n.is_read) await createClient().from("notifications").update({ is_read: true }).eq("id", n.id);
    setOpen(false);
    onChange();
    router.push(n.action_url?.startsWith("/admin") ? n.action_url : "/admin/notifications");
  }

  async function markAll() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    await load();
    onChange();
  }

  return (
    <div className="relative" ref={box}>
      <button type="button" aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`} data-testid="admin-bell"
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-lg p-2 text-muted hover:bg-primary-50 hover:text-primary-700 transition-colors">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[9px] font-bold text-white ring-2 ring-surface"
            data-testid="admin-bell-count">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-white shadow-lg z-50" data-testid="admin-bell-menu">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <p className="text-sm font-semibold">Notifications</p>
            {unread > 0 && (
              <button type="button" onClick={markAll} className="inline-flex items-center gap-1 text-xs text-primary-700 hover:underline">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-96 overflow-y-auto divide-y divide-border">
            {items === null && <li className="px-3 py-4 text-sm text-muted">Loading…</li>}
            {items?.length === 0 && <li className="px-3 py-4 text-sm text-muted">No notifications yet.</li>}
            {items?.map((n) => (
              <li key={n.id}>
                <button type="button" onClick={() => openItem(n)}
                  className={`w-full text-left px-3 py-2.5 hover:bg-surface-2 ${n.is_read ? "" : "bg-primary-50/60"}`}>
                  <p className={`text-sm ${n.is_read ? "text-foreground" : "font-semibold text-foreground"}`}>{n.title}</p>
                  <p className="text-xs text-muted line-clamp-2">{n.message}</p>
                  <p className="mt-0.5 text-[11px] text-muted">{formatRelativeTime(n.created_at)}</p>
                </button>
              </li>
            ))}
          </ul>
          <Link href="/admin/notifications" onClick={() => setOpen(false)}
            className="block border-t border-border px-3 py-2 text-center text-xs font-medium text-primary-700 hover:bg-surface-2">
            See all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
