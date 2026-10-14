/**
 * Send (or resend) a MaalRise investor's portal invitation: a link to
 * set their password, then the KYC form on first sign-in. Super admin
 * and administrator, as for MaalGrow invitations. Sent only because a
 * person pressed the button; the investor record's invitation status
 * is updated exactly as MaalGrow does.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { buildPasswordSetupLink } from "@/lib/auth-links";
import { SITE_URL } from "@/lib/site-url";
import { MAALRISE_APPROVE_ROLES } from "@/lib/maalrise/permissions";
import { isUuid, maalriseGate } from "@/lib/maalrise/api";
import { mr } from "@/lib/maalrise/db";
import { ensureBaseInvestorRecord } from "@/lib/maalrise/onboarding";
import { sendMaalriseInvitation } from "@/lib/maalrise/emails";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_APPROVE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown investor." }, { status: 404 });

  // Read as the staff member (row level security applies).
  const { data: inv, error } = await gate.db.from("maalrise_investors")
    .select("id, profile_id, full_name, email, phone, investor_code").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  if (!inv) return NextResponse.json({ error: "Unknown investor." }, { status: 404 });

  const admin = mr(await createAdminClient());
  let baseId: string;
  try {
    baseId = (await ensureBaseInvestorRecord(admin, {
      profileId: inv.profile_id, email: inv.email, fullName: inv.full_name, phone: inv.phone, createdBy: gate.userId,
    })).id;
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not prepare the investor record." }, { status: 400 });
  }
  const { data: base } = await admin.from("investors").select("invitation_status").eq("id", baseId).single();
  if (base?.invitation_status === "activated") {
    return NextResponse.json({ error: "This investor has already set their password and can sign in." }, { status: 400 });
  }

  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
    type: "invite",
    email: inv.email,
    options: { data: { full_name: inv.full_name, role: "investor" }, redirectTo: `${SITE_URL}/reset-password` },
  });
  if (linkErr) return NextResponse.json({ error: `Could not create the sign-in link: ${linkErr.message}` }, { status: 400 });

  const sent = await sendMaalriseInvitation({
    to: inv.email,
    fullName: inv.full_name,
    investorCode: inv.investor_code,
    passwordSetupLink: buildPasswordSetupLink(link?.properties, "invite"),
  });
  await admin.from("investors").update({
    invitation_status: sent.success ? "sent" : "failed",
    invitation_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    ...(sent.success ? { invitation_sent_at: new Date().toISOString() } : {}),
    updated_at: new Date().toISOString(),
  }).eq("id", baseId);
  await gate.db.rpc("create_audit_log", {
    p_action: sent.success ? "maalrise_invitation_sent" : "maalrise_invitation_failed",
    p_entity_type: "maalrise_investor", p_entity_id: id, p_old_values: null,
    p_new_values: { to: inv.email, error: sent.success ? null : sent.error },
  });

  if (!sent.success) return NextResponse.json({ error: `The invitation was not sent: ${sent.error}` }, { status: 502 });
  return NextResponse.json({ ok: true });
}
