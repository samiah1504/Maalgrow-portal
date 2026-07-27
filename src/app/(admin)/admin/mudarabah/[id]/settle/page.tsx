import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { mudarabahDb } from "@/lib/mudarabah/db";
import { draftFromLedger, termsFromLedger, type LedgerPayload } from "@/lib/mudarabah/editor";
import { Settle } from "./_settle";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Settle cycle | Admin" };
export const revalidate = 0;

const ADMIN_ROLES = ["super_admin", "administrator"];

/**
 * Settlement, in two phases. This page is the first one: it shows
 * everything the commit would write and writes nothing itself.
 */
export default async function SettlePage({
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
  if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) redirect("/admin");

  const db = mudarabahDb(await createAdminClient());
  const { data: raw } = await db.rpc("mudarabah_get_ledger", { p_cycle_id: id });
  if (!raw) notFound();

  const payload = raw as unknown as LedgerPayload;
  const terms = termsFromLedger(payload);
  const draft = draftFromLedger(payload);

  return (
    <div className="space-y-6 animate-fade-in">
      <Link
        href={`/admin/mudarabah/${id}`}
        className="inline-flex items-center gap-1.5 text-xs font-medium text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> Back to the ledger
      </Link>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <ShieldCheck className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            Settle {terms.seriesName} · {terms.cycleLabel}
          </h1>
          <p className="text-sm text-muted mt-0.5">
            Everything that will be written, before any of it is. Profit is paid to
            every investor; only capital depends on what they chose.
          </p>
        </div>
      </div>

      <Settle
        cycleId={id}
        cycleLabel={terms.cycleLabel}
        seriesName={terms.seriesName}
        alreadySettled={draft.status === "settled"}
      />
    </div>
  );
}
