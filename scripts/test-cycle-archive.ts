/**
 * Who has not been paid.
 *
 * That is the one question the cycle archive exists to answer, and it
 * is the one that is easy to get quietly wrong: the dangerous case is
 * not a request marked pending, it is an investor for whom NO request
 * was ever raised. A naive "any request that is not paid" check calls
 * that person settled, because there is nothing to look at.
 *
 * Reproduces the Series B shapes — a holder who continued, one who
 * exited, one paid in full, one nobody raised anything for, and one
 * whose request was raised for the wrong amount (the gross-instead-of
 * -net payout that migration 035 fixed).
 *
 *   npx tsx scripts/test-cycle-archive.ts
 */
import { loadArchiveHolders, decisionLabel } from "../src/lib/mudarabah/cycle-archive";
import type { MudarabahClient } from "../src/lib/mudarabah/db";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, extra ?? "");
  }
}

type Row = Record<string, unknown>;

/**
 * The smallest thing that behaves like the query builder the loader
 * uses: select / eq / neq / in / order, all chainable, awaited last.
 */
function fakeDb(tables: Record<string, Row[]>): MudarabahClient {
  const build = (rows: Row[]) => {
    const q: Record<string, unknown> = {
      eq: (col: string, v: unknown) => build(rows.filter((r) => r[col] === v)),
      neq: (col: string, v: unknown) => build(rows.filter((r) => r[col] !== v)),
      in: (col: string, vs: unknown[]) => build(rows.filter((r) => vs.includes(r[col]))),
      order: () => build(rows),
      then: (resolve: (v: { data: Row[] }) => unknown) => resolve({ data: rows }),
    };
    return q;
  };
  return {
    from: (t: string) => ({ select: () => build(tables[t] ?? []) }),
  } as unknown as MudarabahClient;
}

const CYCLE = "cyc-b";

const investments: Row[] = [
  // Continued. Profit paid. Nothing outstanding.
  { id: "i1", cycle_id: CYCLE, investment_code: "MG-B-1", investor_id: "v1", units: 6,
    capital: 3_000_000, declared_profit: 300_000, declared_profit_net: 270_000,
    next_investment_id: "n1", status: "matured",
    investor: { full_name: "Aisha", investor_code: "MG001" } },

  // Exited. Profit paid, capital still only pending.
  { id: "i2", cycle_id: CYCLE, investment_code: "MG-B-2", investor_id: "v2", units: 2,
    capital: 1_000_000, declared_profit: 100_000, declared_profit_net: 90_000,
    next_investment_id: null, status: "matured",
    investor: { full_name: "Bilal", investor_code: "MG002" } },

  // THE ONE THAT MATTERS: settled, owed money, and nobody ever
  // raised a request. No row to inspect, so nothing looks wrong.
  { id: "i3", cycle_id: CYCLE, investment_code: "MG-B-3", investor_id: "v3", units: 1,
    capital: 500_000, declared_profit: 50_000, declared_profit_net: 45_000,
    next_investment_id: null, status: "matured",
    investor: { full_name: "Fatima", investor_code: "MG003" } },

  // Requested for the GROSS. Paid, but for the wrong figure.
  { id: "i4", cycle_id: CYCLE, investment_code: "MG-B-4", investor_id: "v4", units: 2,
    capital: 1_000_000, declared_profit: 100_000, declared_profit_net: 90_000,
    next_investment_id: null, status: "matured",
    investor: { full_name: "Yusuf", investor_code: "MG004" } },

  // Not settled at all — owed nothing yet, so not outstanding.
  { id: "i5", cycle_id: CYCLE, investment_code: "MG-B-5", investor_id: "v5", units: 1,
    capital: 500_000, declared_profit: null, declared_profit_net: null,
    next_investment_id: null, status: "active",
    investor: { full_name: "Zainab", investor_code: "MG005" } },

  // A cancelled enrolment was never really a member.
  { id: "i6", cycle_id: CYCLE, investment_code: "MG-B-6", investor_id: "v6", units: 0,
    capital: 0, declared_profit: null, declared_profit_net: null,
    next_investment_id: null, status: "cancelled",
    investor: { full_name: "Ghost", investor_code: "MG006" } },
];

const db = fakeDb({
  investments: investments.concat([
    { id: "n1", investment_code: "MG-C-1", cycle: { cycle_label: "Jul 2026 - Oct 2026" } },
  ]),
  rollover_decisions: [
    { investment_id: "i1", source_cycle_id: CYCLE, decision: "continue",
      submitted_at: "2026-07-26", slots_to_withdraw: null, via: "investor" },
    { investment_id: "i2", source_cycle_id: CYCLE, decision: "exit",
      submitted_at: "2026-07-26", slots_to_withdraw: null, via: "investor" },
    { investment_id: "i4", source_cycle_id: CYCLE, decision: "continue",
      submitted_at: "2026-07-26", slots_to_withdraw: null, via: "admin_exception" },
  ],
  payment_requests: [
    { investment_id: "i1", type: "roi", amount: 270_000, status: "paid" },
    { investment_id: "i2", type: "roi", amount: 90_000, status: "paid" },
    { investment_id: "i2", type: "capital", amount: 1_000_000, status: "pending" },
    { investment_id: "i4", type: "roi", amount: 100_000, status: "paid" },
  ],
});

async function main() {
const holders = await loadArchiveHolders(db, CYCLE);
const by = (code: string) => holders.find((h) => h.investmentCode === code)!;

check("cancelled enrolments are not members", holders.length === 5, holders.length);

// i1 — continued, paid, done.
check("a paid continuation is not outstanding", by("MG-B-1").outstanding === false);
check(
  "a continuation names where the slots went",
  by("MG-B-1").continuedAs === "MG-C-1" &&
    by("MG-B-1").continuedInto === "Jul 2026 - Oct 2026",
  by("MG-B-1")
);

// i2 — capital withdrawal still pending.
check("capital still pending is outstanding", by("MG-B-2").outstanding === true);
check("and the profit half is already paid", by("MG-B-2").profitState === "paid");
check("while the capital half is pending", by("MG-B-2").capitalState === "pending");

// i3 — THE POINT OF THE PAGE.
check(
  "an investor with NO request raised is outstanding",
  by("MG-B-3").outstanding === true,
  by("MG-B-3")
);
check("and reads as not requested", by("MG-B-3").profitState === "none");

// i4 — paid, but for the gross.
check("a request paid for the wrong amount still shows the amount", by("MG-B-4").profitRequested === 100_000);
check("what was actually due is the net", by("MG-B-4").profitNet === 90_000);
check(
  "paid-but-wrong is not flagged outstanding — the money did leave",
  by("MG-B-4").outstanding === false
);

// i5 — nothing declared yet.
check("an unsettled holder is not outstanding", by("MG-B-5").outstanding === false);
check("and shows no profit", by("MG-B-5").profitNet === null);

// Silence has a meaning, and it is not "withdrawn".
check(
  "no instruction reads as the capital continuing",
  decisionLabel(null) === "No instruction — capital continued",
  decisionLabel(null)
);
check(
  "an exit says the capital is paid out",
  decisionLabel("exit").includes("withdrawn"),
  decisionLabel("exit")
);
check(
  "an unknown decision is shown verbatim, never as blank",
  decisionLabel("something_new") === "something_new"
);

// Who gave the instruction is on the record.
check("an admin exception is marked as one", by("MG-B-4").via === "admin_exception");
check("an investor's own answer is marked as theirs", by("MG-B-1").via === "investor");

console.log(failures === 0 ? "\nALL CYCLE ARCHIVE TESTS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
}

main();
