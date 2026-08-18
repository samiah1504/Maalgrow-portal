/**
 * Ordering and filtering the investor directory.
 *
 * IN A MODULE, NOT INLINE IN THE PAGE, because both rules are easy to
 * get subtly wrong and impossible to notice when you do. A list that
 * is sorted ALMOST alphabetically looks sorted.
 *
 * ── THE SORT IS BY WHAT YOU READ ─────────────────────────────
 *
 * By the investor's name as it appears on screen, which begins with
 * their first name — not by investor code, not by phone number, not
 * by the date they were added. Those three all LOOK like orderings
 * and none of them helps somebody hunting for Maryam.
 *
 * It is done here rather than in the query because PostgREST cannot
 * order by lower(full_name), and a case-sensitive sort puts "aisha"
 * after "Zainab" — which reads as a bug every single time. The page
 * loads the whole directory anyway, so there is nothing to page
 * through and nothing saved by ordering in SQL.
 *
 * ── ONE ROW PER PERSON ───────────────────────────────────────
 *
 * An investor with holdings in two series appears under each when
 * that series is chosen, and ONCE under All Series. That falls out of
 * filtering investors by their nested investments rather than
 * selecting investments and joining the investor on — which is the
 * shape that would duplicate them, and the reason this is written
 * down.
 */

export type DirectoryInvestment = {
  id: string;
  status: string;
  capital: number;
  series: { name: string } | null;
};

export type DirectoryInvestor = {
  id: string;
  full_name: string;
  investments: DirectoryInvestment[] | null;
};

export type SortOrder = "az" | "za";

/**
 * A collator, not `<`.
 *
 * That is the whole point. Comparing strings with `<` is byte order,
 * which puts EVERY capital letter before every lowercase one — so
 * "aisha bello" lands after "Zainab Yusuf" and the list still looks
 * sorted. Intl.Collator orders the way a person reads, in any locale
 * and with accents handled; `sensitivity: "base"` additionally makes
 * "Bello" and "bello" compare equal rather than merely adjacent, and
 * numeric ordering keeps "Cycle 2" before "Cycle 10".
 *
 * Built once. Constructing a Collator per comparison is the classic
 * way to make sorting a long list slow.
 */
const collator = new Intl.Collator("en", {
  sensitivity: "base",
  numeric: true,
});

/** The name as read — leading spaces are a typing accident, not order. */
function sortKey(investor: { full_name: string }): string {
  return (investor.full_name ?? "").trim();
}

/**
 * A cancelled holding is not a holding.
 *
 * Everything else counts — active, matured and completed alike. An
 * investor who finished Series B last quarter is still someone you go
 * looking for under Series B, and a directory that hid them would
 * send you to All Series to find somebody you already knew was there.
 */
export function investorSeries(investor: DirectoryInvestor): string[] {
  const names = new Set<string>();
  for (const inv of investor.investments ?? []) {
    if (inv.status === "cancelled") continue;
    const name = inv.series?.name;
    if (name) names.add(name);
  }
  return [...names].sort();
}

export function isInSeries(investor: DirectoryInvestor, series: string): boolean {
  return investorSeries(investor).includes(series);
}

/**
 * The directory, filtered and ordered.
 *
 * Sorting a COPY: the array handed in comes from the query result and
 * mutating it in place would reorder whatever else is reading it.
 */
export function orderDirectory<T extends DirectoryInvestor>(
  investors: T[],
  options: { series?: string | null; sort?: SortOrder } = {}
): T[] {
  const series = options.series?.trim() || null;
  const direction = options.sort === "za" ? -1 : 1;

  const filtered = series
    ? investors.filter((i) => isInSeries(i, series))
    : // All Series. No dedup step is needed and none is done — one
      // investor is one row here by construction.
      investors;

  return [...filtered].sort(
    (a, b) => direction * collator.compare(sortKey(a), sortKey(b))
  );
}

/** Which series exist in this set, for the filter's options. */
export function seriesPresent(investors: DirectoryInvestor[]): string[] {
  const names = new Set<string>();
  for (const i of investors) for (const n of investorSeries(i)) names.add(n);
  return [...names].sort();
}
