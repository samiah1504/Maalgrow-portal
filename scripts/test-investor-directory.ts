/**
 * Ordering and filtering the investor directory.
 *
 * A list that is ALMOST alphabetical looks alphabetical, which is why
 * these are worth writing down. Three things go wrong quietly:
 *
 *   1. A case-sensitive sort puts "aisha bello" after "Zainab" —
 *      every capital letter sorts before every lowercase one. The
 *      list still looks sorted until the one person entered in lower
 *      case is at the bottom and nobody can find them.
 *
 *   2. Sorting by investor_code, phone or created_at produces an
 *      order that is stable, plausible and useless for finding
 *      somebody by name.
 *
 *   3. Filtering by series through the INVESTMENTS table instead of
 *      the investors table duplicates anybody holding two of them.
 *
 *   npx tsx scripts/test-investor-directory.ts
 */
import {
  orderDirectory,
  investorSeries,
  isInSeries,
  seriesPresent,
  type DirectoryInvestor,
} from "../src/lib/investor-directory";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

type Row = DirectoryInvestor & {
  investor_code: string;
  phone: string;
  created_at: string;
};

const person = (
  full_name: string,
  code: string,
  series: string[],
  extra: { created_at?: string; phone?: string; status?: string } = {}
): Row => ({
  id: code,
  full_name,
  investor_code: code,
  phone: extra.phone ?? "08000000000",
  created_at: extra.created_at ?? "2026-01-01",
  investments: series.map((name, i) => ({
    id: `${code}-${i}`,
    status: extra.status ?? "active",
    capital: 1_000_000,
    series: { name },
  })),
});

/*
 * Deliberately built in an order that is NOT alphabetical, and with
 * codes and dates that run the other way — so a sort that quietly
 * used one of those instead would produce a different list.
 */
const DIRECTORY: Row[] = [
  person("Zainab Yusuf", "MG001", ["A"], { created_at: "2026-01-01" }),
  person("aisha bello", "MG002", ["B"], { created_at: "2026-02-01" }),
  person("Maryam Sani", "MG003", ["A", "B"], { created_at: "2026-03-01" }),
  person("Abdul Rahman", "MG004", ["C"], { created_at: "2026-04-01" }),
  person("Hauwa Idris", "MG005", ["B"], { created_at: "2026-05-01" }),
  person("  Bello Musa", "MG006", ["A"], { created_at: "2026-06-01" }),
  person("Fatima Umar", "MG007", [], { created_at: "2026-07-01" }),
];

const names = (rows: Row[]) => rows.map((r) => r.full_name.trim());

/* ── A → Z ────────────────────────────────────────────────────── */

const az = orderDirectory(DIRECTORY, { sort: "az" });

check(
  "A → Z is by the name as it reads",
  JSON.stringify(names(az)) ===
    JSON.stringify([
      "Abdul Rahman",
      "aisha bello",
      "Bello Musa",
      "Fatima Umar",
      "Hauwa Idris",
      "Maryam Sani",
      "Zainab Yusuf",
    ]),
  names(az)
);

// THE ONE THAT MATTERS MOST. A case-sensitive sort would put this
// person dead last, and the list would still look ordered.
check(
  "a lower-case name sorts among the As, not after Z",
  names(az).indexOf("aisha bello") === 1,
  names(az)
);

check(
  "leading whitespace is not an ordering",
  names(az).indexOf("Bello Musa") === 2,
  names(az)
);

/* ── And NOT by anything that merely looks like an order ──────── */

const codes = az.map((r) => r.investor_code);
check(
  "it is not ordered by investor code",
  JSON.stringify(codes) !== JSON.stringify([...codes].sort()),
  codes
);
const dates = az.map((r) => r.created_at);
check(
  "nor by the date they were added",
  JSON.stringify(dates) !== JSON.stringify([...dates].sort()),
  dates
);

/* ── Z → A ────────────────────────────────────────────────────── */

const za = orderDirectory(DIRECTORY, { sort: "za" });
check(
  "Z → A is the exact reverse",
  JSON.stringify(names(za)) === JSON.stringify([...names(az)].reverse()),
  names(za)
);
check("and A → Z is the default", JSON.stringify(names(orderDirectory(DIRECTORY))) === JSON.stringify(names(az)));

/* ── Nothing is mutated ───────────────────────────────────────── */

check(
  "the array handed in is left alone",
  DIRECTORY[0].full_name === "Zainab Yusuf",
  DIRECTORY[0].full_name
);

/* ── Series ───────────────────────────────────────────────────── */

const seriesA = orderDirectory(DIRECTORY, { series: "A" });
check(
  "Series A shows only Series A investors",
  JSON.stringify(names(seriesA)) ===
    JSON.stringify(["Bello Musa", "Maryam Sani", "Zainab Yusuf"]),
  names(seriesA)
);
check(
  "and is still alphabetical inside the filter",
  names(seriesA)[0] === "Bello Musa"
);

const seriesB = orderDirectory(DIRECTORY, { series: "B" });
check(
  "Series B shows only Series B investors",
  JSON.stringify(names(seriesB)) ===
    JSON.stringify(["aisha bello", "Hauwa Idris", "Maryam Sani"]),
  names(seriesB)
);

// Maryam holds A and B. She belongs in both filters...
check(
  "somebody in two series appears under each",
  names(seriesA).includes("Maryam Sani") && names(seriesB).includes("Maryam Sani")
);

// ...and EXACTLY ONCE in All Series. This is the duplicate the whole
// shape of the query is chosen to avoid.
const all = orderDirectory(DIRECTORY);
check(
  "and exactly once under All Series",
  all.filter((r) => r.full_name === "Maryam Sani").length === 1,
  all.filter((r) => r.full_name === "Maryam Sani").length
);
check(
  "All Series shows everybody, including those with no holding",
  all.length === DIRECTORY.length && names(all).includes("Fatima Umar"),
  names(all)
);

check(
  "a series nobody holds returns nobody, rather than everybody",
  orderDirectory(DIRECTORY, { series: "Z" }).length === 0
);
check(
  "an empty series value means All Series, not none",
  orderDirectory(DIRECTORY, { series: "" }).length === DIRECTORY.length
);

/* ── Which series somebody is in ──────────────────────────────── */

check(
  "two holdings in one series are listed once",
  JSON.stringify(investorSeries(person("Dup Twice", "MG100", ["A", "A"]))) ===
    JSON.stringify(["A"])
);
check(
  "an investor with no investments is in no series",
  investorSeries(person("None", "MG101", [])).length === 0
);

// A matured or completed holding still puts you in that series — you
// are somebody who is looked for under Series B either way.
check(
  "a matured holding still counts",
  isInSeries(person("Matured", "MG102", ["B"], { status: "matured" }), "B")
);
check(
  "and so does a completed one",
  isInSeries(person("Completed", "MG103", ["B"], { status: "completed" }), "B")
);
// A cancelled one does not. It never happened.
check(
  "a cancelled holding does not",
  !isInSeries(person("Cancelled", "MG104", ["B"], { status: "cancelled" }), "B")
);

check(
  "the series present are listed in order",
  JSON.stringify(seriesPresent(DIRECTORY)) === JSON.stringify(["A", "B", "C"]),
  seriesPresent(DIRECTORY)
);

console.log(
  failures === 0 ? "\nALL INVESTOR DIRECTORY TESTS PASSED" : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
