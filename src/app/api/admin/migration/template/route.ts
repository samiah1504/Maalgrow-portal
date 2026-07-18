import { NextResponse } from "next/server";
import { buildTemplateCsv } from "@/lib/migration-parse";
import { requireSuperAdmin } from "@/lib/migration-server";

export async function GET() {
  const auth = await requireSuperAdmin();
  if (!auth.ok) return auth.response;

  return new NextResponse(buildTemplateCsv(), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="maalgrow-migration-template.csv"',
    },
  });
}
