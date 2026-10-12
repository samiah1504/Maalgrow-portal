/**
 * Cycle workflow: submit, approve or return terms; activation checks;
 * activation.
 *
 * Approval is the database's decision as well as ours: it refuses an
 * approver who prepared or submitted the terms (D5). Activation is for
 * the approver roles only, and the database refuses it unless every
 * activation check passes.
 */
import { NextResponse } from "next/server";
import {
  MAALRISE_APPROVE_ROLES,
  MAALRISE_PREPARE_ROLES,
} from "@/lib/maalrise/permissions";
import { dbError, isUuid, maalriseGate, readJson } from "@/lib/maalrise/api";

type Body = { action?: string; terms_id?: string; reason?: string };

const ROLES: Record<string, readonly string[]> = {
  submit: MAALRISE_PREPARE_ROLES,
  approve: MAALRISE_APPROVE_ROLES,
  return: MAALRISE_APPROVE_ROLES,
  check: [...MAALRISE_PREPARE_ROLES, "finance", "customer_support"],
  activate: MAALRISE_APPROVE_ROLES,
};

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await readJson<Body>(request);
  const action = body?.action ?? "";
  if (!ROLES[action]) return NextResponse.json({ error: "Unknown action." }, { status: 400 });
  if (!isUuid(id)) return NextResponse.json({ error: "Unknown Cycle." }, { status: 404 });

  const gate = await maalriseGate(ROLES[action]);
  if (!gate.ok) return gate.response;

  if (action === "submit" || action === "approve" || action === "return") {
    if (!isUuid(body?.terms_id)) return NextResponse.json({ error: "Which terms?" }, { status: 400 });
    // The terms must belong to this Cycle.
    const { data: t } = await gate.db.from("maalrise_cycle_terms").select("cycle_id").eq("id", body!.terms_id).maybeSingle();
    if (!t || t.cycle_id !== id) return NextResponse.json({ error: "Those terms are not this Cycle's." }, { status: 400 });

    const res =
      action === "submit"
        ? await gate.db.rpc("maalrise_submit_terms", { p_terms: body!.terms_id })
        : action === "approve"
          ? await gate.db.rpc("maalrise_approve_terms", { p_terms: body!.terms_id })
          : await gate.db.rpc("maalrise_return_terms", { p_terms: body!.terms_id, p_reason: body?.reason ?? "" });
    if (res.error) return dbError(res.error);
    return NextResponse.json({ ok: true });
  }

  if (action === "check") {
    const res = await gate.db.rpc("maalrise_activation_checks", { p_cycle: id });
    if (res.error) return dbError(res.error);
    return NextResponse.json(res.data);
  }

  // activate — maalrise_activate_cycle re-runs every check and refuses if any fails
  const res = await gate.db.rpc("maalrise_activate_cycle", { p_cycle: id });
  if (res.error) return dbError(res.error);
  return NextResponse.json(res.data);
}
