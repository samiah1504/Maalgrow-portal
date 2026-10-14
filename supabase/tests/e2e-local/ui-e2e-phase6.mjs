// LOCAL end-to-end run of MaalRise Phase 6 (the investor portal) as real
// investors and staff against the scratch stack. Rebuild with up.sh first.
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
  growOnly: ["10000000-0000-0000-0000-0000000000c2", "pending.kyc@test.local"],
  riseOnly: ["10000000-0000-0000-0000-0000000000c3", "login.only@test.local"],
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
const START = addDays(minusMonths(TODAY, 1), -6);

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
const sidebar = () => page.evaluate(() => document.querySelector("aside")?.innerText ?? "");
const statusOf = (sel) => page.$eval(sel, (el) => el.querySelector("[data-status]")?.getAttribute("data-status")).catch(() => null);
const naira = (k) => "₦" + (k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The MaalGrow KYC gate sends investors who have not submitted KYC to /kyc.
// Mark both MaalGrow investors as submitted and approved so their portal opens.
sql(`update investors set kyc_status = 'approved', kyc_submitted_at = now() where profile_id in
     ('10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c2')`);

// ── Setup through the real API: an active 3-month Cycle, month 1 due six days ago ──
const created = await must("ops", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Portal Counterparty E2E Ltd" },
  cycle: { name: "E2E Phase 6 Cycle", transaction_name: "Murabaha", start_date: START, duration_months: 3, unit_price_kobo: 10_000_000 },
  terms: { costKobo: 1_000_000_000, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 400, treatment: "deducted_from_investors" },
           schedule: { mode: "equal" }, statedSalePriceKobo: 1_350_000_000 },
});
const C = created.id;
await must("ops", "POST", `/api/admin/maalrise/cycles/${C}/actions`, { action: "submit", terms_id: created.terms_id });
await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/actions`, { action: "approve", terms_id: created.terms_id });
const both = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "both@test.local", full_name: "" })).id;
const only = (await must("ops", "POST", "/api/admin/maalrise/investors",
  { email: "login.only@test.local", full_name: "Login Only", bank_name: "Kuda", account_name: "Login Only", account_number: "5566778899" })).id;
await must("ops", "POST", `/api/admin/maalrise/investors/${only}`, { action: "record_kyc", details: { id_type: "NIN", id_number: "9", date_of_birth: "1990-01-01", address: "Abuja" } });
await must("admin", "POST", `/api/admin/maalrise/investors/${only}`, { action: "review_kyc", decision: "verified", notes: "Staff-only note E2E" });
// Since Phase 7 a MaalRise-only person has the investor record too, and fills the KYC form first.
sql(`update investors set kyc_status = 'approved', kyc_submitted_at = now() where profile_id = '10000000-0000-0000-0000-0000000000c3'`);
for (const i of [both, only]) await must("ops", "POST", `/api/admin/maalrise/investors/${i}`, { action: "confirm_bank" });
for (const [inv, units, ref] of [[both, 60, "F6-1"], [only, 40, "F6-2"]]) {
  await must("fin", "POST", `/api/admin/maalrise/cycles/${C}/fundings`, { investor_id: inv, units, received_on: addDays(START, -2), reference: ref });
}
for (const f of sql(`select id from maalrise_investor_fundings where cycle_id = '${C}'`).split("\n")) {
  await must("sa", "POST", `/api/admin/maalrise/fundings/${f}`, { action: "confirm" });
}
const form = new FormData();
form.set("file", new Blob(["%PDF-1.4\n% E2E phase 6 contract\n"], { type: "application/pdf" }), "contract.pdf");
form.set("category", "contract");
const up = await fetch(`${BASE}/api/admin/maalrise/cycles/${C}/documents`, { method: "POST", body: form, headers: { Cookie: `sb-127-auth-token=${cookieFor("ops")}` } });
if (up.status !== 201) throw new Error(`contract upload ${up.status}`);
await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/actions`, { action: "activate" });
const [GROSS, NET] = sql(`select l.counterparty_gross_kobo || '|' || l.investor_net_kobo from maalrise_schedule_lines l
  join maalrise_cycles c on c.approved_terms_id = l.terms_id where c.id = '${C}' and l.period = 1`).split("|").map(Number);
const BOTH_SHARE = NET * 60 / 100, ONLY_SHARE = NET * 40 / 100;
// Month 1 received in full, confirmed, approved; only the first investor's transfer is marked paid.
await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/receipts`,
  { period: 1, amount_kobo: GROSS, received_on: addDays(TODAY, -1), reference: "P6-M1", confirm_now: true });
const D1 = sql(`select id from maalrise_distributions where cycle_id='${C}' and period=1`);
await must("admin", "POST", `/api/admin/maalrise/distributions/${D1}`, { action: "approve" });
const bothLine = sql(`select id from maalrise_distribution_lines where distribution_id='${D1}' and maalrise_investor_id='${both}'`);
await must("officer", "POST", `/api/admin/maalrise/payments/${bothLine}`, { action: "mark_paid", paid_on: TODAY, reference: "P6-PAID-1" });
console.log(`setup: Cycle ${C} from ${START}; month net ${NET}; shares ${BOTH_SHARE}/${ONLY_SHARE}`);

// ── 1. An investor in both products: MaalGrow unchanged, plus a switch ──
await as("both");
await go("/dashboard");
let s = await sidebar();
check("both products: MaalGrow dashboard still opens", page.url().endsWith("/dashboard") && s.includes("My Investments"), page.url());
await page.waitForFunction(() => document.querySelector("aside")?.innerText.includes("MaalRise"), { timeout: 15000 }).catch(() => {});
s = await sidebar();
check("both products: sidebar offers the MaalGrow | MaalRise switch", s.includes("MaalGrow") && s.includes("MaalRise"));
await shot("p6-01-maalgrow-with-switch");
await click("MaalRise", { exact: true });
await page.waitForFunction(() => location.pathname === "/maalrise", { timeout: 15000 }).catch(() => {});
await waitText("Your Cycles");
let t = await text();
s = await sidebar();
check("switch opens the MaalRise overview", page.url().endsWith("/maalrise") && t.includes("Welcome, Both"));
check("MaalRise nav replaces MaalGrow nav", s.includes("My Cycles") && s.includes("Payments") && !s.includes("Profit History"));
check("overview: capital invested is the investor's own", t.includes(naira(600_000_000)));
check("overview: profit paid counts the transfer marked paid", t.includes(naira(BOTH_SHARE)));
check("overview: next expected payment is month 2", t.includes("Profit · month 2"));
check("overview: never the Cycle's total, markup or other investors",
  !t.includes(naira(1_000_000_000)) && !t.includes("35") && !/markup/i.test(t) && !t.includes("Login Only"));
await shot("p6-02-overview");

// ── 2. The Cycle page: months, statuses, capital ─────────────────────────
await go(`/maalrise/cycles/${C}`);
t = await text();
check("Cycle page: holding is units × price and own capital", t.includes("60 × ₦100,000.00") && t.includes(naira(600_000_000)));
check("Cycle page: month 1 Paid (green) with date and reference",
  (await statusOf("tr[data-month='1']")) === "paid" && t.includes("Ref P6-PAID-1"));
check("Cycle page: later months Scheduled", (await statusOf("tr[data-month='2']")) === "scheduled" && (await statusOf("tr[data-month='3']")) === "scheduled");
check("Cycle page: expected profit per month is the investor's share", t.includes(naira(BOTH_SHARE)));
check("Cycle page: capital repayment scheduled for maturity", t.includes("Capital repayment") && t.includes(naira(600_000_000)));
check("Cycle page: no total cost, markup, fee workings or other investors",
  !t.includes(naira(1_000_000_000)) && !/markup|service fee|fee basis/i.test(t) && !t.includes("Login Only") && !t.includes("Staff-only"));
await shot("p6-03-cycle");
const other = await go(`/maalrise/cycles/00000000-0000-0000-0000-000000000000`);
check("a Cycle the investor is not in is not found", other === 404);

// ── 3. Payments, statement, CSV ─────────────────────────────────────────
await go("/maalrise/payments");
t = await text();
check("payments: the paid transfer with last four digits only", t.includes("····6701") && !t.includes("0123456701") && t.includes("P6-PAID-1"));
await go("/maalrise-statement");
t = await text();
check("printable statement: holdings and total received", t.includes("MaalRise statement") && t.includes("E2E Phase 6 Cycle")
  && t.includes("Total received") && t.includes(naira(BOTH_SHARE)));
await shot("p6-04-statement");
const csvRes = await fetch(`${BASE}/api/maalrise/statement`, { headers: { Cookie: `sb-127-auth-token=${cookieFor("both")}` } });
const csv = await csvRes.text();
check("CSV statement downloads with the paid row, account masked",
  csvRes.status === 200 && /attachment; filename="maalrise-statement-/.test(csvRes.headers.get("content-disposition") ?? "")
  && csv.includes("P6-PAID-1") && csv.includes("****6701") && !csv.includes("0123456701"), csv);

// ── 4. A MaalRise-only investor ─────────────────────────────────────────
await as("riseOnly");
await go("/dashboard");
await page.waitForFunction(() => location.pathname === "/maalrise", { timeout: 15000 }).catch(() => {});
await waitText("Your Cycles");
s = await sidebar();
check("MaalRise-only: MaalGrow pages lead to the MaalRise overview", page.url().endsWith("/maalrise"), page.url());
check("MaalRise-only: no product switch, MaalRise branding", !s.includes("MaalGrow\nMaalRise") && s.includes("MaalRise") && s.includes("My Cycles"));
await go(`/maalrise/cycles/${C}`);
check("MaalRise-only: month 1 approved for payment, not paid", (await statusOf("tr[data-month='1']")) === "approved"
  && (await text()).includes(`${naira(ONLY_SHARE)} approved, being transferred`));
await shot("p6-05-rise-only-cycle");

// ── 5. Bank detail change: request, review, decision ──────────────────────
await go("/maalrise/profile");
check("My details: confirmed account shown", (await text()).includes("5566778899") && (await text()).includes("Confirmed"));
check("My details: no staff KYC notes", !(await text()).includes("Staff-only"));
await click("Request a change of bank details");
await type("Bank name", "Opay");
await type("Account name", "Login Only");
await type("Account number", "6000000001");
await click("Submit for review");
check("investor submits a bank change", await toast(/Request sent/i));
await waitText("Change waiting for review");
check("pending request shown beside the confirmed account", (await text()).includes("6000000001") && (await text()).includes("5566778899"));
check("still paid to the confirmed account until approved",
  sql(`select account_number from maalrise_investors where id='${only}'`) === "5566778899");
const dup = await api("riseOnly", "POST", "/api/maalrise/bank-change", { bank_name: "X", account_name: "Y", account_number: "1234567890" });
check("a second request is refused while one waits", dup.status === 400 && /already have a change waiting/.test(dup.body.error ?? ""));
await shot("p6-06-bank-request");

await as("fin");
check("finance cannot review bank changes",
  (await api("fin", "POST", `/api/admin/maalrise/bank-changes/${sql(`select id from maalrise_bank_change_requests where status='pending'`)}`, { action: "approve" })).status === 403);
await as("ops");
await go("/admin/maalrise/dashboard");
check("staff dashboard flags the request", await page.$("[data-testid='bank-change-banner']") !== null);
await go(`/admin/maalrise/investors/${only}#bank`);
check("investor page shows the requested account", (await text()).includes("The investor asked to change their payment account"));
await click("Approve new details");
check("operations approves the new account", await toast(/approved and confirmed/i));
check("approved details become the confirmed account",
  sql(`select account_number || ':' || (bank_confirmed_at is not null) from maalrise_investors where id='${only}'`) === "6000000001:true");
await shot("p6-07-admin-approved");

await as("riseOnly");
await go("/maalrise/profile");
t = await text();
check("investor sees the approval and the new account", t.includes("6000000001") && t.includes("was approved"));
await go("/maalrise/notifications");
check("investor alert: bank details updated", (await text()).includes("Bank details updated"));

// The other investor asks, then withdraws; a rejection carries its reason.
await as("both");
await go("/maalrise/profile");
await click("Request a change of bank details");
await type("Bank name", "Moniepoint");
await type("Account name", "Both Products");
await type("Account number", "7000000001");
await click("Submit for review");
await toast(/Request sent/i);
await waitText("Withdraw request");
await click("Withdraw request");
check("investor withdraws their own request", await toast(/Request withdrawn/i));
const r2 = await must("both", "POST", "/api/maalrise/bank-change", { bank_name: "Moniepoint", account_name: "Wrong Name", account_number: "7000000002" });
check("a rejection needs a reason", (await api("admin", "POST", `/api/admin/maalrise/bank-changes/${r2.id}`, { action: "reject", reason: " " })).status === 400);
await must("admin", "POST", `/api/admin/maalrise/bank-changes/${r2.id}`, { action: "reject", reason: "Account name does not match" });
await go("/maalrise/profile");
check("investor sees the rejection reason", (await text()).includes("Account name does not match"));
check("investor's own alert carries the reason", sql(`select count(*) from maalrise_notifications where kind='bank_change_rejected'
  and message like '%does not match%' and user_id='10000000-0000-0000-0000-0000000000c1'`) === "1");

// ── 6. Who cannot see what ─────────────────────────────────────────────
await as("growOnly");
await go("/maalrise");
s = await sidebar();
check("MaalGrow-only investor: /maalrise sends them to their dashboard", page.url().endsWith("/dashboard"), page.url());
check("MaalGrow-only investor: sidebar unchanged, no switch", s.includes("My Investments") && !s.includes("MaalRise"));
await shot("p6-08-maalgrow-only");
check("MaalGrow-only investor: statement API refuses", (await api("growOnly", "GET", "/api/maalrise/statement")).status !== 200
  || !(await (await fetch(`${BASE}/api/maalrise/statement`, { headers: { Cookie: `sb-127-auth-token=${cookieFor("growOnly")}` } })).text()).includes("P6"));
check("staff cannot use the investor routes", (await api("admin", "POST", "/api/maalrise/bank-change", { bank_name: "a", account_name: "b", account_number: "1234567890" })).status === 403);
check("investors cannot use the staff review route", (await api("both", "POST", `/api/admin/maalrise/bank-changes/${r2.id}`, { action: "approve" })).status === 403);
const rest = async (who, table) => {
  const [id, email] = P[who];
  const jwt = sign({ sub: id, role: "authenticated", aud: "authenticated", email, exp: Math.floor(Date.now() / 1000) + 600 });
  const r = await fetch(`http://127.0.0.1:54321/rest/v1/${table}?select=*`, { headers: { Authorization: `Bearer ${jwt}` } });
  return r.ok ? (await r.json()).length : -1;
};
for (const tbl of ["maalrise_cycle_terms", "maalrise_schedule_lines", "maalrise_cycles", "maalrise_investors", "maalrise_kyc_submissions"]) {
  check(`investor reads nothing from ${tbl} directly`, (await rest("both", tbl)) === 0);
}
check("investor still reads their own allocation", (await rest("both", "maalrise_allocations")) === 1);

// ── 7. MaalGrow pages and earlier MaalRise screens still load ───────────────
await as("both");
for (const path of ["/investments", "/roi-history", "/notifications", "/profile"]) {
  await go(path);
  check(`MaalGrow ${path} still loads for an investor in both`, page.url().endsWith(path) && !(await text()).includes("Application error"), page.url());
}
await as("officer");
await go("/admin/payment-requests/maalrise");
check("payment officer screen still loads", (await text()).includes("E2E Phase 6 Cycle"));
await as("admin");
await go(`/admin/maalrise/cycles/${C}`);
check("staff Cycle page still loads", (await text()).includes("E2E Phase 6 Cycle"));
check("no email was sent", sql(`select count(*) from maalrise_email_outbox where status <> 'draft'`) === "0");
check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
