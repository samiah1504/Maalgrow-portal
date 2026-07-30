"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Download,
  FileCheck2,
  Loader2,
  Receipt,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CycleRow = {
  cycle_id: string;
  series_name: string;
  cycle_label: string;
  end_date: string;
  investors_taxed: number;
  total_withheld: number;
  notes_due: number;
  notes_issued: number;
  without_tin: number;
  remittance_id: string | null;
  remittance_reference: string | null;
  remitted_on: string | null;
  state: "withheld" | "remitted" | "certified";
};

type Remittance = {
  id: string;
  reference: string;
  remitted_on: string;
  amount: number;
  authority: string | null;
};

type PreviewRow = {
  cycle_id: string;
  cycle_label: string;
  series_name: string;
  investment_id: string;
  investor_name: string;
  investor_code: string;
  gross_profit: number;
  wht_amount: number;
  net_paid: number;
  has_tin: boolean;
  /** 042 — a note cannot be issued without a structured address */
  has_address: boolean;
  address_missing: string[] | null;
  full_address: string | null;
  already_issued: boolean;
  reference: string | null;
};

const naira = (kobo: number) =>
  `₦${Math.round((Number(kobo) || 0) / 100).toLocaleString("en-NG")}`;

const STATE_LABEL: Record<string, string> = {
  withheld: "Not yet filed",
  remitted: "Filed — notes outstanding",
  certified: "Notes issued",
};

export function WhtScreen() {
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [remittances, setRemittances] = useState<Remittance[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/wht");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setCycles(json.cycles ?? []);
      setRemittances(json.remittances ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const outstanding = cycles.filter((c) => c.state !== "certified");
  const done = cycles.filter((c) => c.state === "certified");

  if (loading) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* The work, first */}
      <section>
        <h2 className="text-sm font-semibold text-foreground mb-3">
          Needs attention ({outstanding.length})
        </h2>
        {outstanding.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <FileCheck2 className="h-10 w-10 text-border mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">
                Every cycle&apos;s tax has been filed and certified.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {outstanding.map((c) => (
              <CycleCard
                key={c.cycle_id}
                cycle={c}
                remittances={remittances}
                busy={busy}
                setBusy={setBusy}
                onDone={load}
              />
            ))}
          </div>
        )}
      </section>

      {done.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-foreground mb-3">
            Settled and certified ({done.length})
          </h2>
          <div className="space-y-3">
            {done.map((c) => (
              <CycleCard
                key={c.cycle_id}
                cycle={c}
                remittances={remittances}
                busy={busy}
                setBusy={setBusy}
                onDone={load}
              />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function CycleCard({
  cycle: c,
  remittances,
  busy,
  setBusy,
  onDone,
}: {
  cycle: CycleRow;
  remittances: Remittance[];
  busy: boolean;
  setBusy: (b: boolean) => void;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<{
    rows: PreviewRow[];
    totalWithheld: number;
    matches: boolean;
    difference: number;
    remittance: Remittance | null;
  } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);

  const loadPreview = async (remittanceId: string) => {
    const res = await fetch(`/api/admin/wht?remittanceId=${remittanceId}`);
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error);
      return;
    }
    setPreview(json);
    setOpen(true);
  };

  const issue = async (investmentId?: string) => {
    if (!c.remittance_id) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/wht", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "issue",
          remittanceId: c.remittance_id,
          cycleId: c.cycle_id,
          investmentId,
          acknowledged,
        }),
      });
      const json = await res.json();
      if (res.status === 428) {
        toast.error(json.error);
        return;
      }
      if (!res.ok) {
        toast.error(json.error ?? "Could not issue");
        return;
      }
      // Every outcome, not only the happy one. A run that issued two
      // and skipped six is not a success, and saying "2 notes issued"
      // is how six people quietly never get theirs.
      const bits = [`${json.issued} note${json.issued === 1 ? "" : "s"} issued`];
      if (json.skipped_no_tin > 0)
        bits.push(`${json.skipped_no_tin} waiting on a tax number`);
      if (json.skipped_no_address > 0)
        bits.push(`${json.skipped_no_address} waiting on a residential address`);
      (json.skipped_no_tin > 0 || json.skipped_no_address > 0
        ? toast.warning
        : toast.success)(bits.join(" · "));
      onDone();
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className={c.state === "withheld" ? "border-amber-300" : undefined}>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold text-foreground">
              Series {c.series_name} · {c.cycle_label}
            </p>
            <p className="text-xs text-muted mt-0.5">
              {c.investors_taxed} investor{c.investors_taxed === 1 ? "" : "s"} taxed ·{" "}
              {naira(c.total_withheld)} withheld · {c.notes_issued} of {c.notes_due} notes
              issued
              {c.without_tin > 0 && ` · ${c.without_tin} without a tax number`}
            </p>
          </div>
          <span
            className={cn(
              "text-[10px] font-semibold px-2 py-1 rounded-full shrink-0",
              c.state === "certified"
                ? "bg-emerald-100 text-emerald-700"
                : c.state === "remitted"
                ? "bg-blue-100 text-blue-700"
                : "bg-amber-100 text-amber-700"
            )}
          >
            {STATE_LABEL[c.state]}
          </span>
        </div>

        {c.remittance_reference ? (
          <p className="text-xs text-muted flex items-center gap-1.5">
            <Receipt className="h-3.5 w-3.5" />
            Filed as{" "}
            <span className="font-mono text-foreground">{c.remittance_reference}</span>
            {c.remitted_on && ` on ${c.remitted_on}`}
          </p>
        ) : (
          <p className="text-xs text-amber-700 flex items-start gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 mt-px shrink-0" />
            No filing recorded. Credit notes cannot be issued until the tax has
            actually been remitted.
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {c.remittance_id && c.notes_issued < c.notes_due && (
            <button
              type="button"
              onClick={() => loadPreview(c.remittance_id!)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary-700 px-3 py-2 text-xs font-semibold text-white"
            >
              <FileCheck2 className="h-3.5 w-3.5" /> Review and issue notes
            </button>
          )}
          {c.notes_issued > 0 && (
            <span className="inline-flex items-center gap-1.5 text-xs text-emerald-700">
              <Check className="h-3.5 w-3.5" /> {c.notes_issued} issued
            </span>
          )}
        </div>

        {/* The preview: nothing is issued until this is read */}
        {open && preview && (
          <div className="rounded-lg border border-border overflow-hidden">
            <div className="bg-surface-2 px-3 py-2 text-xs">
              <div className="flex justify-between">
                <span className="text-muted">Total withheld</span>
                <span className="font-mono">{naira(preview.totalWithheld)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Amount filed</span>
                <span className="font-mono">
                  {preview.remittance ? naira(preview.remittance.amount) : "—"}
                </span>
              </div>
            </div>

            {!preview.matches && (
              <label className="flex items-start gap-2 p-3 text-xs bg-amber-50 border-t border-amber-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(e) => setAcknowledged(e.target.checked)}
                  className="mt-0.5"
                />
                <span className="text-amber-800">
                  The total withheld and the amount filed differ by{" "}
                  {naira(Math.abs(preview.difference))}. There may be a good reason;
                  confirm you want to issue anyway.
                </span>
              </label>
            )}

            <div className="max-h-72 overflow-y-auto divide-y divide-border">
              {preview.rows.map((r) => (
                <div
                  key={r.investment_id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-foreground truncate">
                      {r.investor_name}
                    </p>
                    <p className="text-muted font-mono text-[10px]">
                      {r.investor_code}
                      {!r.has_tin && " · no TIN"}
                      {r.already_issued && ` · ${r.reference}`}
                    </p>
                    {/* The address that will be PRINTED on the note,
                        or the reason there will not be one. Shown
                        before issuing, because afterwards it is
                        frozen and cannot be corrected. */}
                    {r.has_address ? (
                      <p className="text-[10px] text-muted truncate">{r.full_address}</p>
                    ) : (
                      <p className="text-[10px] text-amber-700">
                        No residential address —{" "}
                        {(r.address_missing ?? []).join(", ").toLowerCase() ||
                          "incomplete"}
                      </p>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-mono">{naira(r.wht_amount)}</p>
                    {!r.already_issued && r.has_tin && r.has_address && (
                      <button
                        type="button"
                        onClick={() => issue(r.investment_id)}
                        disabled={busy}
                        className="text-[10px] text-primary-700 hover:underline"
                      >
                        issue this one
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {preview.rows.some((r) => !r.already_issued && !r.has_address) && (
              <div className="mx-3 mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
                <div>
                  <p className="font-medium">
                    {preview.rows.filter((r) => !r.already_issued && !r.has_address).length}{" "}
                    investor(s) have no complete residential address, and will be
                    skipped.
                  </p>
                  <p className="mt-0.5 text-amber-800/90">
                    A credit note carries the address it was issued with, for good.
                    Complete theirs on the investor record first — the rest of the
                    batch still issues.
                  </p>
                </div>
              </div>
            )}

            <div className="p-3 border-t border-border">
              <button
                type="button"
                onClick={() => issue()}
                disabled={busy || (!preview.matches && !acknowledged)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-3.5 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {busy ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Download className="h-3.5 w-3.5" />
                )}
                Issue all outstanding notes
              </button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export { type Remittance };
