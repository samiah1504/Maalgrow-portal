import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

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
// Returns up to 5 matching investors for the "existing investor" lookup
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

// POST /api/admin/investors — create new investor + send invite
export async function POST(request: Request) {
  try {
    const auth = await requireAdmin();
    if ("error" in auth) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { user } = auth;
    const adminClient = await createAdminClient();

    const body = await request.json();
    const { full_name, email, phone, address } = body as Record<
      string,
      string | undefined
    >;

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

    // Create auth account via invite
    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://maalgrow-portal.vercel.app";

    const { data: inviteData, error: inviteError } =
      await adminClient.auth.admin.inviteUserByEmail(normalizedEmail, {
        data: { full_name: full_name.trim(), role: "investor" },
        redirectTo: `${siteUrl}/api/auth/callback`,
      });

    if (inviteError || !inviteData?.user) {
      return NextResponse.json(
        { error: inviteError?.message ?? "Failed to create auth account" },
        { status: 500 }
      );
    }

    const newUserId = inviteData.user.id;

    // Generate investor code: MGI-001, MGI-002, …
    const { data: lastInvestor } = await adminClient
      .from("investors")
      .select("investor_code")
      .like("investor_code", "MGI-%")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let nextNumber = 1;
    if (lastInvestor?.investor_code) {
      const match = lastInvestor.investor_code.match(/MGI-(\d+)/);
      if (match) nextNumber = parseInt(match[1], 10) + 1;
    }
    const investor_code = `MGI-${String(nextNumber).padStart(3, "0")}`;

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
        created_by: user.id,
      })
      .select()
      .single();

    if (investorError) {
      await adminClient.auth.admin.deleteUser(newUserId);
      return NextResponse.json(
        { error: "Failed to create investor record: " + investorError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ investor }, { status: 201 });
  } catch (err) {
    console.error("[API] POST /admin/investors error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
