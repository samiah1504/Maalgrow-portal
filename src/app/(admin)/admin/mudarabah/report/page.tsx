import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FileText } from "lucide-react";
import { mudarabahDb } from "@/lib/mudarabah/db";
import type { PickerCycle, PickerSeries } from "../_cycle-picker";
import { ReportPreview } from "./_report-preview";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Report preview | Admin" };
export const revalidate = 0;

const ADMIN_ROLES = ["super_admin", "administrator"];

/**
 * See the investor's statement before the investor does.
 *
 * The same resolver, renderer and stylesheet the portal and the email
 * job will use — so what is checked here is what is sent.
 */
export default async function MudarabahReportPreviewPage() {
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
  if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) redirect("/admin");

  const db = mudarabahDb(await createAdminClient());

  const [{ data: series }, { data: cycles }, { data: ledgers }] = await Promise.all([
    db.from("series").select("id, name").order("name"),
    db
      .from("cycles")
      .select("id, series_id, cycle_label, start_date, end_date, status, total_slots, total_investors")
      .order("start_date", { ascending: false }),
    db.from("mudarabah_ledgers").select("cycle_id, status"),
  ]);

  const ledgerByCycle = new Map(
    (ledgers ?? []).map((l) => [l.cycle_id, l.status as string])
  );

  const pickerSeries: PickerSeries[] = (series ?? []).map((s) => ({
    id: s.id,
    name: String(s.name),
  }));

  const pickerCycles: PickerCycle[] = (cycles ?? []).map((c) => ({
    id: c.id,
    seriesId: c.series_id,
    label: c.cycle_label,
    startDate: c.start_date,
    endDate: c.end_date,
    status: c.status,
    totalSlots: Number(c.total_slots ?? 0),
    investors: Number(c.total_investors ?? 0),
    ledgerStatus: ledgerByCycle.get(c.id) ?? null,
  }));

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <Link
          href="/admin/mudarabah"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back to the ledger
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <FileText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Report preview</h1>
          <p className="text-sm text-muted mt-0.5">
            Exactly what an investor receives — three pages, aggregate figures
            only, no product ever named
          </p>
        </div>
      </div>

      <ReportPreview series={pickerSeries} cycles={pickerCycles} />
    </div>
  );
}
