import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { mudarabahDb } from "@/lib/mudarabah/db";
import {
  draftFromLedger,
  termsFromLedger,
  toCycleInput,
  type LedgerPayload,
} from "@/lib/mudarabah/editor";
import {
  settlementPayload,
  settlementPreview,
  type CapitalOverride,
  type Participant,
} from "@/lib/mudarabah/settlement";
import { buildSettlement, buildSettlementProducts } from "@/lib/mudarabah/figures";
import { compute, ENGINE_VERSION } from "@/lib/mudarabah/compute";

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

/**
 * Load the cycle and build the preview. One function, so the preview
 * an administrator approves and the figures the commit writes come
 * from the same call — there is no second derivation on the way in.
 */
async function build(cycleId: string, overrides: CapitalOverride[]) {
  const admin = mudarabahDb(await createAdminClient());
  const { data: raw } = await admin.rpc("mudarabah_get_ledger", {
    p_cycle_id: cycleId,
  });
  if (!raw) return null;

  const payload = raw as unknown as LedgerPayload;
  const terms = termsFromLedger(payload);
  const draft = draftFromLedger(payload);
  const input = toCycleInput(draft, terms);

  const participants: Participant[] = terms.holders.map((h) => ({
    investmentId: h.investmentId,
    investorId: h.investorId,
    investorName: h.investorName,
    investorCode: h.investorCode,
    units: h.units,
    decision: h.capitalAction,
    slotsWithdrawn: h.slotsWithdrawn,
    tin: h.investorTin,
  }));

  return {
    payload,
    input,
    draft,
    preview: settlementPreview(input, participants, overrides),
  };
}

// POST /api/admin/mudarabah/[id]/settle
//
//   action: "preview" — runs the engine and returns everything the
//                       commit would write. Changes nothing.
//   action: "commit"  — writes it, in one transaction, refusing if any
//                       assertion fails.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const g = await guard();
    if (g.error) return g.error;

    const { id } = await params;
    const body = (await request.json()) as {
      action?: string;
      overrides?: CapitalOverride[];
      acknowledged?: boolean;
    };

    const overrides = Array.isArray(body.overrides) ? body.overrides : [];
    const built = await build(id, overrides);
    if (!built) {
      return NextResponse.json({ error: "No such cycle" }, { status: 404 });
    }
    const { preview, input, draft } = built;

    if (body.action === "preview") {
      return NextResponse.json({ preview });
    }

    if (body.action !== "commit") {
      return NextResponse.json(
        { error: "action must be preview or commit" },
        { status: 400 }
      );
    }

    /* ── Everything below refuses rather than writes ───────────── */

    if (draft.status === "settled") {
      return NextResponse.json(
        { error: "This cycle is already settled. Reopen it first if it needs to change." },
        { status: 409 }
      );
    }

    // A failed assertion is a defect, not a decision. No acknowledgement
    // exists that can wave it through.
    if (preview.blocked) {
      return NextResponse.json(
        {
          error: "Settlement refused: an assertion failed. Nothing has been written.",
          assertions: preview.assertions.filter((a) => !a.passed),
        },
        { status: 422 }
      );
    }

    if (preview.needsAcknowledgement && !body.acknowledged) {
      return NextResponse.json(
        {
          error:
            "This settlement needs an explicit acknowledgement before it can be committed.",
          warnings: preview.warnings,
        },
        { status: 428 }
      );
    }

    if (preview.holders.length === 0) {
      return NextResponse.json(
        { error: "Nobody holds slots in this cycle, so there is nothing to settle." },
        { status: 422 }
      );
    }

    // The engine runs ONCE. The snapshot, the holder rows and the
    // write-through all read this same result.
    //
    // Only the `computed` half of buildSettlement is wanted — the
    // cycle-level snapshot, which depends on the engine result alone.
    // Its own holder split is the simpler per-slot one from step 2 and
    // is deliberately NOT used: the rows that get written come from the
    // preview, whose largest-remainder allocation is the one the
    // assertions were checked against. Passing no holdings makes that
    // explicit rather than computing a second answer and dropping it.
    const cycle = compute(input);
    const { computed } = buildSettlement(id, cycle, [], new Date().toISOString());

    const supabase = mudarabahDb(g.supabase);
    const { data: settlementId, error } = await supabase.rpc("mudarabah_settle_cycle", {
      p_cycle_id: id,
      p_engine_version: ENGINE_VERSION,
      p_computed: computed,
      p_holders: settlementPayload(preview),
      p_products: buildSettlementProducts(cycle),
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      settlementId,
      engineVersion: ENGINE_VERSION,
      holders: preview.holders.length,
      cashNeeded: preview.totals.cashNeeded,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not settle the cycle" },
      { status: 500 }
    );
  }
}
