/**
 * The record of a cycle after it is over.
 *
 * WHAT THIS IS FOR. Once a cycle settles, the question stops being
 * "how much profit" and becomes "who has actually been paid". That
 * answer was scattered: the rollover page shows decisions, the
 * payment-requests page shows money, and nothing put an investor's
 * name next to their slots, their instruction and whether the cash
 * ever left. This is that one view, per cycle, for the record.
 *
 * DERIVED, NEVER STORED. Every figure here is read from the rows that
 * caused it — memberships, instructions, payment requests. Nothing is
 * cached and no counter is trusted, for the same reason the cycle
 * pickers stopped trusting cycles.total_slots: an accumulator that
 * misses one delta is wrong for ever, and silently.
 *
 * OUTSTANDING IS THE POINT. A holder is outstanding when money that
 * is owed has not been marked paid. That includes the case where no
 * request was ever raised at all, which is the one worth catching —
 * an investor nobody has noticed is still waiting.
 *
 * Money is NAIRA with two decimals, matching the columns it comes
 * from. Nothing here feeds a calculation; it is all for reading.
 *
 * SERVER ONLY — reads every investor's holdings.
 */

import type { MudarabahClient } from "./db";

/** How a payment request is standing, or that there is not one. */
export type PayState = "paid" | "processing" | "approved" | "pending" | "rejected" | "none";

export type ArchiveHolder = {
  investmentId: string;
  investmentCode: string;
  investorId: string;
  investorName: string;
  investorCode: string;

  slots: number;
  capital: number;

  /** null when they never answered — which means the capital continued. */
  decision: string | null;
  decidedAt: string | null;
  slotsWithdrawn: number | null;
  /** 'investor' | 'admin_exception' — who gave the instruction. */
  via: string | null;

  profitGross: number | null;
  /** What they actually receive. The rest is withheld. */
  profitNet: number | null;

  profitState: PayState;
  profitRequested: number | null;
  capitalState: PayState;
  capitalRequested: number | null;

  /** The enrolment their slots became, if they continued. */
  continuedAs: string | null;
  continuedInto: string | null;

  /** Money is owed and has not been marked paid. */
  outstanding: boolean;
};

export type ArchiveCycle = {
  id: string;
  seriesName: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  settled: boolean;

  investors: number;
  slots: number;
  capital: number;

  /** Investor share of the declared profit, gross and net of tax. */
  profitGross: number;
  profitNet: number;

  /** Holders still owed something. The number that matters. */
  outstanding: number;
  /** Of the profit due, how much has been marked paid. */
  profitPaid: number;
  capitalPaid: number;
};

const DECISION_LABEL: Record<string, string> = {
  continue: "Profit paid · capital continues",
  exit: "Profit + all capital withdrawn",
  partial_exit: "Profit paid · part of capital withdrawn",
  rollover_all: "Capital + profit both continue (legacy)",
};

/** How an instruction reads on a page. Silence has a meaning too. */
export function decisionLabel(decision: string | null): string {
  if (!decision) return "No instruction — capital continued";
  return DECISION_LABEL[decision] ?? decision;
}

/** Worst state wins: one unpaid request makes the holder outstanding. */
function worst(states: PayState[]): PayState {
  const order: PayState[] = ["none", "rejected", "pending", "approved", "processing", "paid"];
  return states.reduce((a, b) => (order.indexOf(b) < order.indexOf(a) ? b : a), "paid");
}

/**
 * Every cycle that has something to document — one that has ended, or
 * settled, or been marked completed. Upcoming and mid-flight cycles
 * are left out; there is nothing to look back on yet.
 */
export async function loadArchiveCycles(db: MudarabahClient): Promise<ArchiveCycle[]> {
  const today = new Date().toISOString().slice(0, 10);

  const [{ data: cycles }, { data: series }, { data: declarations }] = await Promise.all([
    db
      .from("cycles")
      .select("id, series_id, cycle_label, start_date, end_date, status")
      .order("start_date", { ascending: false }),
    db.from("series").select("id, name"),
    db
      .from("cycle_profit_declarations")
      .select("cycle_id, investor_profit_share, total_wht"),
  ]);

  const seriesName = new Map((series ?? []).map((s) => [s.id, String(s.name)]));
  const declByCycle = new Map(
    (declarations ?? []).map((d) => [
      d.cycle_id,
      {
        gross: Number(d.investor_profit_share ?? 0),
        wht: Number(d.total_wht ?? 0),
      },
    ])
  );

  const past = (cycles ?? []).filter(
    (c) =>
      declByCycle.has(c.id) ||
      c.status === "completed" ||
      String(c.end_date) < today
  );
  if (past.length === 0) return [];

  const ids = past.map((c) => c.id);

  const [{ data: memberships }, { data: requests }] = await Promise.all([
    db
      .from("investments")
      .select("id, cycle_id, units, capital, declared_profit, declared_profit_net")
      .in("cycle_id", ids)
      // Settling matures every investment, so an active-only filter
      // would empty a cycle the moment it settled — the bug fixed in
      // migration 033. Cancelled rows were never really members.
      .neq("status", "cancelled"),
    db
      .from("payment_requests")
      .select("investment_id, type, amount, status")
      .in("type", ["roi", "capital"]),
  ]);

  const cycleOf = new Map((memberships ?? []).map((m) => [m.id, m.cycle_id as string]));

  // Paid money, per cycle, per kind.
  const paid = new Map<string, { roi: number; capital: number }>();
  const requestedBy = new Map<string, { roi: PayState[]; capital: PayState[] }>();
  for (const r of requests ?? []) {
    const cycleId = cycleOf.get(r.investment_id as string);
    if (!cycleId) continue;
    const kind = r.type === "roi" ? "roi" : "capital";

    const at = requestedBy.get(r.investment_id as string) ?? { roi: [], capital: [] };
    at[kind].push(r.status as PayState);
    requestedBy.set(r.investment_id as string, at);

    if (r.status === "paid") {
      const p = paid.get(cycleId) ?? { roi: 0, capital: 0 };
      p[kind] += Number(r.amount ?? 0);
      paid.set(cycleId, p);
    }
  }

  return past.map((c) => {
    const rows = (memberships ?? []).filter((m) => m.cycle_id === c.id);
    const decl = declByCycle.get(c.id);
    const p = paid.get(c.id) ?? { roi: 0, capital: 0 };

    let outstanding = 0;
    for (const m of rows) {
      const states = requestedBy.get(m.id) ?? { roi: [], capital: [] };
      const owedProfit = Number(m.declared_profit_net ?? m.declared_profit ?? 0) > 0;
      if (owedProfit && worst(states.roi.length ? states.roi : ["none"]) !== "paid") {
        outstanding += 1;
      }
    }

    return {
      id: c.id,
      seriesName: seriesName.get(c.series_id) ?? "?",
      label: c.cycle_label,
      startDate: c.start_date,
      endDate: c.end_date,
      status: c.status,
      settled: Boolean(decl),
      investors: rows.length,
      slots: rows.reduce((t, m) => t + Number(m.units ?? 0), 0),
      capital: rows.reduce((t, m) => t + Number(m.capital ?? 0), 0),
      profitGross: decl?.gross ?? 0,
      profitNet: decl ? decl.gross - decl.wht : 0,
      outstanding,
      profitPaid: p.roi,
      capitalPaid: p.capital,
    };
  });
}

/**
 * One cycle, holder by holder — the page that answers "has this
 * person been paid".
 */
export async function loadArchiveHolders(
  db: MudarabahClient,
  cycleId: string
): Promise<ArchiveHolder[]> {
  const { data: rows } = await db
    .from("investments")
    .select(
      "id, investment_code, investor_id, units, capital, declared_profit, declared_profit_net, next_investment_id, investor:investors(full_name, investor_code)"
    )
    .eq("cycle_id", cycleId)
    .neq("status", "cancelled")
    .order("created_at");

  if (!rows || rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const nextIds = rows.map((r) => r.next_investment_id).filter(Boolean) as string[];

  const [{ data: decisions }, { data: requests }, { data: continuations }] =
    await Promise.all([
      db
        .from("rollover_decisions")
        .select("investment_id, decision, submitted_at, slots_to_withdraw, via")
        .eq("source_cycle_id", cycleId),
      db
        .from("payment_requests")
        .select("investment_id, type, amount, status")
        .in("investment_id", ids),
      nextIds.length
        ? db
            .from("investments")
            .select("id, investment_code, cycle:cycles(cycle_label)")
            .in("id", nextIds)
        : Promise.resolve({ data: [] as never[] }),
    ]);

  const decisionBy = new Map((decisions ?? []).map((d) => [d.investment_id, d]));
  const contBy = new Map(
    (continuations ?? []).map((n) => {
      const raw = n as unknown as {
        id: string;
        investment_code: string;
        cycle: { cycle_label: string } | null;
      };
      return [raw.id, raw];
    })
  );

  const reqBy = new Map<
    string,
    { roi: { amount: number; status: PayState }[]; capital: { amount: number; status: PayState }[] }
  >();
  for (const r of requests ?? []) {
    const at = reqBy.get(r.investment_id) ?? { roi: [], capital: [] };
    at[r.type === "roi" ? "roi" : "capital"].push({
      amount: Number(r.amount ?? 0),
      status: r.status as PayState,
    });
    reqBy.set(r.investment_id, at);
  }

  return rows.map((r) => {
    const inv = r.investor as unknown as {
      full_name: string;
      investor_code: string;
    } | null;
    const d = decisionBy.get(r.id);
    const req = reqBy.get(r.id) ?? { roi: [], capital: [] };
    const cont = r.next_investment_id ? contBy.get(r.next_investment_id) : undefined;

    const profitNet = r.declared_profit_net ?? r.declared_profit;
    const profitState: PayState = req.roi.length
      ? worst(req.roi.map((x) => x.status))
      : "none";
    const capitalState: PayState = req.capital.length
      ? worst(req.capital.map((x) => x.status))
      : "none";

    // Owed and unpaid. A holder with no declared profit is owed
    // nothing yet, so they are not outstanding — they are unsettled.
    const owedProfit = Number(profitNet ?? 0) > 0;
    const owedCapital = d?.decision === "exit" || d?.decision === "partial_exit";

    return {
      investmentId: r.id,
      investmentCode: r.investment_code,
      investorId: r.investor_id,
      investorName: inv?.full_name ?? "—",
      investorCode: inv?.investor_code ?? "—",
      slots: Number(r.units ?? 0),
      capital: Number(r.capital ?? 0),
      decision: d?.decision ?? null,
      decidedAt: d?.submitted_at ?? null,
      slotsWithdrawn: d?.slots_to_withdraw ?? null,
      via: d?.via ?? null,
      profitGross: r.declared_profit != null ? Number(r.declared_profit) : null,
      profitNet: profitNet != null ? Number(profitNet) : null,
      profitState,
      profitRequested: req.roi.length
        ? req.roi.reduce((t, x) => t + x.amount, 0)
        : null,
      capitalState,
      capitalRequested: req.capital.length
        ? req.capital.reduce((t, x) => t + x.amount, 0)
        : null,
      continuedAs: cont?.investment_code ?? null,
      continuedInto: cont?.cycle?.cycle_label ?? null,
      outstanding:
        (owedProfit && profitState !== "paid") ||
        (owedCapital && capitalState !== "paid"),
    };
  });
}
