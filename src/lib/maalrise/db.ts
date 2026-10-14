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
  CapitalPaymentRow,
  CapitalReceiptRow,
  CapitalSettlementRow,
  AuditRow,
  BankChangeRequestRow,
  BankHistoryRow,
  Counterparty,
  CycleRow,
  DistributionLineRow,
  DistributionRow,
  DocumentRow,
  FundingRow,
  InvestorRow,
  KycSubmissionRow,
  NotificationRow,
  OutboxRow,
  PaymentEventRow,
  ReceiptRow,
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
  receipts: ReceiptRow[];
  distributions: (DistributionRow & { lines: DistributionLineRow[] })[];
  paymentEvents: PaymentEventRow[];
  capitalReceipts: CapitalReceiptRow[];
  capitalSettlements: (CapitalSettlementRow & { payments: CapitalPaymentRow[] })[];
  activity: AuditRow[];
  names: Record<string, string>;
};

export async function getCycleDetail(db: SupabaseClient, id: string): Promise<CycleDetail | null> {
  const cycleRes = await db.from("maalrise_cycles").select("*").eq("id", id).maybeSingle();
  if (cycleRes.error) throw new Error(`Could not load the Cycle: ${cycleRes.error.message}`);
  const cycle = cycleRes.data as CycleRow | null;
  if (!cycle) return null;

  const [cp, terms, allocs, funds, docs, recs, dists, dlines, caps, csets, cpays] = await Promise.all([
    db.from("maalrise_counterparties").select("id, name, registration_no, contact_email, contact_phone").eq("id", cycle.counterparty_id).maybeSingle(),
    db.from("maalrise_cycle_terms").select("*").eq("cycle_id", id).order("version", { ascending: false }),
    db.from("maalrise_allocations").select("*").eq("cycle_id", id),
    db.from("maalrise_investor_fundings").select("*").eq("cycle_id", id).order("created_at", { ascending: false }),
    db.from("maalrise_documents").select("id, cycle_id, maalrise_investor_id, category, name, mime_type, size_bytes, visible_to_investors, created_at")
      .eq("cycle_id", id).order("created_at", { ascending: false }),
    db.from("maalrise_receipts").select("*").eq("cycle_id", id).order("recorded_at", { ascending: false }),
    db.from("maalrise_distributions").select("*").eq("cycle_id", id).order("period", { ascending: false }).order("sequence", { ascending: false }),
    db.from("maalrise_distribution_lines").select("*").eq("cycle_id", id).order("investor_name"),
    db.from("maalrise_capital_receipts").select("*").eq("cycle_id", id).order("recorded_at", { ascending: false }),
    db.from("maalrise_capital_settlements").select("*").eq("cycle_id", id).order("prepared_at", { ascending: false }),
    db.from("maalrise_capital_payments").select("*").eq("cycle_id", id).order("investor_name"),
  ]);
  const capitalReceipts = must<CapitalReceiptRow[]>(caps, "capital entries");
  const settlementRows = must<CapitalSettlementRow[]>(csets, "capital settlements");
  const capitalPayments = must<CapitalPaymentRow[]>(cpays, "capital payments");
  const receipts = must<ReceiptRow[]>(recs, "receipts");
  const distRows = must<DistributionRow[]>(dists, "distributions");
  const lineRows = must<DistributionLineRow[]>(dlines, "payment lines");
  const paymentEvents = lineRows.length
    ? must<PaymentEventRow[]>(
        await db.from("maalrise_payment_events").select("*").in("line_id", lineRows.map((l) => l.id)).order("created_at"),
        "payment history"
      )
    : [];
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

  const entityIds = [id, ...termIds, ...fundings.map((f) => f.id), ...receipts.map((r) => r.id), ...distRows.map((x) => x.id),
    ...capitalReceipts.map((r) => r.id), ...settlementRows.map((x) => x.id)];
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
    ...receipts.flatMap((r) => [r.recorded_by, r.confirmed_by, r.rejected_by, r.reversed_by]),
    ...capitalReceipts.flatMap((r) => [r.recorded_by, r.confirmed_by, r.rejected_by, r.reversed_by]),
    ...settlementRows.flatMap((x) => [x.prepared_by, x.approved_by]),
    ...capitalPayments.map((l) => l.paid_by),
    ...distRows.flatMap((x) => [x.prepared_by, x.approved_by]),
    ...lineRows.map((l) => l.paid_by),
    ...paymentEvents.map((e) => e.actor),
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
    receipts,
    distributions: distRows.map((x) => ({ ...x, lines: lineRows.filter((l) => l.distribution_id === x.id) })),
    paymentEvents,
    capitalReceipts,
    capitalSettlements: settlementRows.map((x) => ({ ...x, payments: capitalPayments.filter((l) => l.settlement_id === x.id) })),
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
  const rows = must<InvestorRow[]>(invs, "investors");
  // Every MaalRise investor has the MaalGrow investor record (Phase 7);
  // "also MaalGrow" means they hold a MaalGrow investment.
  const linked = rows.map((i) => i.maalgrow_investor_id).filter((x): x is string => !!x);
  const holding = linked.length
    ? new Set(must<{ investor_id: string }[]>(await db.from("investments").select("investor_id").in("investor_id", linked), "MaalGrow investments")
        .map((x) => x.investor_id))
    : new Set<string>();
  return rows.map((i) => ({
    ...i,
    cycles: a.filter((x) => x.maalrise_investor_id === i.id).length,
    has_maalgrow: !!i.maalgrow_investor_id && holding.has(i.maalgrow_investor_id),
  }));
}

export type InvestorDetail = {
  investor: InvestorRow;
  kyc: KycSubmissionRow[];
  bankHistory: BankHistoryRow[];
  bankChanges: BankChangeRequestRow[];
  /** The person's MaalGrow investor record (invitation, KYC form), and whether they hold MaalGrow investments. */
  maalgrow: {
    id: string; investor_code: string; kyc_status: string; kyc_submitted_at: string | null;
    invitation_status: string | null; invitation_sent_at: string | null; investments: number;
  } | null;
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

  const [kyc, bank, allocs, funds, activity, changes] = await Promise.all([
    db.from("maalrise_kyc_submissions").select("*").eq("maalrise_investor_id", id).order("submitted_at", { ascending: false }),
    db.from("maalrise_bank_details_history").select("*").eq("maalrise_investor_id", id).order("created_at", { ascending: false }),
    db.from("maalrise_allocations").select("*").eq("maalrise_investor_id", id),
    db.from("maalrise_investor_fundings").select("*").eq("maalrise_investor_id", id).order("created_at", { ascending: false }),
    db.from("audit_logs").select("id, user_id, action, entity_type, entity_id, new_values, created_at")
      .like("action", "maalrise_%").eq("entity_id", id).order("created_at", { ascending: false }).limit(50),
    db.from("maalrise_bank_change_requests").select("*").eq("maalrise_investor_id", id).order("requested_at", { ascending: false }),
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
  const changeRows = must<BankChangeRequestRow[]>(changes, "bank change requests");
  const mgRes = await db.from("investors")
    .select("id, investor_code, kyc_status, kyc_submitted_at, invitation_status, invitation_sent_at, investments(id)")
    .eq("profile_id", investor.profile_id).maybeSingle();
  const mgRow = (mgRes.data ?? null) as (Omit<NonNullable<InvestorDetail["maalgrow"]>, "investments"> & { investments: { id: string }[] | null }) | null;

  return {
    investor,
    kyc: kycRows,
    bankHistory: bankRows,
    bankChanges: changeRows,
    maalgrow: mgRow ? { ...mgRow, investments: mgRow.investments?.length ?? 0 } : null,
    allocations: allocations.map((a) => ({ ...a, cycle: cyc[a.cycle_id] ?? null })),
    fundings: must<FundingRow[]>(funds, "funding"),
    activity: activityRows,
    names: await peopleNames(db, [
      investor.kyc_reviewed_by,
      investor.bank_confirmed_by,
      ...kycRows.map((k) => k.reviewed_by),
      ...bankRows.map((b) => b.actor),
      ...activityRows.map((a) => a.user_id),
      ...changeRows.map((c) => c.reviewed_by),
    ]),
  };
}

export async function dashboardFigures(db: SupabaseClient) {
  const [invs, cycles, allocs, cps, recs, dists, lines, caps, cpays, cterms, bankReqs] = await Promise.all([
    db.from("maalrise_investors").select("id", { count: "exact", head: true }),
    db.from("maalrise_cycles").select("id, name, status, start_date, duration_months, approved_terms_id, counterparty_id"),
    db.from("maalrise_allocations").select("cycle_id, capital_kobo"),
    db.from("maalrise_counterparties").select("id, name"),
    db.from("maalrise_receipts").select("cycle_id, period, amount_kobo, status, applied_kobo, held_kobo"),
    db.from("maalrise_distributions").select("id, cycle_id, status, net_kobo, allocated_kobo, unallocated_kobo"),
    db.from("maalrise_distribution_lines").select("status, amount_kobo"),
    db.from("maalrise_capital_receipts").select("cycle_id, amount_kobo, status"),
    db.from("maalrise_capital_payments").select("status, amount_kobo"),
    db.from("maalrise_cycle_terms").select("id, cost_kobo").eq("status", "approved"),
    db.from("maalrise_bank_change_requests").select("id, maalrise_investor_id, requested_at").eq("status", "pending").order("requested_at"),
  ]);
  const capReceipts = must<Pick<CapitalReceiptRow, "cycle_id" | "amount_kobo" | "status">[]>(caps, "capital entries");
  const capPays = must<Pick<CapitalPaymentRow, "status" | "amount_kobo">[]>(cpays, "capital payments");
  const termCost = Object.fromEntries(must<{ id: string; cost_kobo: number }[]>(cterms, "terms").map((x) => [x.id, x.cost_kobo]));
  if (invs.error) throw new Error(`Could not load investors: ${invs.error.message}`);
  const c = must<Pick<CycleRow, "id" | "name" | "status" | "start_date" | "duration_months" | "approved_terms_id" | "counterparty_id">[]>(cycles, "Cycles");
  const cpName = Object.fromEntries(must<{ id: string; name: string }[]>(cps, "counterparties").map((x) => [x.id, x.name]));
  const receipts = must<Pick<ReceiptRow, "cycle_id" | "period" | "amount_kobo" | "status" | "applied_kobo" | "held_kobo">[]>(recs, "receipts");
  const distributions = must<Pick<DistributionRow, "id" | "cycle_id" | "status" | "net_kobo" | "allocated_kobo" | "unallocated_kobo">[]>(dists, "distributions");
  const payLines = must<Pick<DistributionLineRow, "status" | "amount_kobo">[]>(lines, "payment lines");
  const a = must<Pick<AllocationRow, "cycle_id" | "capital_kobo">[]>(allocs, "allocations");
  const active = c.filter((x) => x.status === "active");
  const termIds = active.map((x) => x.approved_terms_id).filter((x): x is string => !!x);
  const schedule = termIds.length
    ? must<ScheduleLineRow[]>(await db.from("maalrise_schedule_lines").select("*").in("terms_id", termIds).order("due_date"), "schedule")
    : [];
  const sumBy = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((s, r) => s + f(r), 0);
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
    scheduleLines: schedule,
    counterpartyName: (cycleId: string) => cpName[c.find((x) => x.id === cycleId)?.counterparty_id ?? ""] ?? "—",
    receipts,
    receivedKobo: sumBy(receipts.filter((r) => r.status === "confirmed"), (r) => r.amount_kobo),
    awaitingConfirmationKobo: sumBy(receipts.filter((r) => r.status === "recorded"), (r) => r.amount_kobo),
    heldKobo: sumBy(receipts.filter((r) => r.status === "confirmed"), (r) => r.held_kobo ?? 0),
    preparedKobo: sumBy(distributions.filter((x) => x.status === "prepared"), (x) => x.allocated_kobo),
    preparedCount: distributions.filter((x) => x.status === "prepared").length,
    approvedKobo: sumBy(distributions.filter((x) => x.status === "approved"), (x) => x.allocated_kobo),
    unallocatedKobo: sumBy(distributions, (x) => x.unallocated_kobo),
    paidKobo: sumBy(payLines.filter((l) => l.status === "paid"), (l) => l.amount_kobo),
    toPayKobo: sumBy(payLines.filter((l) => l.status === "payable"), (l) => l.amount_kobo),
    toPayCount: payLines.filter((l) => l.status === "payable").length,
    capitalDue: (cycleId: string) => termCost[c.find((x) => x.id === cycleId)?.approved_terms_id ?? ""] ?? 0,
    capitalReceipts: capReceipts,
    capitalPaidKobo: sumBy(capPays.filter((l) => l.status === "paid"), (l) => l.amount_kobo),
    capitalToPayKobo: sumBy(capPays.filter((l) => l.status === "payable"), (l) => l.amount_kobo),
    pendingBankChanges: must<Pick<BankChangeRequestRow, "id" | "maalrise_investor_id" | "requested_at">[]>(bankReqs, "bank change requests"),
  };
}

export type PaymentQueueItem = DistributionLineRow & {
  kind: "profit";
  distribution: Pick<DistributionRow, "id" | "cycle_name" | "counterparty_name" | "period" | "sequence" | "due_date" | "approved_at"> | null;
  history: PaymentEventRow[];
};

export type CapitalQueueItem = CapitalPaymentRow & {
  kind: "capital";
  settlement: Pick<CapitalSettlementRow, "id" | "cycle_name" | "maturity_date" | "approved_at"> | null;
  history: PaymentEventRow[];
};

/**
 * Approved investor payments, for the payment screen. The payment
 * officer reads these through their own RLS policies (approved lines
 * and distributions only); admins read them as staff.
 */
export async function listPaymentQueue(db: SupabaseClient): Promise<PaymentQueueItem[]> {
  const lines = must<DistributionLineRow[]>(
    await db.from("maalrise_distribution_lines").select("*").in("status", ["payable", "paid"])
      .order("status").order("period").order("investor_name"),
    "payments"
  );
  const ids = [...new Set(lines.map((l) => l.distribution_id))];
  // Staff read every distribution; the officer, approved ones only (RLS).
  const dists = ids.length
    ? must<DistributionRow[]>(await db.from("maalrise_distributions").select("*").in("id", ids), "distributions")
    : [];
  const history = lines.length
    ? must<PaymentEventRow[]>(await db.from("maalrise_payment_events").select("*").in("line_id", lines.map((l) => l.id)).order("created_at"), "payment history")
    : [];
  const d = Object.fromEntries(dists.map((x) => [x.id, x]));
  return lines.map((l) => ({ ...l, kind: "profit" as const, distribution: d[l.distribution_id] ?? null, history: history.filter((h) => h.line_id === l.id) }));
}

/** Approved capital repayments, read the same way (officer: approved only). */
export async function listCapitalQueue(db: SupabaseClient): Promise<CapitalQueueItem[]> {
  const lines = must<CapitalPaymentRow[]>(
    await db.from("maalrise_capital_payments").select("*").in("status", ["payable", "paid"]).order("investor_name"),
    "capital payments"
  );
  const ids = [...new Set(lines.map((l) => l.settlement_id))];
  const sets = ids.length
    ? must<CapitalSettlementRow[]>(await db.from("maalrise_capital_settlements").select("*").in("id", ids), "capital settlements")
    : [];
  const history = lines.length
    ? must<PaymentEventRow[]>(await db.from("maalrise_capital_payment_events").select("*").in("line_id", lines.map((l) => l.id)).order("created_at"), "capital payment history")
    : [];
  const st = Object.fromEntries(sets.map((x) => [x.id, x]));
  return lines.map((l) => ({ ...l, kind: "capital" as const, settlement: st[l.settlement_id] ?? null, history: history.filter((h) => h.line_id === l.id) }));
}

export async function listMyNotifications(db: SupabaseClient, limit = 50): Promise<NotificationRow[]> {
  return must<NotificationRow[]>(
    await db.from("maalrise_notifications").select("id, kind, title, message, link, read_at, created_at")
      .order("created_at", { ascending: false }).limit(limit),
    "notifications"
  );
}

/**
 * Carry MaalGrow KYC results (and bank details MaalRise does not yet
 * have, unconfirmed) across to MaalRise — migration 055. Staff sync
 * everyone, an investor themselves. Never blocks a page: on any error
 * the page shows what is already recorded.
 */
export async function syncFromMaalgrow(db: SupabaseClient): Promise<void> {
  try {
    await db.rpc("maalrise_sync_from_maalgrow");
  } catch {
    // Shown as recorded; the next page load tries again.
  }
}

/**
 * MaalGrow investor records that exist only for MaalRise: linked to a
 * MaalRise investor and holding no MaalGrow investment. MaalGrow totals
 * leave these out, and the MaalGrow investor list tags them.
 */
export async function maalriseOnlyInvestorIds(client: unknown): Promise<Set<string>> {
  const db = mr(client);
  try {
    const { data: links, error } = await db.from("maalrise_investors").select("maalgrow_investor_id");
    if (error || !links) return new Set();
    const ids = (links as { maalgrow_investor_id: string | null }[]).map((l) => l.maalgrow_investor_id).filter((x): x is string => !!x);
    if (ids.length === 0) return new Set();
    const { data: inv, error: invErr } = await db.from("investments").select("investor_id").in("investor_id", ids);
    if (invErr) return new Set();
    const holding = new Set((inv as { investor_id: string }[] | null ?? []).map((i) => i.investor_id));
    return new Set(ids.filter((id) => !holding.has(id)));
  } catch {
    return new Set();
  }
}

export type OutboxItem = OutboxRow & { audience: "investor" | "staff"; handled_by_name: string | null };

/** MaalRise emails for the outbox screen, newest first; who each is for comes from the recipient's role. */
export async function listOutbox(db: SupabaseClient, limit = 300): Promise<OutboxItem[]> {
  const rows = must<OutboxRow[]>(
    await db.from("maalrise_email_outbox").select("*").order("created_at", { ascending: false }).limit(limit),
    "emails"
  );
  const userIds = [...new Set(rows.map((r) => r.to_user_id).filter((x): x is string => !!x))];
  const roles = userIds.length
    ? Object.fromEntries(must<{ id: string; role: string }[]>(await db.from("profiles").select("id, role").in("id", userIds), "recipients")
        .map((p) => [p.id, p.role]))
    : {};
  const names = await peopleNames(db, rows.map((r) => r.handled_by));
  return rows.map((r) => ({
    ...r,
    audience: r.to_user_id && roles[r.to_user_id] === "investor" ? "investor" : "staff",
    handled_by_name: r.handled_by ? names[r.handled_by] ?? null : null,
  }));
}

/** Every profit and capital payment marked paid between two dates (inclusive), for the payments register. */
export async function loadRegister(db: SupabaseClient, from: string, to: string) {
  const [lines, caps] = await Promise.all([
    db.from("maalrise_distribution_lines").select("*, distribution:maalrise_distributions(cycle_name)")
      .eq("status", "paid").gte("paid_on", from).lte("paid_on", to),
    db.from("maalrise_capital_payments").select("*, settlement:maalrise_capital_settlements(cycle_name)")
      .eq("status", "paid").gte("paid_on", from).lte("paid_on", to),
  ]);
  type L = DistributionLineRow & { distribution: { cycle_name: string } | null };
  type C = CapitalPaymentRow & { settlement: { cycle_name: string } | null };
  const profit = must<L[]>(lines, "payments").map((l) => ({ ...l, cycle_name: l.distribution?.cycle_name ?? "—" }));
  const capital = must<C[]>(caps, "capital payments").map((p) => ({ ...p, cycle_name: p.settlement?.cycle_name ?? "—" }));
  const names = await peopleNames(db, [...profit.map((l) => l.paid_by), ...capital.map((p) => p.paid_by)]);
  return { profit, capital, names };
}

/** The Cycle's whole audit trail — every record it owns, payments included — oldest first. */
export async function loadCycleAudit(db: SupabaseClient, d: CycleDetail): Promise<{ rows: AuditRow[]; names: Record<string, string> }> {
  const ids = [
    d.cycle.id, ...d.versions.map((v) => v.id), ...d.fundings.map((f) => f.id), ...d.receipts.map((r) => r.id),
    ...d.distributions.map((x) => x.id), ...d.distributions.flatMap((x) => x.lines.map((l) => l.id)),
    ...d.capitalReceipts.map((r) => r.id), ...d.capitalSettlements.map((s) => s.id),
    ...d.capitalSettlements.flatMap((s) => s.payments.map((p) => p.id)), ...d.documents.map((x) => x.id),
  ];
  const rows: AuditRow[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    rows.push(...must<AuditRow[]>(
      await db.from("audit_logs").select("id, user_id, action, entity_type, entity_id, new_values, created_at")
        .like("action", "maalrise_%").in("entity_id", ids.slice(i, i + 200)).limit(5000),
      "audit trail"
    ));
  }
  rows.sort((a, b) => a.created_at.localeCompare(b.created_at));
  return { rows, names: await peopleNames(db, rows.map((r) => r.user_id)) };
}
