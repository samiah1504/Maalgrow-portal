/**
 * Give an existing login MaalRise access. Prepare roles.
 *
 * Only people who ALREADY have a login (for example MaalGrow
 * investors) can be added in this phase. Creating a new login means
 * sending an invitation, which needs the business's approval and is
 * not built yet — so an unknown email is refused, and nothing is sent.
 *
 * maalrise_add_investor() refuses staff accounts, reuses verified
 * MaalGrow KYC and pre-fills MaalGrow bank details UNCONFIRMED.
 */
import { NextResponse } from "next/server";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, findLoginByEmail, maalriseGate, readJson } from "@/lib/maalrise/api";

type Body = { email?: string; full_name?: string; phone?: string; bank_name?: string; account_name?: string; account_number?: string };

export async function POST(request: Request) {
  const gate = await maalriseGate(MAALRISE_PREPARE_ROLES);
  if (!gate.ok) return gate.response;
  const b = await readJson<Body>(request);
  const email = b?.email?.trim().toLowerCase() ?? "";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return NextResponse.json({ error: "Enter a valid email." }, { status: 400 });
  const anyBank = !!(b?.bank_name || b?.account_name || b?.account_number);
  if (anyBank && (!b?.bank_name?.trim() || !b?.account_name?.trim() || !/^\d{10}$/.test(b?.account_number ?? ""))) {
    return NextResponse.json({ error: "Bank name, account name and a 10-digit account number are all required." }, { status: 400 });
  }

  const { data: profile, error } = await findLoginByEmail<{ email: string | null; id: string }>(gate.db, email, "id");
  if (error) return dbError(error);
  if (!profile) {
    return NextResponse.json(
      {
        error:
          "No login exists for this email. Creating new logins and sending invitations is not enabled yet; only people who already have a MaalVest login can be added.",
        code: "NO_LOGIN",
      },
      { status: 409 }
    );
  }

  const res = await gate.db.rpc("maalrise_add_investor", {
    p_profile: profile.id,
    p: {
      full_name: b?.full_name ?? "",
      phone: b?.phone ?? "",
      bank_name: b?.bank_name ?? "",
      account_name: b?.account_name ?? "",
      account_number: b?.account_number ?? "",
    },
  });
  if (res.error) return dbError(res.error);
  return NextResponse.json({ id: res.data }, { status: 201 });
}
