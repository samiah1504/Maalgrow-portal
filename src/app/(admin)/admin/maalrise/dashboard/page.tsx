import Link from "next/link";
import type { Metadata } from "next";
import { Users, Landmark, Wallet, CalendarClock, CheckCircle2, Coins, Plus, UserPlus } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { StatCard } from "@/components/ui/stat-card";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { formatKobo } from "@/lib/maalrise/format";
import { sampleDashboard } from "@/lib/maalrise/sample-summary";
import { EmptyState, SampleDataBanner, SampleTag, SampleToggle } from "@/components/maalrise/sample-notice";

export const metadata: Metadata = { title: "MaalRise Dashboard | Admin" };

const NONE = "—";

export default async function MaalRiseDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdminPage();
  const showSample = (await searchParams).sample === "1";

  // There are no MaalRise tables yet, so the real figures are all
  // empty. The sample view is opt-in and labelled on every tile.
  const s = showSample ? sampleDashboard() : null;
  const tag = showSample ? " (sample)" : "";

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">MaalRise Dashboard</h1>
          <p className="text-sm text-muted mt-1">
            Murabaha Cycles, investor allocations, monthly profit and capital settlement
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SampleToggle href="/admin/maalrise/dashboard" showing={showSample} />
          <Button asChild size="sm" variant="outline">
            <Link href="/admin/maalrise/investors/new" className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Add Investor
            </Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/admin/maalrise/cycles/new" className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> New Cycle
            </Link>
          </Button>
        </div>
      </div>

      {s && <SampleDataBanner asOf={s.asOf} />}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <StatCard
          title={`Total MaalRise investors${tag}`}
          value={s ? s.investorCount : NONE}
          subtitle={s ? "Illustrative count" : "No MaalRise investors yet"}
          icon={<Users className="h-5 w-5" />}
        />
        <StatCard
          title={`Active Cycles${tag}`}
          value={s ? s.activeCycleCount : NONE}
          subtitle={s ? "Illustrative count" : "No Cycles yet"}
          icon={<Landmark className="h-5 w-5" />}
          accentColor="success"
        />
        <StatCard
          title={`Total allocated capital${tag}`}
          value={s ? formatKobo(s.allocatedCapitalKobo) : NONE}
          subtitle={s ? `Active ${formatKobo(s.activeAllocatedKobo)} · draft ${formatKobo(s.draftAllocatedKobo)}` : "No allocations yet"}
          icon={<Wallet className="h-5 w-5" />}
          accentColor="gold"
        />
        <StatCard
          title={`Monthly profit payments due${tag}`}
          value={s ? formatKobo(s.dueKobo) : NONE}
          subtitle={s ? `${s.due.length} due period(s) not yet fully paid` : "Nothing due"}
          icon={<CalendarClock className="h-5 w-5" />}
          accentColor="info"
        />
        <StatCard
          title={`Monthly profit paid / outstanding${tag}`}
          value={s ? `${formatKobo(s.completedKobo)} / ${formatKobo(s.outstandingKobo)}` : NONE}
          subtitle={s ? "Profit only — capital is settled separately" : "No payments recorded"}
          icon={<CheckCircle2 className="h-5 w-5" />}
          accentColor="success"
        />
        <StatCard
          title={`Upcoming capital settlements${tag}`}
          value={s ? s.capitalSettlements.length : NONE}
          subtitle={s ? formatKobo(s.capitalSettlements.reduce((t, c) => t + c.amountKobo, 0)) + " capital due at maturity" : "None scheduled"}
          icon={<Coins className="h-5 w-5" />}
          accentColor="gold"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Monthly profit payments due</CardTitle>
          </CardHeader>
          <CardContent>
            {!s || s.due.length === 0 ? (
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
                    <th className="px-3 py-2 text-right font-medium">Outstanding</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.due.map((d) => (
                    <tr key={`${d.cycle.id}-${d.period}`}>
                      <td className="px-3 py-2">
                        <Link href={`/admin/maalrise/cycles/${d.cycle.id}`} className="text-primary-700 hover:underline">
                          {d.cycle.name}
                        </Link>{" "}
                        <SampleTag />
                      </td>
                      <td className="px-3 py-2">Month {d.period}</td>
                      <td className="px-3 py-2 text-muted">{d.dueDate ? formatDate(d.dueDate) : NONE}</td>
                      <td className="px-3 py-2 text-right font-medium">
                        {formatKobo(d.amountKobo)}{" "}
                        {d.status === "partly_paid" && <Badge variant="warning">Part-paid</Badge>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Upcoming capital settlements</CardTitle>
          </CardHeader>
          <CardContent>
            {!s || s.capitalSettlements.length === 0 ? (
              <EmptyState icon={<Coins className="h-5 w-5" />} title="No capital settlements scheduled">
                Capital settlement is tracked separately from monthly profit and falls due at each Cycle&apos;s maturity.
              </EmptyState>
            ) : (
              <table className="-mx-3 w-[calc(100%+1.5rem)] text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    <th className="px-3 py-2 font-medium">Cycle</th>
                    <th className="px-3 py-2 font-medium">Maturity</th>
                    <th className="px-3 py-2 font-medium">Investors</th>
                    <th className="px-3 py-2 text-right font-medium">Capital due</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {s.capitalSettlements.map((c) => (
                    <tr key={c.cycle.id}>
                      <td className="px-3 py-2">
                        <Link href={`/admin/maalrise/cycles/${c.cycle.id}`} className="text-primary-700 hover:underline">
                          {c.cycle.name}
                        </Link>{" "}
                        <SampleTag />
                      </td>
                      <td className="px-3 py-2 text-muted">{c.dueDate ? formatDate(c.dueDate) : NONE}</td>
                      <td className="px-3 py-2">{c.holders}</td>
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
