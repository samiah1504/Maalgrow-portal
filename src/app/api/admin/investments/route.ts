import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const ADMIN_ROLES = [
  "super_admin",
  "administrator",
  "finance",
  "operations",
  "customer_support",
];

// Fixed slot value: ₦500,000 per slot
const SLOT_VALUE_NGN = 500_000;

function validateUnits(units: unknown): units is number {
  if (typeof units !== "number" || isNaN(units)) return false;
  if (units < 0.5) return false;
  // Must be a multiple of 0.5: units × 2 must be an integer
  return Number.isInteger(Math.round(units * 2));
}

// POST /api/admin/investments
// Body: {
//   investor_id: string,
//   series_id: string,
//   cycle_id: string,
//   units: number,         // slots — decimal, 0.5 increments, min 0.5
//   investment_date: string,
//   notes?: string,
//   payment_amount?: number,
//   payment_date?: string,
//   payment_reference?: string,
// }
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
    };

    // Validate required fields
    if (!investor_id || !series_id || !cycle_id || !investment_date) {
      return NextResponse.json(
        { error: "investor_id, series_id, cycle_id, and investment_date are required" },
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

    // Fetch series (for roi_rate and name)
    const { data: series, error: seriesErr } = await adminClient
      .from("series")
      .select("id, name, roi_rate")
      .eq("id", series_id)
      .single();

    if (seriesErr || !series) {
      return NextResponse.json({ error: "Series not found" }, { status: 404 });
    }

    // Fetch cycle (for maturity_date and cycle_number)
    const { data: cycle, error: cycleErr } = await adminClient
      .from("cycles")
      .select("id, cycle_number, cycle_label, start_date, end_date, status")
      .eq("id", cycle_id)
      .eq("series_id", series_id)
      .single();

    if (cycleErr || !cycle) {
      return NextResponse.json(
        { error: "Cycle not found or does not belong to the selected series" },
        { status: 404 }
      );
    }

    // Fetch investor (for investor_code used in investment_code generation)
    const { data: investor, error: investorErr } = await adminClient
      .from("investors")
      .select("id, investor_code, full_name")
      .eq("id", investor_id)
      .single();

    if (investorErr || !investor) {
      return NextResponse.json({ error: "Investor not found" }, { status: 404 });
    }

    // Financial calculations — use integer arithmetic in kobo to avoid float errors
    // capital = units × ₦500,000
    const capitalKobo = Math.round(units * SLOT_VALUE_NGN * 100);
    const capital = capitalKobo / 100;

    // expected_roi = capital × roi_rate
    const expectedRoiKobo = Math.round(capitalKobo * series.roi_rate);
    const expected_roi = expectedRoiKobo / 100;

    // Generate investment code: MG-{series}-{cycle_number_padded}-{investor_code}
    const baseCode = `MG-${series.name}-${String(cycle.cycle_number).padStart(3, "0")}-${investor.investor_code}`;

    // Handle uniqueness: append suffix if collision
    const { count } = await adminClient
      .from("investments")
      .select("id", { count: "exact", head: true })
      .like("investment_code", `${baseCode}%`);

    const investment_code =
      !count || count === 0 ? baseCode : `${baseCode}-${count + 1}`;

    // Insert investment
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
        roi_rate: series.roi_rate,
        expected_roi,
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
        // Investment is created; log the payment error but don't roll back
        console.error("[API] investment payment insert error:", paymentError);
        return NextResponse.json(
          {
            investment,
            warning:
              "Investment created but initial payment record failed: " +
              paymentError.message,
          },
          { status: 201 }
        );
      }
    }

    return NextResponse.json({ investment }, { status: 201 });
  } catch (err) {
    console.error("[API] POST /admin/investments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
