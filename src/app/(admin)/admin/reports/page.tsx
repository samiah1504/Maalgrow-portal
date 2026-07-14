import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { BarChart3, TrendingUp, DollarSign, Users, Download } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Reports | Admin" };

type SeriesReport = {
  name: string;
  roi_rate: number;
  investments: { capital: number; status: string; expected_roi: number }[];
};

type PaymentSummary = {
  type: string;
  status: string;
  amount: number;
};

export default async function AdminReportsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { count: totalInvestors },
    { count: totalInvestments },
    { data: rawSeries },
    { data: rawPayments },
  ] = await Promise.all([
    supabase.from("investors").select("*", { count: "exact", head: true }),
    supabase.from("investments").select("*", { count: "exact", head: true }),
    supabase.from("series").select("name, roi_rate, investments(capital, status, expected_roi)"),
    supabase.from("payment_requests").select("type, status, amount"),
  ]);

  const seriesData = rawSeries as unknown as SeriesReport[] | null;
  const paymentsData = rawPayments as unknown as PaymentSummary[] | null;

  const totalCapital = seriesData?.flatMap((s) => s.investments).reduce((sum, i) => sum + i.capital, 0) ?? 0;
  const totalROIPaid = paymentsData?.filter((p) => p.type === "roi" && p.status === "paid").reduce((s, p) => s + p.amount, 0) ?? 0;
  const totalROIPending = paymentsData?.filter((p) => p.type === "roi" && ["pending", "approved", "processing"].includes(p.status)).reduce((s, p) => s + p.amount, 0) ?? 0;
  const totalCapitalReturned = paymentsData?.filter((p) => p.type === "capital" && p.status === "paid").reduce((s, p) => s + p.amount, 0) ?? 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Reports</h1>
          <p className="text-sm text-muted mt-1">Financial overview and performance analytics</p>
        </div>
        <button className="flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-2 transition-colors">
          <Download className="h-4 w-4" />
          Export CSV
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Investors"
          value={String(totalInvestors ?? 0)}
          accentColor="primary"
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title="Total Capital"
          value={formatCurrency(totalCapital)}
          accentColor="gold"
          icon={<DollarSign className="h-5 w-5" />}
        />
        <StatCard
          title="ROI Disbursed"
          value={formatCurrency(totalROIPaid)}
          accentColor="success"
          icon={<TrendingUp className="h-5 w-5" />}
        />
        <StatCard
          title="ROI Pending"
          value={formatCurrency(totalROIPending)}
          accentColor="info"
          icon={<BarChart3 className="h-5 w-5" />}
        />
      </div>

      {/* Series Breakdown */}
      <div className="grid gap-4 sm:grid-cols-3">
        {seriesData?.map((s) => {
          const seriesCapital = s.investments.reduce((sum, i) => sum + i.capital, 0);
          const seriesROI = s.investments.reduce((sum, i) => sum + i.expected_roi, 0);
          const activeCount = s.investments.filter((i) => i.status === "active").length;
          const maturedCount = s.investments.filter((i) => i.status === "matured").length;
          const completedCount = s.investments.filter((i) => i.status === "completed").length;

          const seriesColor: Record<string, string> = {
            A: "from-primary-500 to-primary-600",
            B: "from-gold-500 to-gold-600",
            C: "from-blue-500 to-blue-600",
          };

          return (
            <Card key={s.name}>
              <CardHeader className="pb-3">
                <div className="flex items-center gap-2">
                  <div className={`flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br ${seriesColor[s.name] ?? "from-gray-500 to-gray-600"} text-sm font-black text-white`}>
                    {s.name}
                  </div>
                  <div>
                    <CardTitle className="text-sm">Series {s.name}</CardTitle>
                    <p className="text-xs text-muted">{(s.roi_rate * 100).toFixed(1)}% ROI rate</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-xs text-muted">Total Capital</p>
                  <p className="text-lg font-bold text-foreground">{formatCurrency(seriesCapital)}</p>
                </div>
                <div>
                  <p className="text-xs text-muted">Expected ROI</p>
                  <p className="text-base font-semibold text-gold-600">{formatCurrency(seriesROI)}</p>
                </div>
                <div className="border-t border-border pt-3 space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted">Active</span>
                    <span className="font-medium text-emerald-600">{activeCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Matured</span>
                    <span className="font-medium text-gold-600">{maturedCount}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">Completed</span>
                    <span className="font-medium text-primary-600">{completedCount}</span>
                  </div>
                  <div className="flex justify-between font-semibold border-t border-border pt-1.5">
                    <span>Total</span>
                    <span>{s.investments.length}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Payment Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Payment Summary</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "ROI Paid", value: totalROIPaid, color: "text-emerald-600" },
              { label: "ROI Pending", value: totalROIPending, color: "text-gold-600" },
              { label: "Capital Returned", value: totalCapitalReturned, color: "text-primary-600" },
              { label: "Net Obligations", value: totalROIPending + (totalCapital - totalCapitalReturned), color: "text-red-600" },
            ].map((item) => (
              <div key={item.label} className="rounded-xl bg-surface-2 p-4">
                <p className="text-xs text-muted uppercase tracking-wide">{item.label}</p>
                <p className={`text-lg font-bold mt-1 ${item.color}`}>{formatCurrency(item.value)}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
