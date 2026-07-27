/**
 * Staff accounts — create and list.
 *
 * SUPER ADMIN ONLY. Creating a staff account is creating a way into
 * the portal; it is the one thing that should never be delegated to
 * the roles it can create.
 *
 * NO PASSWORD IS EVER SET OR SENT. generateLink({type:"invite"})
 * creates the auth user and returns a token; the branded email carries
 * a link to our own /reset-password page, and the new staff member
 * chooses their own password. Identical to how investors are onboarded
 * — and the reason the raw action_link is never emailed is that link
 * previews and mail scanners consume one-time URLs before the human
 * ever taps them.
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendStaffInviteEmail } from "@/lib/email";
import { buildPasswordSetupLink } from "@/lib/auth-links";
import { SITE_URL } from "@/lib/site-url";
import { STAFF_ROLE_VALUES, staffRole, type StaffRole } from "@/lib/staff-roles";

async function requireSuperAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user, profile };
}

export async function GET() {
  const gate = await requireSuperAdmin();
  if (gate.error) return gate.error;

  const admin = await createAdminClient();
  const { data } = await admin
    .from("profiles")
    .select("id, full_name, email, role, is_active, created_at")
    .in("role", STAFF_ROLE_VALUES)
    .order("created_at", { ascending: false });

  return NextResponse.json({ staff: data ?? [] });
}

export async function POST(request: Request) {
  const gate = await requireSuperAdmin();
  if (gate.error) return gate.error;

  try {
    const body = (await request.json()) as {
      full_name?: string;
      email?: string;
      role?: string;
    };

    const fullName = body.full_name?.trim();
    const email = body.email?.trim().toLowerCase();
    const role = body.role as StaffRole | undefined;

    if (!fullName || !email) {
      return NextResponse.json(
        { error: "Full name and email are required" },
        { status: 400 }
      );
    }
    if (!role || !STAFF_ROLE_VALUES.includes(role)) {
      return NextResponse.json({ error: "Choose a valid role" }, { status: 400 });
    }

    const admin = await createAdminClient();

    // Nobody should end up with two accounts, and an investor must
    // never be silently promoted into staff by reusing their address.
    const { data: existing } = await admin
      .from("profiles")
      .select("id, role")
      .eq("email", email)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        {
          error:
            existing.role === "investor"
              ? "That email already belongs to an investor account."
              : "A staff account with that email already exists.",
        },
        { status: 409 }
      );
    }

    // Creates the user WITHOUT Supabase sending anything of its own.
    const { data: linkData, error: linkError } =
      await admin.auth.admin.generateLink({
        type: "invite",
        email,
        options: {
          data: { full_name: fullName, role },
          redirectTo: `${SITE_URL}/reset-password`,
        },
      });

    if (linkError || !linkData?.user) {
      return NextResponse.json(
        { error: linkError?.message ?? "Failed to create the account" },
        { status: 500 }
      );
    }

    const newUserId = linkData.user.id;

    // The auth trigger creates the profile from raw_user_meta_data;
    // upsert so the role is right either way.
    const { error: profileError } = await admin
      .from("profiles")
      .upsert(
        { id: newUserId, email, full_name: fullName, role, is_active: true },
        { onConflict: "id" }
      );

    if (profileError) {
      // Leave nothing half-created behind.
      await admin.auth.admin.deleteUser(newUserId);
      return NextResponse.json(
        { error: "Failed to create profile: " + profileError.message },
        { status: 500 }
      );
    }

    const info = staffRole(role);
    const emailResult = await sendStaffInviteEmail({
      to: email,
      fullName,
      roleLabel: info?.label ?? role,
      roleSummary: info?.summary ?? "",
      passwordSetupLink: buildPasswordSetupLink(linkData.properties, "invite"),
      portalLink: SITE_URL,
      invitedBy: gate.profile?.full_name ?? undefined,
    });

    await admin.rpc("create_audit_log", {
      p_action: "create_staff_account",
      p_entity_type: "profile",
      p_entity_id: newUserId,
      p_old_values: null,
      p_new_values: { email, role, invited: emailResult.success },
    });

    // The account is real whether or not the email got out — say so
    // plainly rather than reporting a failure that did not happen.
    return NextResponse.json(
      {
        staff: { id: newUserId, full_name: fullName, email, role },
        invited: emailResult.success,
        inviteError: emailResult.error,
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[API] POST /admin/staff error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
