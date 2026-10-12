/**
 * MaalRise reads. Server only.
 *
 * Every read goes through the SIGNED-IN USER'S session client, never
 * the service role, so row level security from migration 051 still
 * applies: staff (is_admin()) see MaalRise records, a Payment Officer
 * or investor reaching one of these pages by mistake reads nothing.
 *
 * Writes are not here. They go through the SECURITY DEFINER functions
 * (maalrise_save_terms, maalrise_approve_terms, …) from the API routes,
 * which is the only way the database accepts them.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AllocationRow,
  AuditRow,
  BankHistoryRow,
  Counterparty,
  CycleRow,
  DocumentRow,
  FundingRow,
  InvestorRow,
  KycSubmissionRow,
  ScheduleLineRow,
  TermsRow,
} from "./types";

/**
 * The generated Database type does not know the MaalRise tables (it
 * is MaalGrow's and is not edited for this), so MaalRise reads use an
 * untyped view of the same client and type each result explicitly.
 */
export function mr(client: unknown): SupabaseClient {
  return client as SupabaseClient;
}

function must<T>(res: { data: T | null; error: { message: string } | null }, what: string): T {
  if (res.error) throw new Error(`Could not load ${what}: ${res.error.message}`);
  return (res.data ?? ([] as unknown)) as T;
}

export async function peopleNames(db: SupabaseClient, ids: (string | null | undefined)[]) {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (unique.length === 0) return {} as Record<string, string>;
  const rows = must<{ id: string; full_name: string | null; email: string }[]>(
    await db.from("profiles").select("id, full_name, email").in("id", unique),
    "staff names"
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.full_name?.trim() || r.email]));
}

export async function listCounterparties(db: SupabaseClient) {
  return must<Counterparty[]>(
    await db.from("maalrise_counterparties").select("id, name, registration_no, contact_email, contact_phone").order("name"),
    "counterparties"
  );
}

export type CycleListItem = CycleRow & {
  counterparty_name: string;
  terms: Pick<TermsRow, "id" | "status" | "version" | "cost_kobo" | "sale_price_kobo"> | null;
  units_funded: number;
  capital_kobo: number;
};

export async function listCycles(db: SupabaseClient): Promise<CycleListItem[]> {
  const [cycles, cps, terms, allocs] = await Promise.all([
    db.from("maalrise_cycles").select("*").order("created_at", { ascending: false }),
    db.from("maalrise_counterparties").select("id, name"),
    db.from("maalrise_cycle_terms").select("id, cycle_id, status, version, cost_kobo, sale_price_kobo").neq("status", "superseded"),
    db.from("maalrise_allocations").select("cycle_id, units, capital_kobo"),
  ]);
  const c = must<CycleRow[]>(cycles, "Cycles");
  const cpName = Object.fromEntries(must<{ id: string; name: string }[]>(cps, "counterparties").map((x) => [x.id, x.name]));
  const t = must<(Pick<TermsRow, "id" | "status" | "version" | "cost_kobo" | "sale_price_kobo"> & { cycle_id: string })[]>(terms, "terms");
  const a = must<Pick<AllocationRow, "cycle_id" | "units" | "capital_kobo">[]>(allocs, "allocations");

  return c.map((cycle) => {
    // The approved version if there is one, otherwise the latest open draft.
    const forCycle = t.filter((x) => x.cycle_id === cycle.id).sort((x, y) => y.version - x.version);
    const shown = forCycle.find((x) => x.id === cycle.approved_terms_id) ?? forCycle[0] ?? null;
    const holdings = a.filter((x) => x.cycle_id === cycle.id);
    return {
      ...cycle,
      counterparty_name: cpName[cycle.counterparty_id] ?? "—",
      terms: shown,
      units_funded: holdings.reduce((s, h) => s + h.units, 0),
      capital_kobo: holdings.reduce((s, h) => s + h.capital_kobo, 0),
    };
  });
}

export type CycleDetail = {
  cycle: CycleRow;
  counterparty: Counterparty | null;
  versions: TermsRow[];
  approved: TermsRow | null;
  open: TermsRow | null;
  schedules: Record<string, ScheduleLineRow[]>;
  allocations: (AllocationRow & { investor: InvestorRow | null })[];
  fundings: (FundingRow & { investor: InvestorRow | null })[];
  documents: DocumentRow[];
  activity: AuditRow[];
  names: Record<string, string>;
};

export async function getCycleDetail(db: SupabaseClient, id: string): Promise<CycleDetail | null> {
  const cycleRes = await db.from("maalrise_cycles").select("*").eq("id", id).maybeSingle();
  if (cycleRes.error) throw new Error(`Could not load the Cycle: ${cycleRes.error.message}`);
  const cycle = cycleRes.data as CycleRow | null;
  if (!cycle) return null;

  const [cp, terms, allocs, funds, docs] = await Promise.all([
    db.from("maalrise_counterparties").select("id, name, registration_no, contact_email, contact_phone").eq("id", cycle.counterparty_id).maybeSingle(),
    db.from("maalrise_cycle_terms").select("*").eq("cycle_id", id).order("version", { ascending: false }),
    db.from("maalrise_allocations").select("*").eq("cycle_id", id),
    db.from("maalrise_investor_fundings").select("*").eq("cycle_id", id).order("created_at", { ascending: false }),
    db.from("maalrise_documents").select("id, cycle_id, maalrise_investor_id, category, name, visible_to_investors, created_at").eq("cycle_id", id),
  ]);
  const versions = must<TermsRow[]>(terms, "terms");
  const approved = versions.find((v) => v.id === cycle.approved_terms_id) ?? null;
  const open = versions.find((v) => v.status === "draft" || v.status === "submitted") ?? null;

  const termIds = versions.map((v) => v.id);
  const lines = termIds.length
    ? must<ScheduleLineRow[]>(
        await db.from("maalrise_schedule_lines").select("*").in("terms_id", termIds).order("period"),
        "schedule"
      )
    : [];
  const schedules: Record<string, ScheduleLineRow[]> = {};
  for (const l of lines) (schedules[l.terms_id] ??= []).push(l);

  const allocations = must<AllocationRow[]>(allocs, "allocations");
  const fundings = must<FundingRow[]>(funds, "funding");
  const investorIds = [...new Set([...allocations, ...fundings].map((x) => x.maalrise_investor_id))];
  const investors = investorIds.length
    ? must<InvestorRow[]>(await db.from("maalrise_investors").select("*").in("id", investorIds), "investors")
    : [];
  const inv = Object.fromEntries(investors.map((i) => [i.id, i]));

  const entityIds = [id, ...termIds, ...fundings.map((f) => f.id)];
  const activity = must<AuditRow[]>(
    await db
      .from("audit_logs")
      .select("id, user_id, action, entity_type, entity_id, new_values, created_at")
      .like("action", "maalrise_%")
      .in("entity_id", entityIds)
      .order("created_at", { ascending: false })
      .limit(100),
    "activity"
  );

  const names = await peopleNames(db, [
    ...versions.flatMap((v) => [v.prepared_by, v.submitted_by, v.approved_by, v.returned_by]),
    ...fundings.flatMap((f) => [f.recorded_by, f.confirmed_by, f.rejected_by]),
    ...activity.map((a) => a.user_id),
    cycle.activated_by,
    cycle.created_by,
  ]);

  return {
    cycle,
    counterparty: (cp.data as Counterparty | null) ?? null,
    versions,
    approved,
    open,
    schedules,
    allocations: allocations.map((a) => ({ ...a, investor: inv[a.maalrise_investor_id] ?? null })),
    fundings: fundings.map((f) => ({ ...f, investor: inv[f.maalrise_investor_id] ?? null })),
    documents: must<DocumentRow[]>(docs, "documents"),
    activity,
    names,
  };
}

export type InvestorListItem = InvestorRow & { cycles: number; has_maalgrow: boolean };

export async function listInvestors(db: SupabaseClient): Promise<InvestorListItem[]> {
  const [invs, allocs] = await Promise.all([
    db.from("maalrise_investors").select("*").order("created_at", { ascending: false }),
    db.from("maalrise_allocations").select("maalrise_investor_id"),
  ]);
  const a = must<{ maalrise_investor_id: string }[]>(allocs, "allocations");
  return must<InvestorRow[]>(invs, "investors").map((i) => ({
    ...i,
    cycles: a.filter((x) => x.maalrise_investor_id === i.id).length,
    has_maalgrow: !!i.maalgrow_investor_id,
  }));
}

export type InvestorDetail = {
  investor: InvestorRow;
  kyc: KycSubmissionRow[];
  bankHistory: BankHistoryRow[];
  allocations: (AllocationRow & { cycle: Pick<CycleRow, "id" | "name" | "status" | "start_date" | "duration_months"> | null })[];
  fundings: FundingRow[];
  activity: AuditRow[];
  names: Record<string, string>;
};

export async function getInvestorDetail(db: SupabaseClient, id: string): Promise<InvestorDetail | null> {
  const res = await db.from("maalrise_investors").select("*").eq("id", id).maybeSingle();
  if (res.error) throw new Error(`Could not load the investor: ${res.error.message}`);
  const investor = res.data as InvestorRow | null;
  if (!investor) return null;

  const [kyc, bank, allocs, funds, activity] = await Promise.all([
    db.from("maalrise_kyc_submissions").select("*").eq("maalrise_investor_id", id).order("submitted_at", { ascending: false }),
    db.from("maalrise_bank_details_history").select("*").eq("maalrise_investor_id", id).order("created_at", { ascending: false }),
    db.from("maalrise_allocations").select("*").eq("maalrise_investor_id", id),
    db.from("maalrise_investor_fundings").select("*").eq("maalrise_investor_id", id).order("created_at", { ascending: false }),
    db.from("audit_logs").select("id, user_id, action, entity_type, entity_id, new_values, created_at")
      .like("action", "maalrise_%").eq("entity_id", id).order("created_at", { ascending: false }).limit(50),
  ]);
  const allocations = must<AllocationRow[]>(allocs, "allocations");
  const cycleIds = allocations.map((a) => a.cycle_id);
  const cycles = cycleIds.length
    ? must<Pick<CycleRow, "id" | "name" | "status" | "start_date" | "duration_months">[]>(
        await db.from("maalrise_cycles").select("id, name, status, start_date, duration_months").in("id", cycleIds),
        "Cycles"
      )
    : [];
  const cyc = Object.fromEntries(cycles.map((c) => [c.id, c]));
  const kycRows = must<KycSubmissionRow[]>(kyc, "KYC");
  const bankRows = must<BankHistoryRow[]>(bank, "bank history");
  const activityRows = must<AuditRow[]>(activity, "activity");

  return {
    investor,
    kyc: kycRows,
    bankHistory: bankRows,
    allocations: allocations.map((a) => ({ ...a, cycle: cyc[a.cycle_id] ?? null })),
    fundings: must<FundingRow[]>(funds, "funding"),
    activity: activityRows,
    names: await peopleNames(db, [
      investor.kyc_reviewed_by,
      investor.bank_confirmed_by,
      ...kycRows.map((k) => k.reviewed_by),
      ...bankRows.map((b) => b.actor),
      ...activityRows.map((a) => a.user_id),
    ]),
  };
}

export async function dashboardFigures(db: SupabaseClient) {
  const [invs, cycles, allocs] = await Promise.all([
    db.from("maalrise_investors").select("id", { count: "exact", head: true }),
    db.from("maalrise_cycles").select("id, name, status, start_date, duration_months, approved_terms_id"),
    db.from("maalrise_allocations").select("cycle_id, capital_kobo"),
  ]);
  if (invs.error) throw new Error(`Could not load investors: ${invs.error.message}`);
  const c = must<Pick<CycleRow, "id" | "name" | "status" | "start_date" | "duration_months" | "approved_terms_id">[]>(cycles, "Cycles");
  const a = must<Pick<AllocationRow, "cycle_id" | "capital_kobo">[]>(allocs, "allocations");
  const active = c.filter((x) => x.status === "active");
  const termIds = active.map((x) => x.approved_terms_id).filter((x): x is string => !!x);
  const lines = termIds.length
    ? must<ScheduleLineRow[]>(await db.from("maalrise_schedule_lines").select("*").in("terms_id", termIds).order("due_date"), "schedule")
    : [];
  return {
    investorCount: invs.count ?? 0,
    cycleCount: c.length,
    activeCycles: active,
    awaitingApproval: c.filter((x) => x.status === "terms_submitted").length,
    allocatedCapitalKobo: a.reduce((s, x) => s + x.capital_kobo, 0),
    activeCapital: active.map((cy) => ({
      cycle: cy,
      capitalKobo: a.filter((x) => x.cycle_id === cy.id).reduce((s, x) => s + x.capital_kobo, 0),
    })),
    scheduleLines: lines,
  };
}
