import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { isUuid } from "@/lib/maalrise/api";
import { CYCLE_PORTAL_LABEL, CYCLE_PORTAL_VARIANT, getMyCycle } from "@/lib/maalrise/portal";
import { requireMaalriseInvestorPage } from "@/lib/maalrise/portal-guard";
import { CycleDetailBody } from "@/components/maalrise/portal-ui";

export const metadata: Metadata = { title: "MaalRise Cycle" };

/**
 * One Cycle as its investor sees it: their units and capital, their
 * expected profit for each month, and each payment's status as staff
 * recorded it. The Cycle's total size, markup and fee are not shown.
 */
export default async function MyCyclePage({ params }: { params: Promise<{ id: string }> }) {
  const { db } = await requireMaalriseInvestorPage();
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const c = await getMyCycle(db, id);
  if (!c) notFound();

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start gap-3">
        <Link href="/maalrise/cycles" aria-label="Back to My Cycles"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-600">MaalRise Cycle</p>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-foreground">{c.name}</h1>
            <Badge variant={CYCLE_PORTAL_VARIANT[c.status]}>{CYCLE_PORTAL_LABEL[c.status]}</Badge>
          </div>
          <p className="text-sm text-muted">Counterparty: {c.counterparty_name}</p>
          {c.description && <p className="mt-1 text-sm text-muted">{c.description}</p>}
        </div>
      </div>

      <CycleDetailBody c={c} />
    </div>
  );
}
