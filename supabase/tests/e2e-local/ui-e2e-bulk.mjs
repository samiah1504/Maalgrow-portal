// LOCAL end-to-end run of the bulk tools (migration 057): import a Cycle's investors and
// funding from a file, "Confirm all", and "Email all investors in this Cycle" — invitations
// for people who never signed in, notifications for the rest, each sent once.
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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const SENT = new URL("./sent-emails.jsonl", import.meta.url).pathname;
const sent = () => (fs.existsSync(SENT) ? fs.readFileSync(SENT, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sentBefore = sent().length;
const dd = (iso) => iso.split("-").reverse().join("/");
const FUTURE = lagos(new Date(Date.now() + 5 * 86400000));

// A Cycle needing 100 units of ₦100,000, terms approved by a different approver.
const c = await must("sa", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Bulk E2E Ltd" },
  cycle: { name: "E2E Bulk Cycle", transaction_name: "Murabaha", start_date: TODAY, duration_months: 3, unit_price_kobo: 10_000_000 },
  terms: { costKobo: 1_000_000_000, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 400, treatment: "deducted_from_investors" },
           schedule: { mode: "equal" }, statedSalePriceKobo: 1_350_000_000 },
});
await must("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "submit", terms_id: c.terms_id });
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "approve", terms_id: c.terms_id });
sql(`update auth.users set last_sign_in_at = now() where email = 'both@test.local'`);

// Template, refusals
const tpl = await fetch(`${BASE}/api/admin/maalrise/cycles/${c.id}/import`, { headers: { Cookie: `sb-127-auth-token=${cookieFor("sa")}` } });
check("the template is Full name, Email, Phone, Units, Date received — no bank details",
  tpl.status === 200 && (await tpl.text()).split("\r\n")[0] === "Full name,Email,Phone,Units,Date received");
check("operations cannot import (needs both roles)", (await api("ops", "POST", `/api/admin/maalrise/cycles/${c.id}/import`, { sheet_url: "x" })).status === 403);
const badLink = await api("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/import`, { sheet_url: "https://example.com/sheet" });
check("a link that is not a Google Sheet is explained", badLink.status === 400 && /does not look like a Google Sheets link/.test(badLink.body.error ?? ""));
const pub = await api("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/import`, { sheet_url: "https://docs.google.com/spreadsheets/d/e/2PACX-abc/pubhtml" });
check("a 'Publish to web' link is explained", pub.status === 400 && /Publish to web/.test(pub.body.error ?? ""));
const early = await api("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/emails`);
check("emails cannot be prepared before any funding is confirmed", early.status === 400 && /No confirmed funding yet/.test(early.body.error ?? ""));

// The sheet: 4 good rows (80 units), a staff row and a future-dated row.
const csv = [
  "Full name,Email,Phone,Units,Date received",
  `,both@test.local,,40,${dd(TODAY)}`,
  `Ngozi One,New.One@bulk.local,0803 000 0001,20,${dd(TODAY)}`,
  `Tunde Two,new.two@bulk.local,,10,${TODAY}`,
  `Bisi Bounce,bounce.three@bulk.local,,10,${dd(TODAY)}`,
  `Staff Person,sa@test.local,,1,${dd(TODAY)}`,
  `Later Person,later@bulk.local,,1,${dd(FUTURE)}`,
].join("\r\n");
const file = path.join(os.tmpdir(), "maalrise-bulk-e2e.csv");
fs.writeFileSync(file, csv);

await as("sa");
await go(`/admin/maalrise/cycles/${c.id}#allocations`);
check("the import panel shows for a super admin", (await text()).includes("Import many investors at once"));
await page.evaluate(() => [...document.querySelectorAll("label")].find((l) => l.textContent.includes("Upload a file"))?.click());
await page.waitForSelector("#import-file");
await (await page.$("#import-file")).uploadFile(file);
await click("Check the rows");
check("preview: 4 ready, 2 with problems", await waitText("4 ready") && (await text()).includes("2 with problems"));
const t1 = await text();
check("preview labels who each person is", t1.includes("Existing login") && t1.includes("New person — login created, nothing sent"));
check("preview explains the refused rows", t1.includes("staff cannot be MaalRise investors") && t1.includes("cannot be in the future"));
check("preview totals: 3 new people, 80 units, ₦8,000,000.00", t1.includes("3 new people") && t1.includes("80 units") && t1.includes("₦8,000,000.00"));
check("nothing saved by the preview", sql(`select count(*) from maalrise_investor_fundings where cycle_id='${c.id}'`) === "0"
  && sql(`select count(*) from auth.users where email like '%@bulk.local'`) === "0");
await shot("p57-01-preview");
page.once("dialog", (d) => d.accept());
await click("Import 4 rows");
check("import done", await toast(/4 row\(s\) imported/i));
check("4 funding entries recorded, none confirmed",
  sql(`select count(*) || ':' || sum(units) || ':' || bool_and(status = 'recorded') from maalrise_investor_fundings where cycle_id='${c.id}'`) === "4:80:true");
check("amounts are units × unit price", sql(`select f.amount_kobo from maalrise_investor_fundings f join maalrise_investors m on m.id = f.maalrise_investor_id
  where m.email='new.one@bulk.local'`) === "200000000");
check("each entry has a reference made from the row", sql(`select bool_and(reference ~ '^IMPORT-[0-9A-F]{12}$') from maalrise_investor_fundings where cycle_id='${c.id}'`) === "t");
check("3 new logins created, each with an investor record and MaalRise access, invitation not sent",
  sql(`select count(*) from auth.users u join investors i on i.profile_id = u.id join maalrise_investors m on m.profile_id = u.id
       where u.email like '%@bulk.local' and i.invitation_status = 'not_sent'`) === "3");
check("no bank details are set by the import (they come from KYC)",
  sql(`select count(*) from maalrise_investors where email like '%@bulk.local' and coalesce(account_number, '') <> ''`) === "0");
check("no email sent by the import", sent().length === sentBefore);
check("the refused rows were not imported", sql(`select count(*) from auth.users where email = 'later@bulk.local'`) === "0");

// Importing the same sheet again adds nothing.
const fd = new FormData();
fd.append("file", new Blob([csv], { type: "text/csv" }), "again.csv");
const again = await fetch(`${BASE}/api/admin/maalrise/cycles/${c.id}/import`, { method: "POST", body: fd, headers: { Cookie: `sb-127-auth-token=${cookieFor("sa")}` } }).then((r) => r.json());
check("the same sheet again: 4 already imported, 0 ready", again.summary?.alreadyImported === 4 && again.summary?.ready === 0, JSON.stringify(again.summary));
const again2 = await must("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/import`, { action: "import", rows: again.rows });
check("importing it anyway skips every row", again2.results.filter((r) => r.skipped).length === 4
  && sql(`select count(*) from maalrise_investor_fundings where cycle_id='${c.id}'`) === "4");
const tamper = await must("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/import`, {
  action: "import", rows: [{ row: 2, email: "sa@test.local", full_name: "X", units: 1, received_on: TODAY, reference: "T-1" }] });
check("rows sent back are checked again on the server (staff refused)", tamper.results[0].ok === false && /staff/.test(tamper.results[0].message));

// The administrator records one entry, then confirms everything they may: not their own.
const both = sql(`select id from maalrise_investors where email='both@test.local'`);
const one = sql(`select id from maalrise_investors where email='new.one@bulk.local'`);
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings`, { investor_id: both, units: 10, received_on: TODAY, reference: "ADM-1" });
const ca = await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings/confirm-all`, {});
check("administrator's Confirm all: the 4 imported confirmed, their own entry left with the reason",
  ca.confirmed === 4 && ca.not_confirmed === 1 && /another finance person/.test(ca.results.find((r) => !r.ok).message), JSON.stringify(ca));
check("support cannot confirm", (await api("support", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings/confirm-all`, {})).status === 403);

// The super admin records one more, then confirms both in the browser with one reason.
await must("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings`, { investor_id: one, units: 10, received_on: TODAY, reference: "SA-1" });
await as("sa");
await go(`/admin/maalrise/cycles/${c.id}#allocations`);
check("Confirm all shows 2 waiting, 1 recorded by you", (await text()).includes("2 funding entries awaiting confirmation") && (await text()).includes("1 recorded by you"));
await click("Confirm all");
await type("Reason for confirming your own entries", "Both transfers seen on the bank statement");
await click("Yes, confirm 2");
check("super admin confirms all with one reason", await toast(/2 confirmed and allocated/i));
check("their own entry carries the reason; the administrator's does not",
  sql(`select string_agg(reference || '=' || coalesce(self_confirm_reason, '-'), ',' order by reference) from maalrise_investor_fundings where reference in ('ADM-1','SA-1')`)
    === "ADM-1=-,SA-1=Both transfers seen on the bank statement");
check("fully funded: 4 investors, 100 units", sql(`select count(*) || ':' || sum(units) from maalrise_allocations where cycle_id='${c.id}'`) === "4:100");
await shot("p57-02-confirmed");

// Email all investors in this Cycle.
check("finance cannot prepare Cycle emails", (await api("fin", "POST", `/api/admin/maalrise/cycles/${c.id}/emails`)).status === 403);
await as("sa");
await go(`/admin/maalrise/cycles/${c.id}#allocations`);
await click("Email all investors");
check("counts shown: 4 to send — 3 invitations, 1 notification",
  await waitText("Ready to send 4") && (await text()).includes("3 invitations") && (await text()).includes("1 notification"));
check("nothing sent before the second press", sent().length === sentBefore);
await shot("p57-03-email-counts");
page.once("dialog", (d) => d.accept());
await click("Send 4 emails");
check("3 sent, the bounced one reported", await toast(/3 sent, 1 not sent/i));
const mail = sent().slice(sentBefore);
const to = (e) => mail.filter((m) => m.to === e);
check("each person got exactly one email", mail.length === 3 && ["both@test.local", "new.one@bulk.local", "new.two@bulk.local"].every((e) => to(e).length === 1));
check("new people get the invitation with a set-password link",
  ["new.one@bulk.local", "new.two@bulk.local"].every((e) => to(e)[0].subject === "Welcome to MaalRise — E2E Bulk Cycle"
    && to(e)[0].html.includes("Set your password") && /reset-password\?token_hash=[0-9a-f]+&amp;type=invite|reset-password\?token_hash=[0-9a-f]+&type=invite/.test(to(e)[0].html)));
check("the invitation states their own units and capital", to("new.one@bulk.local")[0].html.includes("30 unit(s): capital of ₦3,000,000.00"));
check("an existing login gets the notification, no password link",
  to("both@test.local")[0].subject === "MaalRise: you have been added to E2E Bulk Cycle" && !to("both@test.local")[0].html.includes("token_hash"));
check("invitation status recorded on the investor records",
  sql(`select string_agg(email || '=' || invitation_status, ',' order by email) from investors where email like '%@bulk.local'`)
    === "bounce.three@bulk.local=failed,new.one@bulk.local=sent,new.two@bulk.local=sent");
check("the outbox shows 3 sent, 1 failed", sql(`select string_agg(status, ',' order by status) from maalrise_email_outbox where dedupe_key like 'cycle_welcome:${c.id}:%'`) === "failed,sent,sent,sent");

await click("Email all investors");
check("pressing again offers only the failed one", await waitText("Ready to send 1") && (await text()).includes("3 already sent earlier will not be sent again"));
page.once("dialog", (d) => d.accept());
await click("Send 1 email");
check("the retry is reported", await toast(/0 sent, 1 not sent/i));
check("no duplicates were sent", sent().length === sentBefore + 3);
const last = await must("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/emails`);
check("prepared again: still 4 emails in all, 3 already sent", last.already_sent === 3 && last.to_send.length === 1
  && sql(`select count(*) from maalrise_email_outbox where dedupe_key like 'cycle_welcome:${c.id}:%'`) === "4");
check("investors see the in-portal notification too",
  sql(`select count(*) from maalrise_notifications where dedupe_key like 'cycle_welcome:${c.id}:%'`) === "4");
await shot("p57-04-sent");

// 058: activation goes ahead while KYC and bank details are outstanding (warnings),
// but their payments still cannot be approved.
await as("ops");
await go(`/admin/maalrise/cycles/${c.id}`);
const pdf = path.join(os.tmpdir(), "maalrise-bulk-contract.pdf");
fs.writeFileSync(pdf, "%PDF-1.4\n% E2E bulk contract\n");
await (await page.$("#doc-file")).uploadFile(pdf);
await click("Upload", { exact: true });
check("contract uploaded", await toast(/Contract uploaded/));
await as("admin");
await go(`/admin/maalrise/cycles/${c.id}`);
await click("Run activation checks");
check("KYC and bank details listed as warnings with counts",
  await waitText("investor(s) have not completed KYC yet (does not block activation)")
  && (await text()).includes("without confirmed bank details (does not block activation"));
check("Activate is available despite the warnings", await page.evaluate(() =>
  [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Activate Cycle"))?.disabled === false));
let dialogText = "";
page.once("dialog", (d) => { dialogText = d.message(); d.accept(); });
await click("Activate Cycle");
check("Cycle activated", await toast(/Cycle activated/i));
check("the confirmation lists what is still outstanding", dialogText.includes("Still outstanding") && dialogText.includes("KYC"), dialogText);
check("the Cycle is active", sql(`select status from maalrise_cycles where id='${c.id}'`) === "active");
check("the warnings are kept in the activation's audit entry",
  sql(`select count(*) from audit_logs where action='maalrise_activate_cycle' and entity_id='${c.id}' and new_values::text like '%does not block activation%'`) === "1");
await shot("p58-01-activated-with-warnings");
const gross = Number(sql(`select l.counterparty_gross_kobo from maalrise_schedule_lines l join maalrise_cycles c on c.approved_terms_id = l.terms_id
  where c.id='${c.id}' and l.period=1`));
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/receipts`, { period: 1, amount_kobo: gross, received_on: TODAY, reference: "CP-1", confirm_now: true });
const dist = sql(`select id from maalrise_distributions where cycle_id='${c.id}' and period=1`);
const appr = await api("sa", "POST", `/api/admin/maalrise/distributions/${dist}`, { action: "approve" });
check("payments to investors without confirmed bank details cannot be approved",
  appr.status === 400 && /Bank details are unconfirmed or have changed for/.test(appr.body.error ?? ""), JSON.stringify(appr));

check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
