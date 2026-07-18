import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import {
  requireSuperAdmin,
  loadExistingInvestorIndex,
  validateRowShape,
} from "@/lib/migration-server";
import { normalizeEmail, normalizePhone } from "@/lib/migration-parse";

// ─── PATCH: edit / skip / restore / resolve duplicate ───────────────
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id, rowId } = await params;

  const body = (await request.json()) as {
    // edits
    full_name?: string;
    phone?: string | null;
    email?: string | null;
    address?: string | null;
    slots?: number | null;
    amount_paid?: number;
    payment_date?: string | null;
    payment_reference?: string | null;
    notes?: string | null;
    // actions
    action?: "skip" | "restore" | "attach" | "create_new";
  };

  const adminClient = await createAdminClient();
  const { data: row } = await adminClient
    .from("migration_rows")
    .select("*")
    .eq("id", rowId)
    .eq("batch_id", id)
    .single();

  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });
  if (row.status === "imported") {
    return NextResponse.json(
      { error: "This row has already been imported and can no longer be changed" },
      { status: 400 }
    );
  }

  // ── Simple actions ──
  if (body.action === "skip") {
    await adminClient
      .from("migration_rows")
      .update({ status: "skipped" })
      .eq("id", rowId);
    return NextResponse.json({ ok: true });
  }
  if (body.action === "attach") {
    if (!row.existing_investor_id) {
      return NextResponse.json(
        { error: "No matching existing investor for this row" },
        { status: 400 }
      );
    }
    await adminClient
      .from("migration_rows")
      .update({ status: "duplicate", action: "attach", issue: null })
      .eq("id", rowId);
    return NextResponse.json({ ok: true });
  }

  // ── Edit / restore: merge fields and re-validate ──
  const merged = {
    full_name: body.full_name ?? row.full_name,
    phone: body.phone !== undefined ? body.phone : row.phone,
    email: body.email !== undefined ? body.email : row.email,
    address: body.address !== undefined ? body.address : row.address,
    slots: body.slots !== undefined ? body.slots : row.slots,
    amount_paid: body.amount_paid ?? row.amount_paid,
    payment_date:
      body.payment_date !== undefined ? body.payment_date : row.payment_date,
    payment_reference:
      body.payment_reference !== undefined
        ? body.payment_reference
        : row.payment_reference,
    notes: body.notes !== undefined ? body.notes : row.notes,
  };

  const issue = validateRowShape({
    full_name: merged.full_name,
    phone: merged.phone,
    email: normalizeEmail(merged.email),
    slots: merged.slots === null ? null : Number(merged.slots),
    amount_paid: Number(merged.amount_paid ?? 0),
    payment_date: merged.payment_date,
  });

  // Re-run duplicate detection with the edited identity
  let status = issue ? "invalid" : "valid";
  let existingId: string | null = null;
  let dupIssue: string | null = null;

  if (!issue) {
    const index = await loadExistingInvestorIndex(adminClient);
    const email = normalizeEmail(merged.email);
    const phone = normalizePhone(merged.phone);
    const match =
      (email ? index.byEmail.get(email) : undefined) ??
      (phone ? index.byPhone.get(phone) : undefined);
    if (match) {
      status = "duplicate";
      existingId = match.id;
      dupIssue = `Already exists as ${match.full_name} (${match.investor_code}) — choose “Add investment to existing investor” or skip`;
    }
  }

  const { data: updated, error } = await adminClient
    .from("migration_rows")
    .update({
      ...merged,
      email: normalizeEmail(merged.email),
      status,
      issue: issue ?? dupIssue,
      existing_investor_id: existingId,
      action: null,
      error: null,
    })
    .eq("id", rowId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });
  return NextResponse.json({ row: updated });
}

// ─── DELETE: remove a row from the batch ────────────────────────────
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; rowId: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id, rowId } = await params;

  const adminClient = await createAdminClient();
  const { data: row } = await adminClient
    .from("migration_rows")
    .select("status")
    .eq("id", rowId)
    .eq("batch_id", id)
    .single();

  if (!row) return NextResponse.json({ error: "Row not found" }, { status: 404 });
  if (row.status === "imported") {
    return NextResponse.json(
      { error: "Imported rows cannot be deleted" },
      { status: 400 }
    );
  }

  await adminClient.from("migration_rows").delete().eq("id", rowId);
  return NextResponse.json({ ok: true });
}
