import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Layers } from "lucide-react";
import { mudarabahDb } from "@/lib/mudarabah/db";
import { CyclePicker, type PickerCycle, type PickerSeries } from "./_cycle-picker";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mudarabah Ledger | Admin" };
export const revalidate = 0;

const ADMIN_ROLES = ["super_admin", "administrator"];

export default async function MudarabahPage() {
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

  // The EXISTING series and cycles. The ledger attaches to these; it
  // never keeps a cycle of its own.
  const [{ data: series }, { data: cycles }, { data: ledgers }] = await Promise.all([
    db.from("series").select("id, name, price_per_unit").order("name"),
    db
      .from("cycles")
      .select("id, series_id, cycle_number, cycle_label, start_date, end_date, status, total_slots, total_investors")
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
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <Layers className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Mudarabah Ledger</h1>
          <p className="text-sm text-muted mt-0.5">
            Three months of trading recorded against an existing cycle — profit is
            shared as a ratio of what the trade actually realised
          </p>
        </div>
      </div>

      <CyclePicker series={pickerSeries} cycles={pickerCycles} />
    </div>
  );
}
