// LOCAL end-to-end run of MaalRise Phase 7 (go-live readiness) as real staff and
// investors against the scratch stack. Rebuild with up.sh first. Emails are
// recorded by the local gateway (sent-emails.jsonl), never sent.
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
const naira = (k) => "₦" + (k / 100).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// The MaalGrow KYC gate sends investors who have not submitted KYC to /kyc.
// Mark both MaalGrow investors as submitted and approved so their portal opens.
sql(`update investors set kyc_status = 'approved', kyc_submitted_at = now() where profile_id in
     ('10000000-0000-0000-0000-0000000000c1', '10000000-0000-0000-0000-0000000000c2')`);

// ── Setup through the real API: an active 3-month Cycle, month 1 due six days ago ──
const created = await must("ops", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Go-live Counterparty E2E Ltd" },
  cycle: { name: "E2E Phase 7 Cycle", transaction_name: "Murabaha", start_date: START, duration_months: 3, unit_price_kobo: 10_000_000 },
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
for (const i of [both, only]) await must("ops", "POST", `/api/admin/maalrise/investors/${i}`, { action: "confirm_bank" });
for (const [inv, units, ref] of [[both, 60, "F7-1"], [only, 40, "F7-2"]]) {
  await must("fin", "POST", `/api/admin/maalrise/cycles/${C}/fundings`, { investor_id: inv, units, received_on: addDays(START, -2), reference: ref });
}
for (const f of sql(`select id from maalrise_investor_fundings where cycle_id = '${C}'`).split("\n")) {
  await must("sa", "POST", `/api/admin/maalrise/fundings/${f}`, { action: "confirm" });
}
const form = new FormData();
form.set("file", new Blob(["%PDF-1.4\n% E2E phase 7 contract\n"], { type: "application/pdf" }), "contract.pdf");
form.set("category", "contract");
const up = await fetch(`${BASE}/api/admin/maalrise/cycles/${C}/documents`, { method: "POST", body: form, headers: { Cookie: `sb-127-auth-token=${cookieFor("ops")}` } });
if (up.status !== 201) throw new Error(`contract upload ${up.status}`);
await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/actions`, { action: "activate" });
const [GROSS, NET] = sql(`select l.counterparty_gross_kobo || '|' || l.investor_net_kobo from maalrise_schedule_lines l
  join maalrise_cycles c on c.approved_terms_id = l.terms_id where c.id = '${C}' and l.period = 1`).split("|").map(Number);
const BOTH_SHARE = NET * 60 / 100, ONLY_SHARE = NET * 40 / 100;
// Month 1 received in full, confirmed, approved; only the first investor's transfer is marked paid.
await must("admin", "POST", `/api/admin/maalrise/cycles/${C}/receipts`,
  { period: 1, amount_kobo: GROSS, received_on: addDays(TODAY, -1), reference: "P7-M1", confirm_now: true });
const D1 = sql(`select id from maalrise_distributions where cycle_id='${C}' and period=1`);
await must("admin", "POST", `/api/admin/maalrise/distributions/${D1}`, { action: "approve" });
const bothLine = sql(`select id from maalrise_distribution_lines where distribution_id='${D1}' and maalrise_investor_id='${both}'`);
await must("officer", "POST", `/api/admin/maalrise/payments/${bothLine}`, { action: "mark_paid", paid_on: TODAY, reference: "P7-PAID-1" });
console.log(`setup: Cycle ${C} from ${START}; month net ${NET}; shares ${BOTH_SHARE}/${ONLY_SHARE}`);
import { readFileSync, existsSync } from "node:fs";
let t;
const SENT = new URL("./sent-emails.jsonl", import.meta.url).pathname;
const sentEmails = () => (existsSync(SENT) ? readFileSync(SENT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const statValue = (title) => page.evaluate((title) => {
  const el = [...document.querySelectorAll("p, span, h3, div")].find((e) => e.childElementCount === 0 && e.textContent.trim() === title);
  const card = el?.closest("[class*='rounded']")?.parentElement?.closest("[class*='rounded']") ?? el?.closest("[class*='rounded']");
  return card ? (card.innerText.match(/\n(\d[\d,]*)\n/) ?? [])[1] ?? null : null;
}, title);

// ── 1. A MaalRise-only person: login and investor record created, nothing sent ──
await as("admin");
await go("/admin/dashboard");
const totalBefore = await statValue("Total Investors");
const sentBefore = sentEmails().length;
await as("ops");
await go("/admin/maalrise/investors/new");
await type("Email address", "fresh.rise@test.local");
await click("Check email");
check("a new email offers a new login", await waitText("A new login and investor record will be created"));
await type("Full name", "Fresh Rise");
await type("Phone", "08031112222");
await click("Create login and add investor");
check("operations creates the login and investor", await toast(/Investor created\. No email was sent/i));
await page.waitForFunction(() => /\/admin\/maalrise\/investors\/[0-9a-f-]{36}$/.test(location.pathname), { timeout: 15000 }).catch(() => {});
const FRESH = page.url().split("/").pop();
const freshProfile = sql(`select profile_id from maalrise_investors where id='${FRESH}'`);
P.fresh = [freshProfile, "fresh.rise@test.local"];
check("a login and a MaalGrow investor record exist, linked to MaalRise",
  sql(`select p.role || ':' || (i.id = m.maalgrow_investor_id) || ':' || coalesce(i.invitation_status::text, '') || ':' || (select count(*) from investments where investor_id = i.id)
       from maalrise_investors m join profiles p on p.id = m.profile_id join investors i on i.profile_id = m.profile_id where m.id = '${FRESH}'`) === "investor:true:not_sent:0");
check("nothing was emailed on creation", sentEmails().length === sentBefore);
t = await text();
check("investor page: invitation not sent, MaalRise only", t.includes("Not sent") && t.includes("MaalRise only"));
check("operations cannot send invitations", (await api("ops", "POST", `/api/admin/maalrise/investors/${FRESH}/invitation`)).status === 403);
const dupe = await api("ops", "POST", "/api/admin/maalrise/investors", { email: "fresh.rise@test.local", full_name: "Again", create_login: true });
check("the same person cannot be added twice", dupe.status === 400 && /already has MaalRise access/.test(dupe.body.error ?? ""), JSON.stringify(dupe));
check("staff emails are refused", (await api("ops", "POST", "/api/admin/maalrise/investors", { email: "fin@test.local", full_name: "X" })).status === 400);

// MaalGrow totals and list
await as("admin");
await go("/admin/dashboard");
check("MaalGrow dashboard: total investors unchanged by a MaalRise-only person", (await statValue("Total Investors")) === totalBefore, `${totalBefore} → ${await statValue("Total Investors")}`);
await go("/admin/investors?q=Fresh");
check("MaalGrow investor list tags them MaalRise only", (await text()).includes("MaalRise only"));
await shot("p7-01-maalgrow-list-tag");

// ── 2. The invitation, pressed by an administrator ──────────────────────
await go(`/admin/maalrise/investors/${FRESH}`);
page.once("dialog", (d) => d.accept());
await click("Send invitation", { exact: true });
check("administrator sends the invitation", await toast(/Invitation sent/i));
const inv = sentEmails().filter((e) => e.to === "fresh.rise@test.local");
check("one MaalRise invitation email, with a password link and the KYC step",
  inv.length === 1 && /Welcome to MaalRise/.test(inv[0].subject) && /reset-password\?token_hash=/.test(inv[0].html) && /KYC form/.test(inv[0].html), JSON.stringify(inv.map((e) => e.subject)));
check("invitation status recorded on the investor record", sql(`select invitation_status from investors where profile_id='${freshProfile}'`) === "sent");
await waitText("Resend invitation");
check("the page now offers Resend", (await text()).includes("Resend invitation"));

// ── 3. First sign-in: the same KYC form as MaalGrow ─────────────────────
await as("fresh");
await go("/dashboard");
check("first sign-in goes to the KYC form", page.url().endsWith("/kyc"), page.url());
await shot("p7-02-kyc-form");
// The investor submits the form (MaalGrow's own, tested path), with bank details.
sql(`update investors set kyc_submitted_at = now(), bank_name = 'Kuda', account_name = 'Fresh Rise', account_number = '7700112233'
     where profile_id = '${freshProfile}'`);
await as("ops");
await go(`/admin/maalrise/investors/${FRESH}`);
t = await text();
check("MaalRise shows the submitted form, pending review, with a link to KYC Review",
  t.includes("The KYC form was submitted") && sql(`select kyc_status from maalrise_investors where id='${FRESH}'`) === "pending_review");
check("bank details carried across, unconfirmed", t.includes("7700112233") && t.includes("Awaiting admin confirmation"));
sql(`update investors set kyc_status = 'approved' where profile_id = '${freshProfile}'`); // approved in KYC Review
await go(`/admin/maalrise/investors/${FRESH}`);
check("MaalGrow KYC approval is carried to MaalRise", (await text()).includes("Verified via MaalGrow")
  && sql(`select kyc_status || ':' || kyc_source from maalrise_investors where id='${FRESH}'`) === "verified:maalgrow");
await as("fresh");
await go("/dashboard");
await page.waitForFunction(() => location.pathname === "/maalrise", { timeout: 15000 }).catch(() => {});
check("after KYC the MaalRise-only investor lands on MaalRise", page.url().endsWith("/maalrise"), page.url());
await go("/maalrise/profile");
check("investor sees KYC verified", (await text()).includes("Verified"));

// ── 4. Emails: drafts until pressed ──────────────────────────────────────
// A bank change and its decision prepare an investor email draft.
const req = await must("fresh", "POST", "/api/maalrise/bank-change", { bank_name: "Opay", account_name: "Fresh Rise", account_number: "8800112233" });
await must("ops", "POST", `/api/admin/maalrise/bank-changes/${req.id}`, { action: "approve" });
const bounceId = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "bounce.rise@test.local", full_name: "Bounce Rise", create_login: true })).id;
sql(`select maalrise_notify_investor('${bounceId}', 'payment_paid', 'Profit payment sent', 'Test body for bounce', 'e2e:bounce', 'MaalRise profit payment sent')`);
const draftsBefore = Number(sql(`select count(*) from maalrise_email_outbox where status = 'draft'`));
check("drafts waiting, none sent by themselves", draftsBefore >= 3 && sql(`select count(*) from maalrise_email_outbox where status <> 'draft'`) === "0");
await as("fin");
await go("/admin/maalrise/emails");
check("finance can see the outbox but not send", (await text()).includes("MaalRise Emails") && !(await text()).includes("Send all"));
check("finance cannot send through the API",
  (await api("fin", "POST", `/api/admin/maalrise/emails/${sql(`select id from maalrise_email_outbox where status='draft' limit 1`)}`, { action: "send" })).status === 403);
await as("admin");
await go("/admin/maalrise/emails?view=investor");
t = await text();
check("investor drafts listed, including the bank-details email", t.includes("MaalRise: your bank details were updated") && t.includes("fresh.rise@test.local"));
await shot("p7-03-outbox");
page.once("dialog", (d) => d.accept());
await click("Send", { exact: true, within: "MaalRise: your bank details were updated" });
check("administrator sends one email", await toast(/Email sent/i));
const bankMail = sentEmails().filter((e) => e.subject === "MaalRise: your bank details were updated");
check("it went out once, from the shared sender, recorded as sent",
  bankMail.length === 1 && bankMail[0].to === "fresh.rise@test.local"
  && sql(`select status || ':' || (provider_id is not null) from maalrise_email_outbox where kind='bank_change_approved'`) === "sent:true");
const again = await api("admin", "POST", `/api/admin/maalrise/emails/${sql(`select id from maalrise_email_outbox where kind='bank_change_approved'`)}`, { action: "send" });
check("a sent email cannot be sent again", again.status === 400 && /already sent/.test(again.body.error ?? ""));
// A refused address: kept as failed, can be retried or discarded.
const bounce = sql(`select id from maalrise_email_outbox where dedupe_key='e2e:bounce'`);
const b1 = await api("admin", "POST", `/api/admin/maalrise/emails/${bounce}`, { action: "send" });
check("a refused email is reported and kept as failed",
  b1.status === 502 && /rejected/.test(b1.body.error ?? "") && sql(`select status from maalrise_email_outbox where id='${bounce}'`) === "failed");
await go("/admin/maalrise/emails?view=failed");
check("failed view shows the error and Try again", (await text()).includes("Last error") && (await text()).includes("Try again"));
page.once("dialog", (d) => d.accept());
await click("Discard", { exact: true, within: "bounce.rise@test.local" });
check("administrator discards it", await toast(/Email discarded/i));
check("discarded is final", (await api("admin", "POST", `/api/admin/maalrise/emails/${bounce}`, { action: "send" })).status === 400);
await go("/admin/maalrise/emails?view=investor");
const remaining = Number(sql(`select count(*) from maalrise_email_outbox m join profiles p on p.id = m.to_user_id where m.status='draft' and p.role='investor'`));
page.once("dialog", (d) => d.accept());
await click("Send all");
check("Send all sends every investor draft shown", await toast(new RegExp(`${remaining} email\\(s\\) sent`)));
check("no investor drafts left; staff drafts untouched",
  sql(`select count(*) from maalrise_email_outbox m join profiles p on p.id = m.to_user_id where m.status='draft' and p.role='investor'`) === "0");

// ── 5. Communication Centre: MaalRise investors selectable ───────────────
await go("/admin/comms");
await click("Individual Investors");
await page.waitForSelector("[data-testid='maalrise-picker']", { timeout: 15000 }).catch(() => {});
check("Communication Centre offers MaalRise investors", !!(await page.$("[data-testid='maalrise-picker']")));
await click("Add all", { exact: true });
check("all MaalRise investors added to the selection", await toast(/MaalRise investor\(s\) added to the selection/i));
check("Fresh Rise is in the selection", (await text()).includes("Fresh Rise"));
await shot("p7-04-comms");

// ── 6. Reports ─────────────────────────────────────────────────────────
const MONTH = TODAY.slice(0, 7);
await go(`/admin/maalrise/reports?month=${MONTH}`);
t = await text();
check("payments register lists the transfer marked paid, full account for reconciliation",
  t.includes("P7-PAID-1") && t.includes("0123456701") && t.includes(naira(BOTH_SHARE)));
await shot("p7-05-reports");
const regCsv = await fetch(`${BASE}/api/admin/maalrise/reports/register?month=${MONTH}`, { headers: { Cookie: `sb-127-auth-token=${cookieFor("fin")}` } });
const regText = await regCsv.text();
check("register CSV downloads (finance)", regCsv.status === 200 && regText.includes("P7-PAID-1") && regText.startsWith("Date paid,"));
const audit = await (await fetch(`${BASE}/api/admin/maalrise/reports/cycle/${C}?kind=audit`, { headers: { Cookie: `sb-127-auth-token=${cookieFor("admin")}` } })).text();
check("Cycle audit trail CSV includes activation, approval and the payment marked paid",
  ["maalrise_activate_cycle", "maalrise_approve_distribution", "maalrise_mark_line_paid"].every((a) => audit.includes(a)), audit.slice(0, 300));
const invCsv = await (await fetch(`${BASE}/api/admin/maalrise/reports/cycle/${C}?kind=investors`, { headers: { Cookie: `sb-127-auth-token=${cookieFor("admin")}` } })).text();
check("Cycle investors CSV: profit paid per investor", invCsv.includes(String(BOTH_SHARE / 100)) || invCsv.includes((BOTH_SHARE / 100).toFixed(2)));
await go(`/maalrise-cycle-report/${C}`);
t = await text();
check("printable Cycle report: totals, received and investors", t.includes("MaalRise Cycle report") && t.includes("Profit paid to investors") && t.includes("P7-M1"));
await shot("p7-06-cycle-report");
check("the payment officer cannot open reports", (await api("officer", "GET", `/api/admin/maalrise/reports/register?month=${MONTH}`)).status === 403);
check("investors cannot open reports", (await api("both", "GET", `/api/admin/maalrise/reports/cycle/${C}?kind=investors`)).status === 403);

// ── 7. Guide, and MaalGrow still loads ───────────────────────────────────
await go("/admin/maalrise/guide");
check("staff guide loads", (await text()).includes("MaalRise Guide") && (await text()).includes("Send invitation"));
for (const path of ["/admin/dashboard", "/admin/investors", "/admin/reports", "/admin/kyc", "/admin/comms", "/admin/maalrise/dashboard"]) {
  await go(path);
  check(`${path} still loads`, page.url().endsWith(path) && !(await text()).includes("Application error"), page.url());
}
check("every email that went out was pressed (invitation, one send, Send all)",
  sentEmails().length - sentBefore === 1 + 1 + remaining, `${sentEmails().length - sentBefore}`);
check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
