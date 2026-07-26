import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database.types";
import { SITE_URL } from "@/lib/site-url";
import { sendPasswordResetEmail } from "@/lib/email";
import { buildPasswordSetupLink } from "@/lib/auth-links";
import { sendInvestorInvitation } from "@/lib/send-invitation";

type InvestorUpdate = Database["public"]["Tables"]["investors"]["Update"];

type ProfileRef = { id: string; email: string; is_active: boolean } | null;

const ADMIN_ROLES = [
  "super_admin",
  "administrator",
  "finance",
  "operations",
  "customer_support",
];

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "Unauthorized", status: 401 } as const;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) {
    return { error: "Forbidden", status: 403 } as const;
  }

  return { user, profile };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { id } = await params;
    const body = await request.json();
    const { action } = body as { action: string };

    const adminClient = await createAdminClient();

    const { data: investor, error: fetchError } = await adminClient
      .from("investors")
      .select("*, profile:profiles!profile_id(id, email, is_active)")
      .eq("id", id)
      .single();

    if (fetchError || !investor) {
      return NextResponse.json({ error: "Investor not found" }, { status: 404 });
    }

    const profile = (investor.profile as unknown) as ProfileRef;
    const profileId = profile?.id;

    // ─── Update investor details ───────────────────────────────────────────
    if (action === "update") {
      const {
        full_name,
        phone,
        address,
        bank_name,
        account_name,
        account_number,
        bvn,
        nin,
        tin,
        kyc_status,
        kyc_notes,
        preferred_channel,
      } = body as Record<string, string | undefined>;

      const investorUpdate: InvestorUpdate = {};
      if (full_name !== undefined) investorUpdate.full_name = full_name.trim();
      if (phone !== undefined) investorUpdate.phone = phone?.trim() || null;
      if (address !== undefined) investorUpdate.address = address?.trim() || null;
      if (bank_name !== undefined) investorUpdate.bank_name = bank_name?.trim() || null;
      if (account_name !== undefined) investorUpdate.account_name = account_name?.trim() || null;
      if (account_number !== undefined) investorUpdate.account_number = account_number?.trim() || null;
      if (bvn !== undefined) investorUpdate.bvn = bvn?.trim() || null;
      if (nin !== undefined) investorUpdate.nin = nin?.trim() || null;
      // The tax number an administrator may fill in on an investor's behalf
      if (tin !== undefined) investorUpdate.tin = tin?.trim() || null;
      if (kyc_status !== undefined) investorUpdate.kyc_status = kyc_status as InvestorUpdate["kyc_status"];
      if (kyc_notes !== undefined) investorUpdate.kyc_notes = kyc_notes?.trim() || null;
      if (preferred_channel !== undefined && ["sms", "whatsapp", "both"].includes(preferred_channel)) {
        investorUpdate.preferred_channel = preferred_channel as "sms" | "whatsapp" | "both";
      }

      const { error: updateError } = await adminClient
        .from("investors")
        .update(investorUpdate)
        .eq("id", id);

      if (updateError) {
        return NextResponse.json({ error: updateError.message }, { status: 500 });
      }

      if (full_name?.trim() && profileId) {
        await adminClient
          .from("profiles")
          .update({ full_name: full_name.trim() })
          .eq("id", profileId);
      }

      return NextResponse.json({ success: true });
    }

    // ─── Deactivate investor ───────────────────────────────────────────────
    if (action === "deactivate") {
      if (!profileId) {
        return NextResponse.json({ error: "Auth profile not found" }, { status: 404 });
      }

      await adminClient
        .from("profiles")
        .update({ is_active: false })
        .eq("id", profileId);

      const { error: banError } = await adminClient.auth.admin.updateUserById(
        profileId,
        { ban_duration: "87600h" }
      );

      if (banError) {
        return NextResponse.json({ error: banError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    // ─── Reactivate investor ───────────────────────────────────────────────
    if (action === "reactivate") {
      if (!profileId) {
        return NextResponse.json({ error: "Auth profile not found" }, { status: 404 });
      }

      await adminClient
        .from("profiles")
        .update({ is_active: true })
        .eq("id", profileId);

      const { error: unbanError } = await adminClient.auth.admin.updateUserById(
        profileId,
        { ban_duration: "none" }
      );

      if (unbanError) {
        return NextResponse.json({ error: unbanError.message }, { status: 500 });
      }

      return NextResponse.json({ success: true });
    }

    // ─── Send password reset email (branded, via Resend) ───────────────────
    // generateLink only creates the link — Supabase sends nothing — so we
    // must deliver it ourselves or the button silently does nothing.
    if (action === "reset_password") {
      const investorEmail = profile?.email ?? investor.email;

      const { data: linkData, error: resetError } =
        await adminClient.auth.admin.generateLink({
          type: "recovery",
          email: investorEmail,
          options: { redirectTo: `${SITE_URL}/reset-password` },
        });

      if (resetError || !linkData?.properties?.hashed_token) {
        return NextResponse.json(
          { error: resetError?.message ?? "Failed to generate reset link" },
          { status: 500 }
        );
      }

      const emailResult = await sendPasswordResetEmail({
        to: investorEmail,
        fullName: investor.full_name,
        resetLink: buildPasswordSetupLink(linkData.properties, "recovery"),
        portalLink: SITE_URL,
      });

      if (!emailResult.success) {
        return NextResponse.json(
          {
            error:
              "Reset link created but email failed: " +
              (emailResult.error ?? "unknown error"),
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, message: "Password reset email sent" });
    }

    // ─── Resend invitation email (branded, via Resend) ─────────────────────
    if (action === "resend_invite") {
      const result = await sendInvestorInvitation(adminClient, id);

      if (!result.success) {
        return NextResponse.json(
          { error: result.error ?? "Email delivery failed" },
          { status: 500 }
        );
      }

      return NextResponse.json({ success: true, message: "Invitation email resent" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    console.error("[API] PATCH /admin/investors/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
