/**
 * Settling the profit without demanding a capital instruction.
 *
 * An investor cannot decide whether to take their capital until they
 * know what they earned, and that is only known once the cycle is
 * settled. Settlement used to guess on their behalf and write the
 * guess into a frozen snapshot; these cover it no longer doing so.
 */
import { settlementPreview, DEFAULT_WHEN_UNDECIDED, type Participant } from "../src/lib/mudarabah/settlement";
import type { CycleInput } from "../src/lib/mudarabah/compute";

let f = 0;
const ck = (n: string, c: boolean, x?: unknown) => c ? console.log("PASS:", n) : (f++, console.error("FAIL:", n, x ?? ""));

const input: CycleInput = {
  slots: 4, slotPrice: 500_000_00, ratio: 0.5, whtRate: 0.1,
  products: [{ id: "p", name: "P" }],
  months: [{ ads: 0, logistics: 0, misc: 0, bankCharges: 0,
    rows: [{ productId: "p", qty: 100, unitCost: 10_000_00, soldQty: 100, sellPrice: 15_000_00, stockLeft: 0 }] }],
} as unknown as CycleInput;

const p = (id: string, d: Participant["decision"], units = 1): Participant => ({
  investmentId: id, investorId: id, investorName: id, investorCode: id,
  units, decision: d, slotsWithdrawn: 0, tin: "T",
});

ck("the default is undecided, not a guess", DEFAULT_WHEN_UNDECIDED === "undecided");

const pv = settlementPreview(input, [p("a", null), p("b", null), p("c", "withdraw"), p("d", "rollover")]);

const a = pv.holders.find((h) => h.investmentId === "a")!;
const c = pv.holders.find((h) => h.investmentId === "c")!;
const d = pv.holders.find((h) => h.investmentId === "d")!;

ck("undecided stays undecided", a.capitalAction === "undecided", a.capitalAction);
ck("undecided is flagged for the admin", a.defaulted);
ck("undecided withdraws no capital", a.capitalWithdrawn === 0, a.capitalWithdrawn);
ck("undecided is paid the profit", a.amountPaid === a.netProfit, { paid: a.amountPaid, net: a.netProfit });
ck("undecided pays the same as rollover", a.amountPaid === d.amountPaid);
ck("withdraw still returns capital", c.capitalWithdrawn === c.capital && c.amountPaid === c.netProfit + c.capital);

// The whole point: settling is not held up, and the assertions hold.
ck("every assertion still passes", pv.assertions.every((x) => x.passed), pv.assertions.filter(x => !x.passed));
ck("settlement is not blocked by undecided investors", !pv.blocked);

// Cash needed must NOT include capital nobody asked for.
const expected = pv.holders.reduce((t, h) => t + h.netProfit, 0) + c.capital;
ck("cash needed covers profit for all, capital only for the withdrawer",
   pv.totals.cashNeeded === expected, { got: pv.totals.cashNeeded, expected });

const w = pv.warnings.find((x) => x.kind === "no-decision")!;
ck("the warning names them", w && w.investors.length === 2, w?.investors);
ck("the warning no longer claims a choice", !/will CONTINUE/.test(w?.message ?? ""), w?.message);

// An admin can still decide for them
const pv2 = settlementPreview(input, [p("a", null)], [{ investmentId: "a", action: "withdraw" }]);
const a2 = pv2.holders[0];
ck("an admin override still works", a2.capitalAction === "withdraw" && a2.capitalWithdrawn === a2.capital);
ck("an override is marked as theirs, not defaulted", a2.overridden && !a2.defaulted);

process.exit(f === 0 ? 0 : 1);
