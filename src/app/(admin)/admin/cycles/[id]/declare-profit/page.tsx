import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DeclareProfitForm } from "./_declare-profit-form";
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
