import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendOnboardingEmail } from "@/lib/email";
import { getPaymentStatus } from "@/lib/investment-utils";

const ALLOWED_ROLES = ["super_admin", "administrator"];
const SLOT_VALUE_NGN = 500_000;

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

    // Load investor with their latest active investment
    const { data: investor, error: investorErr } = await adminClient
      .from("investors")
      .select(
        `id, full_name, email, investor_code, profile_id,
         investments(
           id, investment_code, units, capital, investment_date, maturity_date,
           series(name),
           cycle:cycles(cycle_label, start_date, end_date),
           investment_payments(amount)
         )`
      )
      .eq("id", id)
      .single();

    if (investorErr || !investor) {
      return NextResponse.json(
        { error: "Investor not found" },
        { status: 404 }
      );
    }

    const siteUrl =
      process.env.NEXT_PUBLIC_SITE_URL ?? "https://maalgrow-portal.vercel.app";

    // Generate a fresh invite link (does NOT send Supabase's email)
    const { data: linkData, error: linkErr } =
      await adminClient.auth.admin.generateLink({
        type: "invite",
        email: investor.email,
        options: {
          data: { full_name: investor.full_name, role: "investor" },
          redirectTo: `${siteUrl}/investor/dashboard`,
        },
      });

    if (linkErr) {
      return NextResponse.json(
        { error: "Failed to generate invite link: " + linkErr.message },
        { status: 500 }
      );
    }

    const passwordSetupLink =
      linkData?.properties?.action_link ?? `${siteUrl}/login`;

    // Pick the most recent active investment for email details
    type InvRow = {
      id: string;
      investment_code: string;
      units: number;
      capital: number;
      investment_date: string;
      maturity_date: string;
      series: { name: string } | null;
      cycle: { cycle_label: string; start_date: string; end_date: string } | null;
      investment_payments: { amount: number }[];
    };

    const investments = (investor.investments ?? []) as unknown as InvRow[];
    const latestInv = investments[0] ?? null;

    const totalPaid = latestInv
      ? latestInv.investment_payments.reduce((s, p) => s + p.amount, 0)
      : 0;
    const capital = latestInv?.capital ?? 0;
    const outstandingBalance = Math.max(0, capital - totalPaid);
    const payStatus =
      capital > 0 ? getPaymentStatus(capital, totalPaid) : "pending";

    const result = await sendOnboardingEmail({
      to: investor.email,
      fullName: investor.full_name,
      investorCode: investor.investor_code,
      email: investor.email,
      passwordSetupLink,
      portalLink: siteUrl,
      seriesName: latestInv?.series?.name ?? "—",
      cycleLabel: latestInv?.cycle?.cycle_label ?? "—",
      slots: latestInv ? latestInv.units : 0,
      slotValue: SLOT_VALUE_NGN,
      totalInvestment: capital,
      totalPaid,
      outstandingBalance,
      paymentStatus: payStatus,
      cycleStart: latestInv?.cycle?.start_date ?? "",
      maturityDate: latestInv?.cycle?.end_date ?? "",
    });

    const newStatus = result.success ? "sent" : "failed";
    const linkExpiresAt = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString();

    await adminClient
      .from("investors")
      .update({
        invitation_status: newStatus,
        invitation_expires_at: linkExpiresAt,
        ...(result.success
          ? { invitation_sent_at: new Date().toISOString() }
          : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (!result.success) {
      return NextResponse.json(
        {
          success: false,
          error: result.error ?? "Email delivery failed",
          invitation_status: "failed",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      invitation_status: "sent",
    });
  } catch (err) {
    console.error("[API] POST /admin/investors/[id]/resend-invitation error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
