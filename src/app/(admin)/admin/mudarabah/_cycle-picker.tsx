"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { ArrowRight, FilePlus2 } from "lucide-react";

export type PickerSeries = { id: string; name: string };

export type PickerCycle = {
  id: string;
  seriesId: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  totalSlots: number;
  investors: number;
  /** null when this cycle has no ledger — nothing is backfilled */
  ledgerStatus: string | null;
};

/**
 * Pick an existing series, then a cycle within it. Settled cycles are
 * hidden until asked for, and open read-only.
 */
export function CyclePicker({
  series,
  cycles,
}: {
  series: PickerSeries[];
  cycles: PickerCycle[];
}) {
  const router = useRouter();
  const [seriesId, setSeriesId] = useState(series[0]?.id ?? "");
  const [showSettled, setShowSettled] = useState(false);

  const visible = useMemo(
    () =>
      cycles.filter(
        (c) => c.seriesId === seriesId && (showSettled || c.ledgerStatus !== "settled")
      ),
    [cycles, seriesId, showSettled]
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="series" className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">
              Series
            </label>
            <select
              id="series"
              value={seriesId}
              onChange={(e) => setSeriesId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              {series.map((s) => (
                <option key={s.id} value={s.id}>
                  Series {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-2 text-sm text-muted">
              <input
                type="checkbox"
                checked={showSettled}
                onChange={(e) => setShowSettled(e.target.checked)}
              />
              Show settled cycles (read-only)
            </label>
          </div>
        </CardContent>
      </Card>

      {visible.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-muted">
            No cycles in this series{showSettled ? "" : " that are still open"}.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => router.push(`/admin/mudarabah/${c.id}`)}
              className="text-left"
            >
              <Card className="h-full hover:border-primary-300 transition-colors">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-foreground">{c.label}</h2>
                    <span
                      className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                        c.ledgerStatus === "settled"
                          ? "bg-emerald-100 text-emerald-700"
                          : c.ledgerStatus
                          ? "bg-amber-100 text-amber-700"
                          : "bg-surface-2 text-muted"
                      )}
                    >
                      {c.ledgerStatus ?? "no ledger"}
                    </span>
                  </div>
                  <p className="text-xs text-muted">
                    {c.startDate} → {c.endDate} · {c.status.replaceAll("_", " ")}
                  </p>
                  <p className="text-xs text-muted">
                    {c.investors} investor{c.investors === 1 ? "" : "s"} ·{" "}
                    {c.totalSlots} slot{c.totalSlots === 1 ? "" : "s"}
                  </p>
                  <p className="pt-2 border-t border-border text-xs font-medium text-primary-700 flex items-center gap-1">
                    {c.ledgerStatus ? (
                      <>
                        Open ledger <ArrowRight className="h-3 w-3" />
                      </>
                    ) : (
                      <>
                        <FilePlus2 className="h-3 w-3" /> Start a ledger for this cycle
                      </>
                    )}
                  </p>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
