import { createAdminClient } from "@/lib/supabase/server";
import { History } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type Row = {
  cycle_id: string;
  series_name: string;
  cycle_label: string;
  start_date: string;
  end_date: string;
  settled_at: string;
  units: number;
  capital: number;
  gross_profit: number;
  wht: number;
  net_profit: number;
  net_return_pct: number;
  capital_action: string;
  slots_withdrawn: number;
  wht_state: string;
};

const naira = (kobo: number) =>
  `${kobo < 0 ? "−" : ""}₦${Math.round(Math.abs(Number(kobo) || 0) / 100).toLocaleString("en-NG")}`;

const ACTION: Record<string, string> = {
  withdraw: "Capital paid out",
  rollover: "Capital continued",
  partial: "Part paid out",
};

const TAX_STATE: Record<string, string> = {
  withheld: "Withheld — not yet filed",
  remitted: "Filed with the tax authority",
  certified: "Credit note issued",
};

/**
 * Every settled cycle this investor has been part of.
 *
 * Read from the frozen snapshot, never recomputed — a figure shown
 * here says the same thing in two years as it does today.
 */
export async function CycleHistory({ investorId }: { investorId: string }) {
  const admin = await createAdminClient();
  const { data } = await (admin as unknown as {
    rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: Row[] | null }>;
  }).rpc("mudarabah_investor_cycle_history", { p_investor_id: investorId });

  const rows = data ?? [];
  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <History className="h-4 w-4 text-primary-600" />
          Cycle history ({rows.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => (
          <div
            key={r.cycle_id}
            className="rounded-lg border border-border p-3 space-y-2"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  Series {r.series_name} · {r.cycle_label}
                </p>
                <p className="text-[11px] text-muted">
                  {r.start_date} → {r.end_date} · {r.units} slot
                  {Number(r.units) === 1 ? "" : "s"}
                </p>
              </div>
              <span className="text-sm font-bold text-emerald-700 tabular-nums shrink-0">
                {naira(r.net_profit)}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px]">
              <Fig label="Capital" value={naira(r.capital)} />
              <Fig label="Gross profit" value={naira(r.gross_profit)} />
              <Fig
                label="Tax withheld"
                value={r.wht > 0 ? `−${naira(r.wht)}` : "—"}
              />
              <Fig label="Net return" value={`${Number(r.net_return_pct).toFixed(2)}%`} />
            </div>

            <p className="text-[11px] text-muted">
              {ACTION[r.capital_action] ?? r.capital_action}
              {r.capital_action === "partial" && ` (${r.slots_withdrawn} slots)`}
              {r.wht > 0 && ` · ${TAX_STATE[r.wht_state] ?? r.wht_state}`}
            </p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Fig({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-muted uppercase tracking-wide text-[9px]">{label}</div>
      <div className="font-mono text-foreground">{value}</div>
    </div>
  );
}
