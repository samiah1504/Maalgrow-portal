"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Download, FileText, Hourglass, Loader2, ShieldCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatDate } from "@/lib/utils";

export type CycleStatement = {
  cycleId: string;
  seriesName: string;
  cycleLabel: string;
  startDate: string;
  endDate: string;
  units: number;
  /** kobo */
  capital: number;
  grossProfit: number;
  wht: number;
  netProfit: number;
  netReturnPct: number;
  capitalAction: string;
  slotsWithdrawn: number;
  whtState: string;
  /** null when the document has not been built yet */
  documentState: string | null;
};

const naira = (kobo: number) => formatCurrency(Math.round((Number(kobo) || 0) / 100));

const ACTION: Record<string, string> = {
  withdraw: "Your capital was returned to you",
  rollover: "Your capital continued into the next cycle",
  partial: "Part of your capital was returned",
};

export function CycleStatements({ statements }: { statements: CycleStatement[] }) {
  if (statements.length === 0) return null;

  return (
    <section>
      <h2 className="text-base font-semibold text-foreground mb-3 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-primary-500" />
        Cycle Statements ({statements.length})
      </h2>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {statements.map((s) => (
          <StatementCard key={s.cycleId} statement={s} />
        ))}
      </div>
    </section>
  );
}

function StatementCard({ statement: s }: { statement: CycleStatement }) {
  const [loading, setLoading] = useState(false);

  const download = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `/api/investor/statement?cycleId=${encodeURIComponent(s.cycleId)}`
      );
      const json = await res.json();

      if (res.status === 202) {
        toast.info(json.message ?? "Your statement is being prepared.");
        return;
      }
      if (!res.ok) {
        toast.error(json.error ?? "Could not download your statement");
        return;
      }
      // A signed URL, valid for a couple of minutes. Navigating to it
      // downloads the file, which is what works in the in-app browsers
      // people arrive from.
      window.location.href = json.url;
    } catch {
      toast.error("Could not download your statement. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const ready = s.documentState === "ready";

  return (
    <Card className="hover:border-primary-300 transition-all card-hover">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle className="text-sm">
              Series {s.seriesName} · {s.cycleLabel}
            </CardTitle>
            <p className="text-xs text-muted mt-0.5">
              {formatDate(s.startDate)} – {formatDate(s.endDate)}
            </p>
          </div>
          <FileText className="h-4 w-4 text-primary-500 shrink-0 mt-0.5" />
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Enough inline that opening the report is optional */}
        <div className="rounded-lg bg-primary-50 border border-primary-100 p-3">
          <p className="text-[10px] uppercase tracking-wide text-primary-700/70">
            You received
          </p>
          <p className="text-xl font-bold text-primary-800 tabular-nums">
            {naira(s.netProfit)}
          </p>
          <p className="text-[11px] text-primary-700/80">
            {s.netReturnPct.toFixed(2)}% net return on your capital
          </p>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <Row label="Slots held" value={String(s.units)} />
          <Row label="Your capital" value={naira(s.capital)} />
          <Row label="Gross profit" value={naira(s.grossProfit)} />
          <Row
            label="Withholding tax"
            value={s.wht > 0 ? `−${naira(s.wht)}` : "—"}
          />
        </dl>

        <p className="text-[11px] text-muted">
          {ACTION[s.capitalAction] ?? s.capitalAction}
          {s.capitalAction === "partial" && ` (${s.slotsWithdrawn} slots)`}.
        </p>

        {s.wht > 0 && <TaxState state={s.whtState} amount={s.wht} />}

        <button
          type="button"
          onClick={download}
          disabled={loading || !ready}
          className="w-full inline-flex items-center justify-center gap-2 rounded-lg bg-primary-700 px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          {loading ? "Preparing…" : ready ? "Download PDF" : "Statement being prepared"}
        </button>
      </CardContent>
    </Card>
  );
}

/**
 * Where the investor's withholding tax has got to. Silence here reads
 * as money that vanished; each state says plainly what has happened
 * and what happens next.
 */
function TaxState({ state, amount }: { state: string; amount: number }) {
  if (state === "certified") {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg p-2">
        <ShieldCheck className="h-3.5 w-3.5 mt-px shrink-0" />
        Your withholding tax credit note is ready.
      </p>
    );
  }
  if (state === "remitted") {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-muted bg-surface-2 border border-border rounded-lg p-2">
        <Hourglass className="h-3.5 w-3.5 mt-px shrink-0" />
        The tax has been filed. Your credit note is being prepared.
      </p>
    );
  }
  return (
    <p className="flex items-start gap-1.5 text-[11px] text-muted bg-surface-2 border border-border rounded-lg p-2">
      <Hourglass className="h-3.5 w-3.5 mt-px shrink-0" />
      Withholding tax of {naira(amount)} was deducted. Your credit note will be
      available once the tax has been filed.
    </p>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-right font-medium text-foreground tabular-nums">{value}</dd>
    </>
  );
}
