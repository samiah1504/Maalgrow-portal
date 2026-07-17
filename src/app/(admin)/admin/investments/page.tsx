import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { TrendingUp, ChevronRight, Search, Filter } from "lucide-react";
import { formatCurrency, formatDate, getDaysUntilMaturity } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Investments | Admin" };

type InvestmentRow = {
  id: string;
  investment_code: string;
  status: string;
  capital: number;
  declared_profit: number | null;
  units: number;
  investment_date: string;
  maturity_date: string;
  created_at: string;
  investor: { full_name: string; investor_code: string } | null;
  series: { name: string } | null;
  cycle: { cycle_label: string } | null;
};

export default async function AdminInvestmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; series?: string; search?: string }>;
}) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = await createAdminClient();
  const params = await searchParams;
  const { status, series, search } = params;

  let query = db
    .from("investments")
    .select(
      "*, investor:investors(full_name, investor_code), series(name), cycle:cycles(cycle_label)"
    )
    .order("created_at", { ascending: false });

  if (status) query = query.eq("status", status as "active" | "matured" | "completed");
  if (series) query = query.eq("series_id", series);

  const { data: rawInvestments } = await query;
  const allInvestments = rawInvestments as unknown as InvestmentRow[] | null;

  const investments = search
    ? allInvestments?.filter(
        (i) =>
          i.investment_code.toLowerCase().includes(search.toLowerCase()) ||
          i.investor?.full_name?.toLowerCase().includes(search.toLowerCase()) ||
          i.investor?.investor_code?.toLowerCase().includes(search.toLowerCase())
      )
    : allInvestments;

  const { data: rawSeries } = await db.from("series").select("id, name").order("name");
  const seriesList = rawSeries as { id: string; name: string }[] | null;

  const totalCapital = investments?.reduce((s, i) => s + i.capital, 0) ?? 0;
  const activeCount = investments?.filter((i) => i.status === "active").length ?? 0;
  const maturedCount = investments?.filter((i) => i.status === "matured").length ?? 0;

  const statusVariant: Record<string, "active" | "matured" | "completed" | "pending"> = {
    active: "active",
    matured: "matured",
    completed: "completed",
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Investments</h1>
        <p className="text-sm text-muted mt-1">All investments across all series and cycles</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Capital"
          value={formatCurrency(totalCapital)}
          accentColor="primary"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Active"
          value={String(activeCount)}
          subtitle="investments"
          accentColor="success"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Matured"
          value={String(maturedCount)}
          subtitle="awaiting decision"
          accentColor="gold"
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="py-4">
          <form className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted pointer-events-none" />
              <input
                name="search"
                defaultValue={search}
                placeholder="Search by code or investor…"
                className="w-full rounded-lg border border-border bg-surface pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
              />
            </div>
            <select
              name="status"
              defaultValue={status ?? ""}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="matured">Matured</option>
              <option value="completed">Completed</option>
            </select>
            <select
              name="series"
              defaultValue={series ?? ""}
              className="rounded-lg border border-border bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400"
            >
              <option value="">All Series</option>
              {seriesList?.map((s) => (
                <option key={s.id} value={s.id}>
                  Series {s.name}
                </option>
              ))}
            </select>
            <button
              type="submit"
              className="flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 transition-colors"
            >
              <Filter className="h-4 w-4" />
              Filter
            </button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {investments?.length ?? 0} Investment
            {(investments?.length ?? 0) !== 1 ? "s" : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {!investments || investments.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <TrendingUp className="h-12 w-12 text-border mb-4" />
              <p className="font-medium text-foreground">No investments found</p>
              <p className="text-sm text-muted mt-1">Try adjusting your filters</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="px-4 py-3 text-left font-medium text-muted">Code</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Investor</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Series</th>
                    <th className="px-4 py-3 text-right font-medium text-muted">Capital</th>
                    <th className="px-4 py-3 text-right font-medium text-muted">Profit</th>
                    <th className="px-4 py-3 text-center font-medium text-muted">Status</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Matures</th>
                    <th className="px-4 py-3 text-center font-medium text-muted">Days Left</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {investments.map((inv) => {
                    const daysLeft = getDaysUntilMaturity(inv.maturity_date);
                    return (
                      <tr key={inv.id} className="hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3 font-mono text-xs text-muted">
                          {inv.investment_code}
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">
                            {inv.investor?.full_name}
                          </p>
                          <p className="text-xs text-muted font-mono">
                            {inv.investor?.investor_code}
                          </p>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold bg-primary-100 text-primary-700">
                            {inv.series?.name}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          {formatCurrency(inv.capital)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {inv.declared_profit != null ? (
                            <span className="text-emerald-600 font-medium">
                              {formatCurrency(inv.declared_profit)}
                            </span>
                          ) : (
                            <span className="text-xs text-muted">Not declared</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant={statusVariant[inv.status] ?? "pending"} dot>
                            {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-sm">
                          {formatDate(inv.maturity_date)}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {inv.status === "active" ? (
                            <span
                              className={`text-xs font-medium ${
                                daysLeft <= 7 ? "text-gold-600" : "text-muted"
                              }`}
                            >
                              {daysLeft}d
                            </span>
                          ) : (
                            <span className="text-xs text-muted">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/admin/investments/${inv.id}`}
                            className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium"
                          >
                            View <ChevronRight className="h-3.5 w-3.5" />
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
