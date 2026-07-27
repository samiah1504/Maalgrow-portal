import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Archive, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { loadArchiveCycles } from "@/lib/mudarabah/cycle-archive";
import { mudarabahDb } from "@/lib/mudarabah/db";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Cycle Archive | Admin" };
export const revalidate = 0;

const VIEW_ROLES = ["super_admin", "administrator", "finance"];

export default async function CycleArchivePage() {
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
  const cycles = await loadArchiveCycles(mudarabahDb(db));

  const stillOwed = cycles.filter((c) => c.outstanding > 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-foreground flex items-center gap-2">
          <Archive className="h-6 w-6 text-primary-600" />
          Cycle Archive
        </h1>
        <p className="text-sm text-muted mt-1">
          Every cycle that has ended, and what is still owed from it.
        </p>
      </div>

      {stillOwed.length > 0 && (
        <Card className="border-amber-300 bg-amber-50/60">
          <CardContent className="flex items-start gap-3 p-4">
            <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
            <div className="text-sm">
              <p className="font-medium text-amber-900">
                {stillOwed.reduce((t, c) => t + c.outstanding, 0)} investor(s)
                across {stillOwed.length} cycle
                {stillOwed.length === 1 ? "" : "s"} have not been paid.
              </p>
              <p className="text-amber-800/90 mt-0.5">
                Open a cycle below to see exactly who, and what they are owed.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {cycles.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-sm text-muted">
            No cycle has ended yet. Once one does, its full record appears here.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {cycles.map((c) => (
            <Link key={c.id} href={`/admin/cycles/archive/${c.id}`} className="block">
              <Card className="transition-colors hover:border-primary-300">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-foreground truncate">
                        Series {c.seriesName} · {c.label}
                      </p>
                      <p className="text-xs text-muted mt-0.5">
                        {formatDate(c.startDate)} — {formatDate(c.endDate)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {c.outstanding > 0 ? (
                        <Badge variant="warning">{c.outstanding} unpaid</Badge>
                      ) : c.settled ? (
                        <Badge variant="completed">
                          <CheckCircle2 className="mr-1 h-3 w-3" />
                          All paid
                        </Badge>
                      ) : (
                        <Badge variant="pending">Not settled</Badge>
                      )}
                      <ArrowRight className="h-4 w-4 text-muted" />
                    </div>
                  </div>

                  {/* Two columns on a narrow phone, four when there is
                      room. Squeezing four across 360px clipped the
                      naira figures the last time this was tried. */}
                  <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <Figure label="Investors" value={String(c.investors)} />
                    <Figure label="Slots" value={c.slots.toLocaleString()} />
                    <Figure label="Capital" value={formatCurrency(c.capital)} />
                    <Figure
                      label="Profit (net of tax)"
                      value={c.settled ? formatCurrency(c.profitNet) : "—"}
                    />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-semibold text-foreground break-words">{value}</p>
    </div>
  );
}
