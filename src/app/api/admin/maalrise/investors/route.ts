/**
 * Give a person MaalRise access. Prepare roles.
 *
 * One person, one investor record (Phase 7): the person also gets the
 * MaalGrow investor record if they have none, so the invitation, KYC
 * form, chat and Communication Centre work for them. A person with no
 * login yet gets one when staff ask for it (create_login) — created
 * WITHOUT sending anything. The invitation is a separate press of
 * "Send invitation" on the investor's page.
 *
 * maalrise_add_investor() refuses staff accounts, reuses verified
 * MaalGrow KYC and pre-fills MaalGrow bank details UNCONFIRMED.
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, findLoginByEmail, maalriseGate, readJson } from "@/lib/maalrise/api";
import { mr } from "@/lib/maalrise/db";
import { createInvestorLogin, ensureBaseInvestorRecord } from "@/lib/maalrise/onboarding";

type Body = {
  email?: string;
  full_name?: string;
  phone?: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  create_login?: boolean;
};

export async function POST(request: Request) {
  const gate = await maalriseGate(MAALRISE_PREPARE_ROLES);
  if (!gate.ok) return gate.response;
  const b = await readJson<Body>(request);
  const email = b?.email?.trim().toLowerCase() ?? "";
  const fullName = b?.full_name?.trim() ?? "";
  const phone = b?.phone?.trim() || null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  const anyBank = !!(b?.bank_name || b?.account_name || b?.account_number);
  if (anyBank && (!b?.bank_name?.trim() || !b?.account_name?.trim() || !/^\d{10}$/.test(b?.account_number ?? ""))) {
    return NextResponse.json({ error: "Bank name, account name and a 10-digit account number are all required." }, { status: 400 });
  }

  const { data: profile, error } = await findLoginByEmail<{ email: string | null; id: string; role: string; full_name: string | null }>(
    gate.db, email, "id, role, full_name");
  if (error) return dbError(error);
  if (!profile && !b?.create_login) {
    return NextResponse.json(
      { error: "No login exists for this email. Choose “Create a new login” to add this person.", code: "NO_LOGIN" },
      { status: 409 }
    );
  }
  if (profile && profile.role !== "investor") {
    return NextResponse.json({ error: "Staff accounts cannot be added as MaalRise investors" }, { status: 400 });
  }
  if (!profile && !fullName) return NextResponse.json({ error: "Full name is required for a new login." }, { status: 400 });

  const admin = mr(await createAdminClient());
  let profileId = profile?.id ?? null;
  let createdLogin = false;
  let createdRecord: string | null = null;
  try {
    if (!profileId) {
      profileId = await createInvestorLogin(admin, email, fullName);
      createdLogin = true;
    }
    const base = await ensureBaseInvestorRecord(admin, {
      profileId,
      email,
      fullName: fullName || profile?.full_name?.trim() || email,
      phone,
      createdBy: gate.userId,
    });
    if (base.created) createdRecord = base.id;
  } catch (e) {
    if (createdLogin && profileId) await admin.auth.admin.deleteUser(profileId);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Could not create the investor." }, { status: 400 });
  }

  const res = await gate.db.rpc("maalrise_add_investor", {
    p_profile: profileId,
    p: {
      full_name: fullName,
      phone: phone ?? "",
      bank_name: b?.bank_name ?? "",
      account_name: b?.account_name ?? "",
      account_number: b?.account_number ?? "",
    },
  });
  if (res.error) {
    // Leave nothing half-made behind.
    if (createdRecord) await admin.from("investors").delete().eq("id", createdRecord);
    if (createdLogin && profileId) await admin.auth.admin.deleteUser(profileId);
    return dbError(res.error);
  }
  return NextResponse.json({ id: res.data, created_login: createdLogin }, { status: 201 });
}
