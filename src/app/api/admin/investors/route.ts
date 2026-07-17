import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const adminRoles = [
      "super_admin",
      "administrator",
      "finance",
      "operations",
      "customer_support",
    ];
    if (!callerProfile || !adminRoles.includes(callerProfile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const {
      full_name,
      email,
      phone,
      address,
      bank_name,
      account_name,
      account_number,
      bvn,
      nin,
    } = body as Record<string, string | undefined>;

    if (!full_name?.trim() || !email?.trim()) {
      return NextResponse.json(
        { error: "Full name and email are required" },
        { status: 400 }
      );
    }

    const normalizedEmail = email.trim().toLowerCase();
    const adminClient = await createAdminClient();

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
        bank_name: bank_name?.trim() || null,
        account_name: account_name?.trim() || null,
        account_number: account_number?.trim() || null,
        bvn: bvn?.trim() || null,
        nin: nin?.trim() || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (investorError) {
      // Roll back: delete the newly-created auth user so we don't have orphan accounts
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
