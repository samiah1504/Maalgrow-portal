import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, TrendingUp, DollarSign, User, CheckCircle2, Clock, XCircle } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Investor Detail | Admin" };

type InvestorFull = {
  id: string;
  full_name: string;
  investor_code: string;
  email: string;
  phone: string | null;
  kyc_status: string;
  created_at: string;
  investments: {
    id: string;
    investment_code: string;
    status: string;
    capital: number;
    expected_roi: number;
    maturity_date: string;
    series: { name: string } | null;
    cycle: { cycle_label: string } | null;
  }[];
  payment_requests: {
    id: string;
    type: string;
    amount: number;
    status: string;
    created_at: string;
  }[];
};

export default async function AdminInvestorDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const { data: rawInvestor } = await supabase
    .from("investors")
    .select("*, investments(*, series(*), cycle:cycles(*)), payment_requests(*)")
    .eq("id", id)
    .single();

  if (!rawInvestor) notFound();

  const investor = rawInvestor as unknown as InvestorFull;

  const totalCapital = investor.investments.reduce((s, i) => s + i.capital, 0);
  const totalROIPaid = investor.payment_requests
    .filter((p) => p.type === "roi" && p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  const activeCount = investor.investments.filter((i) => i.status === "active").length;

  const kycVariant: Record<string, "approved" | "pending" | "rejected"> = {
    approved: "approved",
    pending: "pending",
    rejected: "rejected",
  };

  const statusVariant: Record<string, "active" | "matured" | "completed" | "pending"> = {
    active: "active",
    matured: "matured",
    completed: "completed",
  };

  return (
    <div className="space-y-6 max-w-4xl animate-fade-in">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/investors"
          className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Investors
        </Link>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 text-xl font-bold">
            {investor.full_name.charAt(0)}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">{investor.full_name}</h1>
              <Badge variant={kycVariant[investor.kyc_status] ?? "pending"}>
                {investor.kyc_status === "approved" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : investor.kyc_status === "rejected" ? (
                  <XCircle className="h-3 w-3" />
                ) : (
                  <Clock className="h-3 w-3" />
                )}
                KYC {investor.kyc_status.charAt(0).toUpperCase() + investor.kyc_status.slice(1)}
              </Badge>
            </div>
            <p className="text-sm font-mono text-muted mt-0.5">{investor.investor_code}</p>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Capital" value={formatCurrency(totalCapital)} accentColor="primary" icon={<DollarSign className="h-5 w-5" />} />
        <StatCard title="ROI Received" value={formatCurrency(totalROIPaid)} accentColor="gold" icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard title="Active Investments" value={String(activeCount)} accentColor="success" icon={<TrendingUp className="h-5 w-5" />} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Investments */}
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Investments ({investor.investments.length})</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {investor.investments.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted">No investments yet</p>
              ) : (
                <div className="divide-y divide-border">
                  {investor.investments.map((inv) => (
                    <div key={inv.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-xs font-mono text-muted">{inv.investment_code}</span>
                          <Badge variant={statusVariant[inv.status] ?? "pending"} dot>
                            {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted">
                          Series {inv.series?.name} · {inv.cycle?.cycle_label}
                        </p>
                        <p className="text-xs text-muted">Matures {formatDate(inv.maturity_date)}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-foreground">{formatCurrency(inv.capital)}</p>
                        <p className="text-xs text-gold-600">+{formatCurrency(inv.expected_roi)} ROI</p>
                        <Link
                          href={`/admin/investments/${inv.id}`}
                          className="text-xs text-primary-600 hover:underline"
                        >
                          View →
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Profile */}
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4" /> Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted">Email</p>
                <p className="font-medium text-foreground">{investor.email}</p>
              </div>
              {investor.phone && (
                <div>
                  <p className="text-xs text-muted">Phone</p>
                  <p className="font-medium text-foreground">{investor.phone}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted">Member Since</p>
                <p className="font-medium text-foreground">{formatDate(investor.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-muted">KYC Status</p>
                <Badge variant={kycVariant[investor.kyc_status] ?? "pending"}>
                  {investor.kyc_status.charAt(0).toUpperCase() + investor.kyc_status.slice(1)}
                </Badge>
              </div>
            </CardContent>
          </Card>

          {/* Recent Payments */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Recent Payments</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {investor.payment_requests.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-muted">No payments yet</p>
              ) : (
                <div className="divide-y divide-border">
                  {investor.payment_requests.slice(0, 5).map((p) => (
                    <div key={p.id} className="flex items-center justify-between px-4 py-2.5">
                      <div>
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
                          p.type === "roi" ? "bg-gold-100 text-gold-700" : "bg-primary-100 text-primary-700"
                        }`}>
                          {p.type === "roi" ? "R" : "C"}
                        </span>
                        <span className="ml-2 text-xs text-muted">{formatDate(p.created_at)}</span>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-medium">{formatCurrency(p.amount)}</p>
                        <p className="text-xs text-muted capitalize">{p.status}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
