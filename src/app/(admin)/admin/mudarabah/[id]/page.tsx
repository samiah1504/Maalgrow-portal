import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
import { CycleEditor } from "./_cycle-editor";
import {
  draftFromLedger,
  termsFromLedger,
  type LedgerPayload,
} from "@/lib/mudarabah/editor";
import type { SettlementComputed, SettlementProduct } from "@/lib/mudarabah/figures";
import { mudarabahDb } from "@/lib/mudarabah/db";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Mudarabah Ledger | Admin" };
export const revalidate = 0;

const ADMIN_ROLES = ["super_admin", "administrator"];

// The route id is the EXISTING cycle's id. There is no separate
// Mudarabah cycle to address.
export default async function MudarabahLedgerPage({
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
  const draft = draftFromLedger(payload);
  const terms = termsFromLedger(payload);

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
      settlement = {
        settledAt: row.settled_at,
        engineVersion: row.engine_version,
        computed: row.computed as SettlementComputed,
      };

      const { data: prods } = await db
        .from("mudarabah_settlement_products")
        .select("product_key, product_name, units_bought, units_sold, units_left, revenue, cogs, gross, gross_margin")
        .eq("settlement_id", row.id);

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
      terms={terms}
      hasLedger={payload.hasLedger}
      settlement={settlement}
      settledProducts={settledProducts}
    />
  );
}
