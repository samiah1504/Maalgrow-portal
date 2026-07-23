import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { generateUniqueInvestorCode } from "@/lib/investor-code";
import { SITE_URL } from "@/lib/site-url";

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

  return { user, supabase };
}

// GET /api/admin/investors?search=email_or_phone
export async function GET(request: Request) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search")?.trim() ?? "";

  if (search.length < 3) {
    return NextResponse.json({ investors: [] });
  }

  const { supabase } = auth;

  const { data, error } = await supabase
    .from("investors")
    .select("id, full_name, email, phone, investor_code, kyc_status")
    .or(`email.ilike.%${search}%,phone.ilike.%${search}%`)
    .limit(5);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ investors: data ?? [] });
}

// POST /api/admin/investors — create new investor + auth account
// The onboarding email is sent by the investments route after the investment is created,
// so it can include full investment details in one email.
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const adminClient = await createAdminClient();

    const body = (await request.json()) as {
      full_name?: string;
      email?: string;
      phone?: string;
      address?: string;
    };

    const { full_name, email, phone, address } = body;

    if (!full_name?.trim() || !email?.trim()) {
      return NextResponse.json(
        { error: "Full name and email are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();

    // Prevent duplicate investor records
    const { data: existing } = await adminClient
      .from("investors")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "An investor with this email address already exists" },
        { status: 409 }
      );
    }

    // Generate cryptographically secure investor code (MG-XXXXXX format)
    const investor_code = await generateUniqueInvestorCode(async (code) => {
      const { data } = await adminClient
        .from("investors")
        .select("id")
        .eq("investor_code", code)
        .maybeSingle();
      return !!data;
    });

    // Create auth user WITHOUT sending any email.
    // generateLink({ type: "invite" }) creates the user and returns an action_link
    // but does not trigger Supabase's email system.
    const siteUrl = SITE_URL;

    const { data: linkData, error: linkError } =
      await adminClient.auth.admin.generateLink({
        type: "invite",
        email: normalizedEmail,
        options: {
          data: { full_name: full_name.trim(), role: "investor" },
          redirectTo: `${siteUrl}/reset-password`,
        },
      });

    if (linkError || !linkData?.user) {
      return NextResponse.json(
        { error: linkError?.message ?? "Failed to create auth account" },
        { status: 500 }
      );
    }

    const newUserId = linkData.user.id;

    // Ensure profile exists (created by auth trigger or create manually)
    const { error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: newUserId,
          email: normalizedEmail,
          full_name: full_name.trim(),
          role: "investor",
        },
        { onConflict: "id" }
      );

    if (profileError) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return NextResponse.json(
        { error: "Failed to create profile: " + profileError.message },
        { status: 500 }
      );
    }

    // Insert investor record
    const { data: investor, error: investorError } = await adminClient
      .from("investors")
      .insert({
        profile_id: newUserId,
        investor_code,
        full_name: full_name.trim(),
        email: normalizedEmail,
        phone: phone?.trim() || null,
        address: address?.trim() || null,
        invitation_status: "not_sent",
        invitation_expires_at: new Date(
          Date.now() + 24 * 60 * 60 * 1000
        ).toISOString(),
        created_by: user.id,
        onboarded_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (investorError) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return NextResponse.json(
        {
          error:
            "Failed to create investor record: " + investorError.message,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({ investor }, { status: 201 });
  } catch (err) {
    console.error("[API] POST /admin/investors error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
