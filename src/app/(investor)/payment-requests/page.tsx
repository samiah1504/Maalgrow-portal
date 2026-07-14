import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { CreditCard, CheckCircle2, Clock, XCircle } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Payment Requests" };

const statusConfig: Record<string, { label: string; icon: React.ReactNode; variant: "pending" | "approved" | "processing" | "paid" | "rejected" }> = {
  pending: { label: "Pending Review", icon: <Clock className="h-3.5 w-3.5" />, variant: "pending" },
  approved: { label: "Approved", icon: <CheckCircle2 className="h-3.5 w-3.5" />, variant: "approved" },
  processing: { label: "Processing", icon: <Clock className="h-3.5 w-3.5" />, variant: "processing" },
  paid: { label: "Paid", icon: <CheckCircle2 className="h-3.5 w-3.5" />, variant: "paid" },
  rejected: { label: "Rejected", icon: <XCircle className="h-3.5 w-3.5" />, variant: "rejected" },
};

export default async function PaymentRequestsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: investor } = await supabase
    .from("investors")
    .select("id")
    .eq("profile_id", user.id)
    .single();

  if (!investor) redirect("/dashboard");

  type PaymentRequestRow = {
    id: string;
    request_code: string;
    type: string;
    amount: number;
    status: string;
    bank_name: string;
    account_name: string;
    account_number: string;
    paid_at: string | null;
    rejection_reason: string | null;
    created_at: string;
    investment: {
      investment_code: string;
      series: { name: string } | null;
      cycle: { cycle_label: string } | null;
    } | null;
  };

  const { data: rawRequests } = await supabase
    .from("payment_requests")
    .select("*, investment:investments(investment_code, series:series(name), cycle:cycles(cycle_label))")
    .eq("investor_id", investor.id)
    .order("created_at", { ascending: false });

  const requests = rawRequests as unknown as PaymentRequestRow[] | null;

  const pending = requests?.filter((r) => ["pending", "approved", "processing"].includes(r.status)) ?? [];
  const completed = requests?.filter((r) => ["paid", "rejected"].includes(r.status)) ?? [];

  const totalPaid = requests
    ?.filter((r) => r.status === "paid")
    .reduce((sum, r) => sum + (r.amount || 0), 0) ?? 0;

  const totalPending = requests
    ?.filter((r) => ["pending", "approved", "processing"].includes(r.status))
    .reduce((sum, r) => sum + (r.amount || 0), 0) ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Payment Requests</h1>
        <p className="text-sm text-muted mt-1">Track all your ROI and capital payment requests</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted uppercase tracking-wide">Pending Amount</p>
          <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalPending)}</p>
          <p className="text-xs text-muted mt-0.5">{pending.length} request{pending.length !== 1 ? "s" : ""}</p>
        </div>
        <div className="rounded-xl border border-border bg-surface p-4">
          <p className="text-xs text-muted uppercase tracking-wide">Total Received</p>
          <p className="text-xl font-bold text-success mt-1">{formatCurrency(totalPaid)}</p>
          <p className="text-xs text-muted mt-0.5">Lifetime payments</p>
        </div>
      </div>

      {requests?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <CreditCard className="h-12 w-12 text-border mb-4" />
            <h3 className="font-semibold text-foreground">No payment requests yet</h3>
            <p className="text-sm text-muted mt-1">
              Payment requests are created when you submit your maturity decision.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {pending.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">In Progress</h2>
              <div className="space-y-3">
                {pending.map((req) => (
                  <PaymentRequestCard key={req.id} request={req} />
                ))}
              </div>
            </section>
          )}
          {completed.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3">History</h2>
              <div className="space-y-3">
                {completed.map((req) => (
                  <PaymentRequestCard key={req.id} request={req} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function PaymentRequestCard({ request }: {
  request: {
    id: string;
    request_code: string;
    type: string;
    amount: number;
    status: string;
    bank_name: string;
    account_name: string;
    account_number: string;
    paid_at: string | null;
    rejection_reason: string | null;
    created_at: string;
    investment: {
      investment_code: string;
      series: { name: string } | null;
      cycle: { cycle_label: string } | null;
    } | null;
  };
}) {
  const config = statusConfig[request.status] ?? statusConfig.pending;

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold ${
              request.type === "roi" ? "bg-gold-100 text-gold-700" : "bg-primary-100 text-primary-700"
            }`}>
              {request.type === "roi" ? "R" : "C"}
            </span>
            <span className="text-sm font-semibold text-foreground capitalize">
              {request.type} Payment
            </span>
          </div>
          <p className="text-xs text-muted mt-0.5 font-mono">{request.request_code}</p>
        </div>
        <Badge variant={config.variant}>
          {config.icon}
          {config.label}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 text-xs">
        <div>
          <p className="text-muted">Amount</p>
          <p className="font-bold text-lg text-foreground">{formatCurrency(request.amount)}</p>
        </div>
        <div>
          <p className="text-muted">Investment</p>
          <p className="font-medium">{request.investment?.investment_code ?? "-"}</p>
          <p className="text-muted">{request.investment?.cycle?.cycle_label}</p>
        </div>
        <div>
          <p className="text-muted">Bank</p>
          <p className="font-medium">{request.bank_name}</p>
          <p className="text-muted">{request.account_number}</p>
        </div>
        <div>
          <p className="text-muted">
            {request.status === "paid" ? "Paid On" : "Requested On"}
          </p>
          <p className="font-medium">
            {formatDate(request.paid_at ?? request.created_at)}
          </p>
        </div>
      </div>

      {request.rejection_reason && (
        <div className="mt-3 rounded-lg bg-red-50 border border-red-100 p-2.5">
          <p className="text-xs text-red-700">
            <span className="font-semibold">Rejected:</span> {request.rejection_reason}
          </p>
        </div>
      )}
    </div>
  );
}
