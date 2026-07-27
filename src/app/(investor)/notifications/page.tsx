"use client";

import { useState, useEffect } from "react";
import { Bell, CheckCheck, Trash2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatRelativeTime } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import Link from "next/link";

const typeIcons: Record<string, string> = {
  investment: "💼",
  roi: "💰",
  capital: "🏦",
  maturity: "⏰",
  payment: "💳",
  document: "📄",
  announcement: "📢",
  system: "⚙️",
};

/**
 * A notification's body, set to be read rather than glanced at.
 *
 * It used to render as a single <p> at text-xs in muted grey, which
 * collapsed every line break the sender typed. A short "your payment
 * was confirmed" survived that; a real announcement arrived as an
 * unbroken grey slab several hundred words long, which is what
 * prompted this.
 *
 * Blank lines become paragraphs and single newlines stay as line
 * breaks, so what the sender laid out is what the investor reads.
 * Type is at the size and line height of something meant to be read
 * through, and in the foreground colour: muted grey is for the
 * timestamp, not for the message itself.
 */
function NotificationBody({ text }: { text: string }) {
  const paragraphs = text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div className="mt-2 space-y-3">
      {paragraphs.map((p, i) => (
        <p
          key={i}
          className="text-sm leading-7 text-foreground/85 whitespace-pre-line"
        >
          {p}
        </p>
      ))}
    </div>
  );
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<{
    id: string;
    title: string;
    message: string;
    type: string;
    is_read: boolean;
    action_url: string | null;
    created_at: string;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  const supabase = createClient();

  const loadNotifications = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false });

    setNotifications(data ?? []);
    setLoading(false);
  };

  useEffect(() => { loadNotifications(); }, []);

  const markAllRead = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);

    setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
    toast.success("All notifications marked as read");
  };

  const markRead = async (id: string) => {
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("id", id);

    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n))
    );
  };

  const unreadCount = notifications.filter((n) => !n.is_read).length;

  return (
    <div className="space-y-6 max-w-2xl animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Notifications</h1>
          <p className="text-sm text-muted mt-1">
            {unreadCount > 0 ? `${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}` : "All caught up"}
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAllRead}>
            <CheckCheck className="h-4 w-4" />
            Mark all read
          </Button>
        )}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-20 rounded-xl bg-surface-2 animate-pulse" />
          ))}
        </div>
      ) : notifications.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <Bell className="h-12 w-12 text-border mb-4" />
            <h3 className="font-semibold text-foreground">No notifications yet</h3>
            <p className="text-sm text-muted mt-1">
              We will notify you about your investments, payments, and announcements here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {notifications.map((n) => {
            const Wrapper = n.action_url ? Link : "div";
            return (
              <Wrapper
                key={n.id}
                href={n.action_url ?? "#"}
                onClick={() => !n.is_read && markRead(n.id)}
                className={`flex items-start gap-3 rounded-xl border p-5 transition-all ${
                  !n.is_read
                    ? "bg-primary-50 border-primary-100 hover:border-primary-200"
                    : "bg-surface border-border hover:border-primary-100"
                }`}
              >
                <span className="text-xl flex-shrink-0 mt-0.5">
                  {typeIcons[n.type] ?? "🔔"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-base font-semibold leading-snug ${!n.is_read ? "text-foreground" : "text-muted-foreground"}`}>
                      {n.title}
                    </p>
                    {!n.is_read && (
                      <div className="h-2 w-2 rounded-full bg-primary-500 flex-shrink-0 mt-2" />
                    )}
                  </div>
                  <NotificationBody text={n.message} />
                  <p className="text-[11px] text-muted/70 mt-3">{formatRelativeTime(n.created_at)}</p>
                </div>
              </Wrapper>
            );
          })}
        </div>
      )}
    </div>
  );
}
