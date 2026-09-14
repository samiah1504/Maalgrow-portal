/**
 * What an investor currently has with us.
 *
 * investment_status has four values and only ONE of them is a
 * holding:
 *
 *   active      a live enrolment — money with us, in a running cycle
 *   matured     its cycle has ended
 *   completed   paid out, or continued into the next cycle
 *   cancelled   reversed
 *
 * ── THE TWO FAULTS THIS ENDS ─────────────────────────────────
 *
 * COUNTING. The admin investor page headed its list with
 * `investor.investments.length` — the raw array, every status. An
 * investor with two live enrolments and one matured cycle behind her
 * was shown "Investments (3)" directly beneath a card correctly
 * reading "Active Investments: 2". Two definitions of the same thing,
 * side by side, disagreeing.
 *
 * CAPITAL. Worse, because it was money. Total Capital excluded only
 * 'cancelled', so a rollover was counted on both sides of itself: the
 * rollover writes a NEW enrolment carrying the capital forward and
 * leaves the old one at 'completed' with its own capital still on it.
 * ₦1,000,000 continued from Series B Apr–Jul into Jul–Oct read as
 * ₦2,000,000. The money had not doubled; it had been counted twice
 * for having moved.
 *
 * ── WHY A MODULE AND NOT A FILTER IN THE PAGE ────────────────
 *
 * There were already three separate `status === "active"` passes in
 * that one file plus a fourth rule for capital. That is the exact
 * shape that put a Payment Officer into the investor portal (see
 * home-for-role.ts): one rule written out by hand in several places,
 * later updated in only some of them. Derived once here, and read.
 *
 * Nothing here hides anything. Matured and completed enrolments are
 * still listed on the page — their payment history, declared profit
 * and acknowledgement all live there. They simply stop being counted
 * as current.
 */

/** The only status that is a live holding. */
export const CURRENT_STATUS = "active";

/** Just enough of an investment to decide, so tests need no fixtures. */
export type HoldingLike = {
  status: string;
  capital: number;
  units: number;
};

export type Holdings = {
  /** Live enrolments only. */
  current: HoldingLike[];
  /** How many the investor currently has. */
  count: number;
  /** Capital currently with us. Never double-counts a rollover. */
  capital: number;
  /** Slots currently held. */
  slots: number;
  /** Matured, completed or cancelled. Still listed, never counted. */
  pastCount: number;
};

export function holdingsOf(investments: readonly HoldingLike[]): Holdings {
  const current = investments.filter((i) => i.status === CURRENT_STATUS);
  return {
    current,
    count: current.length,
    capital: current.reduce((s, i) => s + i.capital, 0),
    slots: current.reduce((s, i) => s + i.units, 0),
    pastCount: investments.length - current.length,
  };
}
