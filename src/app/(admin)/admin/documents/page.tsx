import { requireAdminPage } from "@/lib/admin-guard";
import { FileText, Download, Eye } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Documents | Admin" };

type DocumentRow = {
  id: string;
  title: string;
  document_type: string;
  file_url: string;
  created_at: string;
  investor: { full_name: string; investor_code: string } | null;
  investment: { investment_code: string; series: { name: string } | null } | null;
};

const docTypeConfig: Record<string, { label: string; color: string }> = {
  certificate: { label: "Certificate", color: "bg-gold-100 text-gold-700" },
  statement: { label: "Statement", color: "bg-primary-100 text-primary-700" },
  agreement: { label: "Agreement", color: "bg-blue-100 text-blue-700" },
  kyc: { label: "KYC", color: "bg-emerald-100 text-emerald-700" },
  other: { label: "Other", color: "bg-gray-100 text-gray-700" },
};

export default async function AdminDocumentsPage() {
  // Role checked HERE, not only in the middleware. This page reads
  // with the service-role client, so there is no RLS behind it.
  const { supabase } = await requireAdminPage();

  const { data: rawDocs } = await supabase
    .from("documents")
    .select("*, investor:investors(full_name, investor_code), investment:investments(investment_code, series(name))")
    .order("created_at", { ascending: false });

  const docs = rawDocs as unknown as DocumentRow[] | null;

  const grouped = docs?.reduce<Record<string, DocumentRow[]>>((acc, doc) => {
    const key = doc.document_type ?? "other";
    if (!acc[key]) acc[key] = [];
    acc[key].push(doc);
    return acc;
  }, {}) ?? {};

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Documents</h1>
          <p className="text-sm text-muted mt-1">Investment certificates, statements, and agreements</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-foreground">{docs?.length ?? 0}</p>
          <p className="text-xs text-muted">total documents</p>
        </div>
      </div>

      {!docs || docs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-border mb-4" />
            <p className="font-medium text-foreground">No documents yet</p>
            <p className="text-sm text-muted mt-1">Documents are generated when investments are processed.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2">
                    <th className="px-4 py-3 text-left font-medium text-muted">Document</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Type</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Investor</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Investment</th>
                    <th className="px-4 py-3 text-left font-medium text-muted">Date</th>
                    <th className="px-4 py-3 text-center font-medium text-muted">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {docs.map((doc) => {
                    const typeConfig = docTypeConfig[doc.document_type] ?? docTypeConfig.other;
                    return (
                      <tr key={doc.id} className="hover:bg-surface-2 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <FileText className="h-4 w-4 text-muted flex-shrink-0" />
                            <span className="font-medium text-foreground">{doc.title}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${typeConfig.color}`}>
                            {typeConfig.label}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-foreground">{doc.investor?.full_name ?? "—"}</p>
                          <p className="text-xs text-muted font-mono">{doc.investor?.investor_code}</p>
                        </td>
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs text-muted">{doc.investment?.investment_code ?? "—"}</p>
                          {doc.investment?.series?.name && (
                            <p className="text-xs text-muted">Series {doc.investment.series.name}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-muted">{formatDate(doc.created_at)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-center gap-2">
                            {doc.file_url && (
                              <>
                                <a
                                  href={doc.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1 rounded-lg bg-primary-50 text-primary-700 px-2.5 py-1 text-xs font-medium hover:bg-primary-100 transition-colors"
                                >
                                  <Eye className="h-3 w-3" /> View
                                </a>
                                <a
                                  href={doc.file_url}
                                  download
                                  className="flex items-center gap-1 rounded-lg bg-surface-2 text-foreground px-2.5 py-1 text-xs font-medium hover:bg-border transition-colors"
                                >
                                  <Download className="h-3 w-3" /> Download
                                </a>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
