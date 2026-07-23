import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/admin/payments/[id]
// action: "edit" | "reverse" | "confirm" | "reject"
// Each action maps to a transactional SECURITY DEFINER function
// that recalculates the old and new allocations and writes the
// audit log. The session client is used so auth.uid() is the admin.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = (await request.json()) as {
      action?: string;
      series_id?: string;
      cycle_id?: string;
      amount?: number;
      units?: number | null;
      payment_date?: string;
      method?: string | null;
      reference?: string | null;
      notes?: string | null;
      reason?: string;
    };

    let rpc;
    switch (body.action) {
      case "edit": {
        if (!body.series_id || !body.cycle_id || !body.payment_date) {
          return NextResponse.json(
            { error: "Series, cycle and payment date are required" },
            { status: 400 }
          );
        }
        if (typeof body.amount !== "number" || isNaN(body.amount)) {
          return NextResponse.json(
            { error: "Payment amount must be a number" },
            { status: 400 }
          );
        }
        rpc = supabase.rpc("edit_investor_payment", {
          p_payment_id: id,
          p_series_id: body.series_id,
          p_cycle_id: body.cycle_id,
          p_amount: body.amount,
          p_units: body.units ?? null,
          p_payment_date: body.payment_date,
          p_method: body.method ?? null,
          p_reference: body.reference ?? null,
          p_notes: body.notes ?? null,
        });
        break;
      }
      case "reverse":
        rpc = supabase.rpc("reverse_investor_payment", {
          p_payment_id: id,
          p_reason: body.reason ?? "",
        });
        break;
      case "confirm":
        rpc = supabase.rpc("confirm_investor_payment", { p_payment_id: id });
        break;
      case "reject":
        rpc = supabase.rpc("reject_investor_payment", {
          p_payment_id: id,
          p_reason: body.reason ?? null,
        });
        break;
      default:
        return NextResponse.json(
          { error: "action must be edit, reverse, confirm or reject" },
          { status: 400 }
        );
    }

    const { data, error } = await rpc;
    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "P0001" ? 400 : 500 }
      );
    }

    return NextResponse.json({ summary: data });
  } catch (err) {
    console.error("[API] PATCH /admin/payments/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
