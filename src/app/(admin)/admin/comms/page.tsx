import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { MessageSquare } from "lucide-react";
import { CommsCenter } from "./_comms-center";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Communication Centre | Admin" };
export const revalidate = 0;

const COMMS_ROLES = ["super_admin", "administrator"];

export default async function CommsPage() {
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
  if (!profile || !COMMS_ROLES.includes(profile.role ?? "")) redirect("/admin");

  const db = await createAdminClient();
  const [{ data: rawSeries }, { data: rawTemplates }, { data: rawCampaigns }] =
    await Promise.all([
      db
        .from("series")
        .select(
          "id, name, cycles(id, cycle_label, start_date, end_date, status, total_investors)"
        )
        .order("name"),
      db
        .from("comm_templates")
        .select("*")
        .order("is_builtin", { ascending: false })
        .order("name"),
      db
        .from("comm_campaigns")
        .select(
          "*, series:series_id(name), creator:created_by(full_name, email)"
        )
        .order("created_at", { ascending: false })
        .limit(50),
    ]);

  type SeriesRow = {
    id: string;
    name: string;
    cycles: {
      id: string;
      cycle_label: string;
      start_date: string;
      end_date: string;
      status: string;
      total_investors: number;
    }[];
  };

  const series = ((rawSeries ?? []) as unknown as SeriesRow[]).map((s) => {
    const active =
      s.cycles?.find((c) => c.status === "active") ??
      s.cycles?.find((c) => ["subscription_open", "subscription_closed", "upcoming"].includes(c.status)) ??
      null;
    return {
      id: s.id,
      name: s.name,
      cycle_label: active?.cycle_label ?? null,
      start_date: active?.start_date ?? null,
      end_date: active?.end_date ?? null,
      status: active?.status ?? "no active cycle",
      investors: active?.total_investors ?? 0,
    };
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Communication Centre</h1>
          <p className="text-sm text-muted mt-0.5">
            SMS &amp; WhatsApp updates to existing MaalGrow investors — maturity
            notices, payment notifications, portal migration and announcements
          </p>
        </div>
      </div>

      <CommsCenter
        series={series}
        initialTemplates={rawTemplates ?? []}
        initialCampaigns={(rawCampaigns ?? []) as never[]}
        isSuperAdmin={profile.role === "super_admin"}
      />
    </div>
  );
}
