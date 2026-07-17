import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Layers } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeriesSettingsForm } from "./_settings-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Series Settings" };

const ALLOWED_ROLES = ["super_admin", "administrator"];

export default async function SeriesSettingsPage({
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
    redirect("/admin");
  }

  const { data: series } = await supabase
    .from("series")
    .select(
      "id, name, description, mudarabah_investor_ratio, price_per_unit, min_units, max_units, is_active"
    )
    .eq("id", id)
    .single();

  if (!series) notFound();

  const investorPct = Math.round(series.mudarabah_investor_ratio * 100);

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/admin/series" className="hover:text-foreground transition-colors flex items-center gap-1">
          <Layers className="h-3.5 w-3.5" />
          Series Management
        </Link>
        <span>/</span>
        <span className="text-foreground">Series {series.name} Settings</span>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-foreground">
          Series {series.name} — Settings
        </h1>
        <p className="text-sm text-muted mt-1">
          Current: {investorPct}% investor / {100 - investorPct}% company profit sharing ·{" "}
          ₦{series.price_per_unit.toLocaleString("en-NG")} per slot ·{" "}
          Min {series.min_units} slot{series.min_units !== 1 ? "s" : ""}
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Series Configuration</CardTitle>
        </CardHeader>
        <CardContent>
          <SeriesSettingsForm series={series} />
        </CardContent>
      </Card>
    </div>
  );
}
