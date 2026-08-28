/**
 * The naira/kobo boundary on the payment-gap tab and its reminder email.
 *
 * THE BUG THIS EXISTS TO END. Two currencies live in this portal and
 * both are correct in their own half:
 *
 *   INTEGER KOBO   the Mudarabah engine. Money is never a float, so
 *                  lib/mudarabah/format.ts divides by 100 to display
 *                  — and is right to.
 *
 *   NAIRA NUMERIC  the investment ledger the portal was built on.
 *                  declare_cycle_profit writes declared_profit as
 *                  `gross_kobo / 100.0`, so it is already naira.
 *
 * investors_awaiting_payment_request (044) is on the NAIRA side. Every
 * money column it returns comes from investments.capital and
 * investments.declared_profit. Two places treated those as kobo and
 * divided again:
 *
 *   awaiting-payment-request.tsx  the tab — ₦120,100 shown as ₦1,201
 *   api/admin/payment-gap/route.ts  the REMINDER EMAIL — the same
 *                                   figure in the subject line and a
 *                                   30px headline, sent to the investor
 *
 * Nothing was ever stored wrong and no payment was raised from these
 * numbers; the gap tab reports what is owed, it does not compute it.
 * But a figure a hundred times too small is exactly the sort of thing
 * that gets believed, and one of the two ways out of here was an email
 * to the person whose money it is.
 *
 * A unit boundary cannot be caught by reading the code — both sides
 * look reasonable — so it is pinned here instead.
 *
 *   npx tsx scripts/test-gap-money-units.ts
 */
import { readFileSync } from "node:fs";

let failures = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const ROUTE = "src/app/api/admin/payment-gap/route.ts";
const TAB = "src/components/admin/awaiting-payment-request.tsx";
const MIGRATION = "supabase/migrations/044_awaiting_payment_request.sql";

const route = readFileSync(ROUTE, "utf8");
const tab = readFileSync(TAB, "utf8");
const migration = readFileSync(MIGRATION, "utf8");

/**
 * Comments quote the old broken line on purpose, so the search has to
 * ignore them or it can never go green.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");
}

// ------------------------------------------------------------
// 1. The source really is naira, which is what makes /100 wrong.
// ------------------------------------------------------------
check(
  "044 returns profit_available from investments.declared_profit",
  /COALESCE\(i\.declared_profit_net,\s*i\.declared_profit,\s*0\)/.test(migration),
  "the RPC no longer reads the naira column this test is about"
);

// ------------------------------------------------------------
// 2. THE EMAIL. The one that reaches the investor.
// ------------------------------------------------------------
const routeCode = code(route);

check(
  "the reminder email passes profit_available undivided",
  /profitAvailable:\s*Number\(row\.profit_available\),/.test(routeCode),
  "profitAvailable is not passed as plain naira"
);
check(
  "the reminder email passes capital undivided",
  /capital:\s*Number\(row\.capital\),/.test(routeCode),
  "capital is not passed as plain naira"
);
check(
  "no /100 survives anywhere in the payment-gap route",
  !/\/\s*100\b/.test(routeCode),
  "something still divides by 100 on the naira side"
);

// ------------------------------------------------------------
// 3. THE TAB.
// ------------------------------------------------------------
const tabCode = code(tab);

check(
  "the tab formats with formatCurrency rather than dividing",
  /const naira = \([a-zA-Z]+: number\) => formatCurrency\(/.test(tabCode),
  "the tab is not using the shared naira formatter"
);
check(
  "no /100 survives anywhere in the tab",
  !/\/\s*100\b/.test(tabCode),
  "something still divides by 100 on the naira side"
);
check(
  "formatCurrency is actually imported",
  /import \{[^}]*formatCurrency[^}]*\} from "@\/lib\/utils"/.test(tab),
  "the formatter is used but not imported"
);

// ------------------------------------------------------------
// 4. The kobo half is left alone. Deleting every /100 in the portal
//    would break the Mudarabah engine, where the input really is kobo.
// ------------------------------------------------------------
const fmt = readFileSync("src/lib/mudarabah/format.ts", "utf8");
check(
  "the Mudarabah formatter still divides, because its input is kobo",
  /\/\s*100\b/.test(fmt),
  "the kobo-side formatter lost its conversion — that is a different bug"
);

// ------------------------------------------------------------
// 5. What the numbers actually come out as.
// ------------------------------------------------------------
const formatCurrency = (amount: number) =>
  new Intl.NumberFormat("en-NG", {
    style: "currency",
    currency: "NGN",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

const stored = 120_100.5; // naira, as declare_cycle_profit writes it
const shown = formatCurrency(stored);
check(
  "a stored 120,100.50 displays as ₦120,100.50",
  shown.includes("120,100.50"),
  `showed ${shown}`
);
check(
  "and not as the ₦1,201 that was reported",
  !shown.includes("1,201."),
  `showed ${shown}`
);

const old = `₦${Math.round(stored / 100).toLocaleString("en-NG")}`;
check(
  "the old helper is confirmed to have produced ₦1,201",
  old === "₦1,201",
  `the old helper produced ${old}, so this test is not reproducing the report`
);

console.log(
  failures === 0
    ? "\n=== ALL GAP MONEY UNIT TESTS PASSED ==="
    : `\n=== ${failures} FAILED ===`
);
process.exit(failures === 0 ? 0 : 1);
