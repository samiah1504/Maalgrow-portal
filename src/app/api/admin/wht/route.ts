import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";
import { generateCreditNotes } from "@/lib/mudarabah/statements";

const ADMIN_ROLES = ["super_admin", "administrator"];

async function guard() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { supabase };
}

// GET /api/admin/wht                    — every settled cycle with tax withheld
// GET /api/admin/wht?remittanceId=…     — what issuing that filing would do
export async function GET(request: Request) {
  const g = await guard();
  if (g.error) return g.error;

  const db = mudarabahDb(g.supabase);
  const remittanceId = new URL(request.url).searchParams.get("remittanceId");

  if (remittanceId) {
    const { data, error } = await db.rpc("mudarabah_issuance_preview", {
      p_remittance_id: remittanceId,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    const { data: rem } = await db
      .from("wht_remittances")
      .select("id, reference, remitted_on, amount, authority")
      .eq("id", remittanceId)
      .maybeSingle();

    const rows = (data ?? []) as unknown as { wht_amount: number; already_issued: boolean }[];
    const totalWithheld = rows.reduce((t, r) => t + Number(r.wht_amount), 0);

    return NextResponse.json({
      remittance: rem,
      rows: data ?? [],
      totalWithheld,
      // Warned about, never blocked: there can be a legitimate reason
      // for the filing and the withheld total to differ.
      matches: rem ? Number(rem.amount) === totalWithheld : false,
      difference: rem ? Number(rem.amount) - totalWithheld : 0,
    });
  }

  const [{ data: cycles, error }, { data: remittances }] = await Promise.all([
    db.rpc("mudarabah_wht_overview"),
    db
      .from("wht_remittances")
      .select("id, reference, remitted_on, amount, authority")
      .order("remitted_on", { ascending: false }),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ cycles: cycles ?? [], remittances: remittances ?? [] });
}

// POST /api/admin/wht
//
//   action: "record"  — a filing that has actually happened
//   action: "issue"   — notes against that filing, all or one investor
//
// Recording a filing issues nothing. Issuing is a separate, deliberate
// act, because a credit note asserts that money reached the tax
// authority and that must never be a side effect.
export async function POST(request: Request) {
  try {
    const g = await guard();
    if (g.error) return g.error;

    const db = mudarabahDb(g.supabase);
    const body = (await request.json()) as {
      action?: string;
      reference?: string;
      remittedOn?: string;
      amount?: number;
      authority?: string;
      notes?: string;
      cycleIds?: string[];
      remittanceId?: string;
      cycleId?: string;
      investmentId?: string;
      acknowledged?: boolean;
    };

    if (body.action === "record") {
      const { data, error } = await db.rpc("mudarabah_create_remittance", {
        p_reference: String(body.reference ?? ""),
        p_remitted_on: String(body.remittedOn ?? ""),
        p_amount: Number(body.amount ?? 0),
        p_cycle_ids: body.cycleIds ?? [],
        p_authority: body.authority ?? null,
        p_notes: body.notes ?? null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });
      return NextResponse.json({ ok: true, remittanceId: data });
    }

    if (body.action === "issue") {
      if (!body.remittanceId) {
        return NextResponse.json(
          { error: "Credit notes are issued against a recorded filing." },
          { status: 400 }
        );
      }

      // A mismatch between what was withheld and what was filed warns
      // and requires an acknowledgement, but does not block: there can
      // be a legitimate reason, and it is not this code's judgement.
      const { data: preview } = await db.rpc("mudarabah_issuance_preview", {
        p_remittance_id: body.remittanceId,
      });
      const { data: rem } = await db
        .from("wht_remittances")
        .select("amount")
        .eq("id", body.remittanceId)
        .maybeSingle();
      const totalWithheld = ((preview ?? []) as unknown as { wht_amount: number }[]).reduce(
        (t, r) => t + Number(r.wht_amount),
        0
      );
      const mismatch = rem ? Number(rem.amount) !== totalWithheld : false;

      if (mismatch && !body.acknowledged) {
        return NextResponse.json(
          {
            error:
              "The total withheld does not match the amount filed. Confirm you want to issue anyway.",
            totalWithheld,
            remitted: rem ? Number(rem.amount) : null,
            difference: rem ? Number(rem.amount) - totalWithheld : 0,
          },
          { status: 428 }
        );
      }

      const { data, error } = await db.rpc("mudarabah_issue_credit_notes", {
        p_remittance_id: body.remittanceId,
        p_cycle_id: body.cycleId ?? null,
        p_investment_id: body.investmentId ?? null,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 400 });

      // The documents, after the notes exist. A failure here leaves the
      // notes issued and their references allocated — only the PDF is
      // missing, and it can be rebuilt.
      const issued = data as unknown as { issued: number };
      let documents: unknown = null;
      let documentError: string | null = null;
      if (Number(issued?.issued ?? 0) > 0) {
        try {
          const admin = await createAdminClient();
          const cycleIds: string[] = body.cycleId
            ? [body.cycleId]
            : [
                ...new Set(
                  ((preview ?? []) as unknown as { cycle_id: string }[]).map((r) => r.cycle_id)
                ),
              ];
          const results = [];
          for (const cid of cycleIds) results.push(await generateCreditNotes(admin, cid));
          documents = results;
        } catch (e) {
          documentError = e instanceof Error ? e.message : String(e);
        }
      }

      return NextResponse.json({ ok: true, ...issued, documents, documentError });
    }

    return NextResponse.json({ error: "action must be record or issue" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not complete the action" },
      { status: 500 }
    );
  }
}
