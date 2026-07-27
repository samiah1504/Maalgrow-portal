"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle,
  Check,
  Loader2,
  Lock,
  ShieldAlert,
  X,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type CapitalAction = "withdraw" | "rollover" | "partial";

type Holder = {
  investmentId: string;
  investorId: string;
  investorName: string;
  investorCode: string;
  units: number;
  capital: number;
  grossProfit: number;
  wht: number;
  netProfit: number;
  capitalAction: CapitalAction;
  slotsWithdrawn: number;
  capitalWithdrawn: number;
  amountPaid: number;
  defaulted: boolean;
  overridden: boolean;
  hasTin: boolean;
};

type Preview = {
  holders: Holder[];
  totals: {
    units: number;
    capital: number;
    gross: number;
    wht: number;
    net: number;
    capitalReturning: number;
    cashNeeded: number;
  };
  endCash: number;
  cashCovers: boolean;
  shortfall: number;
  assertions: { name: string; passed: boolean; detail: string }[];
  warnings: { kind: string; message: string; investors: string[] }[];
  blocked: boolean;
  needsAcknowledgement: boolean;
  cycle: { profit: number; holderPot: number; mudaribPot: number; netPerSlot: number; isLoss: boolean };
};

const naira = (kobo: number) =>
  `${kobo < 0 ? "−" : ""}₦${Math.round(Math.abs(Number(kobo) || 0) / 100).toLocaleString("en-NG")}`;

const ACTION_WORD: Record<CapitalAction, string> = {
  withdraw: "Paid out",
  rollover: "Continues",
  partial: "Part out",
};

export function Settle({
  cycleId,
  cycleLabel,
  seriesName,
  alreadySettled,
}: {
  cycleId: string;
  cycleLabel: string;
  seriesName: string;
  alreadySettled: boolean;
}) {
  const router = useRouter();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overrides, setOverrides] = useState<
    Record<string, { action: CapitalAction; slotsWithdrawn?: number }>
  >({});
  const [acknowledged, setAcknowledged] = useState(false);
  const [committing, setCommitting] = useState(false);

  const overrideList = useMemo(
    () =>
      Object.entries(overrides).map(([investmentId, o]) => ({
        investmentId,
        ...o,
      })),
    [overrides]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/mudarabah/${cycleId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", overrides: overrideList }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not build the preview");
      setPreview(json.preview as Preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the preview");
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [cycleId, overrideList]);

  useEffect(() => {
    void load();
  }, [load]);

  // Changing anything invalidates an acknowledgement already given
  useEffect(() => {
    setAcknowledged(false);
  }, [overrideList]);

  const commit = async () => {
    setCommitting(true);
    try {
      const res = await fetch(`/api/admin/mudarabah/${cycleId}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "commit",
          overrides: overrideList,
          acknowledged,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Settlement was refused");
        return;
      }
      toast.success(
        `Settled — ${json.holders} investor${json.holders === 1 ? "" : "s"}, ${naira(
          json.cashNeeded
        )} to pay out`
      );
      router.push(`/admin/mudarabah/${cycleId}`);
      router.refresh();
    } finally {
      setCommitting(false);
    }
  };

  if (alreadySettled) {
    return (
      <Card>
        <CardContent className="p-6 flex items-start gap-3">
          <Lock className="h-5 w-5 text-primary-600 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold text-foreground">This cycle is already settled.</p>
            <p className="text-sm text-muted mt-1">
              Its figures are frozen. Reopen it from the ledger if something has to
              change — the earlier snapshot is kept either way.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (loading && !preview) {
    return (
      <Card>
        <CardContent className="p-8 text-center text-sm text-muted">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
          Running the figures…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6 text-sm text-red-700">{error}</CardContent>
      </Card>
    );
  }

  if (!preview) return null;

  const canCommit =
    !preview.blocked &&
    preview.holders.length > 0 &&
    (!preview.needsAcknowledgement || acknowledged);

  return (
    <div className="space-y-5">
      {/* ── The assertions. Visibly passing or failing. ── */}
      <Card className={preview.blocked ? "border-red-300" : "border-emerald-200"}>
        <CardContent className="p-4 space-y-2.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Checks that must pass
          </p>
          {preview.assertions.map((a) => (
            <div key={a.name} className="flex items-start gap-2.5">
              <span
                className={cn(
                  "flex h-5 w-5 items-center justify-center rounded-full shrink-0 mt-0.5",
                  a.passed ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700"
                )}
              >
                {a.passed ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
              </span>
              <div className="min-w-0">
                <p
                  className={cn(
                    "text-sm",
                    a.passed ? "text-foreground" : "text-red-700 font-semibold"
                  )}
                >
                  {a.name}
                </p>
                <p className="text-[11px] text-muted font-mono break-all">{a.detail}</p>
              </div>
            </div>
          ))}
          {preview.blocked && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg p-2.5 mt-1">
              Settlement is blocked. A failed check here is a fault in the figures,
              not a decision to take — nothing can be committed until it passes.
            </p>
          )}
        </CardContent>
      </Card>

      {/* ── Warnings ── */}
      {preview.warnings.map((w) => (
        <Card key={w.kind} className="border-amber-200">
          <CardContent className="p-4 flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm text-foreground">{w.message}</p>
              {w.investors.length > 0 && (
                <ul className="mt-1.5 space-y-0.5">
                  {w.investors.map((n, i) => (
                    <li key={i} className="text-xs text-muted">
                      {n}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {/* ── The cycle ── */}
      <Card>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-4">
          <Stat label="Net profit" value={naira(preview.cycle.profit)} />
          <Stat label="Investors' share" value={naira(preview.cycle.holderPot)} />
          <Stat label="MaalGrow's share" value={naira(preview.cycle.mudaribPot)} />
          <Stat label="Net per slot" value={naira(preview.cycle.netPerSlot)} />
        </CardContent>
      </Card>

      {/* ── Every investor ── */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <Th>Investor</Th>
                <Th right>Slots</Th>
                <Th right>Gross profit</Th>
                <Th right>Tax</Th>
                <Th right>Net profit</Th>
                <Th>Capital</Th>
                <Th right>Capital back</Th>
                <Th right>Total owed</Th>
              </tr>
            </thead>
            <tbody>
              {preview.holders.map((h) => (
                <tr
                  key={h.investmentId}
                  className={cn(
                    "border-b border-border last:border-0",
                    h.defaulted && "bg-amber-50/60"
                  )}
                >
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-foreground">{h.investorName}</div>
                    <div className="text-[11px] text-muted font-mono">
                      {h.investorCode}
                      {!h.hasTin && h.wht > 0 && " · no TIN"}
                    </div>
                  </td>
                  <Td right>{h.units}</Td>
                  <Td right>{naira(h.grossProfit)}</Td>
                  <Td right>{h.wht > 0 ? `−${naira(h.wht)}` : "—"}</Td>
                  <Td right bold>{naira(h.netProfit)}</Td>
                  <td className="px-3 py-2.5">
                    <select
                      value={h.capitalAction}
                      onChange={(e) =>
                        setOverrides((o) => ({
                          ...o,
                          [h.investmentId]: {
                            action: e.target.value as CapitalAction,
                            slotsWithdrawn:
                              e.target.value === "partial" ? h.slotsWithdrawn || 0.5 : undefined,
                          },
                        }))
                      }
                      className={cn(
                        "rounded-lg border bg-surface px-2 py-1 text-xs",
                        h.defaulted ? "border-amber-400" : "border-border"
                      )}
                    >
                      <option value="withdraw">Paid out</option>
                      <option value="rollover">Continues</option>
                      <option value="partial">Part out</option>
                    </select>
                    {h.defaulted && (
                      <div className="text-[10px] text-amber-700 mt-0.5">
                        no instruction — default
                      </div>
                    )}
                    {h.overridden && (
                      <div className="text-[10px] text-primary-700 mt-0.5">changed by you</div>
                    )}
                  </td>
                  <Td right>{h.capitalWithdrawn > 0 ? naira(h.capitalWithdrawn) : "—"}</Td>
                  <Td right bold>{naira(h.amountPaid)}</Td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-surface-2 font-semibold">
                <td className="px-3 py-2.5">
                  {preview.holders.length} investor
                  {preview.holders.length === 1 ? "" : "s"}
                </td>
                <Td right>{preview.totals.units}</Td>
                <Td right>{naira(preview.totals.gross)}</Td>
                <Td right>−{naira(preview.totals.wht)}</Td>
                <Td right>{naira(preview.totals.net)}</Td>
                <td />
                <Td right>{naira(preview.totals.capitalReturning)}</Td>
                <Td right>{naira(preview.totals.cashNeeded)}</Td>
              </tr>
            </tfoot>
          </table>
        </CardContent>
      </Card>

      {/* ── Cash ── */}
      <Card className={preview.cashCovers ? undefined : "border-amber-300"}>
        <CardContent className="p-4 grid gap-3 sm:grid-cols-3">
          <Stat label="Cash at close" value={naira(preview.endCash)} />
          <Stat label="Cash needed" value={naira(preview.totals.cashNeeded)} />
          <Stat
            label={preview.cashCovers ? "Covered" : "Short by"}
            value={preview.cashCovers ? "Yes" : naira(preview.shortfall)}
            tone={preview.cashCovers ? "ok" : "warn"}
          />
        </CardContent>
      </Card>

      {/* ── Commit ── */}
      <Card>
        <CardContent className="p-4 space-y-3">
          {preview.needsAcknowledgement && (
            <label className="flex items-start gap-2.5 text-sm cursor-pointer">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(e) => setAcknowledged(e.target.checked)}
                className="mt-0.5"
              />
              <span className="text-foreground">
                I have read the warnings above and am settling anyway.
                <span className="block text-xs text-muted mt-0.5">
                  Settling freezes these figures. Every investor statement will read
                  from them.
                </span>
              </span>
            </label>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={commit}
              disabled={!canCommit || committing || loading}
              className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
            >
              {committing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              {committing ? "Settling…" : `Settle ${seriesName} · ${cycleLabel}`}
            </button>
            {loading && (
              <span className="text-xs text-muted">
                <Loader2 className="h-3 w-3 animate-spin inline mr-1" />
                recalculating
              </span>
            )}
          </div>

          <p className="text-xs text-muted">
            Nothing above has been written. Settling is one transaction: the snapshot,
            every investor&apos;s figures, the balance entries and the profit
            declaration, all together or not at all. No credit notes are issued here —
            those come after the tax has been filed.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "warn";
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted">
        {label}
      </div>
      <div
        className={cn(
          "text-lg font-bold mt-0.5",
          tone === "warn" ? "text-amber-700" : tone === "ok" ? "text-emerald-700" : "text-foreground"
        )}
      >
        {value}
      </div>
    </div>
  );
}

function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={cn(
        "px-3 py-2 text-[10px] font-semibold uppercase tracking-wide text-muted",
        right && "text-right"
      )}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  right,
  bold,
}: {
  children?: React.ReactNode;
  right?: boolean;
  bold?: boolean;
}) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 tabular-nums",
        right && "text-right",
        bold && "font-semibold text-foreground"
      )}
    >
      {children}
    </td>
  );
}
