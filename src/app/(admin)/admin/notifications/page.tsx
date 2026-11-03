"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, CheckCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

type Item = { id: string; title: string; message: string; action_url: string | null; is_read: boolean; created_at: string };

async function fetchMine(filter: "all" | "unread"): Promise<Item[] | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  let q = supabase.from("notifications").select("id, title, message, action_url, is_read, created_at")
    .eq("user_id", user.id).order("created_at", { ascending: false }).limit(100);
  if (filter === "unread") q = q.eq("is_read", false);
  const { data } = await q;
  return (data ?? []) as Item[];
}

/** A staff member's own notifications: new investor messages and other alerts. */
export default function AdminNotificationsPage() {
  const router = useRouter();
  const [items, setItems] = useState<Item[] | null>(null);
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const load = useCallback(() => fetchMine(filter).then((rows) => { if (rows) setItems(rows); }).catch(() => {}), [filter]);

  useEffect(() => {
    fetchMine(filter).then((rows) => { if (rows) setItems(rows); }).catch(() => {});
    // New alerts while this page is open (the admin shell re-checks them).
    const reload = () => void load();
    window.addEventListener("admin-notifications-changed", reload);
    return () => window.removeEventListener("admin-notifications-changed", reload);
  }, [load, filter]);

  async function open(n: Item) {
    if (!n.is_read) await createClient().from("notifications").update({ is_read: true }).eq("id", n.id);
    if (n.action_url?.startsWith("/admin")) router.push(n.action_url);
    else void load();
  }

  async function markAll() {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", user.id).eq("is_read", false);
    void load();
    router.refresh();
  }

  const unread = (items ?? []).filter((n) => !n.is_read).length;
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="text-sm text-muted mt-1">New investor messages and other alerts for you.</p>
        </div>
        <div className="flex gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value as "all" | "unread")}
            className="h-9 rounded-lg border border-border bg-white px-2 text-sm" aria-label="Show">
            <option value="all">All</option>
            <option value="unread">Unread</option>
          </select>
          <Button size="sm" variant="outline" disabled={unread === 0} onClick={markAll}><CheckCheck className="h-4 w-4" /> Mark all read</Button>
        </div>
      </div>
      <Card>
        <CardContent className="p-0">
          {items === null ? (
            <p className="p-6 text-sm text-muted">Loading…</p>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 p-10 text-sm text-muted"><Bell className="h-6 w-6" /> Nothing here.</div>
          ) : (
            <ul className="divide-y divide-border" data-testid="admin-notifications">
              {items.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => open(n)} className={`w-full text-left px-4 py-3 hover:bg-surface-2 ${n.is_read ? "" : "bg-primary-50/60"}`}>
                    <div className="flex items-start justify-between gap-3">
                      <p className={`text-sm ${n.is_read ? "" : "font-semibold"}`}>{n.title}</p>
                      <span className="shrink-0 text-xs text-muted">{formatRelativeTime(n.created_at)}</span>
                    </div>
                    <p className="text-sm text-muted">{n.message}</p>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
