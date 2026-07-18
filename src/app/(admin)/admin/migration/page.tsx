import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { UploadCloud } from "lucide-react";
import { MigrationWizard } from "./_migration-wizard";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Bulk Investor Migration | Admin" };
export const revalidate = 0;

export default async function MigrationPage() {
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
  if (!profile || profile.role !== "super_admin") redirect("/admin");

  const db = await createAdminClient();
  const [{ data: rawSeries }, { data: rawHistory }] = await Promise.all([
    db
      .from("series")
      .select(
        "id, name, price_per_unit, cycles(id, cycle_label, start_date, end_date, status, cycle_number)"
      )
      .order("name"),
    db
      .from("migration_batches")
      .select(
        "*, series:series_id(name), cycle:cycle_id(cycle_label), uploader:uploaded_by(full_name, email)"
      )
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  type SeriesOption = {
    id: string;
    name: string;
    price_per_unit: number;
    cycles: {
      id: string;
      cycle_label: string;
      start_date: string;
      end_date: string;
      status: string;
      cycle_number: number;
    }[];
  };
  type HistoryRow = {
    id: string;
    source: string;
    source_name: string | null;
    status: string;
    total_rows: number;
    imported_count: number;
    failed_count: number;
    skipped_count: number;
    created_at: string;
    series: { name: string } | null;
    cycle: { cycle_label: string } | null;
    uploader: { full_name: string | null; email: string } | null;
  };

  const series = (rawSeries ?? []) as unknown as SeriesOption[];
  const history = (rawHistory ?? []) as unknown as HistoryRow[];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <UploadCloud className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Bulk Investor Migration</h1>
          <p className="text-sm text-muted mt-0.5">
            Import existing investors series by series from Google Sheets, Excel, or CSV
          </p>
        </div>
      </div>

      <MigrationWizard
        series={series.map((s) => ({
          ...s,
          cycles: [...(s.cycles ?? [])].sort((a, b) => b.cycle_number - a.cycle_number),
        }))}
      />

      {/* ── Migration History ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Migration History</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {history.length === 0 ? (
            <p className="text-sm text-muted text-center py-10">
              No migrations yet. Your import history will appear here permanently.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface-2">
                  <tr>
                    {["Date", "Series", "Cycle", "Uploaded By", "Rows", "Imported", "Failed", "Skipped", "Status", "Reports"].map((h) => (
                      <th key={h} className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase tracking-wide">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {history.map((b) => (
                    <tr key={b.id} className="hover:bg-primary-50/30 transition-colors">
                      <td className="py-3 px-4 text-xs">{formatDate(b.created_at)}</td>
                      <td className="py-3 px-4 font-semibold">Series {b.series?.name}</td>
                      <td className="py-3 px-4 text-xs">{b.cycle?.cycle_label}</td>
                      <td className="py-3 px-4 text-xs">
                        {b.uploader?.full_name ?? b.uploader?.email ?? "—"}
                      </td>
                      <td className="py-3 px-4">{b.total_rows}</td>
                      <td className="py-3 px-4 text-emerald-600 font-semibold">{b.imported_count}</td>
                      <td className={`py-3 px-4 font-semibold ${b.failed_count > 0 ? "text-red-600" : "text-muted"}`}>
                        {b.failed_count}
                      </td>
                      <td className="py-3 px-4 text-muted">{b.skipped_count}</td>
                      <td className="py-3 px-4">
                        <span
                          className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                            b.status === "completed"
                              ? "bg-emerald-100 text-emerald-700"
                              : b.status === "cancelled"
                              ? "bg-surface-2 text-muted"
                              : "bg-amber-100 text-amber-700"
                          }`}
                        >
                          {b.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-xs space-x-2 whitespace-nowrap">
                        <a className="text-primary-600 hover:underline" href={`/api/admin/migration/batches/${b.id}/report?type=full`}>Full</a>
                        <a className="text-red-600 hover:underline" href={`/api/admin/migration/batches/${b.id}/report?type=errors`}>Errors</a>
                        <a className="text-emerald-600 hover:underline" href={`/api/admin/migration/batches/${b.id}/report?type=success`}>Success</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
