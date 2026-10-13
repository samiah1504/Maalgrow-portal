import type { Metadata } from "next";
import { listMyCycles } from "@/lib/maalrise/portal";
import { requireMaalriseInvestorPage } from "@/lib/maalrise/portal-guard";
import { CycleCard, PortalHeading } from "@/components/maalrise/portal-ui";

export const metadata: Metadata = { title: "My MaalRise Cycles" };

export default async function MyCyclesPage() {
  const { db } = await requireMaalriseInvestorPage();
  const cycles = await listMyCycles(db);
  return (
    <div className="space-y-6 animate-fade-in">
      <PortalHeading title="My Cycles" description="Every MaalRise Cycle you hold units in, newest first." />
      {cycles.length === 0 ? (
        <p className="rounded-xl border border-border bg-white p-6 text-sm text-muted">
          You are not in any active Cycle yet. Cycles appear here once they start.
        </p>
      ) : (
        <div className="space-y-3">{cycles.map((c) => <CycleCard key={c.id} c={c} />)}</div>
      )}
    </div>
  );
}
