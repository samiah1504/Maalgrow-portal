import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Archive } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  loadArchiveHolders,
  decisionLabel,
  type PayState,
  type ArchiveHolder,
} from "@/lib/mudarabah/cycle-archive";
import { mudarabahDb } from "@/lib/mudarabah/db";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cycle Record | Admin" };
export const revalidate = 0;

const VIEW_ROLES = ["super_admin", "administrator", "finance"];

const PAY_LABEL: Record<PayState, string> = {
  paid: "Paid",
  processing: "Processing",
  approved: "Approved",
  pending: "Pending",
  rejected: "Rejected",
  none: "Not requested",
};

const PAY_VARIANT: Record<PayState, "completed" | "active" | "warning" | "pending"> = {
  paid: "completed",
  processing: "active",
  approved: "active",
  pending: "warning",
  rejected: "warning",
  none: "pending",
};

export default async function CycleRecordPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !VIEW_ROLES.includes(profile.role ?? "")) redirect("/admin");

  const db = await createAdminClient();

  const { data: cycle } = await db
    .from("cycles")
    .select("id, cycle_label, start_date, end_date, status, series(name)")
    .eq("id", id)
    .single();
  if (!cycle) notFound();

  const series = cycle.series as unknown as { name: string } | null;
  const holders = await loadArchiveHolders(mudarabahDb(db), id);

  const owed = holders.filter((h) => h.outstanding);
  const totalSlots = holders.reduce((t, h) => t + h.slots, 0);
  const totalCapital = holders.reduce((t, h) => t + h.capital, 0);
  const totalProfit = holders.reduce((t, h) => t + (h.profitNet ?? 0), 0);

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/admin/cycles/archive"
          className="inline-flex items-center gap-1.5 text-sm text-muted hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Cycle Archive
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-foreground flex items-center gap-2">
          <Archive className="h-6 w-6 text-primary-600" />
          Series {series?.name ?? "?"} · {cycle.cycle_label}
        </h1>
        <p className="text-sm text-muted mt-1">
          {formatDate(cycle.start_date)} — {formatDate(cycle.end_date)} ·{" "}
          {holders.length} investor{holders.length === 1 ? "" : "s"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Investors" value={String(holders.length)} />
        <Stat label="Slots" value={totalSlots.toLocaleString()} />
        <Stat label="Capital" value={formatCurrency(totalCapital)} />
        <Stat label="Profit (net of tax)" value={formatCurrency(totalProfit)} />
      </div>

      {owed.length > 0 ? (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-900">
                {owed.length} investor{owed.length === 1 ? " has" : "s have"} not
                been paid in full.
              </p>
              <p className="mt-1 text-amber-800/90">
                {owed.map((h) => h.investorName).join(", ")}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : holders.length > 0 ? (
        <Card className="border-emerald-200 bg-emerald-50/50">
          <CardContent className="p-4 text-sm text-emerald-900">
            Everything owed for this cycle has been marked paid.
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Investors in this cycle</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {holders.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">
              This cycle has no investors on record.
            </p>
          ) : (
            <>
              {/* A table on a desktop, a stack of cards on a phone. The
                  same rows either way — nothing is hidden on mobile,
                  because this is the page you check on your feet. */}
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full text-sm">
                  <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
                    <tr>
                      <th className="px-4 py-3 font-medium">Investor</th>
                      <th className="px-4 py-3 font-medium">Slots</th>
                      <th className="px-4 py-3 font-medium">Capital</th>
                      <th className="px-4 py-3 font-medium">Instruction</th>
                      <th className="px-4 py-3 font-medium">Profit</th>
                      <th className="px-4 py-3 font-medium">Capital paid</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holders.map((h) => (
                      <tr
                        key={h.investmentId}
                        className={
                          h.outstanding
                            ? "border-b border-border bg-amber-50/40 last:border-0"
                            : "border-b border-border last:border-0"
                        }
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">{h.investorName}</p>
                          <p className="text-xs text-muted">
                            {h.investorCode} · {h.investmentCode}
                          </p>
                        </td>
                        <td className="px-4 py-3 tabular-nums">{h.slots}</td>
                        <td className="px-4 py-3 tabular-nums">
                          {formatCurrency(h.capital)}
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-foreground">{decisionLabel(h.decision)}</p>
                          {h.continuedAs && (
                            <p className="text-xs text-muted">
                              Continued as {h.continuedAs}
                              {h.continuedInto ? ` in ${h.continuedInto}` : ""}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <PayCell
                            state={h.profitState}
                            due={h.profitNet}
                            requested={h.profitRequested}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {h.decision === "exit" || h.decision === "partial_exit" ? (
                            <PayCell
                              state={h.capitalState}
                              due={h.capitalRequested}
                              requested={h.capitalRequested}
                            />
                          ) : (
                            <span className="text-xs text-muted">
                              Not withdrawn
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="divide-y divide-border lg:hidden">
                {holders.map((h) => (
                  <HolderCard key={h.investmentId} h={h} />
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
        <p className="mt-1 text-base font-semibold text-foreground break-words">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

function PayCell({
  state,
  due,
  requested,
}: {
  state: PayState;
  due: number | null;
  requested: number | null;
}) {
  return (
    <div className="space-y-1">
      <p className="tabular-nums text-foreground">
        {due != null ? formatCurrency(due) : "—"}
      </p>
      <Badge variant={PAY_VARIANT[state]}>{PAY_LABEL[state]}</Badge>
      {/* A request that does not match what is due is worth seeing.
          It is how the gross-instead-of-net payout was caught. */}
      {requested != null && due != null && Math.abs(requested - due) > 0.005 && (
        <p className="text-xs text-amber-700">
          Requested {formatCurrency(requested)}
        </p>
      )}
    </div>
  );
}

function HolderCard({ h }: { h: ArchiveHolder }) {
  return (
    <div className={h.outstanding ? "bg-amber-50/40 p-4" : "p-4"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium text-foreground">{h.investorName}</p>
          <p className="text-xs text-muted">
            {h.investorCode} · {h.investmentCode}
          </p>
        </div>
        <p className="shrink-0 text-sm tabular-nums text-foreground">
          {h.slots} slot{h.slots === 1 ? "" : "s"}
        </p>
      </div>

      <p className="mt-2 text-sm text-foreground">{decisionLabel(h.decision)}</p>
      {h.continuedAs && (
        <p className="text-xs text-muted">
          Continued as {h.continuedAs}
          {h.continuedInto ? ` in ${h.continuedInto}` : ""}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted">Capital</p>
          <p className="text-sm tabular-nums text-foreground">
            {formatCurrency(h.capital)}
          </p>
        </div>
        <div>
          <p className="text-[11px] uppercase tracking-wide text-muted">
            Profit (net)
          </p>
          <p className="text-sm tabular-nums text-foreground">
            {h.profitNet != null ? formatCurrency(h.profitNet) : "—"}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <span className="text-xs text-muted">Profit</span>
        <Badge variant={PAY_VARIANT[h.profitState]}>{PAY_LABEL[h.profitState]}</Badge>
        {(h.decision === "exit" || h.decision === "partial_exit") && (
          <>
            <span className="text-xs text-muted">Capital</span>
            <Badge variant={PAY_VARIANT[h.capitalState]}>
              {PAY_LABEL[h.capitalState]}
            </Badge>
          </>
        )}
      </div>
    </div>
  );
}
