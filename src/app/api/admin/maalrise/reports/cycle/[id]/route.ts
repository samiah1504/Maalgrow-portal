/**
 * A Cycle's report as CSV. Staff.
 *   ?kind=received   — every payment received (profit and capital), fee and net
 *   ?kind=investors  — each investor's units, capital, profit paid and capital returned
 *   ?kind=audit      — the Cycle's activity from the audit log
 */
import { NextResponse } from "next/server";
import { isUuid, maalriseGate } from "@/lib/maalrise/api";
import { getCycleDetail, loadCycleAudit } from "@/lib/maalrise/db";
import { auditCsv, cycleReport, cycleReportCsv } from "@/lib/maalrise/reports";

const STAFF = ["super_admin", "administrator", "operations", "finance", "customer_support"];

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(STAFF);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind !== "received" && kind !== "investors" && kind !== "audit") {
    return NextResponse.json({ error: "Choose received, investors or audit." }, { status: 400 });
  }
  const d = await getCycleDetail(gate.db, id);
  if (!d) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });
  let csv: string;
  if (kind === "audit") {
    const a = await loadCycleAudit(gate.db, d);
    csv = auditCsv(a.rows, a.names);
  } else {
    csv = cycleReportCsv(kind, cycleReport(d));
  }
  const slug = d.cycle.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="maalrise-${slug}-${kind}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
