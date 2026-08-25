import { createAdminClient } from "@/lib/supabase/server";
import { requireAdminPage } from "@/lib/admin-guard";
import Link from "next/link";
import {
  Users,
  TrendingUp,
  DollarSign,
  Clock,
  CreditCard,
  AlertTriangle,
  ChevronRight,
  Activity,
  Layers,
  AlertCircle,
} from "lucide-react";
import { formatCurrency, formatDate, getDaysUntilMaturity } from "@/lib/utils";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Admin Dashboard" };

export default async function AdminDashboardPage() {
  // Role checked HERE, not only in the middleware. This page reads
  // with the service-role client, so there is no RLS behind it.
  await requireAdminPage();

  const db = await createAdminClient();

  type InvestmentRow = {
    id: string;
    investment_code: string;
    capital: number;
    maturity_date: string;
    created_at: string;
    investor: { full_name: string; investor_code: string } | null;
    series: { name: string } | null;
    cycle: { cycle_label: string; end_date?: string } | null;
  };
  type PaymentRow = {
    id: string;
    type: string;
    amount: number;
    created_at: string;
    investor: { full_name: string; investor_code: string } | null;
    investment: { investment_code: string; series: { name: string } | null } | null;
  };

  const [
    { count: totalInvestors },
    { count: activeInvestments },
    { count: pendingPayments },
    { data: capitalDataRaw },
    { data: profitDataRaw },
    { data: recentInvestmentsRaw },
    { data: maturingInvestmentsRaw },
    { data: pendingPaymentRequestsRaw },
    { data: awaitingDeclarationRaw },
  ] = await Promise.all([
    db.from("investors").select("*", { count: "exact", head: true }),
    db.from("investments").select("*", { count: "exact", head: true }).eq("status", "active"),
    db.from("payment_requests").select("*", { count: "exact", head: true }).eq("status", "pending"),
    db.from("investments").select("capital").eq("status", "active"),
    db.from("payment_requests").select("amount").eq("type", "roi").eq("status", "paid"),
    db
      .from("investments")
      .select("*, investor:investors(full_name, investor_code), series(name), cycle:cycles(cycle_label)")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(5),
    db
      .from("investments")
      .select(
        "*, investor:investors(full_name, investor_code), series(name), cycle:cycles(cycle_label, end_date)"
      )
      .eq("status", "active")
      .lte(
        "maturity_date",
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split("T")[0]
      )
      .order("maturity_date", { ascending: true }),
    db
      .from("payment_requests")
      .select(
        "*, investor:investors(full_name, investor_code), investment:investments(investment_code, series:series(name))"
      )
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(5),
    db
      .from("cycles")
      .select("id, cycle_label, series(name)")
      .eq("status", "awaiting_profit_declaration"),
  ]);

  const capitalData = capitalDataRaw as { capital: number }[] | null;
  const profitData = profitDataRaw as { amount: number }[] | null;
  const recentInvestments = recentInvestmentsRaw as InvestmentRow[] | null;
  const maturingInvestments = maturingInvestmentsRaw as InvestmentRow[] | null;
  const pendingPaymentRequests = pendingPaymentRequestsRaw as PaymentRow[] | null;
  const awaitingDeclaration = awaitingDeclarationRaw as {
    id: string;
    cycle_label: string;
    series: { name: string } | null;
  }[] | null;

  const totalCapitalAUM = capitalData?.reduce((s, i) => s + (i.capital || 0), 0) ?? 0;
  const totalProfitPaid = profitData?.reduce((s, p) => s + (p.amount || 0), 0) ?? 0;

  type SeriesWithCycles = {
    name: string;
    cycles: { status: string; cycle_label: string; investments: { capital: number }[] }[];
  };

  const { data: seriesDataRaw } = await db
    .from("series")
    .select("name, cycles(status, cycle_label, investments(capital))")
    .eq("is_active", true);

  const seriesData = seriesDataRaw as SeriesWithCycles[] | null;

  const seriesStats =
    seriesData?.map((s) => {
      const activeCycle = s.cycles?.find((c) => c.status === "active");
      const totalCap =
        activeCycle?.investments?.reduce(
          (sum: number, i: { capital: number }) => sum + (i.capital || 0),
          0
        ) ?? 0;
      const investorCount = activeCycle?.investments?.length ?? 0;
      return {
        name: s.name,
        cycleLabel: activeCycle?.cycle_label ?? "No active cycle",
        totalCapital: totalCap,
        investors: investorCount,
      };
    }) ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Admin Dashboard</h1>
        <p className="text-sm text-muted mt-1">MaalGrow platform overview</p>
      </div>

      {/* Awaiting Profit Declaration Alert */}
      {awaitingDeclaration && awaitingDeclaration.length > 0 && (
        <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-amber-900 text-sm">
                Cycle Matured — Profit Declaration Required
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                The following cycle{awaitingDeclaration.length > 1 ? "s have" : " has"} reached
                maturity. Please enter the final profit before investor reports can be generated.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                {awaitingDeclaration.map((cycle) => (
                  <Link
                    key={cycle.id}
                    href={`/admin/cycles/${cycle.id}/declare-profit`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
                  >
                    Declare Profit — {cycle.cycle_label}
                    <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending payments alert */}
      {(pendingPayments ?? 0) > 0 && (
        <Link
          href="/admin/payment-requests"
          className="flex items-center gap-3 rounded-xl border-2 border-gold-300 bg-gold-50 p-4 hover:border-gold-400 transition-colors"
        >
          <AlertTriangle className="h-5 w-5 text-gold-600 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-gold-800">
              {pendingPayments} payment request{Number(pendingPayments) !== 1 ? "s" : ""} pending
              approval
            </p>
            <p className="text-sm text-gold-600 mt-0.5">
              Review and approve investor payment requests
            </p>
          </div>
          <ChevronRight className="h-5 w-5 text-gold-500" />
        </Link>
      )}

      {/* Key Stats */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Investors"
          value={String(totalInvestors ?? 0)}
          subtitle="Registered investors"
          accentColor="primary"
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Active Investments"
          value={String(activeInvestments ?? 0)}
          subtitle="Currently running"
          accentColor="gold"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Capital Under Management"
          value={formatCurrency(totalCapitalAUM)}
          subtitle="Active capital"
          accentColor="success"
          icon={<DollarSign className="h-5 w-5" />}
        />
        <StatCard
          title="Total Profit Paid"
          value={formatCurrency(totalProfitPaid)}
          subtitle="Lifetime disbursements"
          accentColor="info"
          icon={<CreditCard className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Series Overview */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Layers className="h-4 w-4 text-primary-600" />
              Series Overview
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {seriesStats.map((s) => (
              <div key={s.name} className="rounded-lg border border-border p-3">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div
                      className={`flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
                        s.name === "A"
                          ? "bg-primary-100 text-primary-700"
                          : s.name === "B"
                          ? "bg-gold-100 text-gold-700"
                          : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {s.name}
                    </div>
                    <div>
                      <p className="text-xs font-semibold text-foreground">Series {s.name}</p>
                      <p className="text-[10px] text-muted">{s.cycleLabel}</p>
                    </div>
                  </div>
                  <Badge variant="active" dot className="text-[10px]">
                    Active
                  </Badge>
                </div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <p className="text-muted">Capital</p>
                    <p className="font-semibold">{formatCurrency(s.totalCapital)}</p>
                  </div>
                  <div>
                    <p className="text-muted">Investors</p>
                    <p className="font-semibold">{s.investors}</p>
                  </div>
                </div>
              </div>
            ))}
            <Link
              href="/admin/series"
              className="flex items-center justify-center gap-1 text-xs text-primary-600 font-medium hover:underline"
            >
              Manage series <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>

        {/* Pending Payments */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <CreditCard className="h-4 w-4 text-primary-600" />
                Pending Payments
              </CardTitle>
              <Link href="/admin/payment-requests" className="text-xs text-primary-600 hover:underline">
                View all
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            {pendingPaymentRequests && pendingPaymentRequests.length > 0 ? (
              <div className="space-y-2">
                {pendingPaymentRequests.map((req) => (
                  <Link
                    key={req.id}
                    href="/admin/payment-requests"
                    className="flex items-center justify-between rounded-lg border border-border p-2.5 hover:border-primary-200 hover:bg-primary-50/30 transition-all"
                  >
                    <div>
                      <p className="text-xs font-semibold text-foreground">
                        {req.investor?.full_name}
                      </p>
                      <p className="text-[10px] text-muted capitalize">
                        {req.type === "roi" ? "Profit" : req.type} payment
                      </p>
                    </div>
                    <p className="text-sm font-bold text-foreground">{formatCurrency(req.amount)}</p>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center py-6">
                <CreditCard className="h-8 w-8 text-border mx-auto mb-2" />
                <p className="text-sm text-muted">No pending requests</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Maturing Soon */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4 text-primary-600" />
                Maturing Soon (30 days)
              </CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {maturingInvestments && maturingInvestments.length > 0 ? (
              <div className="space-y-2">
                {maturingInvestments.slice(0, 5).map((inv) => {
                  const days = getDaysUntilMaturity(inv.maturity_date);
                  return (
                    <div
                      key={inv.id}
                      className="flex items-center justify-between rounded-lg border border-border p-2.5"
                    >
                      <div>
                        <p className="text-xs font-semibold text-foreground">
                          {inv.investor?.full_name}
                        </p>
                        <p className="text-[10px] text-muted">
                          {inv.investment_code} · Series {inv.series?.name}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-xs font-bold ${
                            days <= 7 ? "text-gold-600" : "text-foreground"
                          }`}
                        >
                          {days}d
                        </p>
                        <p className="text-[10px] text-muted">{formatDate(inv.maturity_date)}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-6">
                <Clock className="h-8 w-8 text-border mx-auto mb-2" />
                <p className="text-sm text-muted">No maturities in 30 days</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent Investments */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-primary-600" />
              Recent Investments
            </CardTitle>
            <Link
              href="/admin/investments"
              className="text-xs text-primary-600 hover:underline flex items-center gap-1"
            >
              View all <ChevronRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </CardHeader>
        <CardContent>
          {recentInvestments && recentInvestments.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-2 px-3 text-xs font-semibold text-muted uppercase">
                      Code
                    </th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-muted uppercase">
                      Investor
                    </th>
                    <th className="text-left py-2 px-3 text-xs font-semibold text-muted uppercase">
                      Series
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-muted uppercase">
                      Capital
                    </th>
                    <th className="text-right py-2 px-3 text-xs font-semibold text-muted uppercase">
                      Maturity
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {recentInvestments.map((inv) => (
                    <tr key={inv.id} className="hover:bg-primary-50/30 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-xs text-muted">
                        {inv.investment_code}
                      </td>
                      <td className="py-2.5 px-3 font-medium">{inv.investor?.full_name}</td>
                      <td className="py-2.5 px-3">
                        <Badge
                          variant="default"
                          className={`${
                            inv.series?.name === "A"
                              ? "bg-primary-100 text-primary-700"
                              : inv.series?.name === "B"
                              ? "bg-gold-100 text-gold-700"
                              : "bg-blue-100 text-blue-700"
                          }`}
                        >
                          Series {inv.series?.name}
                        </Badge>
                      </td>
                      <td className="py-2.5 px-3 text-right font-semibold">
                        {formatCurrency(inv.capital)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-muted text-xs">
                        {formatDate(inv.maturity_date)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-8 text-muted">No investments yet</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
