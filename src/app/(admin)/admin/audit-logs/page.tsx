import { requireAdminPage } from "@/lib/admin-guard";
import { Shield, Search } from "lucide-react";
import { formatDateTime } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Audit Logs" };

export default async function AuditLogsPage({ searchParams }: { searchParams: Promise<{ q?: string; entity?: string; page?: string }> }) {
  const { q, entity, page: pageStr } = await searchParams;
  const page = parseInt(pageStr ?? "1");
  const pageSize = 25;
  const from = (page - 1) * pageSize;

  // Role checked HERE, not only in the middleware. This page reads
  // with the service-role client, so there is no RLS behind it.
  const { supabase } = await requireAdminPage();

  type AuditLogRow = {
    id: string;
    user_id: string | null;
    action: string;
    entity_type: string;
    entity_id: string | null;
    created_at: string;
    profile: { full_name: string; email: string } | null;
  };

  let query = supabase
    .from("audit_logs")
    .select("id, user_id, action, entity_type, entity_id, created_at, profile:profiles(full_name, email)", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (entity) query = query.eq("entity_type", entity);
  if (q) query = query.ilike("action", `%${q}%`);

  const { data: rawLogs, count } = await query;
  const logs = rawLogs as AuditLogRow[] | null;
  const totalPages = Math.ceil((count ?? 0) / pageSize);

  const entityTypes = ["investor", "investment", "payment_request", "cycle", "series", "user", "announcement"];

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Audit Logs</h1>
        <p className="text-sm text-muted mt-1">Complete record of all system activities</p>
      </div>

      {/* Filters */}
      <form className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            name="q"
            defaultValue={q}
            placeholder="Search by action..."
            className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm placeholder:text-muted/60 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <select
          name="entity"
          defaultValue={entity}
          className="h-10 rounded-lg border border-border bg-white px-3 text-sm focus:border-primary-500 focus:outline-none"
        >
          <option value="">All Entity Types</option>
          {entityTypes.map((e) => (
            <option key={e} value={e}>{e.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())}</option>
          ))}
        </select>
        <button type="submit" className="h-10 rounded-lg bg-primary-700 px-4 text-sm font-medium text-white hover:bg-primary-600 transition-colors">
          Filter
        </button>
      </form>

      <Card>
        <CardContent className="p-0">
          {!logs || logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center">
              <Shield className="h-12 w-12 text-border mb-4" />
              <p className="font-semibold text-foreground">No audit logs found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border bg-surface-2">
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase">Timestamp</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase">User</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase">Action</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase">Entity</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-muted uppercase hidden lg:table-cell">Entity ID</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(logs as (typeof logs[number] & { profile?: { full_name: string; email: string } | null })[]).map((log) => {
                    const profile = log.profile as { full_name: string; email: string } | null;
                    return (
                      <tr key={log.id} className="hover:bg-primary-50/20 transition-colors">
                        <td className="py-2.5 px-4 text-xs text-muted font-mono whitespace-nowrap">
                          {formatDateTime(log.created_at)}
                        </td>
                        <td className="py-2.5 px-4">
                          <div>
                            <p className="text-xs font-medium text-foreground">{profile?.full_name ?? "System"}</p>
                            <p className="text-[10px] text-muted">{profile?.email}</p>
                          </div>
                        </td>
                        <td className="py-2.5 px-4">
                          <span className="inline-flex items-center rounded-md bg-primary-50 px-2 py-0.5 text-xs font-medium text-primary-700">
                            {log.action}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-xs text-muted capitalize">
                          {log.entity_type.replace(/_/g, " ")}
                        </td>
                        <td className="py-2.5 px-4 hidden lg:table-cell">
                          <span className="text-[10px] font-mono text-muted truncate max-w-[120px] block">
                            {log.entity_id ?? "—"}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted">
            Showing {from + 1}–{Math.min(from + pageSize, count ?? 0)} of {count} entries
          </p>
          <div className="flex gap-2">
            {page > 1 && (
              <a href={`?q=${q ?? ""}&entity=${entity ?? ""}&page=${page - 1}`}
                className="h-9 px-3 rounded-lg border border-border text-sm flex items-center hover:bg-primary-50 transition-colors">
                Previous
              </a>
            )}
            {page < totalPages && (
              <a href={`?q=${q ?? ""}&entity=${entity ?? ""}&page=${page + 1}`}
                className="h-9 px-3 rounded-lg border border-border text-sm flex items-center hover:bg-primary-50 transition-colors">
                Next
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
