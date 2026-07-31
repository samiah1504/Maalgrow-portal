import { NextResponse } from "next/server";
import {
  ADDRESS_INCOMPLETE_MESSAGE,
  validateResidentialAddress,
} from "@/lib/residential-address";
import { findLga, findState } from "@/lib/nigeria-geo";
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
        email,
        phone,
        bank_name,
        account_name,
        account_number,
        nin,
        tin,
        kyc_status,
        kyc_notes,
        preferred_channel,
      } = body as Record<string, string | undefined>;

      const investorUpdate: InvestorUpdate = {};
      if (full_name !== undefined) investorUpdate.full_name = full_name.trim();
      if (phone !== undefined) investorUpdate.phone = phone?.trim() || null;
      /*
       * The structured address, 042.
       *
       * investors.address is deliberately NOT writable from here any
       * more. It is the record of what the investor told us before
       * the address had parts, and overwriting it would destroy the
       * one thing the migration went out of its way to preserve.
       *
       * The names are resolved from the codes on this side rather
       * than trusted from the request, so a mismatched pair cannot be
       * stored however the call was made.
       */
      const streetRaw = (body as Record<string, unknown>).residential_street_address;
      if (typeof streetRaw === "string") {
        const value = {
          street: streetRaw.trim(),
          stateCode: String((body as Record<string, unknown>).residential_state_code ?? "").trim(),
          lgaCode: String((body as Record<string, unknown>).residential_lga_code ?? "").trim(),
          city: String((body as Record<string, unknown>).residential_city ?? "").trim(),
        };
        const problems = validateResidentialAddress(value);
        if (Object.keys(problems).length > 0) {
          return NextResponse.json({ error: ADDRESS_INCOMPLETE_MESSAGE }, { status: 400 });
        }
        const state = findState(value.stateCode);
        const lga = findLga(value.lgaCode);
        investorUpdate.residential_street_address = value.street;
        investorUpdate.residential_state_code = state?.code ?? null;
        investorUpdate.residential_state_name = state?.name ?? null;
        investorUpdate.residential_lga_code = lga?.code ?? null;
        investorUpdate.residential_lga_name = lga?.name ?? null;
        investorUpdate.residential_city = value.city;
      }
      if (bank_name !== undefined) investorUpdate.bank_name = bank_name?.trim() || null;
      if (account_name !== undefined) investorUpdate.account_name = account_name?.trim() || null;
      if (account_number !== undefined) investorUpdate.account_number = account_number?.trim() || null;
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

      /*
       * The email address — THREE COPIES, moved together.
       *
       *   auth.users.email   the login
       *   profiles.email     the signed-in person
       *   investors.email    where the statement is sent
       *
       * Nothing kept these in step: handle_new_user() copies the
       * address in when the account is created and never again. So a
       * change that reaches one and not the others leaves an investor
       * whose statement goes to the new address while the login still
       * wants the old one, and they cannot fix it themselves.
       *
       * admin_set_investor_email does the two database copies in one
       * transaction and hands back the previous address. Auth is
       * changed after; if THAT fails, the database change is put back
       * so the three still agree. An error message here is always
       * better than a login somebody has lost.
       */
      const emailRaw = typeof email === "string" ? email.trim() : "";
      if (emailRaw) {
        // Changing a login is not the same kind of act as correcting
        // a phone number, and this screen is open to support and
        // finance as well.
        if (!["super_admin", "administrator"].includes(auth.profile?.role ?? "")) {
          return NextResponse.json(
            { error: "Only an administrator can change an investor's email address" },
            { status: 403 }
          );
        }

        const { data: result, error: emailError } = await adminClient.rpc(
          "admin_set_investor_email",
          { p_investor_id: id, p_email: emailRaw }
        );
        if (emailError) {
          return NextResponse.json({ error: emailError.message }, { status: 400 });
        }

        const outcome = result as unknown as {
          changed: boolean;
          old: string | null;
          new: string;
        };

        if (outcome?.changed && profileId) {
          const { error: authError } = await adminClient.auth.admin.updateUserById(
            profileId,
            // Confirmed outright. Leaving it unconfirmed would lock
            // the investor out until they clicked a link nobody told
            // them to expect — an administrator correcting a typo is
            // the confirmation.
            { email: outcome.new, email_confirm: true }
          );

          if (authError) {
            // Put the database back, so the three copies still agree.
            await adminClient.rpc("admin_set_investor_email", {
              p_investor_id: id,
              p_email: outcome.old ?? "",
            });
            return NextResponse.json(
              {
                error:
                  "The email was not changed: the login could not be updated — " +
                  authError.message,
              },
              { status: 400 }
            );
          }
        }
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
