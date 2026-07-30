import { NextResponse } from "next/server";
import { storedAddressMissing } from "@/lib/residential-address";
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
import { generateStatements } from "@/lib/mudarabah/statements";

/**
 * Settling commits the money and then builds a few documents. The
 * default timeout is measured in seconds and a browser launch alone
 * can exceed it — a killed request here reads as a failed settlement
 * even though the money was already written.
 */
export const maxDuration = 120;

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

  const preview = settlementPreview(input, participants, overrides);

  /*
   * WARNED, NOT REFUSED — migration 042.
   *
   * Settling is the money event, and every investor on the books has
   * only the old single-field address. Refusing to settle until all
   * of them have updated would hold a quarter's payouts for a
   * data-entry exercise, which is the wrong trade by a distance.
   *
   * But it cannot be silent either: an incomplete address is what
   * will stop that investor's withholding tax credit note later, and
   * the moment to find that out is now, not at filing time. So it
   * warns and requires the same acknowledgement any other warning
   * does — impossible to miss, impossible to be blocked by.
   */
  const holderIds = [...new Set(terms.holders.map((h) => h.investorId))];
  if (holderIds.length > 0) {
    const { data: addressRows } = await (await createAdminClient())
      .from("investors")
      .select(
        "id, full_name, residential_street_address, residential_state_code, residential_state_name, residential_lga_code, residential_lga_name, residential_city"
      )
      .in("id", holderIds);

    const incomplete = (addressRows ?? [])
      .filter((r) => storedAddressMissing(r).length > 0)
      .map((r) => String(r.full_name));

    if (incomplete.length > 0) {
      preview.warnings = [
        ...preview.warnings,
        {
          kind: "address",
          message: `${incomplete.length} investor(s) have no complete residential address. Settlement is not affected, but a withholding tax credit note cannot be issued for them until it is filled in.`,
          investors: incomplete,
        },
      ];
      preview.needsAcknowledgement = true;
    }
  }

  return { payload, input, draft, preview };
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

    /* ── The documents, AFTER the money ────────────────────────── */
    //
    // Settlement has committed. Nothing below can undo it: if Chromium
    // times out or storage refuses the upload, the cycle is still
    // settled, the failure is recorded per document, and an
    // administrator can retry from the ledger. An investor briefly
    // sees that their statement is being prepared rather than a
    // settlement that never happened.
    let documents: { queued: number; generated: number; failed: number } | null = null;
    let documentError: string | null = null;
    try {
      await supabase.rpc("mudarabah_queue_statements", {
        p_settlement_id: settlementId as unknown as string,
      });
      const admin = await createAdminClient();
      // A FEW, NOT ALL. Every document is a full Chrome page render;
      // thirty-eight of them here would run for minutes and the
      // platform would kill this request — leaving the administrator
      // staring at a failed call for a settlement that had already
      // committed. The statements panel finishes the rest, in
      // batches, at a moment nobody is waiting on.
      const gen = await generateStatements(admin, id, { limit: 3 });
      documents = {
        queued: gen.outstanding ?? gen.total,
        generated: gen.generated,
        failed: gen.failed,
      };
    } catch (e) {
      documentError = e instanceof Error ? e.message : String(e);
    }

    return NextResponse.json({
      ok: true,
      settlementId,
      engineVersion: ENGINE_VERSION,
      holders: preview.holders.length,
      cashNeeded: preview.totals.cashNeeded,
      documents,
      documentError,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not settle the cycle" },
      { status: 500 }
    );
  }
}
