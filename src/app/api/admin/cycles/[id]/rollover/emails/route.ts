import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendRolloverEmails } from "@/lib/rollover-notify";

// Retry rollover confirmation emails that previously failed.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || !["super_admin", "administrator"].includes(profile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const adminClient = await createAdminClient();
    const emails = await sendRolloverEmails(adminClient, id);
    return NextResponse.json({ emails });
  } catch (err) {
    console.error("[API] POST rollover/emails error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
