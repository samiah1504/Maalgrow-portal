import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import {
  TrendingUp,
  DollarSign,
  BarChart3,
  Activity,
  Clock,
  ChevronRight,
  Bell,
} from "lucide-react";
import { formatCurrency, formatDate, getDaysUntilMaturity } from "@/lib/utils";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  type InvestorWithProfile = {
    id: string;
    full_name: string;
    investor_code: string;
    profile: { id: string; email: string; full_name: string | null } | null;
  };
  type InvestmentWithDetails = {
    id: string;
    investment_code: string;
    capital: number;
    declared_profit: number | null;
    maturity_date: string;
    status: "active" | "matured" | "completed";
    series: { name: "A" | "B" | "C" } | null;
    cycle: { cycle_label: string } | null;
  };

  // Get investor profile
  const { data: rawInvestor } = await supabase
    .from("investors")
    .select("*, profile:profiles(*)")
    .eq("profile_id", user.id)
    .single();

  const investor = rawInvestor as unknown as InvestorWithProfile | null;

  if (!investor) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-muted">Investor profile not found. Please contact support.</p>
        </div>
      </div>
    );
  }

  // Get all investments with series and cycle details
  const { data: rawInvestments } = await supabase
    .from("investments")
    .select("*, series(*), cycle:cycles(*)")
    .eq("investor_id", investor.id)
    .order("created_at", { ascending: false });

  const investments = rawInvestments as unknown as InvestmentWithDetails[] | null;

  // Get recent notifications
  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(5);

  // Get paid profit and capital payment requests
  const { data: paidROI } = await supabase
    .from("payment_requests")
    .select("amount")
    .eq("investor_id", investor.id)
    .eq("type", "roi")
    .eq("status", "paid");

  const { data: paidCapital } = await supabase
    .from("payment_requests")
    .select("amount")
    .eq("investor_id", investor.id)
    .eq("type", "capital")
    .eq("status", "paid");

  const activeInvestments = investments?.filter((i) => i.status === "active") ?? [];
  const maturedInvestments = investments?.filter((i) => i.status === "matured") ?? [];

  const totalActiveCapital = activeInvestments.reduce((sum, i) => sum + (i.capital || 0), 0);
  const totalProfitReceived = (paidROI as { amount: number }[] | null)?.reduce((sum, p) => sum + (p.amount || 0), 0) ?? 0;
  const totalCapitalReturned = (paidCapital as { amount: number }[] | null)?.reduce((sum, p) => sum + (p.amount || 0), 0) ?? 0;

  // Upcoming maturities in next 30 days
  const upcomingMaturities = activeInvestments.filter((i) => {
    const days = getDaysUntilMaturity(i.maturity_date);
    return days <= 30;
  });

  // Series breakdown
  const seriesBreakdown = ["A", "B", "C"].map((s) => {
    const seriesInvestments = activeInvestments.filter((i) => i.series?.name === s);
    return {
      series: s,
      active: seriesInvestments.length > 0,
      capital: seriesInvestments.reduce((sum, i) => sum + (i.capital || 0), 0),
    };
  });

  const firstName = investor.full_name.split(" ")[0];

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Welcome Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            As-salāmu ʿalaykum, {firstName}
          </h1>
          <p className="text-muted text-sm mt-1">
            Investor ID: {investor.investor_code} · Here&apos;s your investment overview
          </p>
        </div>
        {maturedInvestments.length > 0 && (
          <Link
            href="/investments"
            className="flex items-center gap-2 bg-gold-500 text-primary-900 rounded-lg px-4 py-2 text-sm font-semibold hover:bg-gold-400 transition-colors animate-pulse-gold"
          >
            <Bell className="h-4 w-4" />
            {maturedInvestments.length} Investment{maturedInvestments.length !== 1 ? "s" : ""} Matured — Action Required
            <ChevronRight className="h-4 w-4" />
          </Link>
        )}
      </div>

      {/* Key Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Active Capital"
          value={formatCurrency(totalActiveCapital)}
          subtitle={`${activeInvestments.length} active investment${activeInvestments.length !== 1 ? "s" : ""}`}
          accentColor="primary"
          icon={<DollarSign className="h-5 w-5" />}
        />
        <StatCard
          title="Total Profit Received"
          value={formatCurrency(totalProfitReceived)}
          subtitle="Cumulative profit paid"
          accentColor="gold"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Capital Returned"
          value={formatCurrency(totalCapitalReturned)}
          subtitle="From matured investments"
          accentColor="success"
          icon={<BarChart3 className="h-5 w-5" />}
        />
        <StatCard
          title="Upcoming Maturities"
          value={upcomingMaturities.length}
          subtitle="Within 30 days"
          accentColor="info"
          icon={<Clock className="h-5 w-5" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Series Status */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-primary-600" />
              Series Portfolio
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {seriesBreakdown.map(({ series, active, capital }) => (
              <div
                key={series}
                className="flex items-center justify-between rounded-xl border border-border p-4 hover:border-primary-200 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-lg font-bold text-sm ${
                      series === "A"
                        ? "bg-primary-100 text-primary-700"
                        : series === "B"
                        ? "bg-gold-100 text-gold-700"
                        : "bg-blue-100 text-blue-700"
                    }`}
                  >
                    {series}
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-foreground">MaalGrow Series {series}</p>
                    <p className="text-xs text-muted">{active ? `Active · ${formatCurrency(capital)}` : "Not participating"}</p>
                  </div>
                </div>
                <div className="text-right">
                  {active ? (
                    <Badge variant="active" dot>Active</Badge>
                  ) : (
                    <Badge variant="default" className="bg-gray-100 text-gray-500">Inactive</Badge>
                  )}
                </div>
              </div>
            ))}
            <Link
              href="/investments"
              className="flex items-center justify-center gap-2 text-sm text-primary-600 hover:text-primary-700 font-medium mt-2"
            >
              View all investments <ChevronRight className="h-4 w-4" />
            </Link>
          </CardContent>
        </Card>

        {/* Recent Notifications */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5 text-primary-600" />
              Recent Notifications
            </CardTitle>
          </CardHeader>
          <CardContent>
            {notifications && notifications.length > 0 ? (
              <div className="space-y-3">
                {notifications.map((n) => (
                  <div
                    key={n.id}
                    className={`rounded-lg p-3 border ${
                      !n.is_read ? "bg-primary-50 border-primary-100" : "border-border"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!n.is_read && (
                        <div className="mt-1.5 h-1.5 w-1.5 rounded-full bg-primary-500 flex-shrink-0" />
                      )}
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{n.title}</p>
                        <p className="text-xs text-muted mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-muted/70 mt-1">{formatDate(n.created_at)}</p>
                      </div>
                    </div>
                  </div>
                ))}
                <Link
                  href="/notifications"
                  className="flex items-center justify-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                >
                  View all <ChevronRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            ) : (
              <div className="text-center py-6">
                <Bell className="h-8 w-8 text-border mx-auto mb-2" />
                <p className="text-sm text-muted">No notifications yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Active Investments */}
      {activeInvestments.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-5 w-5 text-primary-600" />
                Active Investments
              </CardTitle>
              <Link href="/investments" className="text-sm text-primary-600 hover:underline flex items-center gap-1">
                View all <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {activeInvestments.slice(0, 3).map((inv) => {
                const daysLeft = getDaysUntilMaturity(inv.maturity_date);
                return (
                  <Link
                    key={inv.id}
                    href={`/investments/${inv.id}`}
                    className="flex items-center justify-between rounded-xl border border-border p-4 hover:border-primary-200 hover:bg-primary-50/30 transition-all"
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className={`flex h-9 w-9 items-center justify-center rounded-lg text-xs font-bold ${
                          inv.series?.name === "A"
                            ? "bg-primary-100 text-primary-700"
                            : inv.series?.name === "B"
                            ? "bg-gold-100 text-gold-700"
                            : "bg-blue-100 text-blue-700"
                        }`}
                      >
                        {inv.series?.name}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-foreground">{inv.investment_code}</p>
                        <p className="text-xs text-muted">{inv.cycle?.cycle_label}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-foreground">{formatCurrency(inv.capital)}</p>
                      <p className={`text-xs ${daysLeft <= 7 ? "text-gold-600 font-medium" : "text-muted"}`}>
                        {daysLeft === 0 ? "Matures today" : `${daysLeft}d remaining`}
                      </p>
                    </div>
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
