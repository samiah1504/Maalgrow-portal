import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendInvestorInvitation } from "@/lib/send-invitation";

const ALLOWED_ROLES = ["super_admin", "administrator"];

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !ALLOWED_ROLES.includes(profile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const adminClient = await createAdminClient();
    const result = await sendInvestorInvitation(adminClient, id);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error ?? "Email delivery failed",
          invitation_status: result.invitation_status,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      invitation_status: result.invitation_status,
    });
  } catch (err) {
    console.error("[API] POST /admin/investors/[id]/resend-invitation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
