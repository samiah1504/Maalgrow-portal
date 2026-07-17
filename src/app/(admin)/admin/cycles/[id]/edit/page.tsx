import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EditCycleForm } from "./_edit-cycle-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Edit Cycle | Admin" };

const ALLOWED_ROLES = ["super_admin", "administrator"];

export default async function EditCyclePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !ALLOWED_ROLES.includes(profile.role ?? "")) {
    redirect("/admin/cycles");
  }

  const adminClient = await createAdminClient();

  const { data: rawCycle } = await adminClient
    .from("cycles")
    .select("id, cycle_label, start_date, end_date, status, subscription_open_date, subscription_close_date, unit_value, notes, series(name)")
    .eq("id", id)
    .single();

  if (!rawCycle) notFound();

  type CycleRow = {
    id: string;
    cycle_label: string;
    start_date: string;
    end_date: string;
    status: string;
    subscription_open_date: string | null;
    subscription_close_date: string | null;
    unit_value: number | null;
    notes: string | null;
    series: { name: string } | null;
  };
  const cycle = rawCycle as unknown as CycleRow;

  const { data: rawAudit } = await adminClient
    .from("cycle_audit_log")
    .select("id, action, changes, changed_at, changed_by")
    .eq("cycle_id", id)
    .order("changed_at", { ascending: false })
    .limit(20);

  type AuditEntry = {
    id: string;
    action: string;
    changes: Record<string, unknown>;
    changed_at: string;
    changed_by: string | null;
  };
  const auditLog = (rawAudit ?? []) as unknown as AuditEntry[];

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
        <h1 className="text-2xl font-bold text-foreground">Edit Cycle</h1>
        <p className="text-sm text-muted mt-1">
          <span className="font-semibold text-foreground">{cycle.cycle_label}</span> —
          update dates, status, or other cycle details.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Cycle Details</CardTitle>
        </CardHeader>
        <CardContent>
          <EditCycleForm cycle={cycle} auditLog={auditLog} />
        </CardContent>
      </Card>
    </div>
  );
}
