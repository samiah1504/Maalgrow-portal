// LOCAL end-to-end run of migration 060: a Cycle activated with the wrong cost and an
// investor's funding missing is reopened by a super admin, corrected and activated again.
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
const termsAt = (costKobo) => ({ costKobo, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 400, treatment: "deducted_from_investors" },
  schedule: { mode: "equal" }, statedSalePriceKobo: (costKobo * 135) / 100 });

// "Activated by mistake": ₦400,000 (8 units of ₦50,000); really ₦450,000 with a ninth unit missing.
const c = await must("ops", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Reopen E2E Ltd" },
  cycle: { name: "E2E Reopen Cycle", transaction_name: "Murabaha", start_date: TODAY, duration_months: 3, unit_price_kobo: 5_000_000 },
  terms: termsAt(40_000_000),
});
await must("ops", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "submit", terms_id: c.terms_id });
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "approve", terms_id: c.terms_id });
const both = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "both@test.local", full_name: "" })).id;
const other = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "login.only@test.local", full_name: "Login Only" })).id;
const f1 = (await must("fin", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings`, { investor_id: both, units: 8, received_on: TODAY, reference: "RO-E2E-1" })).id;
await must("admin", "POST", `/api/admin/maalrise/fundings/${f1}`, { action: "confirm" });
await as("ops");
await go(`/admin/maalrise/cycles/${c.id}`);
const pdf = path.join(os.tmpdir(), "maalrise-reopen-contract.pdf");
fs.writeFileSync(pdf, "%PDF-1.4\n% E2E reopen contract\n");
await (await page.$("#doc-file")).uploadFile(pdf);
await click("Upload", { exact: true });
await toast(/Contract uploaded/);
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "activate" });
check("set-up: the Cycle is active at ₦400,000", sql(`select status from maalrise_cycles where id='${c.id}'`) === "active");

// 061: no moving units while the Cycle is active
const activeMove = await api("admin", "POST", `/api/admin/maalrise/fundings/${f1}`, { action: "move", to_investor: other, units: 2, reason: "x" });
check("moving units on an active Cycle is refused (reopen first)", activeMove.status === 400 && /reopen it first/.test(activeMove.body.error ?? ""), JSON.stringify(activeMove));

// Only a super admin sees and can use it
await as("admin");
await go(`/admin/maalrise/cycles/${c.id}`);
check("an administrator does not see Reopen", !(await page.$("[data-testid='reopen-panel']")));
const byAdmin = await api("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "reopen", reason: "x" });
check("an administrator cannot reopen", byAdmin.status === 403, JSON.stringify(byAdmin));
const noReason = await api("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "reopen", reason: " " });
check("no reason, no reopening", noReason.status === 400 && /Give the reason/.test(noReason.body.error ?? ""));

await as("sa");
await go(`/admin/maalrise/cycles/${c.id}`);
check("the super admin sees Reopen for correction", !!(await page.$("[data-testid='reopen-panel']")));
await click("Reopen for correction");
await page.type("textarea[aria-label='Reason for reopening']", "Cost is ₦450,000 not ₦400,000; one unit's funding was missed");
page.once("dialog", (d) => d.accept());
await click("Reopen this Cycle");
check("reopened", await toast(/Cycle reopened/i));
check("back to terms approved, activation cleared",
  sql(`select status || ':' || (activated_at is null) from maalrise_cycles where id='${c.id}'`) === "terms_approved:true");
check("the reason is in the Cycle's activity history", await waitText("Reopened the Cycle for correction (super admin)"));
await shot("p60-01-reopened");

// 061: 2 of the 8 units credited to Both Products were Login Only's — moved in the browser
check("finance cannot move units", (await api("fin", "POST", `/api/admin/maalrise/fundings/${f1}`, { action: "move", to_investor: other, units: 2, reason: "x" })).status === 403);
await as("admin");
await go(`/admin/maalrise/cycles/${c.id}#allocations`);
await click("Move to another investor", { within: "RO-E2E-1", rowOnly: true });
await page.waitForSelector("[data-testid='move-form']");
await page.select(`#move-to-${f1}`, other);
await page.evaluate(() => {
  const set = (label, v) => {
    const l = [...document.querySelectorAll("[data-testid='move-form'] label")].find((x) => x.textContent.trim().startsWith(label));
    const el = document.getElementById(l.htmlFor);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(el, v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  };
  set("Units to move", "2"); set("Reason", "2 units were Login Only's, credited to Both Products by mistake");
});
let moveDialog = "";
page.once("dialog", (d) => { moveDialog = d.message(); d.accept(); });
await click("Move units", { within: "RO-E2E-1", rowOnly: true });
check("units moved", await toast(/Units moved to the right investor/i));
check("the confirmation names both investors and the amount", moveDialog.includes("Move 2 unit(s) (₦100,000.00)") && moveDialog.includes("Login Only"), moveDialog);
check("the entry is split: 6 stay, 2 go to Login Only on the same date",
  sql(`select string_agg(i.full_name || '=' || f.units || ':' || f.reference || ':' || f.status, ',' order by f.reference)
       from maalrise_investor_fundings f join maalrise_investors i on i.id = f.maalrise_investor_id where f.cycle_id='${c.id}'`)
    === "Both Products=6:RO-E2E-1:confirmed,Login Only=2:RO-E2E-1/moved:confirmed");
check("allocations follow, total unchanged",
  sql(`select string_agg(i.full_name || '=' || a.units, ',' order by i.full_name) from maalrise_allocations a
       join maalrise_investors i on i.id = a.maalrise_investor_id where a.cycle_id='${c.id}'`) === "Both Products=6,Login Only=2");
check("the move is in the Cycle's activity history", await waitText("Moved funding to the right investor"));
await shot("p61-01-moved");

// The correction, through the usual screens and routes
const v2 = (await must("ops", "PUT", `/api/admin/maalrise/cycles/${c.id}/terms`, { terms: termsAt(45_000_000) })).terms_id;
await must("ops", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "submit", terms_id: v2 });
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "approve", terms_id: v2 });
const f2 = (await must("fin", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings`, { investor_id: both, units: 1, received_on: TODAY, reference: "RO-E2E-2" })).id;
await must("admin", "POST", `/api/admin/maalrise/fundings/${f2}`, { action: "confirm" });
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "activate" });
check("active again at ₦450,000 with 9 units; the ₦400,000 terms kept as superseded",
  sql(`select c.status || ':' || t.cost_kobo || ':' || (select sum(units) from maalrise_allocations where cycle_id=c.id)
       from maalrise_cycles c join maalrise_cycle_terms t on t.id = c.approved_terms_id where c.id='${c.id}'`) === "active:45000000:9"
  && sql(`select units from maalrise_allocations where cycle_id='${c.id}' and maalrise_investor_id='${other}'`) === "2"
  && sql(`select string_agg(version || status, ',' order by version) from maalrise_cycle_terms where cycle_id='${c.id}'`) === "1superseded,2approved");

// Once money has moved, it is refused
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/receipts`, { period: 1, amount_kobo: 100000, received_on: TODAY });
const late = await api("sa", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "reopen", reason: "too late" });
check("refused once a payment is recorded", late.status === 400 && /cannot be reopened: a payment received/.test(late.body.error ?? ""), JSON.stringify(late));
await as("sa");
await go(`/admin/maalrise/cycles/${c.id}`);
check("and the panel is no longer offered", !(await page.$("[data-testid='reopen-panel']")));

check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
