import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Users, Search, ChevronRight, UserPlus } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  orderDirectory,
  investorSeries,
  type SortOrder,
} from "@/lib/investor-directory";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Investors" };

export default async function InvestorsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kyc?: string; series?: string; sort?: string }>;
}) {
  const { q, kyc, series, sort } = await searchParams;
  const sortOrder: SortOrder = sort === "za" ? "za" : "az";
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Use admin client to bypass RLS — this page is already role-gated by middleware/layout
  const adminClient = await createAdminClient();

  type InvestorRow = {
    id: string;
    full_name: string;
    investor_code: string;
    email: string;
    kyc_status: string;
    created_at: string;
    profile: { email: string; is_active: boolean } | null;
    investments:
      | { id: string; status: string; capital: number; series: { name: string } | null }[]
      | null;
  };

  let query = adminClient
    .from("investors")
    .select(`
      *,
      profile:profiles!profile_id(email, is_active),
      investments:investments(id, status, capital, series:series_id(name))
    `);
  // Deliberately NOT ordered here. PostgREST cannot order by
  // lower(full_name), and a case-sensitive sort drops "aisha" below
  // "Zainab" — see src/lib/investor-directory.ts.

  if (q) {
    query = query.or(`full_name.ilike.%${q}%,investor_code.ilike.%${q}%,email.ilike.%${q}%`);
  }
  if (kyc) {
    query = query.eq("kyc_status", kyc as "pending" | "approved" | "rejected");
  }

  const { data: rawInvestors, error: investorsError } = await query;
  if (investorsError) {
    console.error("[Admin] Investors list query failed:", investorsError);
  }
  // Series filter and A→Z / Z→A, both applied here rather than in the
  // query. One investor is one row whichever series is chosen, and
  // exactly one row under All Series.
  const investors = orderDirectory((rawInvestors as unknown as InvestorRow[]) ?? [], {
    series,
    sort: sortOrder,
  });

  const totalActive = investors.filter((i) =>
    i.investments?.some((inv) => inv.status === "active")
  ).length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Investors</h1>
          <p className="text-sm text-muted mt-1">
            {investors.length}{" "}
            {series ? `investor${investors.length === 1 ? "" : "s"} in Series ${series}` : "registered investors"}
            {" · "}
            {totalActive} with active investments
          </p>
        </div>
        <Link href="/admin/investors/new">
          <div className="inline-flex items-center gap-2 bg-primary-700 text-white rounded-lg px-4 py-2 text-sm font-medium hover:bg-primary-600 transition-colors">
            <UserPlus className="h-4 w-4" />
            Add Investor
          </div>
        </Link>
      </div>

      {/* Filters */}
      <form className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by name, email, or investor code..."
            className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        {/* Series. Fixed A/B/C rather than whatever happens to exist,
            so an empty series is still selectable and reads as "nobody
            here yet" instead of vanishing from the filter. */}
        <select
          name="series"
          defaultValue={series ?? ""}
          className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        >
          <option value="">All Series</option>
          <option value="A">Series A</option>
          <option value="B">Series B</option>
          <option value="C">Series C</option>
        </select>
        {/* Alphabetical by NAME. Not by code, not by phone number, not
            by the date they were added — none of those help anybody
            hunting for Maryam. */}
        <select
          name="sort"
          defaultValue={sortOrder}
          className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        >
          <option value="az">Name A → Z</option>
          <option value="za">Name Z → A</option>
        </select>
        <select
          name="kyc"
          defaultValue={kyc}
          className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        >
          <option value="">All KYC Status</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <button
          type="submit"
          className="h-10 rounded-lg bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-600 transition-colors"
        >
          Search
        </button>
      </form>

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          {investors.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Users className="h-12 w-12 text-border mb-4" />
              <p className="font-semibold text-foreground">No investors found</p>
              <p className="text-sm text-muted mt-1">
                {series
                  ? `Nobody holds a place in Series ${series}${q || kyc ? " matching those filters" : ""}.`
                  : q || kyc
                  ? "Try adjusting your search filters"
                  : "Add your first investor to get started"}
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface-2">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase tracking-wide">Investor</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase tracking-wide hidden sm:table-cell">Code</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase tracking-wide hidden md:table-cell">Series</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase tracking-wide hidden md:table-cell">KYC</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted uppercase tracking-wide hidden lg:table-cell">Active Capital</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase tracking-wide hidden xl:table-cell">Joined</th>
                    <th className="text-right py-3 px-4 text-xs font-semibold text-muted uppercase tracking-wide">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {investors.map((inv) => {
                    const activeInvestments = inv.investments?.filter(
                      (i) => i.status === "active"
                    ) ?? [];
                    const activeCapital = activeInvestments.reduce((s, i) => s + (i.capital || 0), 0);
                    const profile = inv.profile;
                    const kycVariant: Record<string, "pending" | "approved" | "rejected"> = {
                      pending: "pending",
                      approved: "approved",
                      rejected: "rejected",
                    };

                    return (
                      <tr key={inv.id} className="hover:bg-primary-50/30 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-xs font-bold flex-shrink-0">
                              {inv.full_name.split(" ").map((n: string) => n[0]).join("").slice(0, 2).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-semibold text-foreground">{inv.full_name}</p>
                              <p className="text-xs text-muted">{profile?.email}</p>
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4 hidden sm:table-cell">
                          <span className="font-mono text-xs text-muted">{inv.investor_code}</span>
                        </td>
                        <td className="py-3 px-4 hidden md:table-cell">
                          {/* Every series they hold a place in, not just
                              the one being filtered on — so somebody in
                              both A and B is visibly in both. */}
                          <div className="flex flex-wrap gap-1">
                            {investorSeries(inv).length === 0 ? (
                              <span className="text-xs text-muted">—</span>
                            ) : (
                              investorSeries(inv).map((name) => (
                                <span
                                  key={name}
                                  className={
                                    name === series
                                      ? "rounded-md bg-primary-100 px-1.5 py-0.5 text-[11px] font-semibold text-primary-800"
                                      : "rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted"
                                  }
                                >
                                  {name}
                                </span>
                              ))
                            )}
                          </div>
                        </td>
                        <td className="py-3 px-4 hidden md:table-cell">
                          <Badge variant={kycVariant[inv.kyc_status] ?? "pending"} dot>
                            {inv.kyc_status.charAt(0).toUpperCase() + inv.kyc_status.slice(1)}
                          </Badge>
                        </td>
                        <td className="py-3 px-4 text-right hidden lg:table-cell">
                          <div>
                            <p className="font-semibold">{formatCurrency(activeCapital)}</p>
                            <p className="text-xs text-muted">{activeInvestments.length} active</p>
                          </div>
                        </td>
                        <td className="py-3 px-4 hidden xl:table-cell text-muted text-xs">
                          {formatDate(inv.created_at)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Link href={`/admin/investors/${inv.id}`}>
                            <div className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium">
                              View <ChevronRight className="h-3.5 w-3.5" />
                            </div>
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
