/**
 * Investor actions: bank details and KYC. Prepare roles.
 *
 *   set_bank      — replaces the bank details and CLEARS any confirmation
 *   confirm_bank  — an admin confirms the current details
 *   record_kyc    — records a KYC submission made on the investor's behalf
 *   review_kyc    — verifies or rejects the latest submission
 *
 * Bank details alone never count as KYC: verifying needs a submission.
 */
import { NextResponse } from "next/server";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

type Body = {
  action?: string;
  bank_name?: string;
  account_name?: string;
  account_number?: string;
  details?: Record<string, unknown>;
  decision?: string;
  notes?: string;
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const gate = await maalriseGate(MAALRISE_PREPARE_ROLES);
  if (!gate.ok) return gate.response;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown investor." }, { status: 404 });
  const b = await readJson<Body>(request);

  let res;
  switch (b?.action) {
    case "set_bank":
      if (!b.bank_name?.trim() || !b.account_name?.trim() || !/^\d{10}$/.test(b.account_number ?? "")) {
        return NextResponse.json({ error: "Bank name, account name and a 10-digit account number are required." }, { status: 400 });
      }
      res = await gate.db.rpc("maalrise_set_bank_details", {
        p_investor: id, p_bank: b.bank_name, p_account_name: b.account_name, p_account_number: b.account_number,
      });
      break;
    case "confirm_bank":
      res = await gate.db.rpc("maalrise_confirm_bank_details", { p_investor: id });
      break;
    case "record_kyc": {
      const d = b.details ?? {};
      const required = ["id_type", "id_number", "date_of_birth", "address"];
      const missing = required.filter((k) => typeof d[k] !== "string" || !(d[k] as string).trim());
      if (missing.length) return NextResponse.json({ error: `Missing KYC details: ${missing.join(", ")}.` }, { status: 400 });
      res = await gate.db.rpc("maalrise_record_kyc_submission", { p_investor: id, p_details: d });
      break;
    }
    case "review_kyc":
      if (b.decision !== "verified" && b.decision !== "rejected") {
        return NextResponse.json({ error: "Decision must be verified or rejected." }, { status: 400 });
      }
      res = await gate.db.rpc("maalrise_review_kyc", { p_investor: id, p_decision: b.decision, p_notes: b.notes ?? "" });
      break;
    default:
      return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  }
  if (res.error) return dbError(res.error);
  return NextResponse.json({ ok: true });
}
