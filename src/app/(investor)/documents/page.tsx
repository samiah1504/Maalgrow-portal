import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { FileText, Download, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Documents" };

const typeLabels: Record<string, string> = {
  agreement: "Investment Agreement",
  certificate: "Certificate",
  statement: "Statement",
  receipt: "Receipt",
  report: "Report",
  other: "Document",
};

export default async function DocumentsPage() {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: investor } = await supabase
    .from("investors")
    .select("id")
    .eq("profile_id", user.id)
    .single();

  if (!investor) redirect("/dashboard");

  type DocumentRow = {
    id: string;
    name: string;
    type: string;
    file_path: string;
    file_size: number;
    mime_type: string;
    created_at: string;
    investment: { investment_code: string; series: { name: string } | null } | null;
  };

  const { data: rawDocuments } = await supabase
    .from("documents")
    .select("*, investment:investments(investment_code, series:series(name))")
    .eq("investor_id", investor.id)
    .eq("is_visible_to_investor", true)
    .order("created_at", { ascending: false });

  const documents = rawDocuments as unknown as DocumentRow[] | null;

  const grouped = documents?.reduce((acc, doc) => {
    const type = doc.type;
    if (!acc[type]) acc[type] = [];
    acc[type].push(doc);
    return acc;
  }, {} as Record<string, DocumentRow[]>) ?? {};

  return (
    <div className="space-y-6 max-w-3xl animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Documents</h1>
        <p className="text-sm text-muted mt-1">
          {documents?.length ?? 0} document{(documents?.length ?? 0) !== 1 ? "s" : ""} available
        </p>
      </div>

      {!documents || documents.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-border mb-4" />
            <h3 className="font-semibold text-foreground">No documents yet</h3>
            <p className="text-sm text-muted mt-1">
              Your investment agreements and statements will appear here once uploaded.
            </p>
          </CardContent>
        </Card>
      ) : (
        Object.entries(grouped).map(([type, docs]) => (
          <section key={type}>
            <h2 className="text-base font-semibold text-foreground mb-3">{typeLabels[type] ?? "Documents"}</h2>
            <div className="space-y-2">
              {docs?.map((doc) => (
                <div
                  key={doc.id}
                  className="flex items-center justify-between rounded-xl border border-border bg-surface p-4 hover:border-primary-200 transition-all"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-50 text-primary-700 flex-shrink-0">
                      <FileText className="h-5 w-5" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{doc.name}</p>
                      <p className="text-xs text-muted mt-0.5">
                        {doc.investment
                          ? `${doc.investment.investment_code} · Series ${doc.investment.series?.name}`
                          : "General document"}
                        {" · "}{formatDate(doc.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="default" className="hidden sm:inline-flex text-[10px]">
                      {doc.mime_type.split("/")[1]?.toUpperCase()}
                    </Badge>
                    <a
                      href={`/api/documents/${doc.id}`}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground hover:bg-primary-50 hover:border-primary-200 transition-all"
                    >
                      <Download className="h-3.5 w-3.5" />
                      Download
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}
