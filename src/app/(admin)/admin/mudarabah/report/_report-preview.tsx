"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { AlertTriangle, ExternalLink, FileText, Printer, Receipt } from "lucide-react";
import type { PickerCycle, PickerSeries } from "../_cycle-picker";

type Holder = {
  investmentId: string;
  investorName: string;
  investorCode: string;
  units: number;
  decision: "withdraw" | "rollover" | "partial" | "none";
};

type CycleInfo = {
  cycle: {
    seriesName: string;
    cycleLabel: string;
    startDate: string;
    endDate: string;
    description: string | null;
    totalUnits: number;
    investorCount: number;
  };
  provisional: boolean;
  settledAt: string | null;
  missingLedger: boolean;
  netPerSlot: number;
  holders: Holder[];
};

const naira = (kobo: number) =>
  `₦${Math.round((Number(kobo) || 0) / 100).toLocaleString("en-NG")}`;

const DECISION_WORD: Record<Holder["decision"], string> = {
  withdraw: "taking capital out",
  rollover: "capital continues",
  partial: "part out, part continues",
  none: "no instruction yet",
};

/**
 * Series → cycle → investor, then the document itself in an iframe.
 *
 * The preview shows exactly what the investor will receive: the same
 * resolver, the same renderer, the same stylesheet. Printing from here
 * is the same print.
 */
export function ReportPreview({
  series,
  cycles,
}: {
  series: PickerSeries[];
  cycles: PickerCycle[];
}) {
  const [seriesId, setSeriesId] = useState(series[0]?.id ?? "");
  const [cycleId, setCycleId] = useState("");
  const [investmentId, setInvestmentId] = useState("");
  const [doc, setDoc] = useState<"report" | "note">("report");

  const [info, setInfo] = useState<CycleInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  const seriesCycles = useMemo(
    () => cycles.filter((c) => c.seriesId === seriesId),
    [cycles, seriesId]
  );

  // Changing series invalidates the cycle beneath it
  useEffect(() => {
    setCycleId((current) =>
      seriesCycles.some((c) => c.id === current) ? current : seriesCycles[0]?.id ?? ""
    );
  }, [seriesCycles]);

  useEffect(() => {
    if (!cycleId) {
      setInfo(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/admin/mudarabah/report?cycleId=${encodeURIComponent(cycleId)}`)
      .then(async (r) => {
        const body = await r.json();
        if (!r.ok) throw new Error(body.error ?? "Could not load the cycle");
        return body as CycleInfo;
      })
      .then((body) => {
        if (cancelled) return;
        setInfo(body);
        setInvestmentId(body.holders[0]?.investmentId ?? "");
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setInfo(null);
        setError(e instanceof Error ? e.message : "Could not load the cycle");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cycleId]);

  const src = useMemo(() => {
    if (!cycleId || !investmentId) return "";
    const q = new URLSearchParams({ cycleId, investmentId });
    if (doc === "note") q.set("doc", "note");
    return `/api/admin/mudarabah/report?${q.toString()}`;
  }, [cycleId, investmentId, doc]);

  // Print the DOCUMENT, not the admin page around it
  const print = useCallback(() => {
    frame.current?.contentWindow?.focus();
    frame.current?.contentWindow?.print();
  }, []);

  const holder = info?.holders.find((h) => h.investmentId === investmentId) ?? null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-4 grid gap-4 sm:grid-cols-3">
          <div>
            <label
              htmlFor="rp-series"
              className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5"
            >
              Series
            </label>
            <select
              id="rp-series"
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

          <div>
            <label
              htmlFor="rp-cycle"
              className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5"
            >
              Cycle
            </label>
            <select
              id="rp-cycle"
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              {seriesCycles.length === 0 && <option value="">No cycles</option>}
              {seriesCycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                  {c.ledgerStatus ? ` · ${c.ledgerStatus}` : " · no ledger"}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="rp-investor"
              className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5"
            >
              Investor
            </label>
            <select
              id="rp-investor"
              value={investmentId}
              onChange={(e) => setInvestmentId(e.target.value)}
              disabled={!info || info.holders.length === 0}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm disabled:opacity-50"
            >
              {(!info || info.holders.length === 0) && (
                <option value="">No investors in this cycle</option>
              )}
              {info?.holders.map((h) => (
                <option key={h.investmentId} value={h.investmentId}>
                  {h.investorName} · {h.units} slot{h.units === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </div>
        </CardContent>
      </Card>

      {/* What the chosen cycle actually holds — before opening a document */}
      {info && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Investors" value={String(info.cycle.investorCount)} />
              <Stat
                label="Slots held"
                value={`${info.cycle.totalUnits}`}
                hint="Half slots count as halves"
              />
              <Stat
                label="Net profit per slot"
                value={naira(info.netPerSlot)}
                hint="After the manager's share and tax"
              />
              <Stat
                label="Status"
                value={info.provisional ? "Provisional" : "Settled"}
                hint={
                  info.settledAt
                    ? `Frozen ${new Date(info.settledAt).toLocaleDateString("en-GB")}`
                    : "Figures move while the ledger is open"
                }
              />
            </div>

            {info.missingLedger && (
              <p className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                This cycle has no trading ledger yet, so every figure below is
                zero. Record the three months first.
              </p>
            )}

            {holder && (
              <p className="text-xs text-muted">
                {holder.investorName} ({holder.investorCode}) holds {holder.units}{" "}
                slot{holder.units === 1 ? "" : "s"} — {DECISION_WORD[holder.decision]}.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Which document */}
      <div className="flex flex-wrap items-center gap-2">
        <Toggle active={doc === "report"} onClick={() => setDoc("report")}>
          <FileText className="h-3.5 w-3.5" /> Investor report
        </Toggle>
        <Toggle active={doc === "note"} onClick={() => setDoc("note")}>
          <Receipt className="h-3.5 w-3.5" /> Credit note
        </Toggle>

        <div className="flex-1" />

        <button
          type="button"
          onClick={print}
          disabled={!src}
          className="inline-flex items-center gap-1.5 rounded-lg bg-primary-700 px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          <Printer className="h-3.5 w-3.5" /> Print / Save as PDF
        </button>
        <a
          href={src || "#"}
          target="_blank"
          rel="noreferrer"
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-semibold text-foreground",
            !src && "pointer-events-none opacity-40"
          )}
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open in a tab
        </a>
      </div>

      {error && (
        <Card>
          <CardContent className="p-4 text-sm text-red-700">{error}</CardContent>
        </Card>
      )}

      {/* The document itself, on its own paper */}
      <Card>
        <CardContent className="p-0">
          {loading && (
            <div className="p-8 text-center text-sm text-muted">Loading the cycle…</div>
          )}
          {!loading && !src && (
            <div className="p-8 text-center text-sm text-muted">
              Choose a cycle and an investor.
            </div>
          )}
          {!loading && src && (
            <iframe
              ref={frame}
              key={src}
              src={src}
              title="Report preview"
              className="w-full rounded-xl bg-[#F7F3EC]"
              style={{ height: "80vh", border: "0" }}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div className="text-lg font-bold text-foreground mt-0.5">{value}</div>
      {hint && <div className="text-[10px] text-muted mt-0.5">{hint}</div>}
    </div>
  );
}

function Toggle({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-xs font-semibold border transition-colors",
        active
          ? "border-primary-300 bg-primary-100 text-primary-700"
          : "border-border text-muted hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}
