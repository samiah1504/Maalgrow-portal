import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { CreateCycleForm } from "./_create-cycle-form";
import { SLOT_VALUE_NGN } from "@/lib/investment-utils";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Create Cycle | Admin" };

const ALLOWED_ROLES = ["super_admin", "administrator"];

export default async function CreateCyclePage() {
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

  const { data: rawSeries } = await supabase
    .from("series")
    .select("id, name")
    .eq("is_active", true)
    .order("name");

  const series = (rawSeries ?? []) as { id: string; name: "A" | "B" | "C" }[];

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
        <h1 className="text-2xl font-bold text-foreground">Create Cycle</h1>
        <p className="text-sm text-muted mt-1">
          Set up a new 3-month Mudārabah investment cycle. The maturity date is
          calculated automatically as exactly 3 calendar months from the start date.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Cycle Details</CardTitle>
        </CardHeader>
        <CardContent>
          <CreateCycleForm series={series} defaultUnitValue={SLOT_VALUE_NGN} />
        </CardContent>
      </Card>
    </div>
  );
}
