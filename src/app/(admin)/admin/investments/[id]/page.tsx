import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  DollarSign,
  User,
  FileText,
  RefreshCw,
} from "lucide-react";
import { formatCurrency, formatDate, getDaysUntilMaturity } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Investment Detail | Admin" };

type InvestmentFull = {
  id: string;
  investment_code: string;
  status: string;
  capital: number;
  declared_profit: number | null;
  units: number;
  investment_date: string;
  maturity_date: string;
  notes: string | null;
  created_at: string;
  investor: { id: string; full_name: string; investor_code: string; email: string; phone: string } | null;
  series: { name: string } | null;
  cycle: { cycle_label: string; start_date: string; end_date: string } | null;
  payment_requests: {
    id: string;
    request_code: string;
    type: string;
    amount: number;
    status: string;
    created_at: string;
    paid_at: string | null;
  }[];
  documents: { id: string; title: string; document_type: string; created_at: string }[];
};

export default async function AdminInvestmentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { id } = await params;

  const { data: rawInvestment } = await supabase
    .from("investments")
    .select(
      "*, investor:investors(id, full_name, investor_code, email, phone), series(*), cycle:cycles(*), payment_requests(*), documents(*)"
    )
    .eq("id", id)
    .single();

  if (!rawInvestment) notFound();

  const inv = rawInvestment as unknown as InvestmentFull;

  const daysLeft = getDaysUntilMaturity(inv.maturity_date);

  const statusVariant: Record<string, "active" | "matured" | "completed" | "pending"> = {
    active: "active",
    matured: "matured",
    completed: "completed",
  };

  const paymentStatusVariant: Record<string, "pending" | "approved" | "processing" | "paid" | "rejected"> = {
    pending: "pending",
    approved: "approved",
    processing: "processing",
    paid: "paid",
    rejected: "rejected",
  };

  return (
    <div className="space-y-6 max-w-4xl animate-fade-in">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/investments"
          className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </Link>
        <span className="text-muted">/</span>
        <span className="text-sm font-mono text-muted">{inv.investment_code}</span>
      </div>

      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-foreground">{inv.investment_code}</h1>
            <Badge variant={statusVariant[inv.status] ?? "pending"} dot>
              {inv.status.charAt(0).toUpperCase() + inv.status.slice(1)}
            </Badge>
          </div>
          <p className="text-sm text-muted mt-1">
            Series {inv.series?.name} · {inv.cycle?.cycle_label}
          </p>
        </div>
        {inv.status === "active" && (
          <div className="text-right">
            <p className={`text-2xl font-bold ${daysLeft <= 7 ? "text-gold-600" : "text-foreground"}`}>
              {daysLeft}
            </p>
            <p className="text-xs text-muted">days to maturity</p>
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Main Info */}
        <div className="lg:col-span-2 space-y-4">
          {/* Financial */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <DollarSign className="h-4 w-4" /> Financial Details
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div className="rounded-xl bg-surface-2 p-4">
                  <p className="text-xs text-muted uppercase tracking-wide">Capital</p>
                  <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(inv.capital)}</p>
                </div>
                <div className="rounded-xl bg-surface-2 p-4">
                  <p className="text-xs text-muted uppercase tracking-wide">Declared Profit</p>
                  {inv.declared_profit != null ? (
                    <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(inv.declared_profit)}</p>
                  ) : (
                    <p className="text-sm text-muted mt-1">Not yet declared</p>
                  )}
                </div>
                <div className="rounded-xl bg-surface-2 p-4">
                  <p className="text-xs text-muted uppercase tracking-wide">Units</p>
                  <p className="text-xl font-bold text-foreground mt-1">{inv.units}</p>
                </div>
                <div className="rounded-xl bg-surface-2 p-4">
                  <p className="text-xs text-muted uppercase tracking-wide flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Invested
                  </p>
                  <p className="text-sm font-semibold text-foreground mt-1">{formatDate(inv.investment_date)}</p>
                </div>
                <div className="rounded-xl bg-surface-2 p-4">
                  <p className="text-xs text-muted uppercase tracking-wide flex items-center gap-1">
                    <Calendar className="h-3 w-3" /> Matures
                  </p>
                  <p className={`text-sm font-semibold mt-1 ${inv.status === "active" && daysLeft <= 7 ? "text-gold-600" : "text-foreground"}`}>
                    {formatDate(inv.maturity_date)}
                  </p>
                </div>
              </div>
              {inv.notes && (
                <div className="mt-4 rounded-lg bg-primary-50 border border-primary-100 p-3">
                  <p className="text-xs text-muted mb-1">Notes</p>
                  <p className="text-sm text-foreground">{inv.notes}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Payment Requests */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Payment Requests ({inv.payment_requests.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {inv.payment_requests.length === 0 ? (
                <p className="px-6 py-8 text-center text-sm text-muted">No payment requests yet</p>
              ) : (
                <div className="divide-y divide-border">
                  {inv.payment_requests.map((pr) => (
                    <div key={pr.id} className="flex items-center justify-between px-6 py-3">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${
                            pr.type === "roi" ? "bg-emerald-100 text-emerald-700" : "bg-primary-100 text-primary-700"
                          }`}>
                            {pr.type === "roi" ? "P" : "C"}
                          </span>
                          <span className="text-xs font-mono text-muted">{pr.request_code}</span>
                          <Badge variant={paymentStatusVariant[pr.status] ?? "pending"}>
                            {pr.status.charAt(0).toUpperCase() + pr.status.slice(1)}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted mt-0.5">
                          {pr.paid_at ? `Paid ${formatDate(pr.paid_at)}` : `Requested ${formatDate(pr.created_at)}`}
                        </p>
                      </div>
                      <p className="font-semibold text-foreground">{formatCurrency(pr.amount)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Investor */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4" /> Investor
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-base font-semibold text-foreground">{inv.investor?.full_name}</p>
                <p className="text-xs font-mono text-muted mt-0.5">{inv.investor?.investor_code}</p>
              </div>
              <div className="space-y-1.5 text-sm">
                <div>
                  <p className="text-xs text-muted">Email</p>
                  <p className="font-medium text-foreground">{inv.investor?.email}</p>
                </div>
                {inv.investor?.phone && (
                  <div>
                    <p className="text-xs text-muted">Phone</p>
                    <p className="font-medium text-foreground">{inv.investor.phone}</p>
                  </div>
                )}
              </div>
              {inv.investor?.id && (
                <Link
                  href={`/admin/investors/${inv.investor.id}`}
                  className="block text-center rounded-lg bg-primary-50 text-primary-700 text-xs font-medium py-2 hover:bg-primary-100 transition-colors"
                >
                  View Investor Profile
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Cycle */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <RefreshCw className="h-4 w-4" /> Cycle
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p className="font-medium text-foreground">{inv.cycle?.cycle_label}</p>
              {inv.cycle?.start_date && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">Start</span>
                  <span>{formatDate(inv.cycle.start_date)}</span>
                </div>
              )}
              {inv.cycle?.end_date && (
                <div className="flex justify-between text-xs">
                  <span className="text-muted">End</span>
                  <span>{formatDate(inv.cycle.end_date)}</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Documents */}
          {inv.documents.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileText className="h-4 w-4" /> Documents ({inv.documents.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {inv.documents.map((doc) => (
                  <div key={doc.id} className="flex items-center gap-2 text-xs">
                    <FileText className="h-3.5 w-3.5 text-muted" />
                    <span className="text-foreground">{doc.title}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
