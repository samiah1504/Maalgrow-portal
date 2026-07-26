import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatDate, cn } from "@/lib/utils";
import { naira } from "@/lib/mudarabah/format";
import { mudarabahDb } from "@/lib/mudarabah/db";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mudarabah Cycles | Admin" };
export const revalidate = 0;

const ADMIN_ROLES = ["super_admin", "administrator"];

const STATUS_STYLE: Record<string, string> = {
  draft: "bg-surface-2 text-muted",
  active: "bg-amber-100 text-amber-700",
  settled: "bg-emerald-100 text-emerald-700",
};

export default async function MudarabahCyclesPage() {
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
  if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) redirect("/admin");

  const db = mudarabahDb(await createAdminClient());
  const { data: rawCycles } = await db
    .from("mudarabah_cycles")
    .select("id, name, description, start_date, slot_price, slots, ratio, status, currency")
    .order("start_date", { ascending: false });

  type Row = {
    id: string;
    name: string;
    description: string | null;
    start_date: string;
    slot_price: number;
    slots: number;
    ratio: number;
    status: string;
    currency: string;
  };
  const cycles = (rawCycles ?? []) as unknown as Row[];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
            <Layers className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Mudarabah Cycles</h1>
            <p className="text-sm text-muted mt-0.5">
              Three months of trading per cycle — profit is shared as a ratio of what
              the trade actually realised
            </p>
          </div>
        </div>
        <Link
          href="/admin/mudarabah/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New cycle
        </Link>
      </div>

      {cycles.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-sm text-muted">
              No cycles yet. Start one and record the first month&apos;s trading as it
              happens.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cycles.map((c) => (
            <Link key={c.id} href={`/admin/mudarabah/${c.id}`}>
              <Card className="h-full hover:border-primary-300 transition-colors">
                <CardContent className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold text-foreground">{c.name}</h2>
                    <span
                      className={cn(
                        "text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0",
                        STATUS_STYLE[c.status] ?? "bg-surface-2 text-muted"
                      )}
                    >
                      {c.status}
                    </span>
                  </div>
                  {c.description && (
                    <p className="text-xs text-muted">{c.description}</p>
                  )}
                  <p className="text-xs text-muted">
                    From {formatDate(c.start_date)}
                  </p>
                  <div className="pt-2 border-t border-border flex items-baseline justify-between">
                    <span className="text-[11px] uppercase tracking-wide text-muted">
                      Capital
                    </span>
                    <span className="font-mono text-sm font-semibold">
                      {naira(c.slot_price * c.slots)}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted">
                    {c.slots} slot{c.slots === 1 ? "" : "s"} · {Number(c.ratio)}% to slot
                    holders
                  </p>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
