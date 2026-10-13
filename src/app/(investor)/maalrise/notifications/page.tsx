import type { Metadata } from "next";
import { listMyNotifications } from "@/lib/maalrise/db";
import { requireMaalriseInvestorPage } from "@/lib/maalrise/portal-guard";
import { NotificationList } from "@/components/maalrise/notification-list";
import { PortalHeading } from "@/components/maalrise/portal-ui";

export const metadata: Metadata = { title: "MaalRise Alerts" };

export default async function MyMaalRiseAlertsPage() {
  const { db } = await requireMaalriseInvestorPage();
  const items = await listMyNotifications(db, 100);
  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <PortalHeading title="Alerts" description="Payments made to you and updates to your bank details." />
      <NotificationList items={items} endpoint="/api/maalrise/notifications" />
    </div>
  );
}
