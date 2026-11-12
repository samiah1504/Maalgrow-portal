// LOCAL end-to-end run of migration 062: approving a month's profit while one investor has no
// confirmed bank details (they are held, everyone else payable), what staff and the investor see,
// and the release when their KYC is approved in MaalGrow.
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
const waitText = (s, ms = 15000) => page.waitForFunction((s) => document.body.innerText.includes(s), { timeout: ms }, s).then(() => true).catch(() => false);
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

// An active Cycle: Both Products (MaalGrow KYC approved → bank confirmed at once) and Login Only (no bank details yet).
const c = await must("ops", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Held E2E Ltd" },
  cycle: { name: "E2E Held Cycle", transaction_name: "Murabaha", start_date: TODAY, duration_months: 3, unit_price_kobo: 10_000_000 },
  terms: { costKobo: 1_000_000_000, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 400, treatment: "deducted_from_investors" },
           schedule: { mode: "equal" }, statedSalePriceKobo: 1_350_000_000 },
});
await must("ops", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "submit", terms_id: c.terms_id });
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "approve", terms_id: c.terms_id });
const both = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "both@test.local", full_name: "" })).id;
check("an investor whose MaalGrow KYC is approved is verified with confirmed bank details on being added",
  sql(`select kyc_status || ':' || account_number || ':' || (bank_confirmed_at is not null) from maalrise_investors where id='${both}'`) === "verified:0123456701:true");
const login = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "login.only@test.local", full_name: "Login Only" })).id;
for (const [inv, units, ref] of [[both, 60, "HE-1"], [login, 40, "HE-2"]]) {
  const f = (await must("fin", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings`, { investor_id: inv, units, received_on: TODAY, reference: ref })).id;
  await must("admin", "POST", `/api/admin/maalrise/fundings/${f}`, { action: "confirm" });
}
await as("ops");
await go(`/admin/maalrise/cycles/${c.id}`);
const pdf = path.join(os.tmpdir(), "maalrise-held-contract.pdf");
fs.writeFileSync(pdf, "%PDF-1.4\n% E2E held contract\n");
await (await page.$("#doc-file")).uploadFile(pdf);
await click("Upload", { exact: true });
await toast(/Contract uploaded/);
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "activate" });
const gross = Number(sql(`select l.counterparty_gross_kobo from maalrise_schedule_lines l join maalrise_cycles c on c.approved_terms_id = l.terms_id
  where c.id='${c.id}' and l.period=1`));
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/receipts`, { period: 1, amount_kobo: gross, received_on: TODAY, reference: "HE-CP1", confirm_now: true });
const dist = sql(`select id from maalrise_distributions where cycle_id='${c.id}' and period=1`);

// ── Approving no longer waits for Login Only ──
await as("admin");
await go(`/admin/maalrise/cycles/${c.id}#distributions`);
check("the Cycle page says who will be held, and Approve is available",
  (await page.evaluate(() => document.querySelector("[data-testid='will-hold']")?.innerText ?? "")).includes("Login Only")
  && await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent.includes("Approve distribution"))?.disabled === false));
let dialog = "";
page.once("dialog", (d) => { dialog = d.message(); d.accept(); });
await click("Approve distribution");
check("approval goes ahead and says who is on hold", await toast(/1 payment\(s\) on hold until bank details are confirmed: Login Only/));
check("the confirmation named them first", dialog.includes("Login Only"), dialog);
check("Both Products is payable, Login Only on hold",
  sql(`select string_agg(investor_name || '=' || status, ',' order by investor_name) from maalrise_distribution_lines where distribution_id='${dist}'`)
    === "Both Products=payable,Login Only=on_hold");
await shot("held-01-cycle");

await go("/admin/payment-requests/maalrise");
check("MaalRise Payments lists Login Only under On hold", (await page.evaluate(() => document.querySelector("[data-testid='held-payments']")?.innerText ?? "")).includes("Login Only"));
check("…and Both Products ready to pay", (await text()).includes("Both Products"));
await shot("held-02-payments");
await as("officer");
await go("/admin/payment-requests/maalrise");
check("the payment officer's page works and offers only what can be paid", (await text()).includes("Both Products") && !(await text()).includes("Mark paid Login Only"));

// ── What Login Only sees after submitting the KYC form in MaalGrow ──
const mg = sql(`select id from investors where profile_id='10000000-0000-0000-0000-0000000000c3'`);
sql(`update investors set kyc_submitted_at = now(), kyc_status = 'pending', bank_name = 'Opay', account_name = 'Login Only', account_number = '0555555555' where id='${mg}'`);
await as("login");
await go(`/maalrise/cycles/${c.id}`);
check("the investor sees their payment approved, waiting for their bank details",
  (await page.evaluate(() => document.querySelector("[data-testid='waiting-bank']")?.innerText ?? "")).includes("waiting for your bank details"));
await shot("held-03-investor");

// ── Staff approve the KYC in MaalGrow: MaalRise follows at once ──
await must("admin", "PATCH", `/api/admin/investors/${mg}`, { action: "update", kyc_status: "approved" });
check("Login Only is KYC-verified in MaalRise with the KYC bank details confirmed",
  sql(`select kyc_status || ':' || account_number || ':' || (bank_confirmed_at is not null) from maalrise_investors where id='${login}'`) === "verified:0555555555:true");
check("their payment is released to that account",
  sql(`select status || ':' || account_number from maalrise_distribution_lines where distribution_id='${dist}' and maalrise_investor_id='${login}'`) === "payable:0555555555");
await as("admin");
await go("/admin/payment-requests/maalrise");
check("nothing is on hold any more; Login Only is ready to pay", !(await page.$("[data-testid='held-payments']")) && (await text()).includes("Login Only"));
check("the payment officer was told the payment was released",
  sql(`select count(*) from maalrise_notifications n join profiles p on p.id = n.user_id where p.role = 'payment_officer' and n.title = 'Payments released: Login Only'`) === "1");
await as("login");
await go(`/maalrise/cycles/${c.id}`);
check("the investor now sees an ordinary approved payment", !(await page.$("[data-testid='waiting-bank']")) && (await text()).includes("approved, being transferred"));

check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
