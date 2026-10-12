/**
 * What adding this email to MaalRise would do — read only.
 *
 * Reads through the staff member's own session (staff can read
 * profiles and MaalGrow investors under the existing policies), so it
 * shows nothing that staff could not already see in MaalGrow.
 */
import { NextResponse } from "next/server";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, findLoginByEmail, maalriseGate } from "@/lib/maalrise/api";

export async function GET(request: Request) {
  const gate = await maalriseGate(MAALRISE_PREPARE_ROLES);
  if (!gate.ok) return gate.response;
  const email = new URL(request.url).searchParams.get("email")?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });

  const { data: profile, error } = await findLoginByEmail<{ email: string | null; id: string; full_name: string | null; role: string }>(gate.db, email, "id, full_name, role");
  if (error) return dbError(error);
  if (!profile) return NextResponse.json({ status: "no_login" });
  if (profile.role !== "investor") return NextResponse.json({ status: "staff" });

  const [{ data: existing }, { data: mg }] = await Promise.all([
    gate.db.from("maalrise_investors").select("id").eq("profile_id", profile.id).maybeSingle(),
    gate.db.from("investors").select("full_name, kyc_status, bank_name, account_name, account_number").eq("profile_id", profile.id).maybeSingle(),
  ]);
  if (existing) return NextResponse.json({ status: "already_maalrise", investor_id: existing.id });

  return NextResponse.json({
    status: "can_add",
    name: mg?.full_name || profile.full_name || "",
    maalgrow: mg
      ? {
          kyc_approved: mg.kyc_status === "approved",
          bank_name: mg.bank_name,
          account_name: mg.account_name,
          account_number: mg.account_number,
        }
      : null,
  });
}
