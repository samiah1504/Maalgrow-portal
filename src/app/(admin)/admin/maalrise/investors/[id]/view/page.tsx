import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft, CalendarClock, Coins, Eye, Landmark, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/ui/stat-card";
import { formatDate } from "@/lib/utils";
import { requireAdminPage } from "@/lib/admin-guard";
import { isUuid } from "@/lib/maalrise/api";
import { mr } from "@/lib/maalrise/db";
import { formatKobo } from "@/lib/maalrise/format";
import { lagosToday } from "@/lib/maalrise/receipts";
import { CYCLE_PORTAL_LABEL, CYCLE_PORTAL_VARIANT, portfolioSummary, viewAsInvestor } from "@/lib/maalrise/portal";
import { CycleCard, CycleDetailBody, PaymentsTable } from "@/components/maalrise/portal-ui";

export const metadata: Metadata = { title: "View as investor | MaalRise Admin" };

/**
 * "View as investor": a read-only preview of one investor's MaalRise
 * portal — the same figures, from the same database functions, as the
 * investor sees. Nothing here can be changed; each view is recorded.
 */
export default async function ViewAsInvestorPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdminPage();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  let v;
  try {
    v = await viewAsInvestor(mr(supabase), id);
  } catch (e) {
    return (
      <div className="space-y-4">
        <Link href={`/admin/maalrise/investors/${id}`} className="text-sm text-primary-700 hover:underline">← Back to the investor</Link>
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          {e instanceof Error ? e.message : "The investor's view could not be loaded."}
        </p>
      </div>
    );
  }
  if (!v?.profile) notFound();
  const { profile, cycles, payments } = v;
  const s = portfolioSummary(cycles, lagosToday());

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start gap-3">
        <Link href={`/admin/maalrise/investors/${id}`} aria-label="Back to the investor"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-600">View as investor</p>
          <h1 className="text-2xl font-bold text-foreground">{profile.full_name}</h1>
          <p className="text-sm text-muted font-mono">{profile.investor_code}</p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-lg border border-primary-200 bg-primary-50 p-3 text-sm text-primary-900" data-testid="view-as-banner">
        <Eye className="h-4 w-4 mt-0.5 shrink-0" />
        <p>
          This is what {profile.full_name} sees in their MaalRise portal, figure for figure. It is read only: nothing can be changed
          here, and nothing is sent to them. Cycles appear to investors once activated.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard title="Capital invested" value={formatKobo(s.capitalInvestedKobo)}
          subtitle={`${s.activeCycles} Cycle${s.activeCycles === 1 ? "" : "s"} in progress`} icon={<Wallet className="h-5 w-5" />} />
        <StatCard title="Profit paid to them" value={formatKobo(s.profitPaidKobo)} accentColor="success"
          subtitle={s.awaitingTransferKobo > 0 ? `${formatKobo(s.awaitingTransferKobo)} approved, being transferred` : "Marked paid by MaalVest"}
          icon={<Coins className="h-5 w-5" />} />
        <StatCard title="Expected profit to come" value={formatKobo(s.profitToComeKobo)} accentColor="gold"
          subtitle="From the approved schedules" icon={<CalendarClock className="h-5 w-5" />} />
        <StatCard title="Next expected payment" accentColor="info" icon={<Landmark className="h-5 w-5" />}
          value={s.next ? formatKobo(s.next.expectedKobo) : "—"}
          subtitle={s.next ? `${s.next.label}, ${s.next.cycleName} · ${formatDate(s.next.dueDate)}` : "Nothing scheduled"} />
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">Their details, as shown to them</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-muted">Email</dt><dd className="font-medium">{profile.email}</dd></div>
            <div><dt className="text-xs text-muted">Phone</dt><dd className="font-medium">{profile.phone || "—"}</dd></div>
            <div><dt className="text-xs text-muted">KYC</dt><dd className="font-medium capitalize">{profile.kyc_status.replace(/_/g, " ")}</dd></div>
            <div className="sm:col-span-3">
              <dt className="text-xs text-muted">Bank account for payments</dt>
              <dd className="font-medium">
                {profile.bank
                  ? <>{profile.bank.bank_name} · {profile.bank.account_name} · {profile.bank.account_number}{" "}
                      <Badge variant={profile.bank.confirmed ? "approved" : "pending"}>{profile.bank.confirmed ? "Confirmed" : "Awaiting confirmation"}</Badge></>
                  : "None yet — they give it on the KYC form"}
                {profile.pending_request && <span className="block text-xs text-amber-800">They have asked to change it to {profile.pending_request.bank_name} ····{profile.pending_request.account_number.slice(-4)} (awaiting review).</span>}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Their Cycles</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {cycles.length === 0
            ? <p className="py-4 text-sm text-muted">They are not in any active Cycle yet, so their portal shows none. Cycles appear once they are activated.</p>
            : cycles.map((c) => <CycleCard key={c.id} c={c} href={`#cycle-${c.id}`} />)}
        </CardContent>
      </Card>

      {cycles.map((c) => (
        <section key={c.id} id={`cycle-${c.id}`} className="space-y-4 scroll-mt-20">
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            <h2 className="text-lg font-semibold text-foreground">{c.name}</h2>
            <Badge variant={CYCLE_PORTAL_VARIANT[c.status]}>{CYCLE_PORTAL_LABEL[c.status]}</Badge>
            <span className="text-sm text-muted">Counterparty: {c.counterparty_name}</span>
          </div>
          <CycleDetailBody c={c} />
        </section>
      ))}

      <Card>
        <CardHeader><CardTitle className="text-base">Their payment history</CardTitle></CardHeader>
        <CardContent><PaymentsTable payments={payments} /></CardContent>
      </Card>
    </div>
  );
}
