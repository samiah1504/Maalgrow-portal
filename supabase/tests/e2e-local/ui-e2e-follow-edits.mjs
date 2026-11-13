// LOCAL end-to-end run of migration 063: edits on the MaalGrow investor Edit page (email, name, phone,
// bank details) reach MaalRise; bank details are admin-only; unpaid MaalRise payments follow the new account.
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
  login: ["10000000-0000-0000-0000-0000000000c3", "login.only@test.local"],
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
async function toast(re) {
  const ok = await page.waitForFunction((src) => [...document.querySelectorAll("[data-sonner-toast]")].some((x) => new RegExp(src, "i").test(x.innerText)),
    { timeout: 15000 }, re.source).then(() => true).catch(() => false);
  if (!ok) console.log("   toasts:", await page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((x) => x.innerText).join(" | ")));
  return ok;
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

// An active Cycle with Both Products (MaalGrow KYC approved → confirmed bank 0123456701) and month 1 approved.
const c = await must("ops", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Follow E2E Ltd" },
  cycle: { name: "E2E Follow Cycle", transaction_name: "Murabaha", start_date: TODAY, duration_months: 3, unit_price_kobo: 10_000_000 },
  terms: { costKobo: 1_000_000_000, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 400, treatment: "deducted_from_investors" },
           schedule: { mode: "equal" }, statedSalePriceKobo: 1_350_000_000 },
});
await must("ops", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "submit", terms_id: c.terms_id });
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "approve", terms_id: c.terms_id });
const both = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "both@test.local", full_name: "" })).id;
const f = (await must("fin", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings`, { investor_id: both, units: 100, received_on: TODAY, reference: "FE-1" })).id;
await must("admin", "POST", `/api/admin/maalrise/fundings/${f}`, { action: "confirm" });
await as("ops");
await go(`/admin/maalrise/cycles/${c.id}`);
const pdf = path.join(os.tmpdir(), "maalrise-follow-contract.pdf");
fs.writeFileSync(pdf, "%PDF-1.4\n% E2E follow contract\n");
await (await page.$("#doc-file")).uploadFile(pdf);
await click("Upload", { exact: true });
await toast(/Contract uploaded/);
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "activate" });
const gross = Number(sql(`select l.counterparty_gross_kobo from maalrise_schedule_lines l join maalrise_cycles c on c.approved_terms_id = l.terms_id
  where c.id='${c.id}' and l.period=1`));
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/receipts`, { period: 1, amount_kobo: gross, received_on: TODAY, reference: "FE-CP1", confirm_now: true });
const dist = sql(`select id from maalrise_distributions where cycle_id='${c.id}' and period=1`);
await must("admin", "POST", `/api/admin/maalrise/distributions/${dist}`, { action: "approve" });
check("setup: Both Products' month 1 is payable to the MaalGrow KYC account",
  sql(`select status || ':' || account_number from maalrise_distribution_lines where distribution_id='${dist}'`) === "payable:0123456701");
const mg = sql(`select id from investors where email='both@test.local'`);
// The Edit form needs a complete residential address to save; give the test investor one.
sql(`update investors set residential_street_address = '12 Test Street, near the market', residential_state_code = 'LA',
  residential_state_name = 'Lagos', residential_lga_code = 'LA-IKEJA', residential_lga_name = 'Ikeja', residential_city = 'Ikeja' where id = '${mg}'`);
const current = JSON.parse(sql(`select row_to_json(i) from (select full_name, phone, bank_name, account_name, account_number from investors where id='${mg}') i`));

// ── Operations: the bank fields are locked; a bank change is refused, the rest still saves ──
await as("ops");
await go(`/admin/investors/${mg}/edit`);
check("operations sees the bank fields locked, with the reason",
  await page.evaluate(() => document.querySelector("input[name='account_number']")?.disabled === true)
  && (await page.evaluate(() => document.querySelector("[data-testid='bank-edit-note']")?.innerText ?? "")).includes("Only a super admin or administrator"));
let r = await api("ops", "PATCH", `/api/admin/investors/${mg}`, { action: "update", ...current, account_number: "0999999999" });
check("the server refuses a bank change from operations", r.status === 403 && /Only a super admin or administrator/.test(r.body.error ?? ""), JSON.stringify(r));
check("…and nothing changed", sql(`select account_number from investors where id='${mg}'`) === "0123456701");

// ── An administrator edits email, name, phone and bank on the Edit page ──
await as("admin");
await go(`/admin/investors/${mg}/edit`);
check("the administrator sees the bank fields open, with what happens in MaalRise",
  await page.evaluate(() => document.querySelector("input[name='account_number']")?.disabled === false)
  && (await page.evaluate(() => document.querySelector("[data-testid='bank-edit-note']")?.innerText ?? "")).includes("used in MaalRise too"));
const setField = async (name, value) => {
  await page.focus(`input[name='${name}']`);
  await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.type(`input[name='${name}']`, value);
};
await setField("email", "both.new@test.local");
await setField("full_name", "Both Renamed");
await setField("phone", "08099999999");
await setField("bank_name", "Zenith");
await setField("account_name", "Both Renamed");
await setField("account_number", "0777777777");
await shot("follow-01-edit");
await click("Save Changes");
await shot("follow-01b-after-save");
check("saved, and the admin is told MaalRise followed and the unpaid payment moved",
  await toast(/MaalRise bank details updated and confirmed\. 1 unpaid MaalRise payment\(s\) moved/));
check("MaalRise has the new email, name and phone",
  sql(`select email || ':' || full_name || ':' || phone from maalrise_investors where id='${both}'`) === "both.new@test.local:Both Renamed:08099999999");
check("MaalRise uses the new account, confirmed by the administrator",
  sql(`select m.account_number || ':' || p.email from maalrise_investors m join profiles p on p.id = m.bank_confirmed_by where m.id='${both}'`) === "0777777777:admin@test.local");
check("the unpaid payment now goes to the new account",
  sql(`select status || ':' || account_number from maalrise_distribution_lines where distribution_id='${dist}'`) === "payable:0777777777");
check("the login and MaalGrow records have the new email",
  sql(`select u.email || ':' || p.email || ':' || i.email from investors i join profiles p on p.id = i.profile_id join auth.users u on u.id = p.id where i.id='${mg}'`)
    === "both.new@test.local:both.new@test.local:both.new@test.local");
check("each change is in the audit log",
  sql(`select count(distinct action) from audit_logs where entity_id='${both}' and action in ('maalrise_email_from_login','maalrise_contact_from_maalgrow','maalrise_bank_from_maalgrow_edit')`) === "3");

// The MaalRise investor page shows it
await go(`/admin/maalrise/investors/${both}`);
const t = await text();
check("the MaalRise investor page shows the new details", t.includes("both.new@test.local") && t.includes("Both Renamed") && t.includes("0777777777"));
await shot("follow-02-maalrise");

// A save that leaves the bank alone does not touch MaalRise's bank or payments
const before = sql(`select count(*) from audit_logs where action='maalrise_bank_from_maalgrow_edit'`);
r = await api("admin", "PATCH", `/api/admin/investors/${mg}`, { action: "update", phone: "08011111111" });
check("a phone-only save works and leaves MaalRise bank alone",
  r.status === 200 && sql(`select count(*) from audit_logs where action='maalrise_bank_from_maalgrow_edit'`) === before
  && sql(`select phone from maalrise_investors where id='${both}'`) === "08011111111");

check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
