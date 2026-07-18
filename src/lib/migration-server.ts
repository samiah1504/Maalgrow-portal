import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database.types";
import { normalizeEmail, normalizePhone } from "@/lib/migration-parse";
import { isValidSlots } from "@/lib/investment-utils";

type AdminClient = SupabaseClient<Database>;

// ============================================================
// Auth — bulk migration is Super Admin only
// ============================================================

export async function requireSuperAdmin(): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "super_admin") {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Only the Super Admin can run investor migrations" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, userId: user.id };
}

// ============================================================
// Duplicate detection
// ============================================================

export type ExistingInvestorRef = {
  id: string;
  full_name: string;
  investor_code: string;
  email: string;
  phone: string | null;
};

/**
 * Loads every existing investor once and returns lookup maps keyed by
 * normalized email and normalized phone (last 10 digits).
 */
export async function loadExistingInvestorIndex(adminClient: AdminClient): Promise<{
  byEmail: Map<string, ExistingInvestorRef>;
  byPhone: Map<string, ExistingInvestorRef>;
}> {
  const byEmail = new Map<string, ExistingInvestorRef>();
  const byPhone = new Map<string, ExistingInvestorRef>();

  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data } = await adminClient
      .from("investors")
      .select("id, full_name, investor_code, email, phone")
      .range(from, from + pageSize - 1);
    const investors = (data ?? []) as ExistingInvestorRef[];

    for (const inv of investors) {
      const e = normalizeEmail(inv.email);
      if (e && !byEmail.has(e)) byEmail.set(e, inv);
      const p = normalizePhone(inv.phone);
      if (p && !byPhone.has(p)) byPhone.set(p, inv);
    }
    if (investors.length < pageSize) break;
  }

  return { byEmail, byPhone };
}

// ============================================================
// Row re-validation (used after edits and on batch creation)
// ============================================================

export type RowShape = {
  full_name: string;
  phone: string | null;
  email: string | null;
  slots: number | null;
  amount_paid: number;
  payment_date: string | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validateRowShape(row: RowShape): string | null {
  const issues: string[] = [];
  if (!row.full_name || row.full_name.trim().length < 2)
    issues.push("Full name is required");
  const email = normalizeEmail(row.email);
  if (!email) issues.push("Email address is required");
  else if (!EMAIL_RE.test(email)) issues.push(`Invalid email "${row.email}"`);
  if (!normalizePhone(row.phone)) issues.push("Phone number is required");
  if (row.slots === null || row.slots === undefined)
    issues.push("Number of slots is required");
  else if (!isValidSlots(Number(row.slots)))
    issues.push(
      `Invalid slot quantity ${row.slots} — slots must be at least 0.5 and in 0.5 increments`
    );
  if (row.amount_paid < 0) issues.push("Amount paid cannot be negative");
  if (row.amount_paid > 0 && !row.payment_date)
    issues.push("Payment date is required when an amount was paid");
  return issues.length > 0 ? issues.join("; ") : null;
}
