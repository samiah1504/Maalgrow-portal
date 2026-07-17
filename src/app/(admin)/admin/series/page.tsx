import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Layers, ChevronRight, TrendingUp, Users, Calendar } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SLOT_VALUE_NGN } from "@/lib/investment-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Series Management" };

export default async function SeriesPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  type CycleRow = {
    id: string;
    cycle_number: number;
    cycle_label: string;
    start_date: string;
    end_date: string;
    status: string;
    total_capital: number;
    total_investors: number;
  };
  type SeriesWithCycles = {
    id: string;
    name: "A" | "B" | "C";
    description: string | null;
    mudarabah_investor_ratio: number;
    price_per_unit: number;
    is_active: boolean;
    cycles: CycleRow[];
  };

  const { data: rawSeries } = await supabase
    .from("series")
    .select(`
      *,
      cycles(
        id, cycle_number, cycle_label, start_date, end_date, status,
        total_capital, total_investors
      )
    `)
    .order("name");

  const series = rawSeries as unknown as SeriesWithCycles[] | null;

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Series Management</h1>
        <p className="text-sm text-muted mt-1">
          Manage MaalGrow Series A, B, and C — all permanently active
        </p>
      </div>

      {/* Series info box */}
      <div className="rounded-xl bg-primary-50 border border-primary-100 p-4 text-sm text-primary-700">
        <p className="font-semibold mb-1">MaalGrow Series Structure</p>
        <ul className="space-y-1 text-xs text-primary-600">
          <li>• <strong>Series A</strong>: Cycles Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec</li>
          <li>• <strong>Series B</strong>: Cycles Feb–Apr, May–Jul, Aug–Oct, Nov–Jan</li>
          <li>• <strong>Series C</strong>: Cycles Mar–May, Jun–Aug, Sep–Nov, Dec–Feb</li>
          <li>• Each cycle is exactly 3 months. Series never close.</li>
        </ul>
      </div>

      <div className="grid gap-6">
        {series?.map((s) => {
          const cycles = s.cycles ?? [];
          const activeCycle = cycles.find((c) => c.status === "active");
          const upcomingCycle = cycles.find((c) => c.status === "upcoming");
          const totalCycles = cycles.length;
          const completedCycles = cycles.filter((c) => c.status === "completed").length;

          const seriesColors = {
            A: { bg: "bg-primary-700", light: "bg-primary-50", text: "text-primary-700", border: "border-primary-200" },
            B: { bg: "bg-gold-500", light: "bg-gold-50", text: "text-gold-700", border: "border-gold-200" },
            C: { bg: "bg-blue-700", light: "bg-blue-50", text: "text-blue-700", border: "border-blue-200" },
          }[s.name] ?? { bg: "bg-gray-700", light: "bg-gray-50", text: "text-gray-700", border: "border-gray-200" };

          return (
            <Card key={s.id}>
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${seriesColors.bg} text-white text-xl font-black`}>
                      {s.name}
                    </div>
                    <div>
                      <CardTitle>MaalGrow Series {s.name}</CardTitle>
                      <p className="text-sm text-muted mt-0.5">{s.description}</p>
                    </div>
                  </div>
                  <Badge variant={s.is_active ? "active" : "default"} dot>
                    {s.is_active ? "Active" : "Inactive"}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Series Stats */}
                <div className="grid grid-cols-3 gap-3">
                  <div className={`rounded-lg ${seriesColors.light} ${seriesColors.border} border p-3 text-center`}>
                    <p className={`text-lg font-bold ${seriesColors.text}`}>
                      {(s.mudarabah_investor_ratio * 100).toFixed(0)}%
                    </p>
                    <p className="text-xs text-muted mt-0.5">investor ratio</p>
                  </div>
                  <div className={`rounded-lg ${seriesColors.light} ${seriesColors.border} border p-3 text-center`}>
                    <p className={`text-lg font-bold ${seriesColors.text}`}>
                      {formatCurrency(SLOT_VALUE_NGN)}
                    </p>
                    <p className="text-xs text-muted mt-0.5">per slot</p>
                  </div>
                  <div className={`rounded-lg ${seriesColors.light} ${seriesColors.border} border p-3 text-center`}>
                    <p className={`text-lg font-bold ${seriesColors.text}`}>{totalCycles}</p>
                    <p className="text-xs text-muted mt-0.5">total cycles</p>
                  </div>
                </div>

                {/* Active Cycle */}
                {activeCycle && (
                  <div className="rounded-xl border border-border bg-surface p-4">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-foreground">Current Cycle</p>
                      <Badge variant="active" dot>Active</Badge>
                    </div>
                    <p className="text-base font-bold text-foreground">{activeCycle.cycle_label}</p>
                    <div className="grid grid-cols-3 gap-3 mt-3 text-xs text-muted">
                      <div>
                        <p className="text-muted">Start</p>
                        <p className="font-medium text-foreground">{formatDate(activeCycle.start_date)}</p>
                      </div>
                      <div>
                        <p className="text-muted">End</p>
                        <p className="font-medium text-foreground">{formatDate(activeCycle.end_date)}</p>
                      </div>
                      <div>
                        <p className="text-muted">Investors</p>
                        <p className="font-medium text-foreground">{activeCycle.total_investors}</p>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-xs text-muted">Total Capital</span>
                      <span className="text-sm font-bold text-foreground">{formatCurrency(activeCycle.total_capital)}</span>
                    </div>
                  </div>
                )}

                {/* Upcoming Cycle */}
                {upcomingCycle && (
                  <div className="rounded-xl border border-dashed border-border bg-surface-2 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs text-muted">Next Cycle</p>
                        <p className="text-sm font-semibold text-foreground mt-0.5">{upcomingCycle.cycle_label}</p>
                      </div>
                      <Badge variant="upcoming">Upcoming</Badge>
                    </div>
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
                  <p className="text-xs text-muted">
                    {completedCycles} completed cycle{completedCycles !== 1 ? "s" : ""}
                  </p>
                  <Link href={`/admin/cycles?series=${s.id}`} className="flex items-center gap-1 text-xs text-primary-600 font-medium hover:underline">
                    Manage cycles <ChevronRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
