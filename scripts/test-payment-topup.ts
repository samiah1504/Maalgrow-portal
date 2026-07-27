/**
 * The money-only top-up: when it is offered, and what it may be worth.
 *
 * The rules live in payment-dialog.tsx as small expressions over the
 * selected enrolment. They are reproduced here because getting them
 * wrong is not a cosmetic fault: offering the toggle where
 * record_investor_payment would refuse produces an error the
 * administrator cannot act on, and letting an amount past the
 * outstanding balance produces a round trip that always fails.
 *
 * Mirrors the SQL in migration 014 §8:
 *   outstanding := investments.capital − SUM(confirmed payments)
 *   refuse when there is no enrolment, or amount > outstanding.
 */

type Enrolment = { units: number; capital: number; confirmed_paid: number };

/** Exactly the expressions the dialog computes. */
function topUp(enrolment: Enrolment | undefined, isEdit: boolean, amount: number) {
  const outstanding = enrolment
    ? Math.round((enrolment.capital - enrolment.confirmed_paid) * 100) / 100
    : 0;
  const canTopUp = !isEdit && Boolean(enrolment) && outstanding > 0.005;
  const overOutstanding = amount > outstanding + 0.005;
  return { outstanding, canTopUp, overOutstanding };
}

let failures = 0;
function check(name: string, cond: boolean, extra?: unknown) {
  if (cond) console.log("PASS:", name);
  else { failures++; console.error("FAIL:", name, extra ?? ""); }
}

// The reported enrolment: 6 slots, ₦3,000,000, but ₦2,500,000 confirmed
// because a ₦500,000 payment was reversed in error.
const HERS: Enrolment = { units: 6, capital: 3_000_000, confirmed_paid: 2_500_000 };

const hers = topUp(HERS, false, 500_000);
check("reported case: outstanding is one slot", hers.outstanding === 500_000, hers.outstanding);
check("reported case: the toggle is offered", hers.canTopUp);
check("reported case: ₦500,000 is allowed", !hers.overOutstanding);

// A single naira past the outstanding balance is refused, because the
// database refuses it too — better here than after a round trip.
check(
  "one naira over is refused",
  topUp(HERS, false, 500_001).overOutstanding
);

// A fully funded enrolment has nothing to top up. Offering the toggle
// there would only ever produce 'exceeds the outstanding balance'.
const FUNDED: Enrolment = { units: 6, capital: 3_000_000, confirmed_paid: 3_000_000 };
check("fully funded: not offered", !topUp(FUNDED, false, 1).canTopUp);
check("fully funded: outstanding is zero", topUp(FUNDED, false, 1).outstanding === 0);

// No enrolment in the selected cycle: the function raises 'no
// enrolment to apply an instalment to', so the toggle must not appear.
check("no enrolment: not offered", !topUp(undefined, false, 500_000).canTopUp);

// Editing an existing payment is a different flow with its own
// instalment handling; the toggle belongs to adding only.
check("editing: not offered", !topUp(HERS, true, 500_000).canTopUp);

// Float residue on a naira total must not present as a penny of
// outstanding balance and light the toggle on a settled enrolment.
const NOISY: Enrolment = { units: 6, capital: 3_000_000, confirmed_paid: 2_999_999.999 };
check("float noise does not offer a top-up", !topUp(NOISY, false, 1).canTopUp, topUp(NOISY, false, 1));

// Half slots are ordinary here: 0.5 × ₦500,000 = ₦250,000 outstanding.
const HALF: Enrolment = { units: 2.5, capital: 1_250_000, confirmed_paid: 1_000_000 };
const half = topUp(HALF, false, 250_000);
check("half-slot outstanding", half.outstanding === 250_000 && half.canTopUp && !half.overOutstanding, half);

// An OVERPAID enrolment gives a negative outstanding. It must not be
// offered — the fix there is to reverse the excess, not add more.
const OVER: Enrolment = { units: 6, capital: 3_000_000, confirmed_paid: 3_500_000 };
check("overpaid: not offered", !topUp(OVER, false, 1).canTopUp, topUp(OVER, false, 1).outstanding);

process.exit(failures === 0 ? 0 : 1);
