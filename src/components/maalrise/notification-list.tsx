"use client";

import Link from "next/link";
import { BellRing, CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateTime } from "@/lib/utils";
import { useMaalriseAction } from "@/components/maalrise/use-maalrise-action";
import type { NotificationRow } from "@/lib/maalrise/types";

const URGENT = new Set(["payment_followup", "capital_followup"]);

/** The signed-in person's MaalRise notifications, with mark-as-read. */
export function NotificationList({ items, compact = false }: { items: NotificationRow[]; compact?: boolean }) {
  const { run, busy } = useMaalriseAction();
  const unread = items.filter((n) => !n.read_at);
  return (
    <div className="rounded-xl border border-border bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2">
        <p className="flex items-center gap-2 text-sm font-medium"><BellRing className="h-4 w-4 text-primary-600" /> {compact ? "New for you" : "Notifications"}</p>
        {unread.length > 0 && (
          <Button size="xs" variant="outline" loading={busy === "all"}
            onClick={() => run("all", "/api/admin/maalrise/notifications", {}, { success: "Marked as read." })}>
            <CheckCheck className="h-3 w-3" /> Mark all read
          </Button>
        )}
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-muted">No notifications.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((n) => (
            <li key={n.id} className={`px-4 py-3 text-sm ${n.read_at ? "opacity-70" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <p className={`font-medium ${URGENT.has(n.kind) ? "text-red-700" : "text-foreground"}`}>
                  {!n.read_at && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-gold-500" />}
                  {n.title}
                </p>
                <span className="text-[11px] text-muted">{formatDateTime(n.created_at)}</span>
              </div>
              <p className="mt-0.5 text-muted">{n.message}</p>
              <div className="mt-1 flex gap-3 text-xs">
                {n.link && <Link href={n.link} className="text-primary-700 hover:underline">Open</Link>}
                {!n.read_at && (
                  <button className="text-muted hover:text-foreground" disabled={busy === n.id}
                    onClick={() => run(n.id, "/api/admin/maalrise/notifications", { ids: [n.id] })}>
                    Mark read
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
