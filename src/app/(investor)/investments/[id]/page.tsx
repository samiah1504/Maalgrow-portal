import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Calendar, DollarSign, FileText, Clock, TrendingUp, CheckCircle2 } from "lucide-react";
import { formatCurrency, formatDate, getDaysUntilMaturity } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MaturityInstructions } from "./investment-detail-client";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Investment Details" };

export default async function InvestmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: investor } = await supabase
    .from("investors")
    .select("*")
    .eq("profile_id", user.id)
    .single();

  if (!investor) redirect("/dashboard");

  type InvestmentFull = {
    id: string;
    investment_code: string;
    capital: number;
    declared_profit: number | null;
    units: number;
    price_per_unit: number;
    investment_date: string;
    maturity_date: string;
    status: "active" | "matured" | "completed";
    maturity_decision: "continue" | "exit" | "rollover_all" | null;
    next_investment_id: string | null;
    parent_investment_id: string | null;
    rollover_balance?: number;
    series: { id: string; name: "A" | "B" | "C" } | null;
    cycle: {
      id: string;
      cycle_label: string;
      start_date: string;
      end_date: string;
      rollover_deadline?: string | null;
    } | null;
  };
  type LinkedInvestment = { investment_code: string; status: string; cycle: { cycle_label: string } | null };

  const { data: rawInvestment } = await supabase
    .from("investments")
    .select("*, series(*), cycle:cycles(*)")
    .eq("id", id)
    .eq("investor_id", investor.id)
    .single();

  const investment = rawInvestment as unknown as InvestmentFull | null;

  if (!investment) notFound();

  // Get payment requests for this investment
  const { data: paymentRequests } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("investment_id", id)
    .order("created_at", { ascending: false });

  // Payments made into this investment (RLS: investor sees only their own).
  // select("*") + normalisation keeps this working even if the app is
  // deployed before migration 014 adds the status/units columns.
  const { data: rawMyPayments } = await supabase
    .from("investment_payments")
    .select("*")
    .eq("investment_id", id)
    .order("payment_date", { ascending: true });
  const myPayments = (rawMyPayments ?? []).map((p) => ({
    ...p,
    status: p.status ?? "confirmed",
    units: p.units ?? 0,
  }));
  const confirmedPaid = myPayments
    .filter((p) => p.status === "confirmed")
    .reduce((s, p) => s + p.amount, 0);

  // Get documents
  const { data: documents } = await supabase
    .from("documents")
    .select("*")
    .eq("investment_id", id)
    .eq("is_visible_to_investor", true);

  // Get linked investments (continuation chain)
  const { data: rawNextInvestment } = investment.next_investment_id
    ? await supabase
        .from("investments")
        .select("investment_code, status, cycle:cycles(cycle_label)")
        .eq("id", investment.next_investment_id)
        .single()
    : { data: null };
  const nextInvestment = rawNextInvestment as unknown as LinkedInvestment | null;

  const { data: rawParentInvestment } = investment.parent_investment_id
    ? await supabase
        .from("investments")
        .select("investment_code, status, cycle:cycles(cycle_label)")
        .eq("id", investment.parent_investment_id)
        .single()
    : { data: null };
  const parentInvestment = rawParentInvestment as unknown as LinkedInvestment | null;

  // Saved maturity instruction (RLS: investor sees only their own)
  const { data: savedInstructionRaw } = await supabase
    .from("rollover_decisions")
    .select("decision, slots_to_withdraw, locked")
    .eq("investment_id", id)
    .maybeSingle();
  const savedInstruction = savedInstructionRaw as {
    decision: string;
    slots_to_withdraw: number | null;
    locked: boolean;
  } | null;

  const daysLeft = getDaysUntilMaturity(investment.maturity_date);
  const isMatured = investment.status === "matured";

  // Visibility rule: completely hidden during the cycle; appears only in
  // the final 5 days before maturity, and stays visible (locked) once the
  // investment has matured until it is settled.
  const showMaturityInstructions =
    (investment.status === "active" && daysLeft <= 5) || isMatured;
  const totalDays = Math.ceil(
    (new Date(investment.maturity_date).getTime() - new Date(investment.investment_date).getTime()) /
      (1000 * 60 * 60 * 24)
  );
  const elapsedDays = totalDays - daysLeft;
  const progress = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));

  const statusVariant = {
    active: "active",
    matured: "matured",
    completed: "completed",
  }[investment.status] as "active" | "matured" | "completed";

  const seriesColors: Record<string, string> = {
    A: "bg-primary-100 text-primary-700",
    B: "bg-gold-100 text-gold-700",
    C: "bg-blue-100 text-blue-700",
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-4xl">
      {/* Back + Header */}
      <div className="flex items-start gap-4">
        <Link
          href="/investments"
          className="mt-1 rounded-lg p-2 text-muted hover:bg-primary-50 hover:text-primary-700 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <span className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${seriesColors[investment.series?.name ?? "A"]}`}>
              {investment.series?.name}
            </span>
            <span className="font-mono text-sm text-muted">{investment.investment_code}</span>
            <Badge variant={statusVariant} dot>
              {investment.status.charAt(0).toUpperCase() + investment.status.slice(1)}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold text-foreground">
            MaalGrow Series {investment.series?.name}
          </h1>
          <p className="text-muted text-sm">{investment.cycle?.cycle_label}</p>
        </div>
      </div>

      {/* Maturity Instructions — hidden until the final 5 days of the
          cycle, then editable until maturity, then locked */}
      {showMaturityInstructions && (
        <MaturityInstructions
          investment={{
            id: investment.id,
            investment_code: investment.investment_code,
            units: investment.units,
            capital: investment.capital,
            declared_profit: investment.declared_profit,
            status: investment.status,
            maturity_date: investment.maturity_date,
            series: investment.series ?? undefined,
            cycle: investment.cycle ?? undefined,
          }}
          savedInstruction={savedInstruction}
          investorBank={{
            bank_name: investor.bank_name,
            account_name: investor.account_name,
            account_number: investor.account_number,
          }}
        />
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <DollarSign className="h-5 w-5 text-primary-600 mx-auto mb-1" />
          <p className="text-[10px] text-muted uppercase tracking-wide">Capital</p>
          <p className="text-lg font-bold text-foreground mt-0.5">{formatCurrency(investment.capital)}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <TrendingUp className="h-5 w-5 text-emerald-500 mx-auto mb-1" />
          <p className="text-[10px] text-muted uppercase tracking-wide">Declared Profit</p>
          {investment.declared_profit != null ? (
            <p className="text-lg font-bold text-emerald-600 mt-0.5">{formatCurrency(investment.declared_profit)}</p>
          ) : (
            <p className="text-xs text-muted mt-1">Declared at maturity</p>
          )}
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <FileText className="h-5 w-5 text-primary-600 mx-auto mb-1" />
          <p className="text-[10px] text-muted uppercase tracking-wide">Units</p>
          <p className="text-lg font-bold text-foreground mt-0.5">{investment.units}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4 text-center">
          <Clock className="h-5 w-5 text-primary-600 mx-auto mb-1" />
          <p className="text-[10px] text-muted uppercase tracking-wide">
            {investment.status === "active" ? "Days Left" : "Status"}
          </p>
          <p className={`text-lg font-bold mt-0.5 ${investment.status === "active" && daysLeft <= 7 ? "text-gold-600" : "text-foreground"}`}>
            {investment.status === "active" ? daysLeft : investment.status.charAt(0).toUpperCase() + investment.status.slice(1)}
          </p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Investment Timeline */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Calendar className="h-4 w-4 text-primary-600" />
              Investment Timeline
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex justify-between text-sm">
              <div>
                <p className="text-[10px] text-muted uppercase tracking-wide">Start Date</p>
                <p className="font-semibold text-foreground">{formatDate(investment.investment_date)}</p>
              </div>
              <div className="text-right">
                <p className="text-[10px] text-muted uppercase tracking-wide">Maturity Date</p>
                <p className="font-semibold text-foreground">{formatDate(investment.maturity_date)}</p>
              </div>
            </div>

            {/* Progress Bar */}
            <div>
              <div className="flex justify-between text-xs text-muted mb-1.5">
                <span>Investment Progress</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-primary-500 to-gold-500 rounded-full transition-all duration-500"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-muted mt-1">
                {investment.status === "active"
                  ? `${daysLeft} days remaining of ${totalDays} day cycle`
                  : `Cycle completed after ${totalDays} days`}
              </p>
            </div>

            <div className="space-y-2 text-sm border-t border-border pt-3">
              <div className="flex justify-between">
                <span className="text-muted">Price per Unit</span>
                <span className="font-semibold">{formatCurrency(investment.price_per_unit)}</span>
              </div>
              {investment.maturity_decision && (
                <div className="flex justify-between">
                  <span className="text-muted">Decision</span>
                  <span className="font-semibold capitalize">{investment.maturity_decision}</span>
                </div>
              )}
            </div>

            {/* Investment Chain */}
            {(parentInvestment || nextInvestment) && (
              <div className="border-t border-border pt-3 space-y-2">
                {parentInvestment && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>Continued from:</span>
                    <span className="font-mono font-medium text-primary-600">
                      {parentInvestment.investment_code}
                    </span>
                  </div>
                )}
                {nextInvestment && (
                  <div className="flex items-center gap-2 text-xs text-muted">
                    <span>Rolled into:</span>
                    <span className="font-mono font-medium text-primary-600">
                      {nextInvestment.investment_code}
                    </span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Payment Requests */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <DollarSign className="h-4 w-4 text-primary-600" />
              Payment Requests
            </CardTitle>
          </CardHeader>
          <CardContent>
            {paymentRequests && paymentRequests.length > 0 ? (
              <div className="space-y-3">
                {paymentRequests.map((pr) => {
                  const statusVariantMap: Record<string, string> = {
                    pending: "pending",
                    approved: "approved",
                    processing: "processing",
                    paid: "paid",
                    rejected: "rejected",
                  };
                  return (
                    <div key={pr.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div>
                          <span className="text-xs font-mono text-muted">{pr.request_code}</span>
                          <p className="text-sm font-semibold">
                          {pr.type === "roi" ? "Profit" : "Capital"} Payment
                        </p>
                        </div>
                        <Badge variant={statusVariantMap[pr.status] as "pending" | "approved" | "processing" | "paid" | "rejected"}>
                          {pr.status.charAt(0).toUpperCase() + pr.status.slice(1)}
                        </Badge>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted">{pr.bank_name} · {pr.account_number}</span>
                        <span className="text-sm font-bold text-foreground">{formatCurrency(pr.amount)}</span>
                      </div>
                      {pr.paid_at && (
                        <p className="text-xs text-success mt-1 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Paid on {formatDate(pr.paid_at)}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <DollarSign className="h-8 w-8 text-border mx-auto mb-2" />
                <p className="text-sm text-muted">No payment requests yet</p>
                {isMatured && (
                  <p className="text-xs text-muted mt-1">Submit your maturity decision above to create one.</p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* My Payments — capital paid into this investment */}
      {myPayments && myPayments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-primary-600" />
              My Payments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
              {myPayments.map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 bg-white text-sm"
                >
                  <div className="min-w-0">
                    <span
                      className={`font-semibold ${
                        p.status === "reversed" || p.status === "rejected"
                          ? "text-muted line-through"
                          : "text-foreground"
                      }`}
                    >
                      {formatCurrency(p.amount)}
                    </span>
                    {p.units > 0 && (
                      <span className="ml-2 text-xs text-muted">
                        {p.units} slot{p.units === 1 ? "" : "s"}
                      </span>
                    )}
                    <span
                      className={`ml-2 text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded-full ${
                        p.status === "confirmed"
                          ? "bg-green-50 text-green-700"
                          : p.status === "pending"
                          ? "bg-amber-50 text-amber-700"
                          : "bg-red-50 text-red-600"
                      }`}
                    >
                      {p.status}
                    </span>
                    {p.reference && (
                      <span className="ml-2 text-xs text-muted">· {p.reference}</span>
                    )}
                  </div>
                  <span className="text-xs text-muted flex-shrink-0">
                    {formatDate(p.payment_date)}
                  </span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm mt-3 px-1">
              <span className="text-muted">Total confirmed payments</span>
              <span className="font-bold text-foreground">
                {formatCurrency(confirmedPaid)}
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Documents */}
      {documents && documents.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <FileText className="h-4 w-4 text-primary-600" />
              Documents
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {documents.map((doc) => (
                <a
                  key={doc.id}
                  href={`/api/documents/${doc.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border p-3 hover:border-primary-200 hover:bg-primary-50/30 transition-all"
                >
                  <FileText className="h-5 w-5 text-primary-600 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{doc.name}</p>
                    <p className="text-xs text-muted capitalize">{doc.type}</p>
                  </div>
                </a>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
