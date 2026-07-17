import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { calcMaturityDateStr, calcCycleLabel } from "@/lib/cycle-dates";

const ALLOWED_ROLES = ["super_admin", "administrator"];

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (!profile || !ALLOWED_ROLES.includes(profile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json() as {
      series_id: string;
      start_date: string;
      unit_value: number;
      subscription_open_date?: string | null;
      subscription_close_date?: string | null;
      status?: string;
      notes?: string | null;
      cycle_label?: string;
    };

    const { series_id, start_date, unit_value } = body;

    if (!series_id || typeof series_id !== "string") {
      return NextResponse.json({ error: "series_id is required" }, { status: 400 });
    }
    if (!start_date || !/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      return NextResponse.json({ error: "start_date must be a valid YYYY-MM-DD date" }, { status: 400 });
    }
    if (!unit_value || typeof unit_value !== "number" || unit_value <= 0) {
      return NextResponse.json({ error: "unit_value must be a positive number" }, { status: 400 });
    }

    const { subscription_open_date, subscription_close_date } = body;
    if (
      subscription_open_date && subscription_close_date &&
      subscription_close_date <= subscription_open_date
    ) {
      return NextResponse.json(
        { error: "subscription_close_date must be after subscription_open_date" },
        { status: 400 }
      );
    }

    const end_date = calcMaturityDateStr(start_date);

    if (end_date <= start_date) {
      return NextResponse.json({ error: "Calculated maturity date is not after start date" }, { status: 400 });
    }

    const adminClient = await createAdminClient();

    // Overlap check: a cycle [A,B) overlaps [C,D) if A < D AND B > C
    const { data: sameSeries } = await adminClient
      .from("cycles")
      .select("id, cycle_label, start_date, end_date")
      .eq("series_id", series_id)
      .not("status", "eq", "cancelled");

    const overlap = (sameSeries ?? []).find((c) => {
      // [start_date, end_date) overlaps [c.start_date, c.end_date) if:
      return start_date < c.end_date && end_date > c.start_date;
    });

    if (overlap) {
      return NextResponse.json(
        { error: `Dates overlap with existing cycle: ${overlap.cycle_label}` },
        { status: 400 }
      );
    }

    // Count existing cycles for this series to determine cycle_number
    const { count } = await adminClient
      .from("cycles")
      .select("*", { count: "exact", head: true })
      .eq("series_id", series_id);

    const cycle_number = (count ?? 0) + 1;
    const cycle_label = body.cycle_label?.trim() || calcCycleLabel(start_date);
    const status = (body.status as string) || "draft";

    const { data: newCycle, error: insertError } = await adminClient
      .from("cycles")
      .insert({
        series_id,
        cycle_number,
        cycle_label,
        start_date,
        end_date,
        status: status as "draft",
        subscription_open_date: subscription_open_date ?? null,
        subscription_close_date: subscription_close_date ?? null,
        unit_value,
        notes: body.notes?.trim() ?? null,
        total_capital: 0,
        total_investors: 0,
      })
      .select("id, cycle_label, start_date, end_date, status")
      .single();

    if (insertError) {
      console.error("[API] POST /admin/cycles error:", insertError);
      return NextResponse.json({ error: insertError.message }, { status: 500 });
    }

    // Audit log
    const auditChanges: import("@/lib/types/database.types").Json = {
      series_id,
      cycle_label,
      start_date,
      end_date,
      status,
      unit_value,
      subscription_open_date: subscription_open_date ?? null,
      subscription_close_date: subscription_close_date ?? null,
      notes: body.notes?.trim() ?? null,
    };
    await adminClient.from("cycle_audit_log").insert({
      cycle_id: newCycle.id,
      changed_by: user.id,
      action: "create",
      changes: auditChanges,
    });

    return NextResponse.json({ success: true, cycle: newCycle }, { status: 201 });
  } catch (err) {
    console.error("[API] POST /admin/cycles unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
