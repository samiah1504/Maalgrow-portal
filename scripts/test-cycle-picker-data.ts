/**
 * The two predicates that decide whether a cycle card carries a
 * warning. Reproduces the Series B · Apr–Jul 2026 case exactly: the
 * cycle record said 77 slots, the memberships held 78, ₦38,500,000 had
 * been received, and every screen looked internally consistent.
 */
import {
  fundingGap,
  slotsDrifted,
  type PickerCycle,
} from "../src/lib/mudarabah/cycle-picker-data";

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("PASS:", name);
  else { failures++; console.error("FAIL:", name, extra ?? ""); }
}

const base: PickerCycle = {
  id: "c1",
  seriesId: "s1",
  label: "Apr 2026 - July 2026",
  startDate: "2026-04-30",
  endDate: "2026-07-30",
  status: "active",
  totalSlots: 77,
  investors: 38,
  storedSlots: 77,
  storedInvestors: 38,
  pooledCapital: 38_500_000,
  amountReceived: 38_500_000,
  ledgerStatus: null,
};

// A cycle that reconciles raises nothing.
check("clean cycle: no drift", !slotsDrifted(base));
check("clean cycle: no funding gap", fundingGap(base) === 0);

// The reported case, before the data was fixed.
const reported: PickerCycle = {
  ...base,
  totalSlots: 78,
  storedSlots: 77,
  pooledCapital: 39_000_000,
  amountReceived: 38_500_000,
};
check("reported case: drift caught", slotsDrifted(reported));
check("reported case: gap is one slot", fundingGap(reported) === 500_000, fundingGap(reported));

// Drift in the other direction — the accumulator running ahead —
// matters just as much and was equally invisible before.
check(
  "accumulator ahead of memberships",
  slotsDrifted({ ...base, storedSlots: 79 })
);

// Overpayment is a different problem from underfunding, and the sign
// is how the card tells them apart.
const over = { ...base, amountReceived: 39_000_000 };
check("overpayment reported as negative", fundingGap(over) === -500_000, fundingGap(over));

// Half-slot arithmetic is legal (units are NUMERIC(12,2), step 0.5)
// and must not be mistaken for float noise.
const half = { ...base, totalSlots: 77.5, storedSlots: 77 };
check("half-slot drift caught", slotsDrifted(half));

// Float noise must NOT raise a warning. 0.1 + 0.2 style residue on a
// naira total would otherwise flag every cycle in the portal.
const noise = { ...base, amountReceived: 38_500_000 + 0.0001 };
check("float noise ignored", fundingGap(noise) === 0, fundingGap(noise));
check(
  "sub-kobo slot noise ignored",
  !slotsDrifted({ ...base, storedSlots: 77 + 0.0001 })
);

// A cycle with no memberships at all is empty, not broken — but if the
// accumulator still claims slots, that IS worth saying.
const empty = { ...base, totalSlots: 0, investors: 0, storedSlots: 0, pooledCapital: 0, amountReceived: 0 };
check("empty cycle is quiet", !slotsDrifted(empty) && fundingGap(empty) === 0);
check("empty cycle with a stale counter is not", slotsDrifted({ ...empty, storedSlots: 3 }));

process.exit(failures === 0 ? 0 : 1);
