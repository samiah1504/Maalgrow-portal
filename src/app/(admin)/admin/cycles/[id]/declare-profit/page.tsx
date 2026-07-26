import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft, ArrowRight, Layers } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeclareProfitForm } from "./_declare-profit-form";
import { mudarabahDb } from "@/lib/mudarabah/db";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Declare Profit | Admin" };

const ALLOWED_ROLES = ["super_admin", "administrator", "finance"];

export default async function DeclareProfitPage({
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

  if (!profile || !ALLOWED_ROLES.includes(profile.role ?? "")) {
    redirect("/admin/dashboard");
  }

  const { data: cycle } = await supabase
    .from("cycles")
    .select("id, cycle_label, status, total_capital, total_investors, series(mudarabah_investor_ratio)")
    .eq("id", id)
    .single();

  if (!cycle) notFound();

  if (
    cycle.status !== "awaiting_profit_declaration" &&
    cycle.status !== "active"
  ) {
    redirect(`/admin/cycles`);
  }

  // A cycle with a trading ledger declares its profit by SETTLING the
  // ledger — which runs the engine, writes the frozen snapshot and
  // calls declare_cycle_profit itself. Declaring by hand as well would
  // overwrite that with figures nobody can trace back to the trading,
  // and whichever ran last would win. So this form steps aside.
  const { data: ledger } = await mudarabahDb(supabase)
    .from("mudarabah_ledgers")
    .select("cycle_id")
    .eq("cycle_id", id)
    .maybeSingle();

  if (ledger) {
    return (
      <div className="max-w-lg mx-auto space-y-6 animate-fade-in">
        <div className="flex items-center gap-3">
          <Link
            href="/admin/cycles"
            className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Cycles
          </Link>
        </div>

        <div>
          <h1 className="text-2xl font-bold text-foreground">Declare Cycle Profit</h1>
          <p className="text-sm text-muted mt-1">
            <span className="font-semibold text-foreground">{cycle.cycle_label}</span> has a
            Mudarabah trading ledger.
          </p>
        </div>

        <Card>
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-100 text-amber-700 shrink-0">
                <Layers className="h-4.5 w-4.5" />
              </div>
              <div className="space-y-2">
                <p className="text-sm font-semibold text-foreground">
                  Profit for this cycle is declared by settling its ledger.
                </p>
                <p className="text-sm text-muted leading-relaxed">
                  The ledger records three months of real trading. Settling it runs
                  the figures, freezes them as a snapshot every investor statement
                  reads from, and declares the profit here as part of the same step.
                </p>
                <p className="text-sm text-muted leading-relaxed">
                  Entering revenue and expenses by hand as well would replace those
                  figures with ones that no longer match the trading behind them.
                </p>
              </div>
            </div>
            <Link
              href={`/admin/mudarabah/${id}`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-700 px-3.5 py-2 text-xs font-semibold text-white"
            >
              Open the trading ledger
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  const seriesData = cycle.series as unknown as { mudarabah_investor_ratio: number } | null;

  const cycleInfo = {
    id: cycle.id,
    cycle_label: cycle.cycle_label,
    total_capital: cycle.total_capital,
    total_investors: cycle.total_investors,
    mudarabah_investor_ratio: seriesData?.mudarabah_investor_ratio ?? 0.7,
  };

  return (
    <div className="max-w-lg mx-auto space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/cycles"
          className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Cycles
        </Link>
      </div>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Declare Cycle Profit</h1>
        <p className="text-sm text-muted mt-1">
          Enter the final financial figures for{" "}
          <span className="font-semibold text-foreground">{cycle.cycle_label}</span>. The
          system will calculate each investor&apos;s profit share and notify them immediately.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Financial Declaration</CardTitle>
        </CardHeader>
        <CardContent>
          <DeclareProfitForm cycle={cycleInfo} />
        </CardContent>
      </Card>
    </div>
  );
}
