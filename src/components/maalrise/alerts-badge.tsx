"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Unread MaalRise notifications for the signed-in person. Asking for
 * the count also brings payment-date reminders up to date (see
 * maalrise_my_notifications), so finance and admins see a scheduled
 * payment on its date wherever they are in the portal.
 *
 * Fails quiet: no badge if MaalRise is unreachable — the rest of the
 * sidebar never depends on it.
 */
export function MaalriseAlertsBadge() {
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/maalrise/notifications", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d && typeof d.unread === "number") setUnread(d.unread); })
      .catch(() => {});
    return () => { live = false; };
  }, [pathname]);

  if (unread <= 0) return null;
  return (
    <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-primary-900">
      {unread > 9 ? "9+" : unread}
    </span>
  );
}
