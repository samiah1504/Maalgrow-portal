import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BarChart3, CheckCircle2, TrendingUp } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatCard } from "@/components/ui/stat-card";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Profit History" };

export default async function ROIHistoryPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: investor } = await supabase
    .from("investors")
    .select("id")
    .eq("profile_id", user.id)
    .single();

  if (!investor) redirect("/dashboard");

  type ROIPaymentRow = {
    id: string;
    request_code: string;
    amount: number;
    status: string;
    paid_at: string | null;
    created_at: string;
    investment: { investment_code: string; series: { name: string } | null; cycle: { cycle_label: string } | null } | null;
  };

  const { data: rawROIPayments } = await supabase
    .from("payment_requests")
    .select("*, investment:investments(investment_code, series:series(name), cycle:cycles(cycle_label))")
    .eq("investor_id", investor.id)
    .eq("type", "roi")
    .order("created_at", { ascending: false });

  const roiPayments = rawROIPayments as unknown as ROIPaymentRow[] | null;

  const totalPaid = roiPayments?.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0) ?? 0;
  const totalPending = roiPayments?.filter((p) => ["pending", "approved", "processing"].includes(p.status)).reduce((s, p) => s + p.amount, 0) ?? 0;
  const paidCount = roiPayments?.filter((p) => p.status === "paid").length ?? 0;

  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Profit History</h1>
        <p className="text-sm text-muted mt-1">Track all your Mudārabah profit payments</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Total Profit Received" value={formatCurrency(totalPaid)} accentColor="success" icon={<TrendingUp className="h-5 w-5" />} />
        <StatCard title="Pending Payment" value={formatCurrency(totalPending)} accentColor="info" icon={<BarChart3 className="h-5 w-5" />} />
        <StatCard title="Payments Made" value={String(paidCount)} subtitle="Total disbursements" accentColor="success" icon={<CheckCircle2 className="h-5 w-5" />} />
      </div>

      {!roiPayments || roiPayments.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <TrendingUp className="h-12 w-12 text-border mb-4" />
            <h3 className="font-semibold text-foreground">No profit payments yet</h3>
            <p className="text-sm text-muted mt-1">Profit payments will appear here when investments mature.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">All Profit Payments</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-border">
              {roiPayments.map((p) => {
                const inv = p.investment;
                const statusVariant: Record<string, "pending" | "approved" | "processing" | "paid" | "rejected"> = {
                  pending: "pending", approved: "approved", processing: "processing", paid: "paid", rejected: "rejected",
                };
                return (
                  <div key={p.id} className="flex items-center justify-between px-6 py-4">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-mono text-xs text-muted">{p.request_code}</span>
                        <Badge variant={statusVariant[p.status] ?? "pending"}>
                          {p.status.charAt(0).toUpperCase() + p.status.slice(1)}
                        </Badge>
                      </div>
                      <p className="text-sm font-medium text-foreground">
                        {inv?.investment_code} · Series {inv?.series?.name}
                      </p>
                      <p className="text-xs text-muted">{inv?.cycle?.cycle_label}</p>
                      {p.paid_at && (
                        <p className="text-xs text-success mt-0.5 flex items-center gap-1">
                          <CheckCircle2 className="h-3 w-3" />
                          Paid {formatDate(p.paid_at)}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-lg font-bold text-emerald-600">{formatCurrency(p.amount)}</p>
                      <p className="text-xs text-muted">{formatDate(p.created_at)}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
