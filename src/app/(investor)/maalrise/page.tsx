import Link from "next/link";
import type { Metadata } from "next";
import { CalendarClock, Coins, Landmark, Wallet } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { formatDate } from "@/lib/utils";
import { formatKobo } from "@/lib/maalrise/format";
import { lagosToday } from "@/lib/maalrise/receipts";
import { listMyCycles, listMyPayments, portfolioSummary } from "@/lib/maalrise/portal";
import { listMyNotifications } from "@/lib/maalrise/db";
import { requireMaalriseInvestorPage } from "@/lib/maalrise/portal-guard";
import { CycleCard, PaymentsTable, PortalHeading } from "@/components/maalrise/portal-ui";
import { NotificationList } from "@/components/maalrise/notification-list";

export const metadata: Metadata = { title: "MaalRise" };

/** The MaalRise overview: what is invested, what has been paid, what comes next. */
export default async function MaalRiseOverviewPage() {
  const { db, profile } = await requireMaalriseInvestorPage();
  const [cycles, payments, notifications] = await Promise.all([listMyCycles(db), listMyPayments(db), listMyNotifications(db, 5)]);
  const s = portfolioSummary(cycles, lagosToday());
  const unread = notifications.filter((n) => !n.read_at);

  return (
    <div className="space-y-6 animate-fade-in">
      <PortalHeading title={`Welcome, ${profile.full_name.split(" ")[0]}`}
        description="Your MaalRise Cycles, the profit paid to you, and what comes next." />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Capital invested" value={formatKobo(s.capitalInvestedKobo)}
          subtitle={`${s.activeCycles} Cycle${s.activeCycles === 1 ? "" : "s"} in progress`} icon={<Wallet className="h-5 w-5" />} />
        <StatCard title="Profit paid to you" value={formatKobo(s.profitPaidKobo)} accentColor="success"
          subtitle={s.awaitingTransferKobo > 0 ? `${formatKobo(s.awaitingTransferKobo)} approved, being transferred` : "Marked paid by MaalVest"}
          icon={<Coins className="h-5 w-5" />} />
        <StatCard title="Expected profit to come" value={formatKobo(s.profitToComeKobo)} accentColor="gold"
          subtitle="From the approved schedules" icon={<CalendarClock className="h-5 w-5" />} />
        <StatCard title="Next expected payment" accentColor="info" icon={<Landmark className="h-5 w-5" />}
          value={s.next ? formatKobo(s.next.expectedKobo) : "—"}
          subtitle={s.next ? `${s.next.label}, ${s.next.cycleName} · ${formatDate(s.next.dueDate)}` : "Nothing scheduled"} />
      </div>
      {s.capitalRepaidKobo > 0 && (
        <p className="text-sm text-muted">Capital repaid to you so far: <span className="font-medium text-foreground">{formatKobo(s.capitalRepaidKobo)}</span></p>
      )}

      {unread.length > 0 && <NotificationList items={unread} compact endpoint="/api/maalrise/notifications" />}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Your Cycles</CardTitle>
          <Link href="/maalrise/cycles" className="text-sm text-primary-700 hover:underline">See all</Link>
        </CardHeader>
        <CardContent className="space-y-3">
          {cycles.length === 0 ? (
            <p className="py-4 text-sm text-muted">You are not in any active Cycle yet. Cycles appear here once they start.</p>
          ) : (
            cycles.slice(0, 3).map((c) => <CycleCard key={c.id} c={c} />)
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Recent payments</CardTitle>
          <Link href="/maalrise/payments" className="text-sm text-primary-700 hover:underline">Payment history</Link>
        </CardHeader>
        <CardContent>
          <PaymentsTable payments={payments.slice(0, 5)} />
        </CardContent>
      </Card>
    </div>
  );
}
