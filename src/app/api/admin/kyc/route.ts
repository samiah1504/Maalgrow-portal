import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// POST /api/admin/kyc
//   action: "bulk_approve" — server-side transactional bulk approval
//     via the bulk_approve_kyc DB function (revalidates every record,
//     approves only eligible ones, audit-logs each approval plus one
//     campaign-level event, returns a partial-success summary).
//   action: "log_export" — records a bulk-export audit event.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as {
      action?: string;
      investor_ids?: string[];
      scope?: string;
      count?: number;
    };

    if (body.action === "bulk_approve") {
      if (!Array.isArray(body.investor_ids) || body.investor_ids.length === 0) {
        return NextResponse.json(
          { error: "Select at least one investor" },
          { status: 400 }
        );
      }
      // The function itself enforces the admin role via auth.uid()
      const { data, error } = await supabase.rpc("bulk_approve_kyc", {
        p_investor_ids: body.investor_ids,
      });
      if (error) {
        return NextResponse.json(
          { error: error.message },
          { status: error.code === "P0001" ? 400 : 500 }
        );
      }
      return NextResponse.json({ result: data });
    }

    if (body.action === "log_export") {
      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", user.id)
        .single();
      if (!profile || !["super_admin", "administrator"].includes(profile.role ?? "")) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      await supabase.rpc("create_audit_log", {
        p_action: "kyc_export",
        p_entity_type: "investor",
        p_entity_id: null,
        p_old_values: null,
        p_new_values: {
          scope: body.scope ?? "unknown",
          rows: body.count ?? 0,
        },
      });
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "action must be bulk_approve or log_export" },
      { status: 400 }
    );
  } catch (err) {
    console.error("[API] POST /admin/kyc error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
