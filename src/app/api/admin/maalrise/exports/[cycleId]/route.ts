/**
 * Investor Data Export — MaalRise, by Cycle (approved 21 Oct 2026).
 *
 * GET ?fields=full_name,phone,...&format=xlsx|csv[&unmask=1]
 *
 * One row per investor holding units in the Cycle (an allocation, which
 * exists only once funding is CONFIRMED — recorded, rejected or moved
 * funding is never included). Figures are the ones the Cycle page and
 * the Cycle report show. Super admin and administrator only; account
 * numbers masked unless a super admin asks; every export audited.
 */
import { NextResponse } from "next/server";
import { isUuid, maalriseGate } from "@/lib/maalrise/api";
import { getCycleDetail } from "@/lib/maalrise/db";
import { allocateCycle } from "@/lib/maalrise/compute";
import { cycleReport } from "@/lib/maalrise/reports";
import { EXPORT_ROLES, MR_FIELDS, exportFile, pickFields, slug, table, type ExportFormat, type MrRow } from "@/lib/export/investor-export";

export async function GET(request: Request, { params }: { params: Promise<{ cycleId: string }> }) {
  const gate = await maalriseGate(EXPORT_ROLES);
  if (!gate.ok) return gate.response;
  const { cycleId } = await params;
  if (!isUuid(cycleId)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });
  const p = new URL(request.url).searchParams;
  const format = (p.get("format") === "csv" ? "csv" : "xlsx") as ExportFormat;
  const unmask = p.get("unmask") === "1";
  if (unmask && gate.role !== "super_admin") {
    return NextResponse.json({ error: "Only a super admin can export full account numbers." }, { status: 403 });
  }
  const fields = pickFields(MR_FIELDS, (p.get("fields") ?? "").split(",").filter(Boolean));
  if ("error" in fields) return NextResponse.json({ error: fields.error }, { status: 400 });

  const d = await getCycleDetail(gate.db, cycleId);
  if (!d) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });

  const report = cycleReport(d);
  const byInvestor = new Map(report.investors.map((l) => [l.investorId, l]));
  const shown = d.approved ?? d.open;
  let alloc: ReturnType<typeof allocateCycle> | null = null;
  try {
    alloc = shown
      ? allocateCycle({ costKobo: shown.cost_kobo, unitPriceKobo: d.cycle.unit_price_kobo },
          (d.schedules[shown.id] ?? []).map((l) => ({ investorNetKobo: l.investor_net_kobo })),
          d.allocations.map((a) => ({ key: a.maalrise_investor_id, units: a.units })))
      : null;
  } catch {
    alloc = null; // figures that cannot be worked out are left blank, never guessed
  }
  const share = new Map((alloc?.lines ?? []).map((l) => [l.key, l]));
  const confirmed = d.fundings.filter((f) => f.status === "confirmed");

  const rows: MrRow[] = d.allocations.flatMap((a) => {
    if (!a.investor) return [];
    const r = byInvestor.get(a.maalrise_investor_id);
    const own = confirmed.filter((f) => f.maalrise_investor_id === a.maalrise_investor_id)
      .sort((x, y) => x.received_on.localeCompare(y.received_on));
    return [{
      investor: a.investor,
      cycle: d.cycle.name,
      units: a.units,
      capitalKobo: a.capital_kobo,
      participationBps: share.get(a.maalrise_investor_id)?.participationBps ?? null,
      expectedProfitKobo: share.get(a.maalrise_investor_id)?.totalProfitKobo ?? null,
      profitPaidKobo: r?.profitPaidKobo ?? 0,
      profitApprovedKobo: r?.profitApprovedKobo ?? 0,
      capitalReturnedKobo: r?.capitalReturnedKobo ?? 0,
      fundingDates: [...new Set(own.map((f) => f.received_on))].join(", "),
      fundingRefs: own.map((f) => f.reference).join(", "),
    }];
  }).sort((x, y) => x.investor.full_name.localeCompare(y.investor.full_name));

  const file = exportFile(format, d.cycle.name, table(fields, rows, unmask));
  await gate.db.rpc("create_audit_log", {
    p_action: "investor_export", p_entity_type: "maalrise_cycle", p_entity_id: cycleId, p_old_values: null,
    p_new_values: { product: "maalrise", cycle: d.cycle.name, fields: fields.map((f) => f.key), format, rows: rows.length, unmasked: unmask },
  });
  const name = `maalrise-${slug(d.cycle.name)}-investors-${new Date().toISOString().slice(0, 10)}.${format}`;
  return new NextResponse(new Uint8Array(file.bytes), {
    headers: { "Content-Type": file.type, "Content-Disposition": `attachment; filename="${name}"`, "Cache-Control": "no-store" },
  });
}
