import { createClient, createAdminClient } from "@/lib/supabase/server";
import { instructionDeadline } from "@/lib/maturity-deadline";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  Layers,
  Users,
  RefreshCw,
  Wallet,
  Clock,
  AlertTriangle,
  ArrowRight,
} from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RolloverActions } from "./_rollover-actions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cycle Rollover | Admin" };
export const revalidate = 0;

const VIEW_ROLES = ["super_admin", "administrator", "finance"];

type InvRow = {
  id: string;
  investment_code: string;
  units: number;
  capital: number;
  declared_profit: number | null;
  status: string;
  next_investment_id: string | null;
  investor: { id: string; full_name: string; investor_code: string } | null;
};

type DecisionRow = {
  investment_id: string;
  decision: "continue" | "exit" | "rollover_all" | "partial_exit";
  via: string;
  submitted_at: string;
  locked: boolean;
  slots_to_withdraw: number | null;
};

type RolloverRow = {
  previous_investment_id: string;
  status: string;
  error: string | null;
  email_sent: boolean;
  capital_rolled_over: number;
  profit_rolled_over: number;
  withdrawal_amount: number;
};

const DECISION_LABEL: Record<string, string> = {
  continue: "Profit paid · capital continues",
  exit: "Profit + all capital paid out",
  partial_exit: "Profit paid · partial capital withdrawal",
  rollover_all: "Roll over capital + profit (legacy)",
};

export default async function CycleRolloverPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !VIEW_ROLES.includes(profile.role ?? "")) redirect("/admin");

  const isSuperAdmin = profile.role === "super_admin";
  const db = await createAdminClient();

  const { data: cycle } = await db
    .from("cycles")
    .select("*, series(id, name, price_per_unit)")
    .eq("id", id)
    .single();
  if (!cycle) notFound();

  const series = cycle.series as unknown as {
    id: string;
    name: string;
    price_per_unit: number;
  } | null;

  const [
    { data: rawInvestments },
    { data: rawDecisions },
    { data: rawRollovers },
    { data: profitDecl },
    { data: nextCycle },
  ] = await Promise.all([
    db
      .from("investments")
      .select(
        "id, investment_code, units, capital, declared_profit, status, next_investment_id, investor:investors(id, full_name, investor_code)"
      )
      .eq("cycle_id", id)
      .order("created_at"),
    db
      .from("rollover_decisions")
      .select("investment_id, decision, via, submitted_at, locked, slots_to_withdraw")
      .eq("source_cycle_id", id),
    db
      .from("cycle_rollovers")
      .select(
        "previous_investment_id, status, error, email_sent, capital_rolled_over, profit_rolled_over, withdrawal_amount"
      )
      .eq("source_cycle_id", id),
    db.from("cycle_profit_declarations").select("*").eq("cycle_id", id).maybeSingle(),
    db
      .from("cycles")
      .select("id, cycle_label, start_date, end_date, status")
      .eq("series_id", cycle.series_id)
      .eq("start_date", cycle.end_date)
      .maybeSingle(),
  ]);

  const investments = (rawInvestments ?? []) as unknown as InvRow[];
  const decisions = new Map(
    ((rawDecisions ?? []) as DecisionRow[]).map((d) => [d.investment_id, d])
  );
  const rollovers = new Map(
    ((rawRollovers ?? []) as RolloverRow[]).map((r) => [r.previous_investment_id, r])
  );

  // ── Stats ──
  const total = investments.length;
  let autoContinue = 0,
    rollAll = 0,
    profitOnly = 0,
    partialCount = 0,
    withdrawAll = 0,
    failed = 0,
    processed = 0;
  let capitalContinuing = 0,
    profitRolled = 0,
    withdrawalTotal = 0;

  const slotValue = series?.price_per_unit ?? 500000;

  for (const inv of investments) {
    const d = decisions.get(inv.id);
    const r = rollovers.get(inv.id);

    if (r && r.status === "failed") failed++;
    if (r && (r.status === "completed" || r.status === "withdrawn")) {
      processed++;
      capitalContinuing += r.capital_rolled_over;
      profitRolled += r.profit_rolled_over;
      withdrawalTotal += r.withdrawal_amount;
    } else if (inv.status === "matured") {
      // pending processing — project from the instruction
      // (default when none: profit paid, capital continues)
      const dec = d?.decision ?? "continue";
      const profit = inv.declared_profit ?? 0;
      if (dec === "exit") {
        withdrawalTotal += inv.capital + profit;
      } else if (dec === "partial_exit") {
        const capOut = Math.min(inv.capital, (d?.slots_to_withdraw ?? 0) * slotValue);
        capitalContinuing += inv.capital - capOut;
        withdrawalTotal += capOut + profit;
      } else if (dec === "rollover_all") {
        capitalContinuing += inv.capital;
        profitRolled += profit;
      } else {
        capitalContinuing += inv.capital;
        withdrawalTotal += profit;
      }
    }

    if (!d) {
      if (inv.status === "matured" || inv.status === "active") autoContinue++;
    } else if (d.decision === "rollover_all") rollAll++;
    else if (d.decision === "continue") profitOnly++;
    else if (d.decision === "partial_exit") partialCount++;
    else if (d.decision === "exit") withdrawAll++;
  }

  const pendingProcessing = investments.filter(
    (i) => i.status === "matured" && !i.next_investment_id
  ).length;

  // The date the portal will actually stop accepting an instruction.
  // Read from rollover_decision_deadline() rather than rebuilt here:
  // COALESCE(rollover_deadline, end_date) misses the five-day window
  // from migration 027 entirely, and an administrator chasing people
  // was being told the window shut five days before it does.
  const deadline =
    (await instructionDeadline(db, id)) ?? cycle.rollover_deadline ?? cycle.end_date;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/admin/series" className="hover:text-foreground transition-colors flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" />
          Series Management
        </Link>
        <span>/</span>
        <span className="text-foreground">
          Series {series?.name} · {cycle.cycle_label} · Rollover
        </span>
      </div>

      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Rollover — Series {series?.name}, {cycle.cycle_label}
          </h1>
          <p className="text-sm text-muted mt-1">
            {formatDate(cycle.start_date)} — {formatDate(cycle.end_date)} ·{" "}
            <Badge variant={cycle.status === "completed" ? "completed" : "pending"} dot>
              {cycle.status.replaceAll("_", " ")}
            </Badge>
          </p>
          <p className="text-xs text-muted mt-2">
            Instructions lock at maturity ({formatDate(deadline)}). Default for investors
            with no instruction: declared profit is paid to their bank account and their
            capital continues into the next cycle.
          </p>
        </div>
      </div>

      {/* Preconditions */}
      {!profitDecl && (
        <div className="flex items-start gap-3 rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
          <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-amber-900 text-sm">
              Profit has not been declared for this cycle
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              The rollover uses the actual declared Mudārabah profit — there is no preset
              ROI. Declare the profit first, then process the rollover.
            </p>
            <Link
              href={`/admin/cycles/${cycle.id}/declare-profit`}
              className="inline-flex items-center gap-1.5 mt-2 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition-colors"
            >
              Declare Profit <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Investors in maturing cycle", value: String(total), icon: <Users className="h-4 w-4" /> },
          { label: "No response (default: continue)", value: String(autoContinue), icon: <Clock className="h-4 w-4" /> },
          { label: "Capital continues (Option 1)", value: String(profitOnly), icon: <RefreshCw className="h-4 w-4" /> },
          { label: "Partial withdrawals (Option 3)", value: String(partialCount), icon: <Wallet className="h-4 w-4" /> },
          { label: "Withdrawing everything (Option 2)", value: String(withdrawAll), icon: <Wallet className="h-4 w-4" /> },
          { label: "Legacy full rollovers", value: String(rollAll), icon: <RefreshCw className="h-4 w-4" /> },
          { label: "Failed / incomplete", value: String(failed), icon: <AlertTriangle className="h-4 w-4" />, alert: failed > 0 },
          { label: "Processed", value: `${processed}/${total}`, icon: <RefreshCw className="h-4 w-4" /> },
        ].map((s) => (
          <Card key={s.label} className={s.alert ? "border-red-300" : ""}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-muted text-xs">
                {s.icon}
                <span className="uppercase tracking-wide text-[10px]">{s.label}</span>
              </div>
              <p className={`text-2xl font-bold mt-1 ${s.alert ? "text-red-600" : "text-foreground"}`}>
                {s.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Money totals */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted uppercase tracking-wide">Total capital continuing</p>
            <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(capitalContinuing)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted uppercase tracking-wide">Total profit rolled over</p>
            <p className="text-xl font-bold text-emerald-600 mt-1">{formatCurrency(profitRolled)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-[10px] text-muted uppercase tracking-wide">Total withdrawal amount</p>
            <p className="text-xl font-bold text-gold-600 mt-1">{formatCurrency(withdrawalTotal)}</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <RolloverActions
        cycleId={cycle.id}
        seriesName={series?.name ?? "?"}
        profitDeclared={!!profitDecl}
        pendingProcessing={pendingProcessing}
        failedCount={failed}
        rolloverProcessedAt={cycle.rollover_processed_at}
        isSuperAdmin={isSuperAdmin}
        nextCycle={nextCycle as { id: string; cycle_label: string; start_date: string; end_date: string; status: string } | null}
      />

      {/* Per-investor table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Rollover Details</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2">
                <tr>
                  {["Investor", "Slots", "Capital", "Declared Profit", "Decision", "Status"].map((h) => (
                    <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {investments.map((inv) => {
                  const d = decisions.get(inv.id);
                  const r = rollovers.get(inv.id);
                  const decisionText = d
                    ? DECISION_LABEL[d.decision]
                    : "No response — default: profit paid, capital continues";
                  const statusText = r
                    ? r.status === "failed"
                      ? `Failed: ${r.error}`
                      : r.status === "withdrawn"
                      ? "Withdrawn"
                      : "Rolled over"
                    : inv.status === "matured"
                    ? "Pending processing"
                    : inv.status === "completed"
                    ? "Settled"
                    : "Cycle running";
                  return (
                    <tr key={inv.id} className="hover:bg-primary-50/30 transition-colors">
                      <td className="py-3 px-4">
                        <p className="font-semibold text-foreground">{inv.investor?.full_name}</p>
                        <p className="text-xs font-mono text-muted">
                          {inv.investor?.investor_code} · {inv.investment_code}
                        </p>
                      </td>
                      <td className="py-3 px-4">{inv.units}</td>
                      <td className="py-3 px-4">{formatCurrency(inv.capital)}</td>
                      <td className="py-3 px-4">
                        {inv.declared_profit != null ? (
                          <span className="text-emerald-600 font-semibold">
                            {formatCurrency(inv.declared_profit)}
                          </span>
                        ) : (
                          <span className="text-xs text-muted">Not declared</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {decisionText}
                        {d?.via === "admin_exception" && (
                          <span className="ml-1 text-[10px] text-purple-600 font-semibold">(exception)</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <span
                          className={
                            r?.status === "failed"
                              ? "text-red-600 font-semibold"
                              : r
                              ? "text-emerald-600 font-semibold"
                              : "text-muted"
                          }
                        >
                          {statusText}
                        </span>
                        {r && !r.email_sent && r.status !== "failed" && (
                          <span className="ml-1 text-[10px] text-amber-600">(email pending)</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
