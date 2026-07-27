import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// PATCH /api/admin/investments/[id]
// action: "set_slots" — adjust an investor's slot count.
//
// This used to UPDATE the investments table directly, which is how
// slots and money came apart: the enrolment moved and nothing was
// asked of investment_payments, so a cycle could end up holding
// slots no confirmed payment covered.
//
// It now goes through set_investment_slots (migration 024), which
// refuses any edit that would break
//
//     investments.capital == SUM(confirmed payments)
//
// and names the exact shortfall when it does. The role check, the
// step validation and the audit log all live in that function, in
// one transaction with the write — so nothing here can drift from
// what the database actually enforces. The session client is used so
// auth.uid() is the administrator making the change.
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
      units?: number;
      reason?: string;
    };

    if (body.action !== "set_slots") {
      return NextResponse.json(
        { error: "action must be set_slots" },
        { status: 400 }
      );
    }

    const units = Number(body.units);
    if (isNaN(units) || units < 0.5 || !Number.isInteger(units * 2)) {
      return NextResponse.json(
        { error: "Slots must be at least 0.5, in steps of 0.5" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("set_investment_slots", {
      p_investment_id: id,
      p_units: units,
      p_reason: body.reason?.trim() || null,
    });

    if (error) {
      // P0001 is a RAISE EXCEPTION — the funding invariant, a
      // non-active enrolment, or a permission refusal. Every one of
      // those is a message written for the administrator to read, so
      // it goes through verbatim rather than being flattened to
      // "something went wrong".
      return NextResponse.json(
        { error: error.message },
        { status: error.code === "P0001" ? 400 : 500 }
      );
    }

    const result = (data ?? {}) as {
      changed?: boolean;
      units?: number;
      capital?: number;
      confirmedPaid?: number;
    };

    return NextResponse.json({
      success: true,
      units: result.units ?? units,
      capital: result.capital ?? null,
      confirmedPaid: result.confirmedPaid ?? null,
      ...(result.changed === false ? { message: "No change" } : {}),
    });
  } catch (err) {
    console.error("[API] PATCH /admin/investments/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
