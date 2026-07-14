import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";

// Called by a cron job (e.g., daily at midnight)
// Can also be called manually from admin portal
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");

  // Vercel sets this automatically on cron invocations
  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    process.env.NODE_ENV !== "development"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = await createAdminClient();

    const { data, error } = await supabase.rpc("process_matured_investments");

    if (error) {
      console.error("Maturity processing error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      processed: data,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("Cron error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  return GET(request);
}
