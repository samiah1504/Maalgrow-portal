/**
 * Investor Data Export — MaalGrow, by series (approved 21 Oct 2026).
 *
 * GET ?series=A&cycle=<id|all>&status=active,matured,completed
 *     &mode=contacts|investments&fields=full_name,phone,...&format=xlsx|csv[&unmask=1]
 *
 * Super admin and administrator only. Everything is read AS THE SIGNED-
 * IN PERSON, so the database's own staff rules apply. Only investors
 * holding an investment in the chosen series (and cycle, and statuses)
 * are included. Account numbers are masked unless a super admin asks.
 * Each export is recorded in the audit log; nothing is kept on the server.
 */
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import {
  EXPORT_ROLES,
  MG_CONTACT_FIELDS,
  MG_INVESTMENT_FIELDS,
  exportFile,
  mgContactRows,
  pickFields,
  slug,
  sortInvestmentRows,
  table,
  type ExportFormat,
  type MgInvestment,
  type MgInvestmentRow,
  type MgInvestor,
  type MgNextOfKin,
} from "@/lib/export/investor-export";

const STATUSES = ["active", "matured", "completed", "cancelled"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const INVESTOR_COLUMNS = "id, investor_code, full_name, email, phone, address, residential_street_address, residential_city, residential_lga_name, residential_state_name, gender, nationality, occupation, kyc_status, bank_name, account_name, account_number";

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

/** Every row of a filtered query, 1,000 at a time. */
async function all<T>(q: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await q(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

async function inChunks<T>(ids: string[], q: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await q(ids.slice(i, i + 200));
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
  }
  return out;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return bad("Not signed in", 401);
  const db = supabase as unknown as SupabaseClient;
  const { data: me } = await db.from("profiles").select("role").eq("id", user.id).single();
  const role = (me?.role as string | undefined) ?? "";
  if (!EXPORT_ROLES.includes(role)) return bad("Only a super admin or administrator can export investor data.", 403);

  const p = new URL(request.url).searchParams;
  const seriesName = p.get("series") ?? "";
  const cycleParam = p.get("cycle") ?? "all";
  const statuses = (p.get("status") ?? "active,matured,completed").split(",").filter(Boolean);
  const mode = p.get("mode") === "investments" ? "investments" : "contacts";
  const format = (p.get("format") === "csv" ? "csv" : "xlsx") as ExportFormat;
  const unmask = p.get("unmask") === "1";
  if (!["A", "B", "C"].includes(seriesName)) return bad("Choose a series.");
  if (cycleParam !== "all" && !UUID.test(cycleParam)) return bad("Unknown cycle.");
  if (!statuses.length || statuses.some((x) => !STATUSES.includes(x))) return bad("Choose at least one investment status.");
  if (unmask && role !== "super_admin") return bad("Only a super admin can export full account numbers.", 403);
  const fields = pickFields<MgInvestmentRow | ReturnType<typeof mgContactRows>[number]>(
    (mode === "contacts" ? MG_CONTACT_FIELDS : MG_INVESTMENT_FIELDS) as never, (p.get("fields") ?? "").split(",").filter(Boolean));
  if ("error" in fields) return bad(fields.error);

  try {
    const { data: series, error: sErr } = await db.from("series").select("id, name").eq("name", seriesName).maybeSingle();
    if (sErr) throw new Error(sErr.message);
    if (!series) return bad("Unknown series.", 404);
    const { data: cycles, error: cErr } = await db.from("cycles").select("id, cycle_label").eq("series_id", series.id);
    if (cErr) throw new Error(cErr.message);
    const label = Object.fromEntries((cycles ?? []).map((c) => [c.id as string, c.cycle_label as string]));
    if (cycleParam !== "all" && !label[cycleParam]) return bad("That cycle is not in this series.");

    const investments = await all<MgInvestment>((from, to) => {
      let q = db.from("investments")
        .select("id, investment_code, investor_id, cycle_id, units, price_per_unit, capital, investment_date, maturity_date, status")
        .eq("series_id", series.id).in("status", statuses);
      if (cycleParam !== "all") q = q.eq("cycle_id", cycleParam);
      return q.order("id").range(from, to);
    });

    const investorIds = [...new Set(investments.map((i) => i.investor_id))];
    const needs = (k: string[]) => fields.some((f) => k.includes(f.key));
    const [investors, kin, payments] = await Promise.all([
      inChunks<MgInvestor>(investorIds, (ids) => db.from("investors").select(INVESTOR_COLUMNS).in("id", ids).returns<MgInvestor[]>()),
      needs(["nok_name", "nok_relationship", "nok_phone", "nok_email"])
        ? inChunks<NonNullable<MgNextOfKin>>(investorIds, (ids) => db.from("next_of_kin")
            .select("investor_id, full_name, relationship, phone, email").in("investor_id", ids))
        : Promise.resolve([]),
      needs(["amount_paid", "payment_status"])
        ? inChunks<{ investment_id: string; amount: number | string; status: string | null }>(investments.map((i) => i.id),
            (ids) => db.from("investment_payments").select("investment_id, amount, status").in("investment_id", ids))
        : Promise.resolve([]),
    ]);

    const byInvestor = new Map(investors.map((i) => [i.id, i]));
    const nokBy = new Map(kin.map((k) => [k.investor_id, k]));
    const paid = new Map<string, number>();
    for (const pmt of payments) {
      // Only confirmed money counts as paid (rows from before migration 014 have no status).
      if ((pmt.status ?? "confirmed") !== "confirmed") continue;
      paid.set(pmt.investment_id, Math.round(((paid.get(pmt.investment_id) ?? 0) + Number(pmt.amount)) * 100) / 100);
    }
    const rows: MgInvestmentRow[] = investments.flatMap((inv) => {
      const investor = byInvestor.get(inv.investor_id);
      return investor ? [{ investor, nok: nokBy.get(inv.investor_id) ?? null, inv, series: seriesName,
                           cycle: label[inv.cycle_id] ?? "", paid: paid.get(inv.id) ?? 0 }] : [];
    });

    const out = mode === "contacts" ? mgContactRows(rows) : sortInvestmentRows(rows);
    const t = table(fields as never[], out as never[], unmask);
    const file = exportFile(format, `Series ${seriesName}`, t);

    await db.rpc("create_audit_log", {
      p_action: "investor_export", p_entity_type: "series", p_entity_id: series.id, p_old_values: null,
      p_new_values: { product: "maalgrow", series: seriesName, cycle: cycleParam === "all" ? "all" : label[cycleParam],
                      statuses, mode, fields: fields.map((f) => f.key), format, rows: out.length, unmasked: unmask },
    });

    const scope = cycleParam === "all" ? `series-${seriesName}` : `series-${seriesName}-${slug(label[cycleParam])}`;
    const name = `maalgrow-${scope}-${mode}-${new Date().toISOString().slice(0, 10)}.${format}`;
    return new NextResponse(new Uint8Array(file.bytes), {
      headers: { "Content-Type": file.type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
    });
  } catch (e) {
    return bad(e instanceof Error ? `Could not export: ${e.message}` : "Could not export.", 500);
  }
}
