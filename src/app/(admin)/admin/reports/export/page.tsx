import Link from "next/link";
import type { Metadata } from "next";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EXPORT_ROLES, MG_CONTACT_FIELDS, MG_INVESTMENT_FIELDS, fieldOptions } from "@/lib/export/investor-export";
import { ExportPanel } from "@/components/export/export-panel";

export const metadata: Metadata = { title: "Export investors | Admin" };

/** MaalGrow Investor Data Export: everyone with an investment in one series (or one of its cycles). */
export default async function ExportInvestorsPage() {
  const { supabase, role } = await requireAdminPage(EXPORT_ROLES);
  const db = supabase as unknown as SupabaseClient;
  const [{ data: series }, { data: cycles }] = await Promise.all([
    db.from("series").select("id, name").order("name"),
    db.from("cycles").select("id, series_id, cycle_label, cycle_number").order("cycle_number", { ascending: false }),
  ]);
  const nameOf = Object.fromEntries((series ?? []).map((s) => [s.id as string, s.name as string]));

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start gap-3">
        <Link href="/admin/reports" aria-label="Back to Reports" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Export investors</h1>
          <p className="text-sm text-muted mt-1">
            Download the details of everyone invested in a MaalGrow series — a phone list for communication, or an investment report.
            For MaalRise, use <Link href="/admin/maalrise/reports#export" className="text-primary-700 hover:underline">MaalRise Reports</Link>.
          </p>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-base">MaalGrow — by series</CardTitle></CardHeader>
        <CardContent>
          <ExportPanel
            product="maalgrow"
            series={(series ?? []).map((s) => s.name as string)}
            cycles={(cycles ?? []).map((c) => ({ id: c.id as string, series: nameOf[c.series_id as string] ?? "", label: c.cycle_label as string }))}
            contactFields={fieldOptions(MG_CONTACT_FIELDS)}
            investmentFields={fieldOptions(MG_INVESTMENT_FIELDS)}
            canUnmask={role === "super_admin"}
          />
        </CardContent>
      </Card>
    </div>
  );
}
