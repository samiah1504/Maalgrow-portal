/**
 * The signed-in investor's MaalRise notifications.
 *
 * GET returns the unread count (the portal's sidebar badge calls it);
 * POST marks notifications read. Each person only ever sees their own.
 */
import { NextResponse } from "next/server";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

export async function GET() {
  const gate = await maalriseGate(["investor"]);
  if (!gate.ok) return gate.response;
  const res = await gate.db.rpc("maalrise_my_notifications");
  if (res.error) return dbError(res.error);
  return NextResponse.json(res.data);
}

export async function POST(request: Request) {
  const gate = await maalriseGate(["investor"]);
  if (!gate.ok) return gate.response;
  const b = await readJson<{ ids?: string[] }>(request);
  const ids = Array.isArray(b?.ids) ? b.ids.filter(isUuid) : null;
  const res = await gate.db.rpc("maalrise_mark_notifications_read", { p_ids: ids && ids.length ? ids : null });
  if (res.error) return dbError(res.error);
  return NextResponse.json({ marked: res.data });
}
