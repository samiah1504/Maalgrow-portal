/**
 * Confirm or reject recorded funding. Finance roles; the database
 * refuses a confirmation by the person who recorded it, and refuses
 * any confirmation that would fund more units than the cost requires.
 */
import { NextResponse } from "next/server";
import { MAALRISE_FINANCE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_FINANCE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown funding record." }, { status: 404 });
  const b = await readJson<{ action?: string; reason?: string; self_reason?: string }>(request);

  const res =
    b?.action === "confirm"
      ? await gate.db.rpc("maalrise_confirm_funding", { p_funding: id, p_self_reason: b.self_reason?.trim() || null })
      : b?.action === "reject"
        ? await gate.db.rpc("maalrise_reject_funding", { p_funding: id, p_reason: b.reason ?? "" })
        : null;
  if (!res) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (res.error) return dbError(res.error);
  return NextResponse.json({ ok: true });
}
