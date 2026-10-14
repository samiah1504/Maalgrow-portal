/** The monthly payments register as CSV (?month=YYYY-MM). Staff. */
import { NextResponse } from "next/server";
import { maalriseGate } from "@/lib/maalrise/api";
import { loadRegister } from "@/lib/maalrise/db";
import { monthRange, registerCsv, registerRows } from "@/lib/maalrise/reports";

const STAFF = ["super_admin", "administrator", "operations", "finance", "customer_support"];

export async function GET(request: Request) {
  const gate = await maalriseGate(STAFF);
  if (!gate.ok) return gate.response;
  const month = new URL(request.url).searchParams.get("month") ?? "";
  const range = monthRange(month);
  if (!range) return NextResponse.json({ error: "Choose a month (YYYY-MM)." }, { status: 400 });
  const { profit, capital, names } = await loadRegister(gate.db, range.from, range.to);
  return new NextResponse(registerCsv(registerRows(profit, capital, names)), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="maalrise-payments-${month}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
