/**
 * One person, one investor record (agreed 14 Oct 2026).
 *
 * Every MaalRise investor also has the MaalGrow investor record, so
 * the login invitation, the KYC form, chat and the Communication
 * Centre — all built on that record — work for them unchanged. For a
 * MaalRise-only person the record simply has no investments.
 *
 * Server only, with the service-role client: creating a login and the
 * investor record is what MaalGrow's own "add investor" route does,
 * and these helpers do it the same way. Callers check the staff role
 * first. Nothing here sends an email.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { generateUniqueInvestorCode } from "@/lib/investor-code";
import { SITE_URL } from "@/lib/site-url";

/** Creates the login WITHOUT sending anything; returns the new profile id. */
export async function createInvestorLogin(admin: SupabaseClient, email: string, fullName: string): Promise<string> {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "invite",
    email,
    options: { data: { full_name: fullName, role: "investor" }, redirectTo: `${SITE_URL}/reset-password` },
  });
  if (error || !data?.user) throw new Error(error?.message ?? "Could not create the login");
  const id = data.user.id;
  const { error: pErr } = await admin.from("profiles").upsert({ id, email, full_name: fullName, role: "investor" }, { onConflict: "id" });
  if (pErr) {
    await admin.auth.admin.deleteUser(id);
    throw new Error(`Could not create the profile: ${pErr.message}`);
  }
  return id;
}

/**
 * The person's MaalGrow investor record, created (with no investments)
 * if they have none. Returns its id and whether it was created here.
 */
export async function ensureBaseInvestorRecord(
  admin: SupabaseClient,
  p: { profileId: string; email: string; fullName: string; phone: string | null; createdBy: string }
): Promise<{ id: string; created: boolean }> {
  const { data: existing, error } = await admin.from("investors").select("id").eq("profile_id", p.profileId).maybeSingle();
  if (error) throw new Error(`Could not read the investor record: ${error.message}`);
  if (existing) return { id: existing.id as string, created: false };

  const { data: sameEmail } = await admin.from("investors").select("id").eq("email", p.email).maybeSingle();
  if (sameEmail) throw new Error("Another investor record already uses this email address.");

  const investor_code = await generateUniqueInvestorCode(async (code) => {
    const { data } = await admin.from("investors").select("id").eq("investor_code", code).maybeSingle();
    return !!data;
  });
  const { data: row, error: insErr } = await admin
    .from("investors")
    .insert({
      profile_id: p.profileId,
      investor_code,
      full_name: p.fullName,
      email: p.email,
      phone: p.phone,
      invitation_status: "not_sent",
      invitation_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      created_by: p.createdBy,
      onboarded_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (insErr || !row) throw new Error(`Could not create the investor record: ${insErr?.message ?? "unknown error"}`);
  return { id: row.id as string, created: true };
}

export type NewMaalriseInvestor = {
  email: string;
  fullName: string;
  phone: string | null;
  bankName: string;
  accountName: string;
  accountNumber: string;
};

/**
 * Gives a person MaalRise access, as the add-investor page and the bulk
 * import both do: a login if `loginId` is null (created WITHOUT sending
 * anything), the MaalGrow investor record if they have none, then
 * maalrise_add_investor() AS THE STAFF MEMBER (`db`, so the database
 * checks their role). If any step fails, whatever this call made is
 * removed again. Returns the MaalRise investor id.
 */
export async function addMaalriseInvestor(
  db: SupabaseClient,
  admin: SupabaseClient,
  staffId: string,
  loginId: string | null,
  p: NewMaalriseInvestor & { loginName?: string | null }
): Promise<{ id: string; createdLogin: boolean }> {
  let profileId = loginId;
  let createdLogin = false;
  let createdRecord: string | null = null;
  try {
    if (!profileId) {
      profileId = await createInvestorLogin(admin, p.email, p.fullName);
      createdLogin = true;
    }
    const base = await ensureBaseInvestorRecord(admin, {
      profileId,
      email: p.email,
      fullName: p.fullName || p.loginName?.trim() || p.email,
      phone: p.phone,
      createdBy: staffId,
    });
    if (base.created) createdRecord = base.id;
  } catch (e) {
    if (createdLogin && profileId) await admin.auth.admin.deleteUser(profileId);
    throw e instanceof Error ? e : new Error("Could not create the investor.");
  }

  const res = await db.rpc("maalrise_add_investor", {
    p_profile: profileId,
    p: {
      full_name: p.fullName,
      phone: p.phone ?? "",
      bank_name: p.bankName,
      account_name: p.accountName,
      account_number: p.accountNumber,
    },
  });
  if (res.error) {
    // Leave nothing half-made behind.
    if (createdRecord) await admin.from("investors").delete().eq("id", createdRecord);
    if (createdLogin && profileId) await admin.auth.admin.deleteUser(profileId);
    throw new Error(res.error.message);
  }
  return { id: res.data as string, createdLogin };
}
