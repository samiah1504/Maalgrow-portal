// LOCAL end-to-end run of MaalRise Phase 4 (receipts, distributions, payments,
// reminders, contract upload, activation) as real roles against the scratch stack.
// Rebuild the database with up.sh first; this run creates records.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const START = minusMonths(TODAY, 3);

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
async function click(label, { exact = false, within = null } = {}) {
  const handle = await page.evaluateHandle((label, exact, within) => {
    const root = within ? [...document.querySelectorAll("tr, li, div.rounded-lg")].find((r) => r.innerText.includes(within)) : document;
    return [...(root ?? document).querySelectorAll("button, a")].find((b) => {
      const t = b.textContent.trim();
      return (exact ? t === label : t.includes(label)) && !b.disabled;
    });
  }, label, exact, within);
  const el = handle.asElement();
  if (!el) throw new Error(`No enabled button "${label}"${within ? ` in "${within}"` : ""}`);
  await el.click();
}
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

// ── Setup through the real API: an approved, fully funded Cycle ───────────
const created = await must("ops", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Kanziy E2E Ltd" },
  cycle: { name: "E2E Phase 4 Cycle", transaction_name: "Murabaha", start_date: START, duration_months: 6, unit_price_kobo: 10_000_000 },
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
for (const [inv, units, ref] of [[both, 60, "F4-1"], [pend, 40, "F4-2"]]) {
  await must("fin", "POST", `/api/admin/maalrise/cycles/${C}/fundings`, { investor_id: inv, units, received_on: addDays(START, -2), reference: ref });
}
for (const f of sql(`select id from maalrise_investor_fundings where cycle_id = '${C}'`).split("\n")) {
  await must("sa", "POST", `/api/admin/maalrise/fundings/${f}`, { action: "confirm" });
}
const L = Object.fromEntries(sql(`select l.period, l.counterparty_gross_kobo || ':' || l.fee_kobo || ':' || l.due_date from maalrise_schedule_lines l
  join maalrise_cycles c on c.approved_terms_id = l.terms_id where c.id = '${C}' order by period`).split("\n").map((r) => {
  const [p, rest] = r.split("|"); const [g, f, d] = rest.split(":"); return [p, { gross: Number(g), fee: Number(f), due: d }]; }));
console.log(`setup: Cycle ${C} from ${START}; month 3 due ${L[3].due} (today ${TODAY}); month gross ${L[1].gross} kobo`);

// ── 1. Contract upload, then activation (no lock) ──────────────────────────
await as("admin");
await go(`/admin/maalrise/cycles/${C}`);
await click("Run activation checks");
await page.waitForSelector("ul.grid li", { timeout: 15000 }).catch(() => {});
check("activation blocked only by the missing contract", (await text()).includes("Original contract uploaded") && !(await page.evaluate(() =>
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Activate Cycle"))?.disabled === false)));
check("no 'switched off' lock message any more", !(await text()).includes("switched off"));

await as("ops");
await go(`/admin/maalrise/cycles/${C}`);
const pdf = `${SHOTS}/contract.pdf`;
fs.writeFileSync(pdf, "%PDF-1.4\n% E2E test contract\n");
await (await page.$("#doc-file")).uploadFile(pdf);
await click("Upload", { exact: true });
check("ops uploads the contract", await toast(/Contract uploaded/));
check("contract listed", await waitText("contract.pdf"));
const docId = sql(`select id from maalrise_documents where cycle_id = '${C}'`);
const dl = await api("support", "GET", `/api/admin/maalrise/documents/${docId}`);
const file = dl.location ? await (await fetch(dl.location)).text() : "";
check("staff download goes through a short signed link to the private file", dl.status === 307 && file.includes("E2E test contract"), JSON.stringify(dl));
check("an investor login cannot open the document", (await api("both", "GET", `/api/admin/maalrise/documents/${docId}`)).status === 403);
const unsigned = await fetch(`http://127.0.0.1:54321/storage/v1/object/maalrise-documents/${sql(`select storage_path from maalrise_documents where id='${docId}'`)}`);
check("the bucket refuses anyone without the server key", unsigned.status === 403 || unsigned.status === 400);

await as("admin");
await go(`/admin/maalrise/cycles/${C}`);
await click("Run activation checks");
await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Activate Cycle") && !b.disabled), { timeout: 15000 }).catch(() => {});
page.once("dialog", (d) => d.accept());
await click("Activate Cycle");
check("administrator activates once every check passes", await toast(/Cycle activated/));
check("Cycle is active", sql(`select status from maalrise_cycles where id='${C}'`) === "active");

// ── 2. Reminders: due today, follow-up after five days, nothing recorded ──
await as("fin");
await go("/admin/maalrise/dashboard");
check("sidebar shows unread MaalRise alerts", await page.waitForFunction(() =>
  [...document.querySelectorAll("a")].some((a) => a.textContent.includes("MaalRise Alerts") && /\d/.test(a.textContent)), { timeout: 15000 }).then(() => true).catch(() => false));
await go("/admin/maalrise/notifications");
let t = await text();
check("due-today reminder with the agreed wording",
  L[3].due !== TODAY || t.includes("Today is the scheduled payment date for Kanziy E2E Ltd. Please record the payment received when available."));
check("months over five days late are flagged for follow-up", (t.match(/Follow up: Kanziy E2E Ltd payment overdue/g) ?? []).length === 2);
check("a reminder creates no receipt or distribution",
  sql(`select count(*) from maalrise_receipts`) === "0" && sql(`select count(*) from maalrise_distributions`) === "0");
await shot("p4-01-alerts");
await go(`/admin/maalrise/cycles/${C}#receipts`);
t = await text();
check("Cycle shows months 1–2 'Follow up' and month 3 'Due today'", (t.match(/Follow up/g) ?? []).length >= 2 && (L[3].due !== TODAY || t.includes("Due today")));

// ── 3. Finance records month 1 (entered late, actual date kept) ──────────
await page.select("#receipt-month", "1");
await type("Amount received (₦)", String(L[1].gross / 100));
await setDate("Date received", addDays(TODAY, -40));
await type("Payment reference (optional)", "KZ-E2E-001");
check("finance does not get a 'Confirm now' option", !(await page.evaluate(() => document.body.innerText.includes("Confirm now"))));
await click("Record payment");
check("finance records the payment", await toast(/awaiting confirmation/i));
await waitText("KZ-E2E-001");
check("entry awaits an administrator", (await text()).includes("An administrator confirms"));
const r1 = sql(`select id from maalrise_receipts where reference='KZ-E2E-001'`);
check("finance cannot confirm through the API", (await api("fin", "POST", `/api/admin/maalrise/receipts/${r1}`, { action: "confirm" })).status === 403);
check("the actual received date is stored", sql(`select received_on from maalrise_receipts where id='${r1}'`) === addDays(TODAY, -40));
await shot("p4-02-recorded");

// ── 4. Administrator confirms → distribution calculated ───────────────────
await as("admin");
await go(`/admin/maalrise/cycles/${C}#receipts`);
await click("Confirm", { exact: true, within: "KZ-E2E-001" });
check("administrator confirms the payment", await toast(/distribution has been calculated/i));
await waitText("Prepared — awaiting approval");
const d1 = sql(`select id || '|' || applied_kobo || '|' || fee_kobo || '|' || net_kobo || '|' || allocated_kobo || '|' || unallocated_kobo from maalrise_distributions where cycle_id='${C}' and period=1`).split("|");
const lines1 = sql(`select string_agg(amount_kobo::text, ',' order by units desc) from maalrise_distribution_lines where distribution_id='${d1[0]}'`).split(",").map(Number);
check("fee taken in proportion: the whole month's fee for the whole month's payment", Number(d1[1]) === L[1].gross && Number(d1[2]) === L[1].fee);
check("investors' 60/40 shares add up to the net exactly, nothing unallocated",
  lines1.reduce((a, b) => a + b, 0) === Number(d1[3]) && Number(d1[5]) === 0 && lines1.length === 2);
check("60-unit holder gets 60% of the net, within the one-kobo rounding", Math.abs(lines1[0] - Number(d1[3]) * 0.6) <= 1);
t = await text();
check("each payment shows 'Awaiting approval' and the confirmed account", t.includes("Awaiting approval") && t.includes("0123456701"));

// ── 5. Admin records month 2 part-payment AND confirms it in one step ─────
await page.select("#receipt-month", "2");
const part = Math.round(L[2].gross / 3);
await type("Amount received (₦)", (part / 100).toFixed(2));
await setDate("Date received", addDays(TODAY, -3));
check("part-payment warning shown", await waitText("will remain outstanding for month 2"));
await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Confirm now"))?.querySelector("input")?.click());
await click("Record payment");
check("admin records and confirms their own entry", await toast(/recorded and confirmed/i));
await waitText("Part-paid");
check("month 2 shows part-paid with the rest outstanding",
  sql(`select applied_kobo from maalrise_distributions where cycle_id='${C}' and period=2`) === String(part) && (await text()).includes("Part-paid"));
// second part for month 2: more than is still owed is refused (Phase 5 rule)
await page.select("#receipt-month", "2");
await type("Amount received (₦)", String((L[2].gross - part + 500000) / 100));
await setDate("Date received", TODAY);
check("an amount above what is still owed is flagged, and Record is disabled",
  await waitText("still owed for month 2. Check the amount.") && !(await page.evaluate(() =>
    [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Record payment") && !b.disabled))));
const over = await api("admin", "POST", `/api/admin/maalrise/cycles/${C}/receipts`,
  { period: 2, amount_kobo: L[2].gross - part + 500000, received_on: TODAY });
check("the database refuses it too", over.status === 400 && /still owed for month 2/.test(over.body.error ?? ""), JSON.stringify(over));
// the exact remainder completes the month
await type("Amount received (₦)", ((L[2].gross - part) / 100).toFixed(2));
await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Confirm now"))?.querySelector("input")?.click());
await click("Record payment");
await toast(/recorded and confirmed/i);
await sleep(800);
check("one distribution for month 2, totals exactly the scheduled month",
  sql(`select count(*) from maalrise_distributions where cycle_id='${C}' and period=2`) === "1"
  && sql(`select applied_kobo || ':' || fee_kobo from maalrise_distributions where cycle_id='${C}' and period=2`) === `${L[2].gross}:${L[2].fee}`);
await shot("p4-03-distributions");

// ── 6. Approve month 1 (the preparer may approve) ─────────────────────────
check("finance cannot approve a distribution", (await api("fin", "POST", `/api/admin/maalrise/distributions/${d1[0]}`, { action: "approve" })).status === 403);
check("payment officer cannot approve a distribution", (await api("officer", "POST", `/api/admin/maalrise/distributions/${d1[0]}`, { action: "approve" })).status === 403);
await go(`/admin/maalrise/cycles/${C}#distributions`);
await click("Approve distribution", { within: "Month 1 (scheduled" });
check("administrator approves month 1", await toast(/distribution is approved/i));
await waitText("Approved — to pay");
check("month-1 payments are payable; month 2 still awaits approval",
  sql(`select string_agg(distinct status, ',') from maalrise_distribution_lines where distribution_id='${d1[0]}'`) === "payable"
  && sql(`select string_agg(distinct l.status, ',') from maalrise_distribution_lines l join maalrise_distributions d on d.id=l.distribution_id where d.cycle_id='${C}' and d.period=2`) === "pending_approval");

// ── 7. Payment officer: Mark as Paid ───────────────────────────────────────
await as("officer");
await go("/admin/maalrise/dashboard");
check("payment officer cannot open MaalRise admin pages", page.url().includes("/admin/payment-requests"));
await go("/admin/payment-requests/maalrise");
t = await text();
check("officer sees the two approved month-1 payments, nothing awaiting approval",
  t.includes("To pay (2)") && t.includes("Both Products") && t.includes("Pending Kyc"));
check("officer sees the bank account to pay", t.includes("0011223344"));
check("officer sees which Cycle and month each payment is for", t.includes("E2E Phase 4 Cycle") && t.includes("Profit · month 1"));
check("officer's sidebar shows MaalRise Payments, highlighted alone", await page.evaluate(() => {
  const links = [...document.querySelectorAll("aside a")];
  const mr = links.find((a) => a.textContent.includes("MaalRise Payments"));
  const pr = links.find((a) => a.textContent.includes("Payment Requests"));
  return !!mr && mr.className.includes("bg-primary-600") && !!pr && !pr.className.includes("bg-primary-600");
}));
await shot("p4-04-officer-queue");
await click("Mark as Paid", { within: "Both Products" });
await type("Transfer reference", "TRF-E2E-778");
await click("Confirm transfer made");
check("officer marks the payment paid", await toast(/marked paid/i));
await go("/admin/payment-requests/maalrise");
await click("Paid (1)");
t = await text();
check("paid shows with date and reference", t.includes("Paid") && t.includes("TRF-E2E-778"));
const lineBoth = sql(`select id from maalrise_distribution_lines where distribution_id='${d1[0]}' and investor_name='Both Products'`);
check("status stored centrally on the payment line", sql(`select status || ':' || paid_reference from maalrise_distribution_lines where id='${lineBoth}'`) === "paid:TRF-E2E-778");
check("officer cannot reverse", (await api("officer", "POST", `/api/admin/maalrise/payments/${lineBoth}`, { action: "reverse", reason: "x" })).status === 403);
check("administrator cannot reverse", (await api("admin", "POST", `/api/admin/maalrise/payments/${lineBoth}`, { action: "reverse", reason: "x" })).status === 403);
check("finance cannot mark paid", (await api("fin", "POST", `/api/admin/maalrise/payments/${lineBoth}`, { action: "mark_paid", paid_on: TODAY })).status === 403);
check("an unapproved (month 2) payment cannot be marked paid", (await api("officer", "POST", `/api/admin/maalrise/payments/${
  sql(`select l.id from maalrise_distribution_lines l join maalrise_distributions d on d.id=l.distribution_id where d.cycle_id='${C}' and d.period=2 limit 1`)}`,
  { action: "mark_paid", paid_on: TODAY })).status === 400);
check("investor notification and email DRAFT prepared (nothing sent)",
  sql(`select count(*) from maalrise_notifications n join profiles p on p.id=n.user_id where p.email='both@test.local' and kind='payment_paid'`) === "1"
  && sql(`select count(*) from maalrise_email_outbox where to_email='both@test.local' and status='draft'`) === "1"
  && sql(`select count(*) from maalrise_email_outbox where status <> 'draft'`) === "0");
await shot("p4-05-paid");

// ── 8. Super admin reverses, with a reason; history kept ───────────────────
await as("sa");
await go("/admin/payment-requests/maalrise");
await click("Paid (1)");
await click("Reverse", { within: "Both Products" });
await type("Reason for reversal", "Transfer bounced");
await click("Reverse payment");
check("super admin reverses with a reason", await toast(/reversed/i));
check("payment is payable again; history has both events",
  sql(`select status from maalrise_distribution_lines where id='${lineBoth}'`) === "payable"
  && sql(`select string_agg(event, ',' order by created_at) from maalrise_payment_events where line_id='${lineBoth}'`) === "marked_paid,reversed");

// ── 9. Dashboard reflects real money ───────────────────────────────────────
await as("admin");
await go("/admin/maalrise/dashboard");
t = await text();
check("dashboard shows received, distributions and investor payments",
  t.includes("Received from counterparties") && t.includes("Profit distributions") && t.includes("Investor payments paid / to pay"));
check("dashboard lists the months still owed (paid months drop off; month 3 due today, month 4 upcoming)",
  t.includes("Counterparty payments due") && !/Month 1\s/.test(t.split("Counterparty payments due (next")[1] ?? "") && (L[3].due !== TODAY || t.includes("Due today")) && t.includes("Upcoming"));
check("dashboard money figures match the database",
  t.includes("₦1,166,666.66") && !t.includes("held"));
await shot("p4-06-dashboard");
await go(`/admin/maalrise/cycles/${C}#receipts`);
await shot("p4-07-cycle");

// ── 10. MaalGrow untouched; internal helpers locked ────────────────────────
check("internal helpers are not callable by signed-in users",
  sql(`select has_function_privilege('authenticated','maalrise_build_distribution_lines(uuid)','EXECUTE')`) === "f");
await go("/admin/payment-requests");
check("MaalGrow Payment Requests page still loads", !page.url().includes("/login") && (await text()).length > 50);
check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
