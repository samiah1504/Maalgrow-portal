import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Super Admin exception approval: change an investor's rollover decision
// after the deadline (or unlock a locked decision).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await params; // cycle id is part of the URL for scoping only

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || profile.role !== "super_admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as {
      investment_id?: string;
      decision?: "continue" | "exit" | "rollover_all";
      bank_name?: string;
      account_name?: string;
      account_number?: string;
      notes?: string;
    };

    if (!body.investment_id || !body.decision) {
      return NextResponse.json(
        { error: "investment_id and decision are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("submit_rollover_decision", {
      p_investment_id: body.investment_id,
      p_decision: body.decision,
      p_bank_name: body.bank_name ?? null,
      p_account_name: body.account_name ?? null,
      p_account_number: body.account_number ?? null,
      p_notes: body.notes ?? null,
      p_admin_override: true,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return NextResponse.json({ result: data });
  } catch (err) {
    console.error("[API] POST rollover/decision error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
