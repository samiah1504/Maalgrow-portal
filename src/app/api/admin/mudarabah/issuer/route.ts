import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";

const ADMIN_ROLES = ["super_admin", "administrator"];

// POST /api/admin/mudarabah/issuer
//
// The company details printed on every withholding tax credit note.
// Editable here rather than by hand in SQL, because they are ordinary
// business details that change — an address, a signatory — and a tax
// document carrying the wrong ones is worse than useless.
export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();
    if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as {
      companyName?: string;
      companyAddress?: string;
      companyTin?: string;
      signatoryName?: string;
      signatoryTitle?: string;
    };

    if (!String(body.companyName ?? "").trim()) {
      return NextResponse.json(
        { error: "The company name appears on every credit note — it cannot be blank." },
        { status: 400 }
      );
    }

    const { error } = await mudarabahDb(supabase).rpc(
      "mudarabah_update_issuer_settings",
      {
        p_company_name: String(body.companyName).trim(),
        p_company_address: body.companyAddress?.trim() || null,
        p_company_tin: body.companyTin?.trim() || null,
        p_signatory_name: body.signatoryName?.trim() || null,
        p_signatory_title: body.signatoryTitle?.trim() || null,
      }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not save the issuer details" },
      { status: 500 }
    );
  }
}
