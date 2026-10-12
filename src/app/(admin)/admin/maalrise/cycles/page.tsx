import Link from "next/link";
import type { Metadata } from "next";
import { Landmark, Plus } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { CYCLE_STATUS_LABEL, CYCLE_STATUS_VARIANT, formatKobo } from "@/lib/maalrise/format";
import { SAMPLE_CYCLES } from "@/lib/maalrise/sample-data";
import { sampleCycleFigures } from "@/lib/maalrise/sample-summary";
import { EmptyState, SampleDataBanner, SampleTag, SampleToggle } from "@/components/maalrise/sample-notice";

export const metadata: Metadata = { title: "MaalRise Cycles | Admin" };

export default async function MaalRiseCyclesPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdminPage();
  const showSample = (await searchParams).sample === "1";
  const rows = showSample
    ? SAMPLE_CYCLES.map((c) => ({ cycle: c, f: sampleCycleFigures(c) }))
    : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">MaalRise Cycles</h1>
          <p className="text-sm text-muted mt-1">
            Each Cycle is one Murabaha transaction with its own terms, investors and schedule
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SampleToggle href="/admin/maalrise/cycles" showing={showSample} />
          <Button asChild size="sm">
            <Link href="/admin/maalrise/cycles/new" className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> New Cycle
            </Link>
          </Button>
        </div>
      </div>

      {showSample && <SampleDataBanner />}

      {rows.length === 0 ? (
        <EmptyState icon={<Landmark className="h-5 w-5" />} title="No MaalRise Cycles yet">
          Create a Cycle to record a Murabaha transaction&apos;s terms. Nothing is visible to investors
          until its terms are approved by a second authorised person and the Cycle is activated.
        </EmptyState>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left">
                    <th className="px-4 py-3 font-medium text-muted">Cycle</th>
                    <th className="px-4 py-3 font-medium text-muted">Counterparty</th>
                    <th className="px-4 py-3 font-medium text-muted">Start</th>
                    <th className="px-4 py-3 font-medium text-muted">Maturity</th>
                    <th className="px-4 py-3 text-right font-medium text-muted">Transaction cost</th>
                    <th className="px-4 py-3 text-right font-medium text-muted">Sale price</th>
                    <th className="px-4 py-3 text-right font-medium text-muted">Funded</th>
                    <th className="px-4 py-3 text-center font-medium text-muted">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map(({ cycle, f }) => (
                    <tr key={cycle.id} className="hover:bg-surface-2 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/admin/maalrise/cycles/${cycle.id}`} className="font-medium text-primary-700 hover:underline">
                          {cycle.name}
                        </Link>{" "}
                        <SampleTag />
                        <p className="text-xs text-muted">{cycle.transactionName}</p>
                      </td>
                      <td className="px-4 py-3 text-muted">{cycle.counterparty.name}</td>
                      <td className="px-4 py-3 text-muted">{formatDate(cycle.startDate)}</td>
                      <td className="px-4 py-3 text-muted">{f.maturity ? formatDate(f.maturity) : "—"}</td>
                      <td className="px-4 py-3 text-right">{formatKobo(cycle.costKobo)}</td>
                      <td className="px-4 py-3 text-right">{formatKobo(f.breakdown.salePriceKobo)}</td>
                      <td className="px-4 py-3 text-right">
                        {f.unitsFunded} / {f.unitsRequired} units
                        {f.fundingShortfallKobo > 0 && (
                          <p className="text-xs text-amber-700">Short {formatKobo(f.fundingShortfallKobo)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={CYCLE_STATUS_VARIANT[cycle.status] ?? "pending"}>
                          {CYCLE_STATUS_LABEL[cycle.status] ?? cycle.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
