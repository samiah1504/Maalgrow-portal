import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database.types";
import { SITE_URL } from "@/lib/site-url";
import { formatDate } from "@/lib/utils";
import {
  normalizeNigerianPhone,
  isValidEmail,
  firstName,
  type TemplateVars,
} from "./util";
import { formatCurrency } from "@/lib/utils";

type AdminClient = SupabaseClient<Database>;

// ── Auth: Communication Centre is for super_admin + administrator ──
export const COMMS_ROLES = ["super_admin", "administrator"];

export async function requireCommsAdmin(): Promise<
  | { ok: true; userId: string; role: string }
  | { ok: false; response: NextResponse }
> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !COMMS_ROLES.includes(profile.role ?? "")) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "The Communication Centre is restricted to administrators" },
        { status: 403 }
      ),
    };
  }
  return { ok: true, userId: user.id, role: profile.role! };
}

// ── Recipient resolution ─────────────────────────────────────────────

export type ResolvedRecipient = {
  investor_id: string;
  full_name: string;
  investor_code: string;
  email: string;
  phone_raw: string | null;
  phone_normalized: string | null;
  preferred_channel: "sms" | "whatsapp" | "both";
  vars: TemplateVars;
  /** null = sendable; otherwise the reason it will be skipped */
  skip_reason: string | null;
};

export type RecipientStats = {
  total_selected: number;
  valid_phones: number;
  invalid_phones: number;
  duplicates_removed: number;
};

export type CommGroup =
  | "all_active"
  | "series"
  | "cycle"
  | "individual"
  | "kyc_incomplete"
  | "kyc_approved"
  | "portal_not_activated"
  | "maturity_pending"
  | "profit_published";

type InvestorRow = {
  id: string;
  full_name: string;
  investor_code: string;
  email: string;
  phone: string | null;
  kyc_status: "pending" | "approved" | "rejected";
  invitation_status: string | null;
  preferred_channel: "sms" | "whatsapp" | "both";
  profile: { is_active: boolean } | null;
  investments: {
    status: string;
    units: number;
    capital: number;
    declared_profit: number | null;
    maturity_date: string;
    series_id: string;
    cycle_id: string;
    series: { name: string } | null;
    cycle: { cycle_label: string } | null;
  }[];
};

/**
 * Resolves the recipient list for a campaign or preview.
 *
 * "Active investors" = investors whose portal account is active AND who
 * hold at least one active investment. Inactive/exited investors are
 * excluded; invalid phone numbers are flagged; duplicate phone numbers
 * keep the first investor and skip the rest.
 */
export async function loadCommRecipients(
  adminClient: AdminClient,
  opts: {
    group: CommGroup;
    seriesId?: string | null;
    cycleId?: string | null;
    investorIds?: string[] | null;
    /** true for email campaigns: validate/dedupe by email, not phone */
    forEmail?: boolean;
  }
): Promise<{ recipients: ResolvedRecipient[]; stats: RecipientStats }> {
  let query = adminClient
    .from("investors")
    .select(
      `id, full_name, investor_code, email, phone, kyc_status, invitation_status, preferred_channel,
       profile:profiles!profile_id(is_active),
       investments(status, units, capital, declared_profit, maturity_date, series_id, cycle_id, series(name), cycle:cycles(cycle_label))`
    )
    .order("full_name");

  if (opts.group === "individual" && opts.investorIds && opts.investorIds.length > 0) {
    query = query.in("id", opts.investorIds);
  }

  const { data } = await query;
  const rows = (data ?? []) as unknown as InvestorRow[];

  const seenPhones = new Map<string, string>(); // normalized phone → investor name
  const seenEmails = new Map<string, string>(); // lowercased email → investor name
  const recipients: ResolvedRecipient[] = [];
  let invalid = 0;
  let dups = 0;

  const soon = new Date(Date.now() + 30 * 86400000).toISOString().split("T")[0];
  const today = new Date().toISOString().split("T")[0];

  for (const inv of rows) {
    const activeInvestments = (inv.investments ?? []).filter((i) => i.status === "active");

    // Exclusions by group. All groups except 'individual' require an
    // active account with at least one live investment.
    if (opts.group !== "individual") {
      if (inv.profile?.is_active === false) continue; // deactivated account
      if (activeInvestments.length === 0) continue;   // exited / no live investment
    }
    if (opts.group === "series") {
      if (!activeInvestments.some((i) => i.series_id === opts.seriesId)) continue;
    }
    if (opts.group === "cycle") {
      if (!activeInvestments.some((i) => i.cycle_id === opts.cycleId)) continue;
    }
    if (opts.group === "kyc_incomplete" && inv.kyc_status === "approved") continue;
    if (opts.group === "kyc_approved" && inv.kyc_status !== "approved") continue;
    if (opts.group === "portal_not_activated" && inv.invitation_status === "activated") continue;
    if (opts.group === "maturity_pending") {
      const pending = activeInvestments.some(
        (i) => i.maturity_date >= today && i.maturity_date <= soon
      );
      if (!pending) continue;
    }
    if (opts.group === "profit_published") {
      const hasProfit = (inv.investments ?? []).some(
        (i) => i.declared_profit != null && i.status !== "cancelled"
      );
      if (!hasProfit) continue;
    }

    const relevant =
      opts.group === "series"
        ? activeInvestments.filter((i) => i.series_id === opts.seriesId)
        : opts.group === "cycle"
        ? activeInvestments.filter((i) => i.cycle_id === opts.cycleId)
        : activeInvestments;
    const primary = [...relevant].sort((a, b) =>
      b.maturity_date.localeCompare(a.maturity_date)
    )[0];
    const totalSlots = relevant.reduce((s, i) => s + Number(i.units), 0);
    const totalCapital = relevant.reduce((s, i) => s + Number(i.capital), 0);
    const latestProfit = (inv.investments ?? [])
      .filter((i) => i.declared_profit != null)
      .sort((a, b) => b.maturity_date.localeCompare(a.maturity_date))[0]
      ?.declared_profit;

    const phoneNormalized = normalizeNigerianPhone(inv.phone);
    const emailValid = isValidEmail(inv.email);
    const emailKey = (inv.email ?? "").trim().toLowerCase();

    let skip: string | null = null;
    if (opts.forEmail) {
      if (!emailValid) {
        invalid++;
        skip = inv.email
          ? `Invalid email address: ${inv.email}`
          : "No email address on record";
      } else if (seenEmails.has(emailKey)) {
        dups++;
        skip = `Duplicate email address (also on ${seenEmails.get(emailKey)})`;
      } else {
        seenEmails.set(emailKey, inv.full_name);
      }
    } else {
      if (!phoneNormalized) {
        invalid++;
        skip = inv.phone
          ? `Invalid phone number: ${inv.phone}`
          : "No phone number on record";
      } else if (seenPhones.has(phoneNormalized)) {
        dups++;
        skip = `Duplicate phone number (also on ${seenPhones.get(phoneNormalized)})`;
      } else {
        seenPhones.set(phoneNormalized, inv.full_name);
      }
    }

    recipients.push({
      investor_id: inv.id,
      full_name: inv.full_name,
      investor_code: inv.investor_code,
      email: inv.email,
      phone_raw: inv.phone,
      phone_normalized: phoneNormalized,
      preferred_channel: inv.preferred_channel ?? "sms",
      skip_reason: skip,
      vars: {
        first_name: firstName(inv.full_name),
        full_name: inv.full_name,
        registered_email: inv.email,
        investor_code: inv.investor_code,
        series_name: primary?.series?.name ? `Series ${primary.series.name}` : undefined,
        cycle_name: primary?.cycle?.cycle_label ?? undefined,
        capital_amount: totalCapital > 0 ? formatCurrency(totalCapital) : undefined,
        total_slots: totalSlots > 0 ? String(totalSlots) : undefined,
        profit_amount: latestProfit != null ? formatCurrency(Number(latestProfit)) : undefined,
        maturity_value:
          latestProfit != null && totalCapital > 0
            ? formatCurrency(totalCapital + Number(latestProfit))
            : undefined,
        maturity_date: primary ? formatDate(primary.maturity_date) : undefined,
        maturity_instruction_deadline: primary
          ? formatDate(primary.maturity_date)
          : undefined,
        kyc_status:
          inv.kyc_status === "approved"
            ? "Approved"
            : inv.kyc_status === "rejected"
            ? "Needs Correction"
            : "Pending Review",
        portal_url: SITE_URL,
      },
    });
  }

  return {
    recipients,
    stats: {
      total_selected: recipients.length,
      valid_phones: recipients.filter((r) => r.skip_reason === null).length,
      invalid_phones: invalid,
      duplicates_removed: dups,
    },
  };
}
