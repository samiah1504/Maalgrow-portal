import Link from "next/link";
import type { Metadata } from "next";
import { Users, Landmark, Wallet, CalendarClock, CheckCircle2, Coins, Plus, UserPlus } from "lucide-react";
import { addDays, format } from "date-fns";
import { requireAdminPage } from "@/lib/admin-guard";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { formatKobo } from "@/lib/maalrise/format";
import { maturityDate } from "@/lib/maalrise/dates";
import { sampleDashboard } from "@/lib/maalrise/sample-summary";
import { dashboardFigures, mr } from "@/lib/maalrise/db";
import { EmptyState, SampleDataBanner, SampleTag, SampleToggle } from "@/components/maalrise/sample-notice";

export const metadata: Metadata = { title: "MaalRise Dashboard | Admin" };

const NONE = "—";
/** How far ahead "payments due" looks when payment tracking is not live yet. */
const DUE_WINDOW_DAYS = 31;

type View = {
  sample: boolean;
  asOf?: string;
  investors: { value: string | number; sub: string };
  active: { value: string | number; sub: string };
  capital: { value: string; sub: string };
  due: { value: string; sub: string };
  paid: { value: string; sub: string };
  settle: { value: string | number; sub: string };
  dueRows: { key: string; cycleId: string; cycleName: string; period: number; dueDate: string | null; amountKobo: number; partly: boolean }[];
  settleRows: { cycleId: string; cycleName: string; dueDate: string | null; holders: number; amountKobo: number }[];
};

export default async function MaalRiseDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { supabase } = await requireAdminPage();
  const showSample = (await searchParams).sample === "1";

  let v: View;
  if (showSample) {
    // Opt-in, labelled on every tile, and never mixed with real records.
    const s = sampleDashboard();
    v = {
      sample: true,
      asOf: s.asOf,
      investors: { value: s.investorCount, sub: "Illustrative count" },
      active: { value: s.activeCycleCount, sub: "Illustrative count" },
      capital: { value: formatKobo(s.allocatedCapitalKobo), sub: `Active ${formatKobo(s.activeAllocatedKobo)} · draft ${formatKobo(s.draftAllocatedKobo)}` },
      due: { value: formatKobo(s.dueKobo), sub: `${s.due.length} due period(s) not yet fully paid` },
      paid: { value: `${formatKobo(s.completedKobo)} / ${formatKobo(s.outstandingKobo)}`, sub: "Profit only — capital is settled separately" },
      settle: { value: s.capitalSettlements.length, sub: `${formatKobo(s.capitalSettlements.reduce((t, c) => t + c.amountKobo, 0))} capital due at maturity` },
      dueRows: s.due.map((d) => ({ key: `${d.cycle.id}-${d.period}`, cycleId: d.cycle.id, cycleName: d.cycle.name, period: d.period, dueDate: d.dueDate, amountKobo: d.amountKobo, partly: d.status === "partly_paid" })),
      settleRows: s.capitalSettlements.map((c) => ({ cycleId: c.cycle.id, cycleName: c.cycle.name, dueDate: c.dueDate, holders: c.holders, amountKobo: c.amountKobo })),
    };
  } else {
    const f = await dashboardFigures(mr(supabase));
    const today = format(new Date(), "yyyy-MM-dd");
    const horizon = format(addDays(new Date(), DUE_WINDOW_DAYS), "yyyy-MM-dd");
    const termsToCycle = Object.fromEntries(f.activeCycles.map((c) => [c.approved_terms_id, c]));
    const upcoming = f.scheduleLines.filter((l) => l.due_date >= today && l.due_date <= horizon);
    v = {
      sample: false,
      investors: { value: f.investorCount, sub: f.investorCount ? "With MaalRise access" : "No MaalRise investors yet" },
      active: { value: f.activeCycles.length, sub: `${f.cycleCount} Cycle(s) in total · ${f.awaitingApproval} awaiting approval` },
      capital: { value: formatKobo(f.allocatedCapitalKobo), sub: "Confirmed funding across all Cycles" },
      due: { value: upcoming.length ? formatKobo(upcoming.reduce((s, l) => s + l.investor_net_kobo, 0)) : NONE, sub: `Expected in the next ${DUE_WINDOW_DAYS} days, from approved schedules` },
      paid: { value: NONE, sub: "Tracked from Phase 4 (receipts and distributions)" },
      settle: { value: f.activeCapital.length || NONE, sub: f.activeCapital.length ? `${formatKobo(f.activeCapital.reduce((s, c) => s + c.capitalKobo, 0))} capital due at maturity` : "None scheduled" },
      dueRows: upcoming.map((l) => {
        const c = termsToCycle[l.terms_id];
        return { key: l.id, cycleId: c?.id ?? "", cycleName: c?.name ?? "—", period: l.period, dueDate: l.due_date, amountKobo: l.investor_net_kobo, partly: false };
      }),
      settleRows: f.activeCapital.map(({ cycle, capitalKobo }) => ({
        cycleId: cycle.id, cycleName: cycle.name, dueDate: maturityDate(cycle.start_date, cycle.duration_months), holders: 0, amountKobo: capitalKobo,
      })),
    };
  }
  const tag = v.sample ? " (sample)" : "";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">MaalRise Dashboard</h1>
          <p className="text-sm text-muted mt-1">Murabaha Cycles, investor allocations, monthly profit and capital settlement</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SampleToggle href="/admin/maalrise/dashboard" showing={v.sample} />
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/maalrise/investors/new" className="flex items-center gap-2"><UserPlus className="h-4 w-4" /> Add Investor</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/maalrise/cycles/new" className="flex items-center gap-2"><Plus className="h-4 w-4" /> New Cycle</Link>
          </Button>
        </div>
      </div>

      {v.sample && <SampleDataBanner asOf={v.asOf} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard title={`Total MaalRise investors${tag}`} value={v.investors.value} subtitle={v.investors.sub} icon={<Users className="h-5 w-5" />} />
        <StatCard title={`Active Cycles${tag}`} value={v.active.value} subtitle={v.active.sub} icon={<Landmark className="h-5 w-5" />} accentColor="success" />
        <StatCard title={`Total allocated capital${tag}`} value={v.capital.value} subtitle={v.capital.sub} icon={<Wallet className="h-5 w-5" />} accentColor="gold" />
        <StatCard title={`Monthly profit payments due${tag}`} value={v.due.value} subtitle={v.due.sub} icon={<CalendarClock className="h-5 w-5" />} accentColor="info" />
        <StatCard title={`Monthly profit paid / outstanding${tag}`} value={v.paid.value} subtitle={v.paid.sub} icon={<CheckCircle2 className="h-5 w-5" />} accentColor="success" />
        <StatCard title={`Upcoming capital settlements${tag}`} value={v.settle.value} subtitle={v.settle.sub} icon={<Coins className="h-5 w-5" />} accentColor="gold" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-base">Monthly profit payments due</CardTitle></CardHeader>
          <CardContent>
            {v.dueRows.length === 0 ? (
              <EmptyState icon={<CalendarClock className="h-5 w-5" />} title="No monthly payments due">
                Payments appear here once a Cycle&apos;s terms are approved and it is activated.
              </EmptyState>
            ) : (
              <table className="-mx-3 w-[calc(100%+1.5rem)] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Cycle</th>
                    <th className="px-3 py-2 font-medium">Period</th>
                    <th className="px-3 py-2 font-medium">Due</th>
                    <th className="px-3 py-2 text-right font-medium">{v.sample ? "Outstanding" : "Expected"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {v.dueRows.map((d) => (
                    <tr key={d.key}>
                      <td className="px-3 py-2">
                        <Link href={`/admin/maalrise/cycles/${d.cycleId}`} className="text-primary-700 hover:underline">{d.cycleName}</Link>{" "}
                        {v.sample && <SampleTag />}
                      </td>
                      <td className="px-3 py-2">Month {d.period}</td>
                      <td className="px-3 py-2 text-muted">{d.dueDate ? formatDate(d.dueDate) : NONE}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatKobo(d.amountKobo)} {d.partly && <Badge variant="warning">Part-paid</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Upcoming capital settlements</CardTitle></CardHeader>
          <CardContent>
            {v.settleRows.length === 0 ? (
              <EmptyState icon={<Coins className="h-5 w-5" />} title="No capital settlements scheduled">
                Capital settlement is tracked separately from monthly profit and falls due at each Cycle&apos;s maturity.
              </EmptyState>
            ) : (
              <table className="-mx-3 w-[calc(100%+1.5rem)] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Cycle</th>
                    <th className="px-3 py-2 font-medium">Maturity</th>
                    <th className="px-3 py-2 text-right font-medium">Capital due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {v.settleRows.map((c) => (
                    <tr key={c.cycleId}>
                      <td className="px-3 py-2">
                        <Link href={`/admin/maalrise/cycles/${c.cycleId}`} className="text-primary-700 hover:underline">{c.cycleName}</Link>{" "}
                        {v.sample && <SampleTag />}
                      </td>
                      <td className="px-3 py-2 text-muted">{c.dueDate ? formatDate(c.dueDate) : NONE}</td>
                      <td className="px-3 py-2 text-right font-medium">{formatKobo(c.amountKobo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
