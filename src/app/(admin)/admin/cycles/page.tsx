import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { RefreshCw, TrendingUp, Calendar, CheckCircle2 } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cycles | Admin" };

type CycleRow = {
  id: string;
  cycle_label: string;
  status: string;
  start_date: string;
  end_date: string;
  created_at: string;
  series: { name: string; roi_rate: number } | null;
  investments: { capital: number }[];
};

export default async function AdminCyclesPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawCycles } = await supabase
    .from("cycles")
    .select("*, series(*), investments(capital)")
    .order("start_date", { ascending: false });

  const cycles = rawCycles as unknown as CycleRow[] | null;

  const activeCycles = cycles?.filter((c) => c.status === "active") ?? [];
  const closedCycles = cycles?.filter((c) => c.status !== "active") ?? [];

  const statusVariant: Record<string, "active" | "completed" | "pending"> = {
    active: "active",
    closed: "completed",
    upcoming: "pending",
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Cycles</h1>
        <p className="text-sm text-muted mt-1">3-month Mudārabah investment cycles per series</p>
      </div>

      {/* Active Cycles */}
      {activeCycles.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Active Cycles ({activeCycles.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {activeCycles.map((cycle) => (
              <CycleCard key={cycle.id} cycle={cycle} statusVariant={statusVariant} />
            ))}
          </div>
        </section>
      )}

      {closedCycles.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-muted" />
            Past Cycles ({closedCycles.length})
          </h2>
          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-surface-2">
                      <th className="px-4 py-3 text-left font-medium text-muted">Cycle</th>
                      <th className="px-4 py-3 text-left font-medium text-muted">Series</th>
                      <th className="px-4 py-3 text-left font-medium text-muted">Start</th>
                      <th className="px-4 py-3 text-left font-medium text-muted">End</th>
                      <th className="px-4 py-3 text-right font-medium text-muted">Investments</th>
                      <th className="px-4 py-3 text-right font-medium text-muted">Total Capital</th>
                      <th className="px-4 py-3 text-center font-medium text-muted">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {closedCycles.map((cycle) => {
                      const totalCapital = cycle.investments.reduce((s, i) => s + i.capital, 0);
                      return (
                        <tr key={cycle.id} className="hover:bg-surface-2 transition-colors">
                          <td className="px-4 py-3 font-medium text-foreground">{cycle.cycle_label}</td>
                          <td className="px-4 py-3">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold bg-primary-100 text-primary-700">
                              {cycle.series?.name}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted">{formatDate(cycle.start_date)}</td>
                          <td className="px-4 py-3 text-muted">{formatDate(cycle.end_date)}</td>
                          <td className="px-4 py-3 text-right">{cycle.investments.length}</td>
                          <td className="px-4 py-3 text-right font-medium">{formatCurrency(totalCapital)}</td>
                          <td className="px-4 py-3 text-center">
                            <Badge variant={statusVariant[cycle.status] ?? "pending"}>
                              {cycle.status.charAt(0).toUpperCase() + cycle.status.slice(1)}
                            </Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {!cycles || cycles.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <RefreshCw className="h-12 w-12 text-border mb-4" />
            <p className="font-medium text-foreground">No cycles yet</p>
            <p className="text-sm text-muted mt-1">Cycles are created automatically when series are set up.</p>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CycleCard({
  cycle,
  statusVariant,
}: {
  cycle: CycleRow;
  statusVariant: Record<string, "active" | "completed" | "pending">;
}) {
  const totalCapital = cycle.investments.reduce((s, i) => s + i.capital, 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-100 text-xs font-bold text-primary-700">
              {cycle.series?.name}
            </div>
            <div>
              <CardTitle className="text-sm">Series {cycle.series?.name}</CardTitle>
              <p className="text-xs text-muted mt-0.5">{cycle.cycle_label}</p>
            </div>
          </div>
          <Badge variant={statusVariant[cycle.status] ?? "pending"} dot>
            {cycle.status.charAt(0).toUpperCase() + cycle.status.slice(1)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-surface-2 p-2.5">
            <p className="text-[10px] text-muted uppercase tracking-wide flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Start
            </p>
            <p className="font-medium text-foreground mt-0.5">{formatDate(cycle.start_date)}</p>
          </div>
          <div className="rounded-lg bg-surface-2 p-2.5">
            <p className="text-[10px] text-muted uppercase tracking-wide flex items-center gap-1">
              <Calendar className="h-3 w-3" /> End
            </p>
            <p className="font-medium text-foreground mt-0.5">{formatDate(cycle.end_date)}</p>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs border-t border-border pt-3">
          <span className="flex items-center gap-1 text-muted">
            <TrendingUp className="h-3 w-3" /> {cycle.investments.length} investment{cycle.investments.length !== 1 ? "s" : ""}
          </span>
          <span className="font-semibold text-foreground">{formatCurrency(totalCapital)}</span>
        </div>
        {cycle.series?.roi_rate && (
          <div className="text-xs flex items-center gap-1 text-gold-600">
            <CheckCircle2 className="h-3 w-3" />
            ROI Rate: {(cycle.series.roi_rate * 100).toFixed(1)}%
          </div>
        )}
      </CardContent>
    </Card>
  );
}
