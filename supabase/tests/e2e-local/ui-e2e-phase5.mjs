// LOCAL end-to-end run of MaalRise Phase 5 (capital settlement, entry
// reversal, closing a Cycle) as real roles against the scratch stack.
// Rebuild the database with up.sh first; this run creates records.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { sign } from "./jwt.mjs";
const puppeteer = createRequire(new URL("../../../package.json", import.meta.url))("puppeteer-core");
const CHROME = process.env.CHROME ?? "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BASE = "http://localhost:3000";
const SHOTS = process.argv[2];
const P = {
  sa: ["a0000000-0000-0000-0000-0000000000a1", "sa@test.local"],
  admin: ["a0000000-0000-0000-0000-0000000000a2", "admin@test.local"],
  ops: ["a0000000-0000-0000-0000-0000000000a3", "ops@test.local"],
  fin: ["a0000000-0000-0000-0000-0000000000a4", "fin@test.local"],
  support: ["a0000000-0000-0000-0000-0000000000a5", "support@test.local"],
  officer: ["b0000000-0000-0000-0000-0000000000b1", "officer@test.local"],
  both: ["10000000-0000-0000-0000-0000000000c1", "both@test.local"],
};
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { if (ok) pass++; else fail++; console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok || !extra ? "" : ` — ${extra}`}`); };
const sql = (q) => execFileSync("psql", ["-d", "mr_e2e", "-Atc", q], { encoding: "utf8" }).trim();

function cookieFor(who) {
  const [id, email] = P[who];
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = sign({ sub: id, role: "authenticated", aud: "authenticated", email, exp });
  const session = { access_token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "local",
    user: { id, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } };
  return "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
}
async function api(who, method, path, body) {
  const r = await fetch(BASE + path, { method, redirect: "manual",
    headers: { Cookie: `sb-127-auth-token=${cookieFor(who)}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})), location: r.headers.get("location") };
}
const must = async (who, method, path, body) => {
  const r = await api(who, method, path, body);
  if (r.status >= 400) throw new Error(`${who} ${method} ${path} → ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
};

const lagos = (d = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const TODAY = lagos();
const addDays = (iso, n) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const minusMonths = (iso, n) => { const [y, m, d] = iso.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 - n, d, 12)); return t.toISOString().slice(0, 10); };
const START = addDays(minusMonths(TODAY, 2), -6);

const browser = await puppeteer.launch({ executablePath: CHROME, args: ["--no-sandbox"] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 1000 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
async function as(who) {
  // Leave the current page first: going to the same URL with a #section
  // does not reload, which would keep the previous person's view.
  await page.goto("about:blank");
  await page.deleteCookie(...(await page.cookies(BASE)));
  await page.setCookie({ name: "sb-127-auth-token", value: cookieFor(who), domain: "localhost", path: "/" });
}
async function go(path) { const r = await page.goto(BASE + path, { waitUntil: "networkidle0" }); return r?.status(); }
const text = () => page.evaluate(() => document.body.innerText);
const waitText = (s, ms = 15000) => page.waitForFunction((s) => document.body.innerText.includes(s), { timeout: ms }, s).then(() => true).catch(() => false);
async function toast(re) {
  const ok = await page.waitForFunction((src) => [...document.querySelectorAll("[data-sonner-toast]")].some((x) => new RegExp(src, "i").test(x.innerText)),
    { timeout: 15000 }, re.source).then(() => true).catch(() => false);
  if (!ok) console.log("   toasts:", await page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((x) => x.innerText).join(" | ")));
  return ok;
}
async function type(label, v, scope = "body") {
  const id = await page.evaluate((label, scope) => [...document.querySelector(scope).querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(label))?.htmlFor, label, scope);
  if (!id) throw new Error(`No input labelled ${label}`);
  await page.click(`[id="${id}"]`, { count: 3 });
  await page.type(`[id="${id}"]`, v);
}
async function setDate(label, v) {
  const id = await page.evaluate((label) => [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(label))?.htmlFor, label);
  await page.$eval(`[id="${id}"]`, (el, v) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }, v);
}
async function click(label, { exact = false, within = null, rowOnly = false } = {}) {
  const handle = await page.evaluateHandle((label, exact, within, rowOnly) => {
    const root = within ? [...document.querySelectorAll(rowOnly ? "tr" : "tr, li, div.rounded-lg")].find((r) => r.innerText.includes(within)) : document;
    return [...(root ?? document).querySelectorAll("button, a")].find((b) => {
      const t = b.textContent.trim();
      return (exact ? t === label : t.includes(label)) && !b.disabled;
    });
  }, label, exact, within, rowOnly);
  const el = handle.asElement();
  if (!el) throw new Error(`No enabled button "${label}"${within ? ` in "${within}"` : ""}`);
  await el.click();
}
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

// ── Setup through the real API: an active 2-month Cycle that matured 6 days ago ──
const created = await must("ops", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Kanziy Capital E2E Ltd" },
  cycle: { name: "E2E Phase 5 Cycle", transaction_name: "Murabaha", start_date: START, duration_months: 2, unit_price_kobo: 10_000_000 },
  terms: { costKobo: 1_000_000_000, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 400, treatment: "deducted_from_investors" },
           schedule: { mode: "equal" }, statedSalePriceKobo: 1_350_000_000 },
});
const C = created.id;
await must("ops", "POST", `/api/admin/maalrise/cycles/${C}/actions`, { action: "submit", terms_id: created.terms_id });
await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/actions`, { action: "approve", terms_id: created.terms_id });
const both = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "both@test.local", full_name: "" })).id;
const pend = (await must("ops", "POST", "/api/admin/maalrise/investors",
  { email: "pending.kyc@test.local", full_name: "Pending Kyc", bank_name: "Access", account_name: "Pending Kyc", account_number: "0011223344" })).id;
await must("ops", "POST", `/api/admin/maalrise/investors/${pend}`, { action: "record_kyc", details: { id_type: "NIN", id_number: "1", date_of_birth: "1990-01-01", address: "Lagos" } });
await must("admin", "POST", `/api/admin/maalrise/investors/${pend}`, { action: "review_kyc", decision: "verified", notes: "" });
for (const i of [both, pend]) await must("ops", "POST", `/api/admin/maalrise/investors/${i}`, { action: "confirm_bank" });
for (const [inv, units, ref] of [[both, 60, "F5-1"], [pend, 40, "F5-2"]]) {
  await must("fin", "POST", `/api/admin/maalrise/cycles/${C}/fundings`, { investor_id: inv, units, received_on: addDays(START, -2), reference: ref });
}
for (const f of sql(`select id from maalrise_investor_fundings where cycle_id = '${C}'`).split("\n")) {
  await must("sa", "POST", `/api/admin/maalrise/fundings/${f}`, { action: "confirm" });
}
const form = new FormData();
form.set("file", new Blob(["%PDF-1.4\n% E2E phase 5 contract\n"], { type: "application/pdf" }), "contract.pdf");
form.set("category", "contract");
const up = await fetch(`${BASE}/api/admin/maalrise/cycles/${C}/documents`, { method: "POST", body: form, headers: { Cookie: `sb-127-auth-token=${cookieFor("ops")}` } });
if (up.status !== 201) throw new Error(`contract upload ${up.status}`);
await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/actions`, { action: "activate" });
const L = Object.fromEntries(sql(`select l.period, l.counterparty_gross_kobo || ':' || l.fee_kobo from maalrise_schedule_lines l
  join maalrise_cycles c on c.approved_terms_id = l.terms_id where c.id = '${C}' order by period`).split("\n").map((r) => {
  const [p, rest] = r.split("|"); const [g, f] = rest.split(":"); return [p, { gross: Number(g), fee: Number(f) }]; }));
const MATURITY = sql(`select maalrise_maturity_date('${C}')`);
console.log(`setup: Cycle ${C} from ${START}; maturity ${MATURITY} (today ${TODAY}); month gross ${L[1].gross}`);

// ── 1. Capital reminders at maturity ─────────────────────────────────────
await as("fin");
await go("/admin/maalrise/notifications");
let t = await text();
check("capital-due reminder after maturity", t.includes("Capital repayment due: Kanziy Capital E2E Ltd") && t.includes("E2E Phase 5 Cycle matured on"));
check("capital follow-up five days after maturity", t.includes("Follow up: Kanziy Capital E2E Ltd capital overdue"));
check("reminders create no capital records", sql(`select count(*) from maalrise_capital_receipts`) === "0");

// ── 2. Monthly entries; super admin reverses a confirmed one ───────────────
for (const [period, amount, ref] of [[1, L[1].gross, "M1"], [2, 100_000_000, "M2A"], [2, L[2].gross - 100_000_000, "M2B"]]) {
  const r = await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/receipts`,
    { period, amount_kobo: amount, received_on: addDays(TODAY, -8), reference: ref, confirm_now: true });
  if (!r.confirmed) throw new Error(`receipt ${ref} not confirmed`);
}
const over = await api("fin", "POST", `/api/admin/maalrise/cycles/${C}/receipts`, { period: 2, amount_kobo: 1, received_on: TODAY });
check("a fully recorded month refuses more", over.status === 400 && /already fully recorded/.test(over.body.error ?? ""), JSON.stringify(over));
const m2a = sql(`select id from maalrise_receipts where reference='M2A'`);
check("an administrator cannot reverse a confirmed entry",
  (await api("admin", "POST", `/api/admin/maalrise/receipts/${m2a}`, { action: "reverse", reason: "x" })).status === 403);
await as("sa");
await go(`/admin/maalrise/cycles/${C}#receipts`);
await click("Reverse", { exact: true, within: "M2A" });
await page.type("input[placeholder='Reason for reversing (required)']", "Keyed against the wrong month");
await click("Reverse entry");
check("super admin reverses the entry with a reason", await toast(/reversed and recalculated/i));
await waitText("Keyed against the wrong month");
const d2 = sql(`select applied_kobo || ':' || fee_kobo || ':' || net_kobo from maalrise_distributions where cycle_id='${C}' and period=2`).split(":").map(Number);
const remaining = L[2].gross - 100_000_000;
check("month-2 distribution recalculated from what remains, fee exact",
  d2[0] === remaining && d2[1] === Math.round(remaining * L[2].fee / L[2].gross) && d2[2] === d2[0] - d2[1]);
check("the reversed entry is kept, marked Reversed", (await text()).includes("Reversed"));
await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/receipts`,
  { period: 2, amount_kobo: 100_000_000, received_on: addDays(TODAY, -8), reference: "M2A", confirm_now: true });
check("re-recorded: month 2 exact again (same distribution)",
  sql(`select count(*) || ':' || sum(applied_kobo) || ':' || sum(fee_kobo) from maalrise_distributions where cycle_id='${C}' and period=2`) === `1:${L[2].gross}:${L[2].fee}`);
for (const id of sql(`select id from maalrise_distributions where cycle_id='${C}' and status='prepared'`).split("\n")) {
  await must("admin", "POST", `/api/admin/maalrise/distributions/${id}`, { action: "approve" });
}

// ── 3. Capital in two parts; payout only when complete ─────────────────────
await as("fin");
await go(`/admin/maalrise/cycles/${C}#capital`);
t = await text();
check("capital section shows ₦10m due, status follow up", t.includes("₦10,000,000.00") && t.includes("Follow up"));
await type("Capital received (₦)", "4000000");
await setDate("Date capital received", addDays(TODAY, -3));
await type("Capital reference (optional)", "CAP-A");
check("finance gets no 'Confirm now' option for capital", !(await page.evaluate(() => [...document.querySelectorAll("label")].some((l) => l.textContent.includes("Confirm now")))));
check("part-capital note: investors repaid only once full capital is confirmed", await waitText("Investors are repaid only once the full capital is confirmed"));
await click("Record capital");
check("finance records ₦4m of capital", await toast(/Capital recorded — awaiting confirmation/i));
await waitText("CAP-A");
const capA = sql(`select id from maalrise_capital_receipts where reference='CAP-A'`);
check("finance cannot confirm capital", (await api("fin", "POST", `/api/admin/maalrise/capital/${capA}`, { action: "confirm" })).status === 403);

await as("admin");
await go(`/admin/maalrise/cycles/${C}#capital`);
await click("Confirm", { exact: true, within: "CAP-A" });
check("admin confirms the first part", await toast(/confirmed/i));
await waitText("still to be confirmed before investors can be repaid");
check("no payout prepared for part capital", sql(`select count(*) from maalrise_capital_settlements`) === "0");
await type("Capital received (₦)", "6000001");
check("an amount above the capital still owed is flagged", await waitText("of capital still owed. Check the amount."));
const capOver = await api("admin", "POST", `/api/admin/maalrise/cycles/${C}/capital`, { amount_kobo: 600_000_001, received_on: TODAY });
check("the database refuses capital above what is owed", capOver.status === 400 && /still owed/.test(capOver.body.error ?? ""));
await type("Capital received (₦)", "6000000");
await setDate("Date capital received", addDays(TODAY, -2));
await type("Capital reference (optional)", "CAP-B");
// the capital form's "Confirm now" (the monthly form's comes first on the page)
await page.evaluate(() => [...document.querySelectorAll("label")].filter((l) => l.textContent.includes("Confirm now")).pop()?.querySelector("input")?.click());
await click("Record capital");
check("admin records and confirms the rest", await toast(/Capital recorded and confirmed/i));
check("full capital confirmed → repayment prepared for review", await waitText("Capital repayment to investors"));
check("each investor gets back exactly what they funded (₦6m / ₦4m)",
  sql(`select string_agg(amount_kobo::text, ',' order by amount_kobo desc) from maalrise_capital_payments`) === "600000000,400000000");
await shot("p5-01-capital-prepared");

// ── 4. Super admin reverses a capital entry; prepared payout cancelled ─────
await as("sa");
await go(`/admin/maalrise/cycles/${C}#capital`);
await click("Reverse", { exact: true, within: "CAP-B" });
await page.type("input[placeholder='Reason for reversing (required)']", "Wrong value date");
await click("Reverse entry");
check("super admin reverses a capital entry", await toast(/reversed/i));
check("the prepared capital payout is cancelled", sql(`select string_agg(status, ',') from maalrise_capital_settlements`) === "cancelled"
  && sql(`select count(*) from maalrise_capital_payments`) === "0");
await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/capital`, { amount_kobo: 600_000_000, received_on: addDays(TODAY, -2), reference: "CAP-B", confirm_now: true });
check("recorded again → one live settlement", sql(`select count(*) from maalrise_capital_settlements where status <> 'cancelled'`) === "1");

// ── 5. Approve the capital settlement ──────────────────────────────────────
const S = sql(`select id from maalrise_capital_settlements where status = 'prepared'`);
check("finance cannot approve a capital settlement", (await api("fin", "POST", `/api/admin/maalrise/capital-settlements/${S}`, { action: "approve" })).status === 403);
await as("admin");
await go(`/admin/maalrise/cycles/${C}#capital`);
await click("Approve capital settlement");
check("admin approves the capital settlement", await toast(/capital settlement is approved/i));
check("capital repayments are payable", sql(`select string_agg(distinct status, ',') from maalrise_capital_payments`) === "payable");

// ── 6. Payment officer pays capital (and the profit) ───────────────────────
await as("officer");
await go("/admin/payment-requests/maalrise");
t = await text();
check("officer sees capital repayments, labelled", t.includes("Capital repayment") && t.includes("E2E Phase 5 Cycle"));
await shot("p5-02-officer-capital");
await click("Mark as Paid", { within: "Capital repayment", rowOnly: true });
await type("Transfer reference", "CAP-TRF-1");
await click("Confirm transfer made");
check("officer marks a capital repayment paid", await toast(/marked paid/i));
check("paid status stored on the capital payment", sql(`select count(*) from maalrise_capital_payments where status='paid' and paid_reference='CAP-TRF-1'`) === "1");
check("investor notified and an email DRAFT prepared",
  sql(`select count(*) from maalrise_email_outbox where kind='capital_paid' and status='draft'`) === "1"
  && sql(`select count(*) from maalrise_email_outbox where status <> 'draft'`) === "0");

// close is refused while anything is unpaid
const early = await api("admin", "POST", `/api/admin/maalrise/cycles/${C}/actions`, { action: "close" });
check("closing refused while payments are unpaid, with reasons", early.status === 400 && /not yet marked paid/.test(early.body.error ?? ""), JSON.stringify(early));
for (const id of sql(`select id from maalrise_distribution_lines where cycle_id='${C}' and status='payable'`).split("\n")) {
  await must("officer", "POST", `/api/admin/maalrise/payments/${id}`, { action: "mark_paid", paid_on: TODAY, reference: `P-${id.slice(0, 6)}` });
}
for (const id of sql(`select id from maalrise_capital_payments where status='payable'`).split("\n")) {
  await must("officer", "POST", `/api/admin/maalrise/payments/${id}`, { action: "mark_paid", paid_on: TODAY, reference: `C-${id.slice(0, 6)}`, kind: "capital" });
}

// ── 7. Close the Cycle ─────────────────────────────────────────────────────
check("operations cannot close", (await api("ops", "POST", `/api/admin/maalrise/cycles/${C}/actions`, { action: "close" })).status === 403);
await as("admin");
await go(`/admin/maalrise/cycles/${C}#closing`);
t = await text();
check("closing summary shows capital in, profit paid and capital returned per investor",
  t.includes("Capital in") && t.includes("Profit paid") && t.includes("Capital returned") && t.includes("₦6,000,000.00"));
await click("Run closing checks");
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Close Cycle") && !b.disabled), { timeout: 15000 }).catch(() => {});
await shot("p5-03-closing");
page.once("dialog", (dlg) => dlg.accept());
await click("Close Cycle");
check("administrator closes the Cycle", await toast(/Cycle closed/i));
await waitText("This Cycle is closed");
check("Cycle status is closed", sql(`select status from maalrise_cycles where id='${C}'`) === "closed");
const late = await api("fin", "POST", `/api/admin/maalrise/cycles/${C}/capital`, { amount_kobo: 1, received_on: TODAY });
check("a closed Cycle takes no more entries", late.status === 400);
const capLine = sql(`select id from maalrise_capital_payments limit 1`);
const rev = await api("sa", "POST", `/api/admin/maalrise/payments/${capLine}`, { action: "reverse", reason: "after close", kind: "capital" });
check("a closed Cycle's payments cannot be reversed", rev.status === 400 && /closed/.test(rev.body.error ?? ""), JSON.stringify(rev));
await shot("p5-04-closed");

await go("/admin/maalrise/dashboard");
check("dashboard loads after closing", (await text()).includes("MaalRise Dashboard"));
await go("/admin/payment-requests");
check("MaalGrow Payment Requests page still loads", !page.url().includes("/login"));
check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
