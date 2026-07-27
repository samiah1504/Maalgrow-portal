/**
 * One staff account — change role, deactivate, resend the invitation.
 *
 * DEACTIVATE RATHER THAN DELETE. Someone who leaves has approved
 * payments and settled cycles with their name on them; deleting the
 * profile would orphan every one of those records. Banning the auth
 * user stops them signing in while the history stays readable.
 *
 * A super admin cannot deactivate or demote themselves. Locking the
 * only person who can create accounts out of the portal is not a
 * mistake anyone should be able to make in one click.
 */

import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendStaffInviteEmail } from "@/lib/email";
import { buildPasswordSetupLink } from "@/lib/auth-links";
import { SITE_URL } from "@/lib/site-url";
import { STAFF_ROLE_VALUES, staffRole, type StaffRole } from "@/lib/staff-roles";

/** A century — Supabase's way of saying "until somebody lifts it". */
const FOREVER = "876000h";

async function gate() {
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

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const g = await gate();
  if (g.error) return g.error;
  const { id } = await params;

  try {
    const body = (await request.json()) as {
      role?: string;
      is_active?: boolean;
      resend_invite?: boolean;
    };

    const admin = await createAdminClient();
    const { data: target } = await admin
      .from("profiles")
      .select("id, full_name, email, role, is_active")
      .eq("id", id)
      .single();

    if (!target) {
      return NextResponse.json({ error: "Staff account not found" }, { status: 404 });
    }
    if (!STAFF_ROLE_VALUES.includes(target.role as StaffRole)) {
      return NextResponse.json(
        { error: "That account is not a staff account" },
        { status: 400 }
      );
    }

    // ── Resend the invitation ────────────────────────────────
    if (body.resend_invite) {
      const { data: linkData, error: linkError } =
        await admin.auth.admin.generateLink({
          type: "invite",
          email: target.email,
          options: {
            data: { full_name: target.full_name, role: target.role },
            redirectTo: `${SITE_URL}/reset-password`,
          },
        });

      if (linkError) {
        return NextResponse.json({ error: linkError.message }, { status: 500 });
      }

      const info = staffRole(target.role);
      const result = await sendStaffInviteEmail({
        to: target.email,
        fullName: target.full_name ?? target.email,
        roleLabel: info?.label ?? target.role,
        roleSummary: info?.summary ?? "",
        passwordSetupLink: buildPasswordSetupLink(linkData?.properties, "invite"),
        portalLink: SITE_URL,
        invitedBy: g.profile?.full_name ?? undefined,
      });

      return result.success
        ? NextResponse.json({ invited: true })
        : NextResponse.json({ error: result.error ?? "Failed to send" }, { status: 502 });
    }

    // ── Role change / activation ─────────────────────────────
    type ProfileUpdate = {
      role?: StaffRole;
      is_active?: boolean;
      updated_at?: string;
    };
    const updates: ProfileUpdate = {};

    if (body.role !== undefined) {
      if (!STAFF_ROLE_VALUES.includes(body.role as StaffRole)) {
        return NextResponse.json({ error: "Choose a valid role" }, { status: 400 });
      }
      if (id === g.user!.id && body.role !== "super_admin") {
        return NextResponse.json(
          { error: "You cannot remove your own super admin role." },
          { status: 400 }
        );
      }
      updates.role = body.role as StaffRole;
    }

    if (body.is_active !== undefined) {
      if (id === g.user!.id && !body.is_active) {
        return NextResponse.json(
          { error: "You cannot deactivate your own account." },
          { status: 400 }
        );
      }
      updates.is_active = body.is_active;

      // The profile flag is what the app reads; the ban is what
      // actually stops a session being created. Both, or a
      // deactivated person keeps working until their token expires.
      const { error: banError } = await admin.auth.admin.updateUserById(id, {
        ban_duration: body.is_active ? "none" : FOREVER,
      });
      if (banError) {
        return NextResponse.json({ error: banError.message }, { status: 500 });
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "Nothing to change" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const { error: updateError } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    await admin.rpc("create_audit_log", {
      p_action: "update_staff_account",
      p_entity_type: "profile",
      p_entity_id: id,
      p_old_values: { role: target.role, is_active: target.is_active },
      p_new_values: { ...updates },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API] PATCH /admin/staff/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
