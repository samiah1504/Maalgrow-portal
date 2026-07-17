import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  TrendingUp,
  DollarSign,
  User,
  CheckCircle2,
  Clock,
  XCircle,
  Building2,
  ShieldCheck,
  PlusCircle,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  SLOT_VALUE_NGN,
  getPaymentStatus,
  paymentStatusColor,
  slotLabel,
} from "@/lib/investment-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import { InvestorActions } from "./_components/investor-actions";
import { AddPaymentDialog } from "./_components/add-payment-dialog";
import { AcknowledgementDownloadButton } from "./_components/acknowledgement-download-button";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Investor Detail | Admin" };

type InvestmentPayment = {
  id: string;
  amount: number;
  payment_date: string;
  reference: string | null;
  created_at: string;
};

type InvestmentFull = {
  id: string;
  investment_code: string;
  units: number;
  price_per_unit: number;
  capital: number;
  declared_profit: number | null;
  investment_date: string;
  maturity_date: string;
  status: string;
  notes: string | null;
  series: { name: string } | null;
  cycle: { cycle_label: string; start_date: string; end_date: string } | null;
  investment_payments: InvestmentPayment[];
};

type InvestorFull = {
  id: string;
  full_name: string;
  investor_code: string;
  email: string;
  phone: string | null;
  address: string | null;
  bank_name: string | null;
  account_name: string | null;
  account_number: string | null;
  bvn: string | null;
  nin: string | null;
  kyc_status: string;
  kyc_notes: string | null;
  invitation_status: string | null;
  invitation_sent_at: string | null;
  created_at: string;
  profile: { id: string; email: string; is_active: boolean } | null;
  investments: InvestmentFull[];
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

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = await createAdminClient();
  const { id } = await params;

  const { data: rawInvestor } = await db
    .from("investors")
    .select(`
      *,
      profile:profiles!profile_id(id, email, is_active),
      investments(
        *,
        series(*),
        cycle:cycles(cycle_label, start_date, end_date),
        investment_payments(*)
      ),
      payment_requests(*)
    `)
    .eq("id", id)
    .single();

  if (!rawInvestor) notFound();

  const investor = rawInvestor as unknown as InvestorFull;

  // Aggregate stats
  const totalCapital = investor.investments.reduce((s, i) => s + i.capital, 0);
  const totalProfitPaid = investor.payment_requests
    .filter((p) => p.type === "roi" && p.status === "paid")
    .reduce((s, p) => s + p.amount, 0);
  const activeCount = investor.investments.filter(
    (i) => i.status === "active"
  ).length;

  const isActive = investor.profile?.is_active !== false;

  const kycVariant: Record<string, "approved" | "pending" | "rejected"> = {
    approved: "approved",
    pending: "pending",
    rejected: "rejected",
  };

  const statusVariant: Record<
    string,
    "active" | "matured" | "completed" | "pending"
  > = {
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
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary-100 text-primary-700 text-xl font-bold flex-shrink-0">
            {investor.full_name.charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold text-foreground">
                {investor.full_name}
              </h1>
              <Badge variant={kycVariant[investor.kyc_status] ?? "pending"}>
                {investor.kyc_status === "approved" ? (
                  <CheckCircle2 className="h-3 w-3" />
                ) : investor.kyc_status === "rejected" ? (
                  <XCircle className="h-3 w-3" />
                ) : (
                  <Clock className="h-3 w-3" />
                )}
                KYC{" "}
                {investor.kyc_status.charAt(0).toUpperCase() +
                  investor.kyc_status.slice(1)}
              </Badge>
              {!isActive && (
                <Badge variant="rejected" dot>
                  Inactive
                </Badge>
              )}
            </div>
            <p className="text-sm font-mono text-muted mt-0.5">
              {investor.investor_code}
            </p>
          </div>
        </div>

        <div className="flex flex-col gap-2 items-start sm:items-end">
          <InvestorActions
            investorId={investor.id}
            investorName={investor.full_name}
            investorEmail={investor.profile?.email ?? investor.email}
            isActive={isActive}
          />
          <Link
            href={`/admin/investors/new?investor_id=${investor.id}`}
            className="inline-flex items-center gap-1.5 text-xs text-primary-600 hover:text-primary-700 font-medium"
          >
            <PlusCircle className="h-3.5 w-3.5" />
            Add Investment
          </Link>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Total Capital"
          value={formatCurrency(totalCapital)}
          accentColor="primary"
          icon={<DollarSign className="h-5 w-5" />}
        />
        <StatCard
          title="Profit Received"
          value={formatCurrency(totalProfitPaid)}
          accentColor="success"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="Active Investments"
          value={String(activeCount)}
          accentColor="success"
          icon={<TrendingUp className="h-5 w-5" />}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Investments with payment detail */}
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">
              Investments ({investor.investments.length})
            </h2>
            <Link href="/admin/investors/new" className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 font-medium">
              <PlusCircle className="h-3.5 w-3.5" />
              Add New Investment
            </Link>
          </div>

          {investor.investments.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-sm text-muted">
                No investments yet.{" "}
                <Link
                  href="/admin/investors/new"
                  className="text-primary-600 hover:underline"
                >
                  Add the first investment →
                </Link>
              </CardContent>
            </Card>
          ) : (
            investor.investments.map((inv) => {
              const totalPaid = inv.investment_payments.reduce(
                (s, p) => s + p.amount,
                0
              );
              const balance = inv.capital - totalPaid;
              const payStatus = getPaymentStatus(inv.capital, totalPaid);

              return (
                <Card key={inv.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <span className="font-mono text-xs text-muted">
                            {inv.investment_code}
                          </span>
                          <Badge
                            variant={statusVariant[inv.status] ?? "pending"}
                            dot
                          >
                            {inv.status.charAt(0).toUpperCase() +
                              inv.status.slice(1)}
                          </Badge>
                          <span
                            className={`text-xs font-semibold px-2 py-0.5 rounded-full ${paymentStatusColor(payStatus)}`}
                          >
                            {payStatus}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-foreground">
                          Series {inv.series?.name} · {inv.cycle?.cycle_label}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <AcknowledgementDownloadButton
                          investorCode={investor.investor_code}
                          fullName={investor.full_name}
                          email={investor.profile?.email ?? investor.email}
                          investment={inv}
                          totalPaid={totalPaid}
                        />
                        <AddPaymentDialog
                          investmentId={inv.id}
                          investmentCode={inv.investment_code}
                          capital={inv.capital}
                          units={inv.units}
                          totalPaid={totalPaid}
                        />
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {/* Allocation summary */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted">Slots</p>
                        <p className="font-semibold">{slotLabel(inv.units)}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Slot value</p>
                        <p className="font-semibold">
                          {formatCurrency(SLOT_VALUE_NGN)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Investment</p>
                        <p className="font-semibold text-foreground">
                          {formatCurrency(inv.capital)}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-muted">Declared Profit</p>
                        {inv.declared_profit != null ? (
                          <p className="font-semibold text-emerald-600">
                            +{formatCurrency(inv.declared_profit)}
                          </p>
                        ) : (
                          <p className="text-xs text-muted">Not yet declared</p>
                        )}
                      </div>
                    </div>

                    {/* Cycle dates */}
                    {inv.cycle && (
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-muted">Cycle start</p>
                          <p className="font-medium">
                            {formatDate(inv.cycle.start_date)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-muted">Matures</p>
                          <p className="font-medium">
                            {formatDate(inv.cycle.end_date)}
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Payment summary */}
                    <div className="rounded-lg bg-surface-2 border border-border p-3 space-y-1.5 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted">Total paid</span>
                        <span className="font-medium text-foreground">
                          {formatCurrency(totalPaid)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted">Outstanding</span>
                        <span
                          className={`font-bold ${
                            balance > 0
                              ? "text-amber-600"
                              : balance === 0
                              ? "text-green-600"
                              : "text-blue-600"
                          }`}
                        >
                          {formatCurrency(Math.max(0, balance))}
                        </span>
                      </div>
                    </div>

                    {/* Individual payment records */}
                    {inv.investment_payments.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-muted mb-2">
                          Payment history
                        </p>
                        <div className="divide-y divide-border border border-border rounded-lg overflow-hidden">
                          {inv.investment_payments
                            .slice()
                            .sort(
                              (a, b) =>
                                new Date(a.payment_date).getTime() -
                                new Date(b.payment_date).getTime()
                            )
                            .map((p, idx) => (
                              <div
                                key={p.id}
                                className="flex items-center justify-between px-3 py-2 bg-white text-sm"
                              >
                                <div>
                                  <span className="text-xs text-muted mr-2">
                                    #{idx + 1}
                                  </span>
                                  <span className="font-medium text-foreground">
                                    {formatCurrency(p.amount)}
                                  </span>
                                  {p.reference && (
                                    <span className="ml-2 text-xs text-muted">
                                      · {p.reference}
                                    </span>
                                  )}
                                </div>
                                <span className="text-xs text-muted">
                                  {formatDate(p.payment_date)}
                                </span>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })
          )}

          {/* Outgoing payment requests (Profit/Capital returns) */}
          {investor.payment_requests.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">
                  Profit & Capital Payment Requests (
                  {investor.payment_requests.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-border">
                  {investor.payment_requests.map((p) => (
                    <div
                      key={p.id}
                      className="flex items-center justify-between px-6 py-3"
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`inline-flex h-7 w-7 items-center justify-center rounded-lg text-xs font-bold ${
                            p.type === "roi"
                              ? "bg-emerald-100 text-emerald-700"
                              : "bg-primary-100 text-primary-700"
                          }`}
                        >
                          {p.type === "roi" ? "P" : "CAP"}
                        </span>
                        <div>
                          <p className="text-sm font-medium text-foreground capitalize">
                            {p.type === "roi" ? "Profit Payment" : "Capital Return"}
                          </p>
                          <p className="text-xs text-muted">
                            {formatDate(p.created_at)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold">
                          {formatCurrency(p.amount)}
                        </p>
                        <p className="text-xs text-muted capitalize">
                          {p.status}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-4">
          {/* Profile card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm flex items-center gap-2">
                <User className="h-4 w-4" /> Profile
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-xs text-muted">Email</p>
                <p className="font-medium text-foreground break-all">
                  {investor.profile?.email ?? investor.email}
                </p>
              </div>
              {investor.phone && (
                <div>
                  <p className="text-xs text-muted">Phone</p>
                  <p className="font-medium text-foreground">{investor.phone}</p>
                </div>
              )}
              {investor.address && (
                <div>
                  <p className="text-xs text-muted">Address</p>
                  <p className="font-medium text-foreground">
                    {investor.address}
                  </p>
                </div>
              )}
              <div>
                <p className="text-xs text-muted">Member Since</p>
                <p className="font-medium text-foreground">
                  {formatDate(investor.created_at)}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted">Account Status</p>
                <Badge variant={isActive ? "approved" : "rejected"} dot>
                  {isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div>
                <p className="text-xs text-muted">KYC Status</p>
                <Badge variant={kycVariant[investor.kyc_status] ?? "pending"}>
                  {investor.kyc_status.charAt(0).toUpperCase() +
                    investor.kyc_status.slice(1)}
                </Badge>
              </div>
              {investor.kyc_notes && (
                <div>
                  <p className="text-xs text-muted">KYC Notes</p>
                  <p className="text-xs text-foreground mt-0.5">
                    {investor.kyc_notes}
                  </p>
                </div>
              )}
              {investor.invitation_status && (
                <div>
                  <p className="text-xs text-muted">Invitation</p>
                  <Badge
                    variant={
                      investor.invitation_status === "sent" || investor.invitation_status === "activated"
                        ? "approved"
                        : investor.invitation_status === "failed" || investor.invitation_status === "expired"
                        ? "rejected"
                        : "pending"
                    }
                    dot
                  >
                    {investor.invitation_status === "not_sent"
                      ? "Not Sent"
                      : investor.invitation_status === "sent"
                      ? "Sent"
                      : investor.invitation_status === "activated"
                      ? "Account Activated"
                      : investor.invitation_status === "expired"
                      ? "Link Expired"
                      : investor.invitation_status === "failed"
                      ? "Delivery Failed"
                      : investor.invitation_status}
                  </Badge>
                  {investor.invitation_sent_at && (
                    <p className="text-xs text-muted mt-0.5">
                      Sent {formatDate(investor.invitation_sent_at)}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Bank details */}
          {(investor.bank_name ||
            investor.account_name ||
            investor.account_number) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <Building2 className="h-4 w-4" /> Bank Details
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {investor.bank_name && (
                  <div>
                    <p className="text-xs text-muted">Bank</p>
                    <p className="font-medium text-foreground">
                      {investor.bank_name}
                    </p>
                  </div>
                )}
                {investor.account_name && (
                  <div>
                    <p className="text-xs text-muted">Account Name</p>
                    <p className="font-medium text-foreground">
                      {investor.account_name}
                    </p>
                  </div>
                )}
                {investor.account_number && (
                  <div>
                    <p className="text-xs text-muted">Account Number</p>
                    <p className="font-mono font-medium text-foreground">
                      {investor.account_number}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* Identity */}
          {(investor.bvn || investor.nin) && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4" /> Identity
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {investor.bvn && (
                  <div>
                    <p className="text-xs text-muted">BVN</p>
                    <p className="font-mono font-medium text-foreground">
                      ••••••••{investor.bvn.slice(-3)}
                    </p>
                  </div>
                )}
                {investor.nin && (
                  <div>
                    <p className="text-xs text-muted">NIN</p>
                    <p className="font-mono font-medium text-foreground">
                      ••••••••{investor.nin.slice(-3)}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
