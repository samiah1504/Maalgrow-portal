import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { CampaignActions } from "./_campaign-actions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Campaign | Communication Centre" };
export const revalidate = 0;

const COMMS_ROLES = ["super_admin", "administrator"];

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-surface-2 text-muted",
  queued: "bg-blue-100 text-blue-700",
  processing: "bg-amber-100 text-amber-700",
  sent: "bg-emerald-100 text-emerald-700",
  partially_sent: "bg-amber-100 text-amber-700",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-surface-2 text-muted",
};

export default async function CampaignPage({
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
  if (!profile || !COMMS_ROLES.includes(profile.role ?? "")) redirect("/admin");

  const db = await createAdminClient();
  const [{ data: campaign }, { data: rawRecipients }] = await Promise.all([
    db
      .from("comm_campaigns")
      .select("*, series:series_id(name), creator:created_by(full_name, email)")
      .eq("id", id)
      .single(),
    db
      .from("comm_recipients")
      .select("*, investor:investors(full_name, investor_code)")
      .eq("campaign_id", id)
      .order("status"),
  ]);

  if (!campaign) notFound();

  type Recip = {
    id: string;
    status: string;
    channel_used: string | null;
    sms_fallback_used: boolean;
    phone_normalized: string | null;
    skip_reason: string | null;
    error: string | null;
    attempts: number;
    sent_at: string | null;
    provider_response: unknown;
    investor: { full_name: string; investor_code: string } | null;
  };
  const recipients = (rawRecipients ?? []) as unknown as Recip[];
  const creator = campaign.creator as unknown as { full_name: string | null; email: string } | null;
  const seriesRef = campaign.series as unknown as { name: string } | null;

  const pendingCount = recipients.filter((r) => r.status === "pending").length;
  const failedCount = recipients.filter((r) => r.status === "failed").length;

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/admin/comms" className="hover:text-foreground transition-colors flex items-center gap-1">
          <MessageSquare className="h-3.5 w-3.5" />
          Communication Centre
        </Link>
        <span>/</span>
        <span className="text-foreground">{campaign.name}</span>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-3">
            {campaign.name}
            <span className={cn("text-xs font-semibold px-2.5 py-1 rounded-full", STATUS_STYLE[campaign.status])}>
              {campaign.status.replaceAll("_", " ")}
            </span>
          </h1>
          <p className="text-sm text-muted mt-1">
            Created by {creator?.full_name ?? creator?.email ?? "—"} on {formatDate(campaign.created_at)} ·{" "}
            {campaign.recipient_group === "series"
              ? `Series ${seriesRef?.name ?? "?"}`
              : campaign.recipient_group === "all_active"
              ? "All active investors"
              : "Individually selected investors"}{" "}
            · {campaign.channel.replaceAll("_", " ")}
          </p>
        </div>
        <CampaignActions
          campaignId={campaign.id}
          status={campaign.status}
          pendingCount={pendingCount}
          failedCount={failedCount}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {[
          { label: "Recipients", value: String(campaign.total_recipients) },
          { label: "Successful", value: String(campaign.sent_count), cls: "text-emerald-600" },
          { label: "Failed", value: String(campaign.failed_count), cls: campaign.failed_count > 0 ? "text-red-600" : "" },
          { label: "Skipped", value: String(campaign.skipped_count) },
          ...(campaign.channel === "email"
            ? [
                { label: "Delivered", value: String(campaign.delivered_count ?? 0), cls: "text-emerald-600" },
                { label: "Opened", value: String(campaign.opened_count ?? 0) },
                { label: "Bounced", value: String(campaign.bounced_count ?? 0), cls: (campaign.bounced_count ?? 0) > 0 ? "text-red-600" : "" },
              ]
            : [{ label: "Estimated Cost", value: formatCurrency(campaign.estimated_cost) }]),
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-3">
              <p className="text-[10px] text-muted uppercase tracking-wide">{s.label}</p>
              <p className={cn("text-lg font-bold mt-0.5", s.cls || "text-foreground")}>{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Message */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Message Template</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm whitespace-pre-wrap rounded-lg bg-surface-2 p-4">{campaign.message_body}</p>
        </CardContent>
      </Card>

      {/* Recipients */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Delivery Status</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-surface-2 sticky top-0">
                <tr>
                  {["Investor", "Phone", "Channel", "Status", "Attempts", "Sent At", "Details"].map((h) => (
                    <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold text-muted uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {recipients.map((r) => (
                  <tr key={r.id} className={r.status === "failed" ? "bg-red-50/40" : ""}>
                    <td className="py-2.5 px-3">
                      <p className="font-medium">{r.investor?.full_name}</p>
                      <p className="text-[11px] font-mono text-muted">{r.investor?.investor_code}</p>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-xs">{r.phone_normalized ?? "—"}</td>
                    <td className="py-2.5 px-3 text-xs">
                      {r.channel_used ?? "—"}
                      {r.sms_fallback_used && <span className="ml-1 text-[10px] text-amber-600">(SMS fallback)</span>}
                    </td>
                    <td className="py-2.5 px-3">
                      <span className={cn(
                        "text-xs font-semibold px-2 py-0.5 rounded-full",
                        r.status === "sent" ? "bg-emerald-100 text-emerald-700"
                          : r.status === "failed" ? "bg-red-100 text-red-700"
                          : r.status === "skipped" ? "bg-surface-2 text-muted"
                          : "bg-blue-100 text-blue-700"
                      )}>
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-xs">{r.attempts}</td>
                    <td className="py-2.5 px-3 text-xs">{r.sent_at ? formatDate(r.sent_at) : "—"}</td>
                    <td className="py-2.5 px-3 text-xs text-muted max-w-[280px]">
                      {r.error ?? r.skip_reason ?? ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
