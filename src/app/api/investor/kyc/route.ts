import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

// Investor submits (or resubmits) their own KYC. Server-side validation
// mirrors the form; kyc_submitted_at is set via the service role because
// a DB trigger blocks investors from setting it themselves.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const adminClient = await createAdminClient();
    const { data: investor } = await adminClient
      .from("investors")
      .select("id, kyc_status")
      .eq("profile_id", user.id)
      .maybeSingle();

    if (!investor) {
      return NextResponse.json(
        { error: "No investor account is linked to this login" },
        { status: 404 }
      );
    }

    const body = (await request.json()) as {
      phone?: string;
      address?: string;
      bvn?: string;
      nin?: string | null;
      bank_name?: string;
      account_name?: string;
      account_number?: string;
    };

    const phone = body.phone?.trim() ?? "";
    const address = body.address?.trim() ?? "";
    const bvn = body.bvn?.trim() ?? "";
    const nin = body.nin?.trim() || null;
    const bankName = body.bank_name?.trim() ?? "";
    const accountName = body.account_name?.trim() ?? "";
    const accountNumber = body.account_number?.trim() ?? "";

    if (phone.replace(/\D/g, "").length < 10)
      return NextResponse.json({ error: "Enter a valid phone number" }, { status: 400 });
    if (address.length < 10)
      return NextResponse.json({ error: "Enter your full residential address" }, { status: 400 });
    if (!/^\d{11}$/.test(bvn))
      return NextResponse.json({ error: "BVN must be exactly 11 digits" }, { status: 400 });
    if (nin !== null && !/^\d{11}$/.test(nin))
      return NextResponse.json({ error: "NIN must be exactly 11 digits" }, { status: 400 });
    if (bankName.length < 2)
      return NextResponse.json({ error: "Enter your bank name" }, { status: 400 });
    if (accountName.length < 3)
      return NextResponse.json({ error: "Enter the account name" }, { status: 400 });
    if (!/^\d{10}$/.test(accountNumber))
      return NextResponse.json({ error: "Account number must be 10 digits" }, { status: 400 });

    const { error: updateError } = await adminClient
      .from("investors")
      .update({
        phone,
        address,
        bvn,
        nin,
        bank_name: bankName,
        account_name: accountName,
        account_number: accountNumber,
        // Resubmission after rejection goes back to pending review
        kyc_status: "pending",
        kyc_submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", investor.id);

    if (updateError) {
      return NextResponse.json(
        { error: "Failed to save KYC: " + updateError.message },
        { status: 500 }
      );
    }

    // Let admins know there is a KYC submission to review
    const { data: admins } = await adminClient
      .from("profiles")
      .select("id")
      .in("role", ["super_admin", "administrator"])
      .eq("is_active", true);

    if (admins && admins.length > 0) {
      await adminClient.from("notifications").insert(
        admins.map((a) => ({
          user_id: a.id,
          title: "KYC Submitted for Review",
          message: `An investor has ${investor.kyc_status === "rejected" ? "resubmitted" : "submitted"} their KYC details. Review and approve or reject in the investor's profile.`,
          type: "system" as const,
          action_url: `/admin/investors/${investor.id}`,
        }))
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[API] POST /investor/kyc error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
