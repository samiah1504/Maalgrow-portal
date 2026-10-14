/**
 * Send or discard one MaalRise email. Super admin and administrator.
 *
 * send: the database hands the email over only once (a second press,
 * or a second person, is refused while it is being sent), the app
 * sends it through the same service as MaalGrow, and the result is
 * recorded. A failure stays in the outbox to retry.
 *
 * A Cycle invitation (migration 057) also carries a fresh "set your
 * password" link, made at the moment of sending, and updates the
 * investor record's invitation status exactly as "Send invitation"
 * does. If the person has signed in since it was prepared, it goes
 * as an ordinary message without the link.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildPasswordSetupLink } from "@/lib/auth-links";
import { SITE_URL } from "@/lib/site-url";
import { MAALRISE_APPROVE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";
import { mr } from "@/lib/maalrise/db";
import { sendCycleInvitation, sendOutboxEmail, type SendResult } from "@/lib/maalrise/emails";

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
  const e = claim.data as { kind: string; to_email: string; subject: string; body: string };

  let sent: SendResult;
  let invited: string | null = null;
  if (e.kind === "cycle_invitation") {
    const { data: row } = await gate.db.from("maalrise_email_outbox").select("to_user_id").eq("id", id).maybeSingle();
    const admin = mr(await createAdminClient());
    const userId = (row?.to_user_id as string | null) ?? null;
    const { data: u } = userId ? await admin.auth.admin.getUserById(userId) : { data: null };
    if (u?.user?.last_sign_in_at) {
      sent = await sendOutboxEmail(e.to_email, e.subject, e.body);
    } else {
      const link = await admin.auth.admin.generateLink({
        type: "invite",
        email: e.to_email,
        options: { data: { role: "investor" }, redirectTo: `${SITE_URL}/reset-password` },
      });
      const props = link.error
        ? (await admin.auth.admin.generateLink({ type: "recovery", email: e.to_email, options: { redirectTo: `${SITE_URL}/reset-password` } }))
        : link;
      if (props.error || !props.data?.properties?.hashed_token) {
        sent = { success: false, error: `Could not create the sign-in link: ${props.error?.message ?? "no link returned"}` };
      } else {
        sent = await sendCycleInvitation(e.to_email, e.subject, e.body,
          buildPasswordSetupLink(props.data.properties, link.error ? "recovery" : "invite"));
        invited = userId;
      }
    }
    if (invited) {
      await admin.from("investors").update({
        invitation_status: sent.success ? "sent" : "failed",
        invitation_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        ...(sent.success ? { invitation_sent_at: new Date().toISOString() } : {}),
        updated_at: new Date().toISOString(),
      }).eq("profile_id", invited);
    }
  } else {
    sent = await sendOutboxEmail(e.to_email, e.subject, e.body);
  }

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
