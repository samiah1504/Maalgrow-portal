import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/migration-server";
import { expectedCapital } from "@/lib/migration-parse";

// ─── GET: batch detail + rows + totals ──────────────────────────────
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const adminClient = await createAdminClient();
  const [{ data: batch }, { data: rows }] = await Promise.all([
    adminClient
      .from("migration_batches")
      .select(
        "*, series:series_id(name, price_per_unit), cycle:cycle_id(cycle_label, start_date, end_date, status)"
      )
      .eq("id", id)
      .single(),
    adminClient
      .from("migration_rows")
      .select("*, existing_investor:existing_investor_id(full_name, investor_code)")
      .eq("batch_id", id)
      .order("row_number"),
  ]);

  if (!batch) {
    return NextResponse.json({ error: "Batch not found" }, { status: 404 });
  }

  type Row = {
    slots: number | null;
    amount_paid: number;
    status: string;
  };

  const all = (rows ?? []) as unknown as Row[];
  const countable = all.filter((r) => !["skipped", "invalid"].includes(r.status));
  const totals = {
    total_rows: all.length,
    importable: all.filter((r) =>
      ["valid", "duplicate", "failed"].includes(r.status)
    ).length,
    imported: all.filter((r) => r.status === "imported").length,
    invalid: all.filter((r) => r.status === "invalid").length,
    duplicates: all.filter((r) => r.status === "duplicate").length,
    skipped: all.filter((r) => r.status === "skipped").length,
    failed: all.filter((r) => r.status === "failed").length,
    total_slots: countable.reduce((s, r) => s + Number(r.slots ?? 0), 0),
    expected_capital: countable.reduce(
      (s, r) => s + expectedCapital(r.slots === null ? null : Number(r.slots)),
      0
    ),
    amount_paid: countable.reduce((s, r) => s + Number(r.amount_paid ?? 0), 0),
  };

  return NextResponse.json({
    batch,
    rows: rows ?? [],
    totals: {
      ...totals,
      outstanding: Math.max(0, totals.expected_capital - totals.amount_paid),
    },
  });
}

// ─── PATCH: update batch (email mode / cancel) ──────────────────────
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const body = (await request.json()) as {
    email_mode?: "now" | "queue" | "none";
    status?: "cancelled";
  };

  const adminClient = await createAdminClient();
  const { data: batch, error } = await adminClient
    .from("migration_batches")
    .update({
      ...(body.email_mode ? { email_mode: body.email_mode } : {}),
      ...(body.status === "cancelled" ? { status: "cancelled" } : {}),
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  return NextResponse.json({ batch });
}
