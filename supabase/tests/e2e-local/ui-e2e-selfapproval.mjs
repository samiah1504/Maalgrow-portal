// LOCAL end-to-end run of migration 056: a super admin approves their own terms and
// confirms funding they recorded, with a reason; an administrator still cannot.
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

// The super admin prepares and submits terms alone.
const mine = await must("sa", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Self Approval E2E Ltd" },
  cycle: { name: "E2E Self Approval Cycle", transaction_name: "Murabaha", start_date: TODAY, duration_months: 3, unit_price_kobo: 10_000_000 },
  terms: { costKobo: 1_000_000_000, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 400, treatment: "deducted_from_investors" },
           schedule: { mode: "equal" }, statedSalePriceKobo: 1_350_000_000 },
});
await must("sa", "POST", `/api/admin/maalrise/cycles/${mine.id}/actions`, { action: "submit", terms_id: mine.terms_id });
const noReason = await api("sa", "POST", `/api/admin/maalrise/cycles/${mine.id}/actions`, { action: "approve", terms_id: mine.terms_id });
check("without a reason the super admin's own approval is refused", noReason.status === 400 && /give a reason/.test(noReason.body.error ?? ""), JSON.stringify(noReason));

await as("sa");
await go(`/admin/maalrise/cycles/${mine.id}`);
check("the super admin sees the self-approval box", !!(await page.$("[data-testid='self-approve-terms']")));
await type("Reason for approving your own terms", "Sole director; second approver not yet appointed");
await click("Approve my own terms");
check("super admin approves their own terms", await toast(/Terms approved and frozen/i));
await waitText("Self-approved by a super admin");
check("the reason shows on the terms", (await text()).includes("Self-approved by a super admin: Sole director"));
check("approved with the reason stored",
  sql(`select status || ':' || self_approval_reason from maalrise_cycle_terms where id='${mine.terms_id}'`) === "approved:Sole director; second approver not yet appointed");
await shot("p56-01-self-approved");

// Funding recorded and confirmed by the super admin.
const inv = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "both@test.local", full_name: "" })).id;
await must("sa", "POST", `/api/admin/maalrise/cycles/${mine.id}/fundings`, { investor_id: inv, units: 10, received_on: TODAY, reference: "SELF-F1" });
await as("sa"); // leave the page first: the same path with a #section does not reload
await go(`/admin/maalrise/cycles/${mine.id}#funding`);
await click("Confirm (recorded by you)");
await type("Reason for confirming your own entry", "Transfer seen on the bank statement");
await click("Confirm with this reason");
check("super admin confirms funding they recorded", await toast(/Funding confirmed and allocated/i));
check("funding confirmed with the reason stored",
  sql(`select status || ':' || self_confirm_reason from maalrise_investor_fundings where reference='SELF-F1'`) === "confirmed:Transfer seen on the bank statement");

// An administrator's own terms: unchanged rule.
const theirs = await must("admin", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Admin Own E2E Ltd" },
  cycle: { name: "E2E Admin Own Cycle", transaction_name: "Murabaha", start_date: TODAY, duration_months: 3, unit_price_kobo: 10_000_000 },
  terms: { costKobo: 1_000_000_000, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 400, treatment: "deducted_from_investors" },
           schedule: { mode: "equal" }, statedSalePriceKobo: 1_350_000_000 },
});
await must("admin", "POST", `/api/admin/maalrise/cycles/${theirs.id}/actions`, { action: "submit", terms_id: theirs.terms_id });
await as("admin");
await go(`/admin/maalrise/cycles/${theirs.id}`);
check("an administrator still sees 'a different authorised person must approve'",
  (await text()).includes("a different authorised person must approve them") && !(await page.$("[data-testid='self-approve-terms']")));
const forced = await api("admin", "POST", `/api/admin/maalrise/cycles/${theirs.id}/actions`, { action: "approve", terms_id: theirs.terms_id, self_reason: "please" });
check("an administrator cannot approve their own terms even with a reason", forced.status === 400 && /cannot be approved by the person/.test(forced.body.error ?? ""));
await must("sa", "POST", `/api/admin/maalrise/cycles/${theirs.id}/actions`, { action: "approve", terms_id: theirs.terms_id });
check("a different approver still approves without a reason",
  sql(`select status || ':' || coalesce(self_approval_reason, '-') from maalrise_cycle_terms where id='${theirs.terms_id}'`) === "approved:-");
check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
