import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  TrendingUp,
  Calendar,
  DollarSign,
  FileText,
  ChevronRight,
  AlertCircle,
} from "lucide-react";
import { formatCurrency, formatDate, getDaysUntilMaturity } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "My Investments" };

const statusBadge = {
  active: "active",
  matured: "matured",
  completed: "completed",
} as const;

export default async function InvestmentsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: investor } = await supabase
    .from("investors")
    .select("id")
    .eq("profile_id", user.id)
    .single();

  if (!investor) redirect("/dashboard");

  type InvestmentRow = {
    id: string;
    investment_code: string;
    status: string;
    capital: number;
    expected_roi: number;
    units: number;
    investment_date: string;
    maturity_date: string;
    series: { name: string } | null;
    cycle: { cycle_label: string } | null;
  };

  const { data: rawInvestments } = await supabase
    .from("investments")
    .select("*, series(*), cycle:cycles(*)")
    .eq("investor_id", investor.id)
    .order("created_at", { ascending: false });

  const investments = rawInvestments as unknown as InvestmentRow[] | null;

  const active = investments?.filter((i) => i.status === "active") ?? [];
  const matured = investments?.filter((i) => i.status === "matured") ?? [];
  const completed = investments?.filter((i) => i.status === "completed") ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">My Investments</h1>
        <p className="text-muted text-sm mt-1">All your MaalGrow investments across all series</p>
      </div>

      {/* Matured — Action Required Banner */}
      {matured.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-gold-400 bg-gold-50 p-4">
          <AlertCircle className="h-5 w-5 text-gold-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-gold-800">
              {matured.length} investment{matured.length !== 1 ? "s" : ""} require your attention
            </p>
            <p className="text-sm text-gold-700 mt-0.5">
              Please submit your maturity decision for each matured investment below.
            </p>
          </div>
        </div>
      )}

      {investments?.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <TrendingUp className="h-12 w-12 text-border mb-4" />
            <h3 className="font-semibold text-foreground">No investments yet</h3>
            <p className="text-sm text-muted mt-1 max-w-sm">
              Your investments will appear here once created by the MaalVest team.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Matured Investments */}
          {matured.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-gold-500" />
                Matured — Decision Required ({matured.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {matured.map((inv) => (
                  <InvestmentCard key={inv.id} investment={inv} urgent />
                ))}
              </div>
            </section>
          )}

          {/* Active Investments */}
          {active.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-emerald-500" />
                Active Investments ({active.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {active.map((inv) => (
                  <InvestmentCard key={inv.id} investment={inv} />
                ))}
              </div>
            </section>
          )}

          {/* Completed Investments */}
          {completed.length > 0 && (
            <section>
              <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-primary-400" />
                Completed ({completed.length})
              </h2>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {completed.map((inv) => (
                  <InvestmentCard key={inv.id} investment={inv} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function InvestmentCard({
  investment,
  urgent,
}: {
  investment: {
    id: string;
    investment_code: string;
    status: string;
    capital: number;
    expected_roi: number;
    units: number;
    investment_date: string;
    maturity_date: string;
    series?: { name: string } | null;
    cycle?: { cycle_label: string } | null;
  };
  urgent?: boolean;
}) {
  const daysLeft = getDaysUntilMaturity(investment.maturity_date);

  const seriesColors: Record<string, string> = {
    A: "bg-primary-100 text-primary-700",
    B: "bg-gold-100 text-gold-700",
    C: "bg-blue-100 text-blue-700",
  };

  return (
    <Card
      className={`hover:border-primary-300 transition-all card-hover ${
        urgent ? "border-gold-300 bg-gold-50/50" : ""
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div
              className={`flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold ${
                seriesColors[investment.series?.name ?? "A"]
              }`}
            >
              {investment.series?.name}
            </div>
            <div>
              <p className="text-xs font-mono text-muted">{investment.investment_code}</p>
              <CardTitle className="text-sm mt-0.5">Series {investment.series?.name}</CardTitle>
            </div>
          </div>
          <Badge variant={statusBadge[investment.status as keyof typeof statusBadge] ?? "default"} dot>
            {investment.status.charAt(0).toUpperCase() + investment.status.slice(1)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted">{investment.cycle?.cycle_label}</div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-lg bg-surface-2 p-2.5">
            <p className="text-[10px] text-muted uppercase tracking-wide">Capital</p>
            <p className="text-sm font-bold text-foreground mt-0.5">{formatCurrency(investment.capital)}</p>
          </div>
          <div className="rounded-lg bg-surface-2 p-2.5">
            <p className="text-[10px] text-muted uppercase tracking-wide">Expected ROI</p>
            <p className="text-sm font-bold text-gold-600 mt-0.5">{formatCurrency(investment.expected_roi)}</p>
          </div>
        </div>

        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between text-muted">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Invested
            </span>
            <span className="font-medium text-foreground">{formatDate(investment.investment_date)}</span>
          </div>
          <div className="flex justify-between text-muted">
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Matures
            </span>
            <span
              className={`font-medium ${
                daysLeft <= 7 && investment.status === "active"
                  ? "text-gold-600"
                  : "text-foreground"
              }`}
            >
              {formatDate(investment.maturity_date)}
            </span>
          </div>
          <div className="flex justify-between text-muted">
            <span className="flex items-center gap-1">
              <DollarSign className="h-3 w-3" /> Units
            </span>
            <span className="font-medium text-foreground">{investment.units}</span>
          </div>
        </div>

        <div className="flex gap-2 pt-1">
          <Link href={`/investments/${investment.id}`} className="flex-1">
            <Button
              variant={urgent ? "secondary" : "outline"}
              size="sm"
              className="w-full text-xs"
            >
              {urgent ? "Submit Decision" : "View Details"}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </Link>
          <Button variant="ghost" size="icon-sm" className="flex-shrink-0">
            <FileText className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
