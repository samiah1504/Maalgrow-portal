/**
 * What an investor currently has with us.
 *
 * The case that matters most is the ROLLOVER: the same money appears
 * on two investment rows — the old one at 'completed' and the new one
 * at 'active' — and counting both says an investor has twice what she
 * gave us. A figure that is exactly double is the hardest kind of
 * wrong to notice, because it looks like a number rather than a fault.
 *
 *   npx tsx scripts/test-investor-holdings.ts
 */
import { holdingsOf, type HoldingLike } from "../src/lib/investor-holdings";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const inv = (status: string, capital: number, units: number): HoldingLike => ({
  status,
  capital,
  units,
});

// ------------------------------------------------------------
// H1 — THE REPORTED CASE
//
//      Two live enrolments, one matured cycle behind them. The page
//      said "Investments (3)" under a card saying "Active: 2".
// ------------------------------------------------------------
{
  const h = holdingsOf([
    inv("matured", 1_000_000, 2),
    inv("active", 1_000_000, 2),
    inv("active", 500_000, 1),
  ]);
  check("H1 a matured enrolment is not counted", h.count === 2, `count ${h.count}`);
  check("H1 it is still acknowledged as past", h.pastCount === 1, `past ${h.pastCount}`);
}

// ------------------------------------------------------------
// H2 — THE ROLLOVER DOUBLE-COUNT
//
//      N1,000,000 continued from one cycle into the next. The
//      rollover writes a new enrolment and leaves the old one at
//      'completed' carrying its own capital. Counting both reports
//      twice the money.
// ------------------------------------------------------------
{
  const h = holdingsOf([
    inv("completed", 1_000_000, 2), // Apr–Jul, rolled over
    inv("active", 1_000_000, 2), // Jul–Oct, the continuation
  ]);
  check(
    "H2 a rollover is counted once, not twice",
    h.capital === 1_000_000,
    `capital ${h.capital} — the investor gave us 1,000,000`
  );
  check("H2 and so are its slots", h.slots === 2, `slots ${h.slots}`);
  check("H2 and it is one investment, not two", h.count === 1, `count ${h.count}`);

  // The old behaviour, reproduced, so this test is known to be
  // testing something that was really happening.
  const oldWay = [
    inv("completed", 1_000_000, 2),
    inv("active", 1_000_000, 2),
  ]
    .filter((i) => i.status !== "cancelled")
    .reduce((s, i) => s + i.capital, 0);
  check(
    "H2 the old rule is confirmed to have doubled it",
    oldWay === 2_000_000,
    `the old rule gave ${oldWay}, so this test is not reproducing the fault`
  );
}

// ------------------------------------------------------------
// H3 — every non-current status is excluded, not just matured
// ------------------------------------------------------------
{
  const h = holdingsOf([
    inv("matured", 100, 1),
    inv("completed", 200, 2),
    inv("cancelled", 400, 4),
    inv("active", 800, 8),
  ]);
  check("H3 only the active one counts", h.count === 1, `count ${h.count}`);
  check("H3 capital is the active one's", h.capital === 800, `capital ${h.capital}`);
  check("H3 slots are the active one's", h.slots === 8, `slots ${h.slots}`);
  check("H3 the other three are past", h.pastCount === 3, `past ${h.pastCount}`);
}

// ------------------------------------------------------------
// H4 — an investor whose every cycle has closed
//
//      Count zero, and the page still has three cards to show. The
//      heading has to say so or it reads as a miscount.
// ------------------------------------------------------------
{
  const h = holdingsOf([
    inv("matured", 100, 1),
    inv("completed", 200, 2),
    inv("completed", 300, 3),
  ]);
  check("H4 nothing current", h.count === 0 && h.capital === 0, JSON.stringify(h));
  check("H4 but three to list", h.pastCount === 3, `past ${h.pastCount}`);
}

// ------------------------------------------------------------
// H5 — a brand new investor
// ------------------------------------------------------------
{
  const h = holdingsOf([]);
  check(
    "H5 empty is empty, and nothing divides by zero",
    h.count === 0 && h.capital === 0 && h.slots === 0 && h.pastCount === 0,
    JSON.stringify(h)
  );
}

// ------------------------------------------------------------
// H6 — fractional slots survive
//
//      Half slots are real in this portal; a rule that rounded them
//      would be wrong in a way nobody would see until a statement.
// ------------------------------------------------------------
{
  const h = holdingsOf([inv("active", 250_000, 0.5), inv("active", 750_000, 1.5)]);
  check("H6 fractional slots add up exactly", h.slots === 2, `slots ${h.slots}`);
  check("H6 capital adds up", h.capital === 1_000_000, `capital ${h.capital}`);
}

// ------------------------------------------------------------
// H7 — the count and the list always agree
//
//      count + pastCount must equal what the page renders, whatever
//      the mix. If these ever drift the heading is lying about the
//      cards underneath it.
// ------------------------------------------------------------
{
  const mixes: HoldingLike[][] = [
    [],
    [inv("active", 1, 1)],
    [inv("matured", 1, 1)],
    [inv("active", 1, 1), inv("cancelled", 1, 1), inv("completed", 1, 1)],
    [inv("matured", 1, 1), inv("matured", 1, 1), inv("active", 1, 1)],
  ];
  const allAgree = mixes.every((m) => {
    const h = holdingsOf(m);
    return h.count + h.pastCount === m.length;
  });
  check("H7 count + past always equals what is listed", allAgree);
}

console.log(
  failures === 0
    ? "\n=== ALL INVESTOR HOLDINGS TESTS PASSED ==="
    : `\n=== ${failures} FAILED ===`
);
process.exit(failures === 0 ? 0 : 1);
