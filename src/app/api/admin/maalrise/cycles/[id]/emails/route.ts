/**
 * "Email all investors in this Cycle" — step one. Super admin and
 * administrator.
 *
 * Prepares one email per investor with confirmed funding (migration
 * 057): an invitation for someone who has never signed in, a "you have
 * been added" notification for everyone else. Nothing is sent here;
 * the screen shows the counts, and after one more press sends each
 * prepared email through the outbox route. Pressing again prepares
 * nothing new — each investor gets at most one such email per Cycle.
 */
import { NextResponse } from "next/server";
import { MAALRISE_APPROVE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate } from "@/lib/maalrise/api";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_APPROVE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });
  const res = await gate.db.rpc("maalrise_prepare_cycle_emails", { p_cycle: id });
  if (res.error) return dbError(res.error);
  return NextResponse.json(res.data);
}
