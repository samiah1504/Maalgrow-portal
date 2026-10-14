import Link from "next/link";
import type { Metadata } from "next";
import { Mail } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { formatDateTime } from "@/lib/utils";
import { listOutbox, mr, type OutboxItem } from "@/lib/maalrise/db";
import { canApprove } from "@/lib/maalrise/permissions";
import { EmptyState } from "@/components/maalrise/sample-notice";
import { EmailActions, SendAll } from "./_email-actions";

export const metadata: Metadata = { title: "MaalRise Emails | Admin" };

const VIEWS = {
  investor: { label: "To investors", match: (e: OutboxItem) => e.audience === "investor" && e.status === "draft" },
  staff: { label: "To staff", match: (e: OutboxItem) => e.audience === "staff" && e.status === "draft" },
  failed: { label: "Failed", match: (e: OutboxItem) => e.status === "failed" || e.status === "queued" },
  sent: { label: "Sent", match: (e: OutboxItem) => e.status === "sent" },
  discarded: { label: "Discarded", match: (e: OutboxItem) => e.status === "discarded" },
} as const;
type View = keyof typeof VIEWS;

const STATUS_VARIANT = { draft: "upcoming", queued: "processing", sent: "paid", failed: "rejected", discarded: "upcoming" } as const;

/**
 * Every MaalRise email is written as a draft. Nothing is sent until a
 * super admin or administrator presses Send here.
 */
export default async function MaalRiseEmailsPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { supabase, role } = await requireAdminPage();
  const v = (await searchParams).view;
  const view: View = v && v in VIEWS ? (v as View) : "investor";
  const all = await listOutbox(mr(supabase));
  const shown = all.filter(VIEWS[view].match);
  const mayAct = canApprove(role) && (view === "investor" || view === "staff" || view === "failed");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">MaalRise Emails</h1>
          <p className="text-sm text-muted mt-1 max-w-3xl">
            Emails about payments, capital and bank details are prepared here as drafts. Nothing is sent until a super admin or
            administrator presses Send. In-app notifications are shown either way. Emails go out from the same address as MaalGrow.
          </p>
        </div>
        {mayAct && view !== "failed" && <SendAll ids={shown.map((e) => e.id)} count={shown.length} />}
      </div>

      <nav className="flex flex-wrap gap-2" aria-label="Email views">
        {(Object.keys(VIEWS) as View[]).map((k) => {
          const n = all.filter(VIEWS[k].match).length;
          return (
            <Link key={k} href={`/admin/maalrise/emails?view=${k}`}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${k === view ? "border-primary-700 bg-primary-700 text-white" : "border-border bg-surface text-muted-foreground hover:border-primary-300"}`}>
              {VIEWS[k].label} ({n})
            </Link>
          );
        })}
      </nav>

      <Card>
        <CardContent className="pt-6">
          {shown.length === 0 ? (
            <EmptyState icon={<Mail className="h-5 w-5" />} title="Nothing here" />
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((e) => (
                <li key={e.id} className="py-3" data-email={e.kind}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-medium text-foreground">{e.subject}</p>
                      <p className="text-xs text-muted">
                        To {e.to_email} · {e.audience === "investor" ? "investor" : "staff"} · prepared {formatDateTime(e.created_at)}
                        {e.attempts > 0 && ` · ${e.attempts} attempt(s)`}
                      </p>
                      <details className="mt-1 text-sm text-muted">
                        <summary className="cursor-pointer text-xs text-primary-700">Show message</summary>
                        <p className="mt-1 whitespace-pre-line">{e.body}</p>
                      </details>
                      {e.last_error && <p className="mt-1 text-xs text-red-700">Last error: {e.last_error}</p>}
                      {e.status === "sent" && e.sent_at && (
                        <p className="mt-1 text-xs text-emerald-700">Sent {formatDateTime(e.sent_at)}{e.handled_by_name ? ` by ${e.handled_by_name}` : ""}</p>
                      )}
                      {e.status === "discarded" && e.discarded_at && (
                        <p className="mt-1 text-xs text-muted">Discarded {formatDateTime(e.discarded_at)}{e.handled_by_name ? ` by ${e.handled_by_name}` : ""}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={STATUS_VARIANT[e.status]}>{e.status === "queued" ? "sending" : e.status}</Badge>
                      {mayAct && e.status !== "queued" && <EmailActions id={e.id} to={e.to_email} retry={e.status === "failed"} />}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
