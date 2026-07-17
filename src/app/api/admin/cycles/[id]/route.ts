import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { calcMaturityDateStr } from "@/lib/cycle-dates";

const ALLOWED_ROLES = ["super_admin", "administrator"];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const adminClient = await createAdminClient();

    const { data: cycle, error } = await adminClient
      .from("cycles")
      .select("*, series(name, mudarabah_investor_ratio)")
      .eq("id", id)
      .single();

    if (error || !cycle) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    const { data: auditLog } = await adminClient
      .from("cycle_audit_log")
      .select("id, action, changes, changed_at, changed_by")
      .eq("cycle_id", id)
      .order("changed_at", { ascending: false })
      .limit(20);

    return NextResponse.json({ cycle, audit_log: auditLog ?? [] });
  } catch (err) {
    console.error("[API] GET /admin/cycles/[id] error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
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

    const adminClient = await createAdminClient();

    const { data: existing, error: fetchErr } = await adminClient
      .from("cycles")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Cycle not found" }, { status: 404 });
    }

    const body = await request.json() as {
      cycle_label?: string;
      start_date?: string;
      subscription_open_date?: string | null;
      subscription_close_date?: string | null;
      unit_value?: number;
      status?: string;
      notes?: string | null;
    };

    // Validate start_date if provided
    const start_date = body.start_date ?? existing.start_date;
    if (body.start_date && !/^\d{4}-\d{2}-\d{2}$/.test(body.start_date)) {
      return NextResponse.json({ error: "start_date must be a valid YYYY-MM-DD date" }, { status: 400 });
    }

    const end_date = body.start_date ? calcMaturityDateStr(body.start_date) : existing.end_date;

    if (body.unit_value !== undefined && (typeof body.unit_value !== "number" || body.unit_value <= 0)) {
      return NextResponse.json({ error: "unit_value must be a positive number" }, { status: 400 });
    }

    const sub_open = body.subscription_open_date !== undefined
      ? body.subscription_open_date
      : existing.subscription_open_date;
    const sub_close = body.subscription_close_date !== undefined
      ? body.subscription_close_date
      : existing.subscription_close_date;

    if (sub_open && sub_close && sub_close <= sub_open) {
      return NextResponse.json(
        { error: "subscription_close_date must be after subscription_open_date" },
        { status: 400 }
      );
    }

    // Overlap check if start_date changed
    if (body.start_date) {
      const { data: sameSeries } = await adminClient
        .from("cycles")
        .select("id, cycle_label, start_date, end_date")
        .eq("series_id", existing.series_id)
        .not("id", "eq", id)
        .not("status", "eq", "cancelled");

      const overlap = (sameSeries ?? []).find((c) => {
        return start_date < c.end_date && end_date > c.start_date;
      });

      if (overlap) {
        return NextResponse.json(
          { error: `Dates overlap with existing cycle: ${overlap.cycle_label}` },
          { status: 400 }
        );
      }
    }

    // Build changeset for audit log
    const changes: Record<string, { old: unknown; new: unknown }> = {};

    type CycleUpdate = {
      cycle_label?: string;
      start_date?: string;
      end_date?: string;
      status?: "draft" | "subscription_open" | "subscription_closed" | "upcoming" | "active" | "maturity_window" | "awaiting_profit_declaration" | "matured" | "completed" | "cancelled";
      subscription_open_date?: string | null;
      subscription_close_date?: string | null;
      unit_value?: number | null;
      notes?: string | null;
      updated_at?: string;
    };
    const updatePayload: CycleUpdate = { updated_at: new Date().toISOString() };

    if (body.cycle_label?.trim() && body.cycle_label.trim() !== existing.cycle_label) {
      const v = body.cycle_label.trim();
      changes["cycle_label"] = { old: existing.cycle_label, new: v };
      updatePayload.cycle_label = v;
    }
    if (body.start_date && body.start_date !== existing.start_date) {
      changes["start_date"] = { old: existing.start_date, new: body.start_date };
      updatePayload.start_date = body.start_date;
      changes["end_date"] = { old: existing.end_date, new: end_date };
      updatePayload.end_date = end_date;
    }
    if (body.subscription_open_date !== undefined && body.subscription_open_date !== existing.subscription_open_date) {
      changes["subscription_open_date"] = { old: existing.subscription_open_date, new: body.subscription_open_date };
      updatePayload.subscription_open_date = body.subscription_open_date;
    }
    if (body.subscription_close_date !== undefined && body.subscription_close_date !== existing.subscription_close_date) {
      changes["subscription_close_date"] = { old: existing.subscription_close_date, new: body.subscription_close_date };
      updatePayload.subscription_close_date = body.subscription_close_date;
    }
    if (body.unit_value !== undefined && body.unit_value !== existing.unit_value) {
      changes["unit_value"] = { old: existing.unit_value, new: body.unit_value };
      updatePayload.unit_value = body.unit_value;
    }
    if (body.status && body.status !== existing.status) {
      changes["status"] = { old: existing.status, new: body.status };
      updatePayload.status = body.status as CycleUpdate["status"];
    }
    if (body.notes !== undefined) {
      const notesVal = body.notes?.trim() ?? null;
      if (notesVal !== existing.notes) {
        changes["notes"] = { old: existing.notes, new: notesVal };
        updatePayload.notes = notesVal;
      }
    }

    if (Object.keys(changes).length === 0) {
      return NextResponse.json({ success: true, message: "No changes" });
    }

    const { error: updateErr } = await adminClient
      .from("cycles")
      .update(updatePayload)
      .eq("id", id);

    if (updateErr) {
      console.error("[API] PATCH /admin/cycles/[id] error:", updateErr);
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    await adminClient.from("cycle_audit_log").insert({
      cycle_id: id,
      changed_by: user.id,
      action: "update",
      changes: changes as unknown as import("@/lib/types/database.types").Json,
    });

    return NextResponse.json({ success: true, changes });
  } catch (err) {
    console.error("[API] PATCH /admin/cycles/[id] unexpected error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
