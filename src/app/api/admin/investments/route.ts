import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendOnboardingEmail } from "@/lib/email";
import { getPaymentStatus } from "@/lib/investment-utils";

const ADMIN_ROLES = [
  "super_admin",
  "administrator",
  "finance",
  "operations",
  "customer_support",
];

const SLOT_VALUE_NGN = 500_000;

function validateUnits(units: unknown): units is number {
  if (typeof units !== "number" || isNaN(units)) return false;
  if (units < 0.5) return false;
  return Number.isInteger(units * 2);
}

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

    if (!callerProfile || !ADMIN_ROLES.includes(callerProfile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const {
      investor_id,
      series_id,
      cycle_id,
      units,
      investment_date,
      notes,
      payment_amount,
      payment_date,
      payment_reference,
      send_onboarding_email,
    } = body as {
      investor_id: string;
      series_id: string;
      cycle_id: string;
      units: unknown;
      investment_date: string;
      notes?: string;
      payment_amount?: number;
      payment_date?: string;
      payment_reference?: string;
      send_onboarding_email?: boolean;
    };

    if (!investor_id || !series_id || !cycle_id || !investment_date) {
      return NextResponse.json(
        {
          error:
            "investor_id, series_id, cycle_id, and investment_date are required",
        },
        { status: 400 }
      );
    }

    if (!validateUnits(units)) {
      return NextResponse.json(
        {
          error:
            "Slots must be a number ≥ 0.5 in increments of 0.5 (e.g. 0.5, 1, 1.5, 2, …)",
        },
        { status: 400 }
      );
    }

    if (
      payment_amount !== undefined &&
      (typeof payment_amount !== "number" || payment_amount <= 0)
    ) {
      return NextResponse.json(
        { error: "Payment amount must be greater than 0" },
        { status: 400 }
      );
    }

    const adminClient = await createAdminClient();

    const { data: series, error: seriesErr } = await adminClient
      .from("series")
      .select("id, name")
      .eq("id", series_id)
      .single();

    if (seriesErr || !series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    const { data: cycle, error: cycleErr } = await adminClient
      .from("cycles")
      .select("id, cycle_number, cycle_label, start_date, end_date, status")
      .eq("id", cycle_id)
      .eq("series_id", series_id)
      .single();

    if (cycleErr || !cycle) {
      return NextResponse.json(
        {
          error:
            "Cycle not found or does not belong to the selected series",
        },
        { status: 404 }
      );
    }

    const { data: investor, error: investorErr } = await adminClient
      .from("investors")
      .select("id, investor_code, full_name, email, profile_id")
      .eq("id", investor_id)
      .single();

    if (investorErr || !investor) {
      return NextResponse.json(
        { error: "Investor not found" },
        { status: 404 }
      );
    }

    const capitalKobo = Math.round(units * SLOT_VALUE_NGN * 100);
    const capital = capitalKobo / 100;

    const baseCode = `MG-${series.name}-${String(cycle.cycle_number).padStart(3, "0")}-${investor.investor_code}`;
    const { count } = await adminClient
      .from("investments")
      .select("id", { count: "exact", head: true })
      .like("investment_code", `${baseCode}%`);

    const investment_code =
      !count || count === 0 ? baseCode : `${baseCode}-${count + 1}`;

    const { data: investment, error: investmentError } = await adminClient
      .from("investments")
      .insert({
        investment_code,
        investor_id,
        series_id,
        cycle_id,
        units,
        price_per_unit: SLOT_VALUE_NGN,
        capital,
        investment_date,
        maturity_date: cycle.end_date,
        status: "active",
        notes: notes?.trim() || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (investmentError) {
      return NextResponse.json(
        { error: "Failed to create investment: " + investmentError.message },
        { status: 500 }
      );
    }

    // Record initial payment if provided
    let paymentWarning: string | undefined;
    if (payment_amount && payment_amount > 0 && payment_date) {
      const { error: paymentError } = await adminClient
        .from("investment_payments")
        .insert({
          investment_id: investment.id,
          investor_id,
          amount: payment_amount,
          payment_date,
          reference: payment_reference?.trim() || null,
          created_by: user.id,
        });

      if (paymentError) {
        console.error("[API] investment payment insert error:", paymentError);
        paymentWarning =
          "Investment created but initial payment record failed: " +
          paymentError.message;
      }
    }

    // Send onboarding email when requested (for new investors)
    let invitationStatus: string | undefined;
    let emailSent = false;
    let emailError: string | undefined;

    if (send_onboarding_email) {
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL ??
        "https://maalgrow-portal.vercel.app";

      // Generate a fresh invite link (does not send any email on its own)
      const { data: linkData, error: linkErr } =
        await adminClient.auth.admin.generateLink({
          type: "invite",
          email: investor.email,
          options: {
            data: { full_name: investor.full_name, role: "investor" },
            redirectTo: `${siteUrl}/investor/dashboard`,
          },
        });

      const passwordSetupLink =
        linkData?.properties?.action_link ?? `${siteUrl}/login`;

      const totalPaid =
        payment_amount && payment_amount > 0 && !paymentWarning
          ? payment_amount
          : 0;
      const outstandingBalance = Math.max(0, capital - totalPaid);
      const payStatus = getPaymentStatus(capital, totalPaid);

      if (!linkErr) {
        const result = await sendOnboardingEmail({
          to: investor.email,
          fullName: investor.full_name,
          investorCode: investor.investor_code,
          email: investor.email,
          passwordSetupLink,
          portalLink: siteUrl,
          seriesName: series.name,
          cycleLabel: cycle.cycle_label,
          slots: units,
          slotValue: SLOT_VALUE_NGN,
          totalInvestment: capital,
          totalPaid,
          outstandingBalance,
          paymentStatus: payStatus,
          paymentDate: payment_date,
          cycleStart: cycle.start_date,
          maturityDate: cycle.end_date,
        });

        emailSent = result.success;
        emailError = result.error;
      } else {
        emailError = linkErr.message;
      }

      invitationStatus = emailSent ? "sent" : "failed";

      // Update investor's invitation_status
      await adminClient
        .from("investors")
        .update({
          invitation_status: invitationStatus as "sent" | "failed",
          ...(emailSent
            ? { invitation_sent_at: new Date().toISOString() }
            : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", investor_id);
    }

    return NextResponse.json(
      {
        investment,
        ...(paymentWarning ? { warning: paymentWarning } : {}),
        ...(invitationStatus !== undefined
          ? { invitation_status: invitationStatus, email_sent: emailSent, email_error: emailError }
          : {}),
      },
      { status: 201 }
    );
  } catch (err) {
    console.error("[API] POST /admin/investments error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
