import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import {
  AlertTriangle,
  AlertCircle,
  Clock,
  Settings,
  Users,
  Calendar,
  ChevronRight,
  TrendingUp,
  CheckCircle2,
  Circle,
  BarChart3,
} from "lucide-react";
import { formatCurrency, formatDate, getDaysUntilMaturity } from "@/lib/utils";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Series Management" };
export const revalidate = 0;

// ─── Types ───────────────────────────────────────────────────────────────────

type ProfitDeclaration = {
  cycle_id: string;
  profit_per_slot: number;
  net_profit: number;
  investor_profit_share: number;
  declared_at: string;
};

type CycleRow = {
  id: string;
  cycle_number: number;
  cycle_label: string;
  start_date: string;
  end_date: string;
  status: string;
  subscription_open_date: string | null;
  subscription_close_date: string | null;
  total_capital: number;
  total_slots: number;
  total_investors: number;
  amount_received: number;
  unit_value: number | null;
  rollover_processed_at?: string | null;
};

type SeriesRow = {
  id: string;
  name: "A" | "B" | "C";
  description: string | null;
  mudarabah_investor_ratio: number;
  price_per_unit: number;
  min_units: number;
  max_units: number | null;
  is_active: boolean;
  cycles: CycleRow[];
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const CURRENT_CYCLE_PRIORITY = [
  "awaiting_profit_declaration",
  "maturity_window",
  "active",
  "subscription_closed",
  "subscription_open",
  "upcoming",
  "draft",
];

function getCurrentCycle(cycles: CycleRow[]): CycleRow | null {
  for (const status of CURRENT_CYCLE_PRIORITY) {
    const found = cycles.find((c) => c.status === status);
    if (found) return found;
  }
  return null;
}

function getCompletedCycles(cycles: CycleRow[]): CycleRow[] {
  return cycles
    .filter((c) => c.status === "completed" || c.status === "matured")
    .sort((a, b) => b.start_date.localeCompare(a.start_date));
}

function seriesColor(name: "A" | "B" | "C") {
  return {
    A: {
      bg: "bg-primary-700",
      light: "bg-primary-50",
      text: "text-primary-700",
      border: "border-primary-200",
    },
    B: {
      bg: "bg-gold-500",
      light: "bg-gold-50",
      text: "text-gold-700",
      border: "border-gold-200",
    },
    C: {
      bg: "bg-blue-700",
      light: "bg-blue-50",
      text: "text-blue-700",
      border: "border-blue-200",
    },
  }[name];
}

function cycleStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: "Draft",
    subscription_open: "Subscription Open",
    subscription_closed: "Subscription Closed",
    upcoming: "Upcoming",
    active: "Active",
    maturity_window: "Maturity Window",
    awaiting_profit_declaration: "Awaiting Profit Declaration",
    matured: "Matured",
    completed: "Completed",
    cancelled: "Cancelled",
  };
  return labels[status] ?? status;
}

function cycleStatusBadgeVariant(status: string): "active" | "completed" | "pending" | "warning" {
  if (status === "active" || status === "subscription_open") return "active";
  if (status === "completed") return "completed";
  if (status === "awaiting_profit_declaration" || status === "maturity_window") return "warning";
  return "pending";
}

function profitLabel(status: string, hasProfitDecl: boolean): { text: string; cls: string } {
  if (hasProfitDecl) return { text: "Profit Declared", cls: "text-emerald-700 bg-emerald-50 border-emerald-200" };
  if (status === "awaiting_profit_declaration") return { text: "Awaiting Profit Declaration", cls: "text-amber-700 bg-amber-50 border-amber-200" };
  if (status === "matured") return { text: "Matured — Not Declared", cls: "text-orange-700 bg-orange-50 border-orange-200" };
  return { text: "Not Yet Declared", cls: "text-muted bg-surface-2 border-border" };
}

function CycleTimeline({ cycle }: { cycle: CycleRow }) {
  const now = new Date();

  const allMilestones = [
    { label: "Sub Opens", date: cycle.subscription_open_date },
    { label: "Sub Closes", date: cycle.subscription_close_date },
    { label: "Starts", date: cycle.start_date },
    { label: "Matures", date: cycle.end_date },
  ];
  const milestones = allMilestones.filter((m) => m.date !== null) as Array<{
    label: string;
    date: string;
  }>;

  const firstFutureIdx = milestones.findIndex((m) => new Date(m.date) > now);

  return (
    <div>
      <p className="text-[10px] font-semibold text-muted uppercase tracking-wider mb-2">
        Cycle Timeline
      </p>
      <div className="grid grid-cols-2 gap-1.5">
        {milestones.map((m, i) => {
          const isPast = new Date(m.date) <= now;
          const isCurrent = i === firstFutureIdx;
          return (
            <div
              key={m.label}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs",
                isPast
                  ? "border-emerald-200 bg-emerald-50"
                  : isCurrent
                    ? "border-blue-200 bg-blue-50"
                    : "border-border bg-surface-2"
              )}
            >
              {isPast ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
              ) : (
                <Circle
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    isCurrent ? "text-blue-500" : "text-muted/40"
                  )}
                />
              )}
              <div className="min-w-0">
                <p
                  className={cn(
                    "font-medium leading-tight",
                    isPast
                      ? "text-emerald-800"
                      : isCurrent
                        ? "text-blue-800"
                        : "text-foreground"
                  )}
                >
                  {m.label}
                </p>
                <p
                  className={cn(
                    "leading-tight",
                    isPast
                      ? "text-emerald-600"
                      : isCurrent
                        ? "text-blue-600"
                        : "text-muted"
                  )}
                >
                  {formatDate(m.date)}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function SeriesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [
    { data: rawSeries },
    { data: profitDeclarations },
    { count: awaitingRollover },
    { data: memberships },
  ] = await Promise.all([
    supabase
      .from("series")
      .select(
        `id, name, description, mudarabah_investor_ratio, price_per_unit,
         min_units, max_units, is_active,
         cycles(
           id, cycle_number, cycle_label, start_date, end_date, status,
           subscription_open_date, subscription_close_date,
           total_capital, total_slots, total_investors, amount_received,
           unit_value, rollover_processed_at
         )`
      )
      .order("name"),
    supabase
      .from("cycle_profit_declarations")
      .select("cycle_id, profit_per_slot, net_profit, investor_profit_share, declared_at"),
    supabase
      .from("investments")
      .select("*", { count: "exact", head: true })
      .eq("status", "matured")
      .is("maturity_decision", null),
    supabase
      .from("investments")
      .select("cycle_id, units, capital")
      .eq("status", "active"),
  ]);

  const series = rawSeries as unknown as SeriesRow[] | null;

  // cycles.total_slots / total_investors / total_capital are running
  // totals maintained by trigger deltas — nothing recalculates them, so
  // a missed delta leaves them stale and this page would then disagree
  // with the Mudarabah ledger, which counts the memberships themselves.
  // Recount here, over the same rows the ledger and settlement use.
  // Mutating in place so every consumer below sees the derived figure.
  //
  // CAPITAL IS SLOTS × SLOT VALUE, not the sum of each enrolment's
  // stored capital column. They should be identical — an enrolment's
  // capital IS its units × price — but summing the column would hide a
  // row where the two had come apart. Defining capital as the product
  // makes that impossible: one slot count, one price, one answer.
  const held = new Map<string, { slots: number; investors: number }>();
  for (const m of (memberships ?? []) as {
    cycle_id: string;
    units: number | null;
  }[]) {
    const at = held.get(m.cycle_id) ?? { slots: 0, investors: 0 };
    at.slots += Number(m.units ?? 0);
    at.investors += 1;
    held.set(m.cycle_id, at);
  }
  for (const s of series ?? []) {
    for (const c of s.cycles ?? []) {
      const at = held.get(c.id) ?? { slots: 0, investors: 0 };
      // The same COALESCE(cycle.unit_value, series.price_per_unit) the
      // Mudarabah engine applies, so a slot is never worth two
      // different amounts on two different pages.
      const slotValue = c.unit_value != null
        ? Number(c.unit_value)
        : Number(s.price_per_unit ?? 0);
      c.total_slots = at.slots;
      c.total_investors = at.investors;
      c.total_capital = at.slots * slotValue;
    }
  }

  // Build profit declaration map: cycle_id → declaration
  const profitMap = new Map<string, ProfitDeclaration>(
    (profitDeclarations as ProfitDeclaration[] | null)?.map((pd) => [pd.cycle_id, pd]) ?? []
  );

  // ── Alert data ────────────────────────────────────────────────────────────
  const now = new Date();
  const sevenDaysLater = new Date(now);
  sevenDaysLater.setDate(sevenDaysLater.getDate() + 7);

  type AlertCycle = CycleRow & { series_name: "A" | "B" | "C" };
  const awaitingDeclaration: AlertCycle[] = [];
  const rolloverPending: AlertCycle[] = [];
  const subscriptionClosing: (AlertCycle & { daysLeft: number })[] = [];

  for (const s of series ?? []) {
    for (const c of s.cycles ?? []) {
      if (c.status === "awaiting_profit_declaration") {
        awaitingDeclaration.push({ ...c, series_name: s.name });
      }
      if (
        c.status === "completed" &&
        profitMap.has(c.id) &&
        !c.rollover_processed_at
      ) {
        rolloverPending.push({ ...c, series_name: s.name });
      }
      if (c.subscription_close_date) {
        const closeDate = new Date(c.subscription_close_date);
        if (closeDate > now && closeDate <= sevenDaysLater) {
          const daysLeft = Math.ceil(
            (closeDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );
          subscriptionClosing.push({ ...c, series_name: s.name, daysLeft });
        }
      }
    }
  }

  const hasAlerts =
    awaitingDeclaration.length > 0 ||
    rolloverPending.length > 0 ||
    (awaitingRollover ?? 0) > 0 ||
    subscriptionClosing.length > 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Header ── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Series Management</h1>
          <p className="text-sm text-muted mt-1">
            Mudārabah investment series — live operational dashboard
          </p>
        </div>
        <Link
          href="/admin/cycles"
          className="flex items-center gap-1.5 text-sm text-primary-600 font-medium hover:underline"
        >
          <Calendar className="h-4 w-4" />
          View Cycle Schedule
        </Link>
      </div>

      {/* ── Dashboard Alerts ── */}
      {hasAlerts && (
        <div className="space-y-2">
          {awaitingDeclaration.map((cycle) => (
            <div
              key={cycle.id}
              className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-3.5"
            >
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-amber-900">
                  Series {cycle.series_name}: {cycle.cycle_label} — Awaiting Profit Declaration
                </p>
                <p className="text-xs text-amber-700 mt-0.5">
                  This cycle has matured. Investors cannot submit rollover decisions until
                  profit is declared.
                </p>
              </div>
              <Button
                asChild
                size="sm"
                className="shrink-0 bg-amber-600 hover:bg-amber-700 text-white border-0"
              >
                <Link href={`/admin/cycles/${cycle.id}/declare-profit`}>
                  Declare Profit
                </Link>
              </Button>
            </div>
          ))}

          {rolloverPending.map((cycle) => (
            <div
              key={cycle.id}
              className="flex items-start gap-3 rounded-xl border border-purple-200 bg-purple-50 p-3.5"
            >
              <AlertCircle className="h-4 w-4 text-purple-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-purple-900">
                  Series {cycle.series_name}: {cycle.cycle_label} — Rollover Ready
                </p>
                <p className="text-xs text-purple-700 mt-0.5">
                  Profit has been declared. Process the automatic rollover to continue
                  investors into the next cycle.
                </p>
              </div>
              <Button
                asChild
                size="sm"
                className="shrink-0 bg-purple-600 hover:bg-purple-700 text-white border-0"
              >
                <Link href={`/admin/cycles/${cycle.id}/rollover`}>Process Rollover</Link>
              </Button>
            </div>
          ))}

          {(awaitingRollover ?? 0) > 0 && (
            <div className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3.5">
              <AlertCircle className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-blue-900">
                  {awaitingRollover} investor
                  {awaitingRollover !== 1 ? "s" : ""} awaiting rollover decision
                </p>
                <p className="text-xs text-blue-700 mt-0.5">
                  These investors have matured investments but have not yet chosen to roll
                  over or exit.
                </p>
              </div>
              <Button
                asChild
                size="sm"
                variant="outline"
                className="shrink-0 border-blue-300 text-blue-700 hover:bg-blue-100"
              >
                <Link href="/admin/investors">View Investors</Link>
              </Button>
            </div>
          )}

          {subscriptionClosing.map((cycle) => (
            <div
              key={cycle.id}
              className="flex items-start gap-3 rounded-xl border border-orange-200 bg-orange-50 p-3.5"
            >
              <Clock className="h-4 w-4 text-orange-600 mt-0.5 shrink-0" />
              <p className="text-sm text-orange-900">
                <span className="font-semibold">
                  Series {cycle.series_name}: {cycle.cycle_label}
                </span>{" "}
                — subscription closes in{" "}
                <span className="font-semibold">
                  {cycle.daysLeft} day{cycle.daysLeft !== 1 ? "s" : ""}
                </span>{" "}
                ({formatDate(cycle.subscription_close_date!)})
              </p>
            </div>
          ))}
        </div>
      )}

      {/* ── Series Cards ── */}
      <div className="grid gap-6">
        {series?.map((s) => {
          const cycles = s.cycles ?? [];
          const colors = seriesColor(s.name);
          const currentCycle = getCurrentCycle(cycles);
          const completedCycles = getCompletedCycles(cycles);
          const hasProfitDecl = currentCycle
            ? profitMap.has(currentCycle.id)
            : false;
          const profitDecl = currentCycle ? profitMap.get(currentCycle.id) : undefined;
          const daysUntilMaturity = currentCycle
            ? getDaysUntilMaturity(currentCycle.end_date)
            : 0;
          const investorPct = Math.round(s.mudarabah_investor_ratio * 100);
          const companyPct = 100 - investorPct;
          const pl = currentCycle
            ? profitLabel(currentCycle.status, hasProfitDecl)
            : null;

          return (
            <Card key={s.id} className="overflow-hidden">
              {/* ── Card Header ── */}
              <CardHeader className="pb-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div
                      className={`flex h-12 w-12 items-center justify-center rounded-xl ${colors.bg} text-white text-xl font-black shrink-0`}
                    >
                      {s.name}
                    </div>
                    <div>
                      <CardTitle>MaalGrow Series {s.name}</CardTitle>
                      <p className="text-xs text-muted mt-0.5">
                        Profit Sharing: {investorPct}% investors / {companyPct}% company
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={s.is_active ? "active" : "default"} dot>
                      {s.is_active ? "Active" : "Inactive"}
                    </Badge>
                    <Link
                      href={`/admin/series/${s.id}/settings`}
                      className="p-1.5 rounded-lg hover:bg-surface-2 text-muted hover:text-foreground transition-colors"
                      title="Series Settings"
                    >
                      <Settings className="h-4 w-4" />
                    </Link>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="space-y-5">
                {/* ── Current Cycle Panel ── */}
                {currentCycle ? (
                  <>
                    <div
                      className={`rounded-xl ${colors.light} ${colors.border} border p-4 space-y-4`}
                    >
                      {/* Cycle label + profit status + countdown */}
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-[10px] font-semibold text-muted uppercase tracking-wider">
                            Current Cycle
                          </p>
                          <p className="text-base font-bold text-foreground mt-0.5">
                            {currentCycle.cycle_label}
                          </p>
                          <p className="text-xs text-muted">
                            {formatDate(currentCycle.start_date)} —{" "}
                            {formatDate(currentCycle.end_date)}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <Badge variant={cycleStatusBadgeVariant(currentCycle.status)} dot>
                            {cycleStatusLabel(currentCycle.status)}
                          </Badge>
                          {daysUntilMaturity > 0 && (
                            <p
                              className={`text-xs ${colors.text} font-semibold mt-1.5 flex items-center justify-end gap-1`}
                            >
                              <Clock className="h-3 w-3" />
                              Matures in {daysUntilMaturity} days
                            </p>
                          )}
                        </div>
                      </div>

                      {/*
                        Stats grid.

                        There is no "Collected" tile. An investor is
                        entered only once their payment has arrived and
                        been confirmed, so the money in a cycle is
                        always its capital — two tiles for one figure
                        invited exactly the confusion of reading one
                        screen against another. Capital is slots ×
                        slot value, full stop.

                        When the money does NOT match, that is a fault
                        in the records rather than a statistic, so it
                        appears below as a warning instead.
                      */}
                      {/*
                        Two columns on a phone, three from sm up. Capital
                        takes the whole second row on narrow screens —
                        ₦39,000,000.00 is fourteen characters and will not
                        fit a third of a 390px viewport, which is where
                        this page is most often read.
                      */}
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {[
                          { label: "Investors", value: currentCycle.total_investors.toString(), wide: false },
                          { label: "Slots Sold", value: currentCycle.total_slots.toString(), wide: false },
                          {
                            label: "Capital",
                            value: formatCurrency(currentCycle.total_capital),
                            wide: true,
                          },
                        ].map(({ label, value, wide }) => (
                          <div
                            key={label}
                            className={`rounded-lg bg-white/60 dark:bg-black/10 px-3 py-2.5 text-center ${
                              wide ? "col-span-2 sm:col-span-1" : ""
                            }`}
                          >
                            <p className="text-[10px] text-muted uppercase tracking-wide">
                              {label}
                            </p>
                            <p className="text-sm font-bold text-foreground mt-0.5 tabular-nums break-words">
                              {value}
                            </p>
                          </div>
                        ))}
                      </div>

                      {Math.abs(
                        currentCycle.total_capital - currentCycle.amount_received
                      ) > 0.005 && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 flex items-start gap-2">
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-600 mt-0.5 flex-shrink-0" />
                          <p className="text-[11px] leading-snug text-amber-800">
                            {currentCycle.total_capital > currentCycle.amount_received ? (
                              <>
                                {formatCurrency(
                                  currentCycle.total_capital - currentCycle.amount_received
                                )}{" "}
                                of slots here have no confirmed payment behind
                                them. Open the Mudarabah ledger for this cycle
                                to see which investors.
                              </>
                            ) : (
                              <>
                                {formatCurrency(
                                  currentCycle.amount_received - currentCycle.total_capital
                                )}{" "}
                                more has been received than the slots account
                                for. Open the Mudarabah ledger for this cycle
                                to see which investors.
                              </>
                            )}
                          </p>
                        </div>
                      )}

                      {/* Profit Status */}
                      {pl && (
                        <div
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 ${pl.cls}`}
                        >
                          <span className="text-xs font-semibold">Profit Status</span>
                          <span className="text-xs font-bold">{pl.text}</span>
                        </div>
                      )}

                      {/* Profit per slot — only when declared */}
                      {profitDecl && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-emerald-700">
                              Profit Per Slot
                            </span>
                            <span className="text-sm font-bold text-emerald-800">
                              {formatCurrency(profitDecl.profit_per_slot)}
                            </span>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <span className="text-xs text-emerald-600">
                              Total Investor Share
                            </span>
                            <span className="text-xs font-medium text-emerald-700">
                              {formatCurrency(profitDecl.investor_profit_share)}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Cycle Timeline */}
                    <CycleTimeline cycle={currentCycle} />
                  </>
                ) : (
                  <div className="rounded-xl border border-dashed border-border bg-surface-2 p-6 text-center">
                    <p className="text-sm text-muted">No active cycle for this series.</p>
                    <Button asChild size="sm" className="mt-3">
                      <Link href="/admin/cycles/new">Create Cycle</Link>
                    </Button>
                  </div>
                )}

                {/* ── Quick Actions ── */}
                <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                  {currentCycle && (
                    <Button asChild size="sm">
                      <Link
                        href={`/admin/cycles/${currentCycle.id}/edit`}
                        className="flex items-center gap-1.5"
                      >
                        <BarChart3 className="h-3.5 w-3.5" />
                        Manage Cycle
                      </Link>
                    </Button>
                  )}
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/admin/investors?series=${s.id}`}
                      className="flex items-center gap-1.5"
                    >
                      <Users className="h-3.5 w-3.5" />
                      View Investors
                    </Link>
                  </Button>
                  {currentCycle &&
                    (currentCycle.status === "awaiting_profit_declaration" ||
                      currentCycle.status === "matured") && (
                      <Button
                        asChild
                        size="sm"
                        variant="outline"
                        className="border-amber-300 text-amber-700 hover:bg-amber-50"
                      >
                        <Link
                          href={`/admin/cycles/${currentCycle.id}/declare-profit`}
                          className="flex items-center gap-1.5"
                        >
                          <TrendingUp className="h-3.5 w-3.5" />
                          Declare Profit
                        </Link>
                      </Button>
                    )}
                  <Button asChild size="sm" variant="outline">
                    <Link
                      href={`/admin/series/${s.id}/settings`}
                      className="flex items-center gap-1.5"
                    >
                      <Settings className="h-3.5 w-3.5" />
                      Settings
                    </Link>
                  </Button>
                </div>

                {/* ── Completed Cycles History ── */}
                {completedCycles.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-semibold text-muted uppercase tracking-wide">
                        Completed Cycles
                      </p>
                      <Link
                        href={`/admin/cycles?series=${s.id}`}
                        className="flex items-center gap-0.5 text-xs text-primary-600 hover:underline"
                      >
                        All cycles <ChevronRight className="h-3 w-3" />
                      </Link>
                    </div>
                    <div className="rounded-xl border border-border overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-border bg-surface-2">
                            <th className="px-3 py-2 text-left font-medium text-muted">Cycle</th>
                            <th className="px-3 py-2 text-right font-medium text-muted">
                              Investors
                            </th>
                            <th className="px-3 py-2 text-right font-medium text-muted">
                              Capital
                            </th>
                            <th className="px-3 py-2 text-right font-medium text-muted">
                              Profit / Slot
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border">
                          {completedCycles.slice(0, 5).map((cycle) => {
                            const pd = profitMap.get(cycle.id);
                            return (
                              <tr
                                key={cycle.id}
                                className="hover:bg-surface-2 transition-colors"
                              >
                                <td className="px-3 py-2.5 font-medium text-foreground">
                                  {cycle.cycle_label}
                                </td>
                                <td className="px-3 py-2.5 text-right text-muted">
                                  {cycle.total_investors}
                                </td>
                                <td className="px-3 py-2.5 text-right font-medium">
                                  {formatCurrency(cycle.total_capital)}
                                </td>
                                <td className="px-3 py-2.5 text-right">
                                  {pd ? (
                                    <span className="font-semibold text-emerald-700">
                                      {formatCurrency(pd.profit_per_slot)}
                                    </span>
                                  ) : (
                                    <span className="text-muted italic">Not declared</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
