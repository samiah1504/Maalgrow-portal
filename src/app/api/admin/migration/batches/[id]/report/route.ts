import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { requireSuperAdmin } from "@/lib/migration-server";
import { expectedCapital } from "@/lib/migration-parse";
import { getPaymentStatus } from "@/lib/investment-utils";

// GET ?type=full | errors | success — downloadable CSV reports
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await params;

  const url = new URL(request.url);
  const type = url.searchParams.get("type") ?? "full";

  const adminClient = await createAdminClient();
  const { data: rows } = await adminClient
    .from("migration_rows")
    .select("*, investor:investor_id(investor_code)")
    .eq("batch_id", id)
    .order("row_number");

  type Row = {
    row_number: number;
    full_name: string;
    phone: string | null;
    email: string | null;
    slots: number | null;
    amount_paid: number;
    payment_date: string | null;
    status: string;
    issue: string | null;
    error: string | null;
    investor: { investor_code: string } | null;
  };

  let filtered = (rows ?? []) as unknown as Row[];
  if (type === "errors") {
    filtered = filtered.filter((r) =>
      ["failed", "invalid", "skipped"].includes(r.status)
    );
  } else if (type === "success") {
    filtered = filtered.filter((r) => r.status === "imported");
  }

  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const header = [
    "Row", "Full Name", "Phone", "Email", "Slots", "Expected Investment",
    "Amount Paid", "Outstanding", "Payment Status", "Status",
    "Investor Code", "Issue / Error",
  ].join(",");

  const lines = filtered.map((r) => {
    const expected = expectedCapital(r.slots === null ? null : Number(r.slots));
    const paid = Number(r.amount_paid ?? 0);
    return [
      esc(r.row_number), esc(r.full_name), esc(r.phone), esc(r.email),
      esc(r.slots ?? ""), esc(expected), esc(paid),
      esc(Math.max(0, expected - paid)),
      esc(expected > 0 ? getPaymentStatus(expected, paid) : ""),
      esc(r.status), esc(r.investor?.investor_code ?? ""),
      esc(r.error ?? r.issue ?? ""),
    ].join(",");
  });

  return new NextResponse([header, ...lines].join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="migration-${type}-report-${id.slice(0, 8)}.csv"`,
    },
  });
}
