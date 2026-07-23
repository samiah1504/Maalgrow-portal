import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/admin/payments
// Records a new investor payment allocated to a series + cycle.
// All validation, enrolment creation/top-up, cycle totals and the
// audit log happen inside record_investor_payment in ONE database
// transaction — the session client is used so auth.uid() is the
// admin performing the action.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      investor_id?: string;
      series_id?: string;
      cycle_id?: string;
      amount?: number;
      units?: number | null;
      payment_date?: string;
      method?: string | null;
      reference?: string | null;
      notes?: string | null;
      status?: "pending" | "confirmed";
      apply_to_outstanding?: boolean;
    };

    if (!body.investor_id || !body.series_id || !body.cycle_id) {
      return NextResponse.json(
        { error: "Investor, series and cycle are required" },
        { status: 400 }
      );
    }
    if (typeof body.amount !== "number" || isNaN(body.amount)) {
      return NextResponse.json(
        { error: "Payment amount must be a number" },
        { status: 400 }
      );
    }
    if (!body.payment_date) {
      return NextResponse.json(
        { error: "Payment date is required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("record_investor_payment", {
      p_investor_id: body.investor_id,
      p_series_id: body.series_id,
      p_cycle_id: body.cycle_id,
      p_amount: body.amount,
      p_units: body.apply_to_outstanding ? null : body.units ?? null,
      p_payment_date: body.payment_date,
      p_method: body.method ?? null,
      p_reference: body.reference ?? null,
      p_notes: body.notes ?? null,
      p_status: body.status === "pending" ? "pending" : "confirmed",
      p_apply_to_outstanding: body.apply_to_outstanding === true,
    });

    if (error) {
      // P0001 = raised business-rule exception → client error
      const isRule = error.code === "P0001";
      return NextResponse.json(
        { error: error.message },
        { status: isRule ? 400 : 500 }
      );
    }

    return NextResponse.json({ summary: data }, { status: 201 });
  } catch (err) {
    console.error("[API] POST /admin/payments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
