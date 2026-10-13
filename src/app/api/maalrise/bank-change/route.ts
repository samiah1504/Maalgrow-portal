/**
 * An investor asks to change the bank account their MaalRise payments
 * go to. Staff review it; until it is approved, payments keep going to
 * the confirmed account. maalrise_request_bank_change() works out who
 * the investor is from the session — no investor id is accepted.
 */
import { NextResponse } from "next/server";
import { dbError, maalriseGate, readJson } from "@/lib/maalrise/api";

type Body = { bank_name?: string; account_name?: string; account_number?: string };

export async function POST(request: Request) {
  const gate = await maalriseGate(["investor"]);
  if (!gate.ok) return gate.response;
  const b = await readJson<Body>(request);
  const bank = b?.bank_name?.trim() ?? "";
  const name = b?.account_name?.trim() ?? "";
  const number = b?.account_number?.trim() ?? "";
  if (!bank || !name || !/^\d{10}$/.test(number)) {
    return NextResponse.json({ error: "Bank name, account name and a 10-digit account number are all required." }, { status: 400 });
  }
  const res = await gate.db.rpc("maalrise_request_bank_change", {
    p: { bank_name: bank, account_name: name, account_number: number },
  });
  if (res.error) return dbError(res.error);
  return NextResponse.json({ id: res.data }, { status: 201 });
}
