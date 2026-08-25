import { requireAdminPage } from "@/lib/admin-guard";
import { NewInvestorForm } from "./_new-investor-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Add Investor | Admin" };

export default async function NewInvestorPage() {
  // Role checked HERE, not only in the middleware. This page reads
  // with the service-role client, so there is no RLS behind it.
  const { supabase } = await requireAdminPage();

  // Fetch series and cycles for the investment form
  const [{ data: series }, { data: cycles }] = await Promise.all([
    supabase
      .from("series")
      .select("id, name, mudarabah_investor_ratio, is_active")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("cycles")
      .select("id, series_id, cycle_number, cycle_label, start_date, end_date, status")
      .in("status", ["upcoming", "active"])
      .order("series_id")
      .order("cycle_number"),
  ]);

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <Link
        href="/admin/investors"
        className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Investors
      </Link>

      <NewInvestorForm series={series ?? []} cycles={cycles ?? []} />
    </div>
  );
}
