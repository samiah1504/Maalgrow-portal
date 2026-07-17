import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";

const ADMIN_ROLES = [
  "super_admin",
  "administrator",
  "finance",
  "operations",
  "customer_support",
];

// POST /api/admin/investments/[id]/payments
// Adds a new payment record to an existing investment
export async function POST(
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

    const { data: callerProfile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!callerProfile || !ADMIN_ROLES.includes(callerProfile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id: investment_id } = await params;

    const adminClient = await createAdminClient();

    // Verify investment exists and get investor_id
    const { data: investment, error: invErr } = await adminClient
      .from("investments")
      .select("id, investor_id, capital")
      .eq("id", investment_id)
      .single();

    if (invErr || !investment) {
      return NextResponse.json({ error: "Investment not found" }, { status: 404 });
    }

    const body = await request.json();
    const { amount, payment_date, reference } = body as {
      amount: unknown;
      payment_date: string;
      reference?: string;
    };

    if (typeof amount !== "number" || amount <= 0) {
      return NextResponse.json(
        { error: "Payment amount must be greater than 0" },
        { status: 400 }
      );
    }

    if (!payment_date) {
      return NextResponse.json(
        { error: "Payment date is required" },
        { status: 400 }
      );
    }

    const { data: payment, error: paymentError } = await adminClient
      .from("investment_payments")
      .insert({
        investment_id,
        investor_id: investment.investor_id,
        amount,
        payment_date,
        reference: reference?.trim() || null,
        created_by: user.id,
      })
      .select()
      .single();

    if (paymentError) {
      return NextResponse.json(
        { error: "Failed to record payment: " + paymentError.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ payment }, { status: 201 });
  } catch (err) {
    console.error("[API] POST /admin/investments/[id]/payments error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
