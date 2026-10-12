import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-guard";
import { listMyNotifications, mr } from "@/lib/maalrise/db";
import { NotificationList } from "@/components/maalrise/notification-list";

export const metadata: Metadata = { title: "MaalRise Alerts | Admin" };

/**
 * Payment-date reminders, follow-ups and payment events for the signed-in
 * person. Email versions are prepared as drafts only; none are sent.
 */
export default async function MaalRiseNotificationsPage() {
  const { supabase } = await requireAdminPage();
  const db = mr(supabase);
  // Brings payment-date reminders up to date before listing them.
  await db.rpc("maalrise_my_notifications");
  const items = await listMyNotifications(db, 100);
  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">MaalRise Alerts</h1>
        <p className="text-sm text-muted mt-1">
          Scheduled payment dates, follow-ups after five days, and payment and distribution events. Email copies are kept as
          unsent drafts until email sending is approved.
        </p>
      </div>
      <NotificationList items={items} />
    </div>
  );
}
