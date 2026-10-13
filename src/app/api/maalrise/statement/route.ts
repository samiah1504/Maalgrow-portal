/**
 * The investor's MaalRise statement as CSV: every payment marked paid,
 * with the account shown by its last four digits only.
 */
import { NextResponse } from "next/server";
import { dbError, maalriseGate } from "@/lib/maalrise/api";
import { lagosToday } from "@/lib/maalrise/receipts";
import { statementCsv, type MyPayment } from "@/lib/maalrise/portal";

export async function GET() {
  const gate = await maalriseGate(["investor"]);
  if (!gate.ok) return gate.response;
  const res = await gate.db.rpc("maalrise_my_payments");
  if (res.error) return dbError(res.error);
  return new NextResponse(statementCsv((res.data as MyPayment[] | null) ?? []), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="maalrise-statement-${lagosToday()}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
