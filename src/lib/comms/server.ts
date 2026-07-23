import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database.types";
import { SITE_URL } from "@/lib/site-url";
import { formatDate } from "@/lib/utils";
import {
  normalizeNigerianPhone,
  firstName,
  type TemplateVars,
} from "./util";

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

type InvestorRow = {
  id: string;
  full_name: string;
  investor_code: string;
  email: string;
  phone: string | null;
  preferred_channel: "sms" | "whatsapp" | "both";
  profile: { is_active: boolean } | null;
  investments: {
    status: string;
    units: number;
    maturity_date: string;
    series_id: string;
    series: { name: string } | null;
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
    group: "all_active" | "series" | "individual";
    seriesId?: string | null;
    investorIds?: string[] | null;
  }
): Promise<{ recipients: ResolvedRecipient[]; stats: RecipientStats }> {
  let query = adminClient
    .from("investors")
    .select(
      `id, full_name, investor_code, email, phone, preferred_channel,
       profile:profiles!profile_id(is_active),
       investments(status, units, maturity_date, series_id, series(name))`
    )
    .order("full_name");

  if (opts.group === "individual" && opts.investorIds && opts.investorIds.length > 0) {
    query = query.in("id", opts.investorIds);
  }

  const { data } = await query;
  const rows = (data ?? []) as unknown as InvestorRow[];

  const seenPhones = new Map<string, string>(); // normalized phone → investor name
  const recipients: ResolvedRecipient[] = [];
  let invalid = 0;
  let dups = 0;

  for (const inv of rows) {
    const activeInvestments = (inv.investments ?? []).filter((i) => i.status === "active");

    // Exclusions by group
    if (opts.group === "all_active" || opts.group === "series") {
      if (inv.profile?.is_active === false) continue; // deactivated account
      if (activeInvestments.length === 0) continue;   // exited / no live investment
    }
    if (opts.group === "series") {
      const inSeries = activeInvestments.some((i) => i.series_id === opts.seriesId);
      if (!inSeries) continue;
    }

    const relevant =
      opts.group === "series"
        ? activeInvestments.filter((i) => i.series_id === opts.seriesId)
        : activeInvestments;
    const primary = [...relevant].sort((a, b) =>
      b.maturity_date.localeCompare(a.maturity_date)
    )[0];
    const totalSlots = relevant.reduce((s, i) => s + Number(i.units), 0);

    const phoneNormalized = normalizeNigerianPhone(inv.phone);
    let skip: string | null = null;
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
        maturity_date: primary ? formatDate(primary.maturity_date) : undefined,
        total_slots: totalSlots > 0 ? String(totalSlots) : undefined,
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
