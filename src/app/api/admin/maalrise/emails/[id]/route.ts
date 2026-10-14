/**
 * Send or discard one MaalRise email. Super admin and administrator.
 *
 * send: the database hands the email over only once (a second press,
 * or a second person, is refused while it is being sent), the app
 * sends it through the same service as MaalGrow, and the result is
 * recorded. A failure stays in the outbox to retry.
 */
import { NextResponse } from "next/server";
import { MAALRISE_APPROVE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";
import { sendOutboxEmail } from "@/lib/maalrise/emails";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_APPROVE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Email not found" }, { status: 404 });
  const b = await readJson<{ action?: string }>(request);

  if (b?.action === "discard") {
    const res = await gate.db.rpc("maalrise_discard_email", { p_email: id });
    if (res.error) return dbError(res.error);
    return NextResponse.json({ ok: true });
  }
  if (b?.action !== "send") return NextResponse.json({ error: "Choose send or discard." }, { status: 400 });

  const claim = await gate.db.rpc("maalrise_claim_email", { p_email: id });
  if (claim.error) return dbError(claim.error);
  const e = claim.data as { to_email: string; subject: string; body: string };
  const sent = await sendOutboxEmail(e.to_email, e.subject, e.body);
  const res = await gate.db.rpc("maalrise_email_result", {
    p_email: id,
    p_ok: sent.success,
    p_provider_id: sent.success ? sent.providerId : null,
    p_error: sent.success ? null : sent.error,
  });
  if (res.error) return dbError(res.error);
  if (!sent.success) return NextResponse.json({ error: `Not sent: ${sent.error}. It stays in the outbox to try again.` }, { status: 502 });
  return NextResponse.json({ ok: true });
}
