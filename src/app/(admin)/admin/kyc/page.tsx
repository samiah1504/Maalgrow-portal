import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { deriveKycStatus, kycMissingFields } from "@/lib/kyc";
import { KycTable, type KycRow } from "./_kyc-table";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "KYC Centre | Admin" };
export const revalidate = 0;

type NokRow = {
  investor_id: string;
  full_name: string;
  relationship: string;
  phone: string;
  alternative_phone: string | null;
  email: string | null;
  address: string;
  city: string;
  state: string;
  country: string;
};

export default async function AdminKycPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  if (!profile || !["super_admin", "administrator"].includes(profile.role ?? "")) {
    redirect("/admin/dashboard");
  }

  const db = await createAdminClient();

  const [{ data: investors }, nokRes, { data: memberships }, { data: series }, { data: cycles }] =
    await Promise.all([
      db
        .from("investors")
        .select(
          "id, investor_code, full_name, email, phone, address, residential_street_address, residential_state_code, residential_state_name, residential_lga_code, residential_lga_name, residential_city, residential_address_verified, residential_address_updated_at, previous_address_record, bank_name, account_name, account_number, gender, nationality, occupation, kyc_status, kyc_notes, kyc_submitted_at, kyc_approved_at, updated_at"
        )
        .order("full_name"),
      db.from("next_of_kin").select("*"),
      db
        .from("investments")
        .select("investor_id, series_id, cycle_id")
        .neq("status", "completed"),
      db.from("series").select("id, name").order("name"),
      db
        .from("cycles")
        .select("id, series_id, cycle_label")
        .order("cycle_number"),
    ]);

  const nokByInvestor = new Map<string, NokRow>(
    ((nokRes.data ?? []) as NokRow[]).map((n) => [n.investor_id, n])
  );
  const membershipByInvestor = new Map<string, { series: Set<string>; cycles: Set<string> }>();
  for (const m of memberships ?? []) {
    const entry = membershipByInvestor.get(m.investor_id) ?? {
      series: new Set<string>(),
      cycles: new Set<string>(),
    };
    entry.series.add(m.series_id);
    entry.cycles.add(m.cycle_id);
    membershipByInvestor.set(m.investor_id, entry);
  }

  const rows: KycRow[] = (investors ?? []).map((inv) => {
    const nok = nokByInvestor.get(inv.id) ?? null;
    const membership = membershipByInvestor.get(inv.id);
    return {
      id: inv.id,
      investor_code: inv.investor_code,
      full_name: inv.full_name,
      email: inv.email,
      phone: inv.phone,
      address: inv.address,
      bank_name: inv.bank_name,
      account_number: inv.account_number,
      gender: inv.gender ?? null,
      nationality: inv.nationality ?? null,
      occupation: inv.occupation ?? null,
      kyc_submitted_at: inv.kyc_submitted_at,
      kyc_approved_at: inv.kyc_approved_at ?? null,
      updated_at: inv.updated_at,
      nok_name: nok?.full_name ?? null,
      nok_relationship: nok?.relationship ?? null,
      nok_phone: nok?.phone ?? null,
      nok_email: nok?.email ?? null,
      nok_address: nok
        ? [nok.address, nok.city, nok.state, nok.country].filter(Boolean).join(", ")
        : null,
      derived_status: deriveKycStatus(
        { ...inv, gender: inv.gender ?? null, nationality: inv.nationality ?? null, occupation: inv.occupation ?? null },
        nok
      ),
      missing: kycMissingFields(
        { ...inv, gender: inv.gender ?? null, nationality: inv.nationality ?? null, occupation: inv.occupation ?? null },
        nok
      ),
      series_ids: Array.from(membership?.series ?? []),
      cycle_ids: Array.from(membership?.cycles ?? []),
    };
  });

  return (
    <div className="space-y-6 animate-fade-in">
      <div>
        <h1 className="text-2xl font-bold text-foreground">KYC Centre</h1>
        <p className="text-muted text-sm mt-1">
          Review, approve and export investor KYC records. Bank account numbers
          are masked in this table.
        </p>
      </div>

      <KycTable
        rows={rows}
        series={(series ?? []).map((s) => ({ id: s.id, name: String(s.name) }))}
        cycles={cycles ?? []}
      />
    </div>
  );
}
