import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { RefreshCw, TrendingUp, Calendar, AlertCircle, Plus, Pencil } from "lucide-react";
import { formatDate, formatCurrency } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cycles | Admin" };

type CycleRow = {
  id: string;
  cycle_label: string;
  status: string;
  start_date: string;
  end_date: string;
  created_at: string;
  series: { name: string } | null;
  investments: { capital: number }[];
};

const STATUS_VARIANT: Record<string, "active" | "completed" | "pending" | "warning"> = {
  draft: "pending",
  subscription_open: "active",
  subscription_closed: "pending",
  upcoming: "pending",
  active: "active",
  maturity_window: "warning",
  awaiting_profit_declaration: "warning",
  completed: "completed",
  matured: "completed",
  cancelled: "completed",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  subscription_open: "Subscription Open",
  subscription_closed: "Subscription Closed",
  upcoming: "Upcoming",
  active: "Active",
  maturity_window: "Maturity Window",
  awaiting_profit_declaration: "Awaiting Profit Declaration",
  completed: "Completed",
  matured: "Matured",
  cancelled: "Cancelled",
};

export default async function AdminCyclesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: rawCycles } = await supabase
    .from("cycles")
    .select("*, series(*), investments(capital)")
    .order("start_date", { ascending: false });

  const cycles = rawCycles as unknown as CycleRow[] | null;

  const LIVE_STATUSES = new Set(["draft", "subscription_open", "subscription_closed", "upcoming", "active", "maturity_window"]);
  const activeCycles = cycles?.filter((c) => LIVE_STATUSES.has(c.status)) ?? [];
  const awaitingDeclaration =
    cycles?.filter((c) => c.status === "awaiting_profit_declaration") ?? [];
  const closedCycles =
    cycles?.filter(
      (c) => !LIVE_STATUSES.has(c.status) && c.status !== "awaiting_profit_declaration"
    ) ?? [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cycles</h1>
          <p className="text-sm text-muted mt-1">
            3-month Mudārabah investment cycles per series
          </p>
        </div>
        <Button asChild size="sm">
          <Link href="/admin/cycles/new" className="flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Create Cycle
          </Link>
        </Button>
      </div>

      {/* Awaiting Profit Declaration — urgent alert */}
      {awaitingDeclaration.length > 0 && (
        <section>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 mb-2 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="font-semibold text-amber-900 text-sm">
                {awaitingDeclaration.length === 1
                  ? "1 cycle has matured and requires profit declaration"
                  : `${awaitingDeclaration.length} cycles have matured and require profit declaration`}
              </p>
              <p className="text-xs text-amber-700 mt-0.5">
                Investor reports and maturity decisions cannot proceed until profit is declared.
              </p>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {awaitingDeclaration.map((cycle) => (
              <CycleCard key={cycle.id} cycle={cycle} />
            ))}
          </div>
        </section>
      )}

      {/* Active / Upcoming Cycles */}
      {activeCycles.length > 0 && (
        <section>
          <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            Active Cycles ({activeCycles.length})
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {activeCycles.map((cycle) => (
              <CycleCard key={cycle.id} cycle={cycle} />
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
                      <th className="px-4 py-3 text-right font-medium text-muted">
                        Investments
                      </th>
                      <th className="px-4 py-3 text-right font-medium text-muted">
                        Total Capital
                      </th>
                      <th className="px-4 py-3 text-center font-medium text-muted">Status</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {closedCycles.map((cycle) => {
                      const totalCapital = cycle.investments.reduce(
                        (s, i) => s + i.capital,
                        0
                      );
                      return (
                        <tr
                          key={cycle.id}
                          className="hover:bg-surface-2 transition-colors"
                        >
                          <td className="px-4 py-3 font-medium text-foreground">
                            {cycle.cycle_label}
                          </td>
                          <td className="px-4 py-3">
                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-md text-xs font-bold bg-primary-100 text-primary-700">
                              {cycle.series?.name}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-muted">
                            {formatDate(cycle.start_date)}
                          </td>
                          <td className="px-4 py-3 text-muted">
                            {formatDate(cycle.end_date)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {cycle.investments.length}
                          </td>
                          <td className="px-4 py-3 text-right font-medium">
                            {formatCurrency(totalCapital)}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <Badge
                              variant={STATUS_VARIANT[cycle.status] ?? "pending"}
                            >
                              {STATUS_LABEL[cycle.status] ?? cycle.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <Link
                              href={`/admin/cycles/${cycle.id}/edit`}
                              className="inline-flex items-center gap-1 text-xs text-primary-600 hover:underline"
                            >
                              <Pencil className="h-3 w-3" /> Edit
                            </Link>
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
            <p className="text-sm text-muted mt-1 mb-4">
              Create your first cycle using the button above.
            </p>
            <Button asChild size="sm">
              <Link href="/admin/cycles/new" className="flex items-center gap-2">
                <Plus className="h-4 w-4" />
                Create Cycle
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function CycleCard({ cycle }: { cycle: CycleRow }) {
  const totalCapital = cycle.investments.reduce((s, i) => s + i.capital, 0);
  const isPendingDeclaration = cycle.status === "awaiting_profit_declaration";

  return (
    <Card className={isPendingDeclaration ? "border-amber-300" : undefined}>
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
          <Badge variant={STATUS_VARIANT[cycle.status] ?? "pending"} dot>
            {STATUS_LABEL[cycle.status] ?? cycle.status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="rounded-lg bg-surface-2 p-2.5">
            <p className="text-[10px] text-muted uppercase tracking-wide flex items-center gap-1">
              <Calendar className="h-3 w-3" /> Start
            </p>
            <p className="font-medium text-foreground mt-0.5">
              {formatDate(cycle.start_date)}
            </p>
          </div>
          <div className="rounded-lg bg-surface-2 p-2.5">
            <p className="text-[10px] text-muted uppercase tracking-wide flex items-center gap-1">
              <Calendar className="h-3 w-3" /> End
            </p>
            <p className="font-medium text-foreground mt-0.5">
              {formatDate(cycle.end_date)}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between text-xs border-t border-border pt-3">
          <span className="flex items-center gap-1 text-muted">
            <TrendingUp className="h-3 w-3" /> {cycle.investments.length}{" "}
            investment{cycle.investments.length !== 1 ? "s" : ""}
          </span>
          <span className="font-semibold text-foreground">
            {formatCurrency(totalCapital)}
          </span>
        </div>
        {isPendingDeclaration && (
          <Button asChild size="sm" className="w-full mt-1">
            <Link href={`/admin/cycles/${cycle.id}/declare-profit`}>
              Declare Profit
            </Link>
          </Button>
        )}
        <Button asChild size="sm" variant="outline" className="w-full">
          <Link href={`/admin/cycles/${cycle.id}/edit`} className="flex items-center gap-1.5">
            <Pencil className="h-3.5 w-3.5" />
            Edit Cycle
          </Link>
        </Button>
      </CardContent>
    </Card>
  );
}
