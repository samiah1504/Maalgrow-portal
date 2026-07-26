import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { CycleEditor } from "./_cycle-editor";
import { emptyDraft, fromSavedCycle, type Draft } from "@/lib/mudarabah/editor";
import type { SettlementComputed, SettlementProduct } from "@/lib/mudarabah/figures";
import { mudarabahDb } from "@/lib/mudarabah/db";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mudarabah Cycle | Admin" };
export const revalidate = 0;

const ADMIN_ROLES = ["super_admin", "administrator"];

type SavedCycle = Parameters<typeof fromSavedCycle>[0];

export default async function MudarabahCyclePage({
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

  // A brand new cycle: nothing to load
  if (id === "new") {
    return <CycleEditor initialDraft={emptyDraft()} settlement={null} settledProducts={[]} />;
  }

  const db = mudarabahDb(await createAdminClient());
  const { data: saved } = await db.rpc("mudarabah_get_cycle", { p_cycle_id: id });
  if (!saved) notFound();

  // How many slots are withdrawing capital at maturity
  const { data: holdings } = await db
    .from("mudarabah_holdings")
    .select("slots, capital_action")
    .eq("cycle_id", id);

  const withdrawSlots = (holdings ?? [])
    .filter((h) => h.capital_action === "withdraw")
    .reduce((s, h) => s + Number(h.slots), 0);

  const draft: Draft = fromSavedCycle(saved as unknown as SavedCycle, withdrawSlots);

  // A settled cycle shows its FROZEN figures, never a fresh calculation
  let settlement: {
    settledAt: string;
    engineVersion: string;
    computed: SettlementComputed;
  } | null = null;
  let settledProducts: SettlementProduct[] = [];

  if (draft.status === "settled") {
    const { data: row } = await db
      .from("mudarabah_settlements")
      .select("id, settled_at, engine_version, computed")
      .eq("cycle_id", id)
      .eq("is_current", true)
      .maybeSingle();

    if (row) {
      const r = row as unknown as {
        id: string;
        settled_at: string;
        engine_version: string;
        computed: SettlementComputed;
      };

      settlement = {
        settledAt: r.settled_at,
        engineVersion: r.engine_version,
        computed: r.computed,
      };

      const { data: prods } = await db
        .from("mudarabah_settlement_products")
        .select("product_key, product_name, units_bought, units_sold, units_left, revenue, cogs, gross, gross_margin")
        .eq("settlement_id", r.id);

      settledProducts = (prods ?? []).map((p) => ({
        productId: p.product_key,
        productName: p.product_name,
        unitsBought: p.units_bought,
        unitsSold: p.units_sold,
        unitsLeft: p.units_left,
        revenue: p.revenue,
        cogs: p.cogs,
        gross: p.gross,
        grossMargin: Number(p.gross_margin),
      }));
    }
  }

  return (
    <CycleEditor
      initialDraft={draft}
      settlement={settlement}
      settledProducts={settledProducts}
    />
  );
}
