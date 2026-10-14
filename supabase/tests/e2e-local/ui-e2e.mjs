// LOCAL end-to-end run of the MaalRise admin screens, as real roles, against the scratch stack.
import { createRequire } from "node:module";
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

function cookieFor(who) {
  const [id, email] = P[who];
  const exp = Math.floor(Date.now() / 1000) + 3600;
  const access_token = sign({ sub: id, role: "authenticated", aud: "authenticated", email, exp });
  const session = { access_token, token_type: "bearer", expires_in: 3600, expires_at: exp, refresh_token: "local",
    user: { id, email, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {} } };
  return "base64-" + Buffer.from(JSON.stringify(session)).toString("base64url");
}

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
async function api(who, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { Cookie: `sb-127-auth-token=${cookieFor(who)}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => ({})) };
}
async function go(path) {
  const resp = await page.goto(BASE + path, { waitUntil: "networkidle0" });
  return resp?.status();
}
const text = () => page.evaluate(() => document.body.innerText);
async function type(label, v) {
  const id = await page.evaluate((label) => [...document.querySelectorAll("label")].find((l) => l.textContent.trim().startsWith(label))?.htmlFor, label);
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
async function click(label, { exact = false } = {}) {
  const handle = await page.evaluateHandle((label, exact) =>
    [...document.querySelectorAll("button, a")].find((b) => {
      const t = b.textContent.trim();
      return (exact ? t === label : t.includes(label)) && !b.disabled;
    }), label, exact);
  const el = handle.asElement();
  if (!el) throw new Error(`No enabled button "${label}"`);
  await el.click();
}
const hasEnabledButton = (label) => page.evaluate((label) => [...document.querySelectorAll("button")].some((b) => b.textContent.includes(label) && !b.disabled), label);
const hasButton = (label) => page.evaluate((label) => [...document.querySelectorAll("button, a")].some((b) => b.textContent.includes(label)), label);
/** Wait for a toast matching re (sonner keeps earlier ones on screen). */
async function toast(re) {
  const ok = await page.waitForFunction((src) => [...document.querySelectorAll("[data-sonner-toast]")].some((x) => new RegExp(src, "i").test(x.innerText)),
    { timeout: 15000 }, re.source).then(() => true).catch(() => false);
  if (!ok) console.log("   toasts:", await page.evaluate(() => [...document.querySelectorAll("[data-sonner-toast]")].map((x) => x.innerText).join(" | ")));
  return ok;
}
/** Wait for the refreshed page to contain s. */
const waitText = (s, ms = 15000) => page.waitForFunction((s) => document.body.innerText.includes(s), { timeout: ms }, s).then(() => true).catch(() => false);
async function settle() { await sleep(600); await page.waitForNetworkIdle({ idleTime: 400 }).catch(() => {}); }
async function pickOption(triggerIndex, optionText) {
  const triggers = await page.$$('button[role="combobox"]');
  await triggers[triggerIndex].click();
  await page.waitForSelector('[role="option"]');
  const opt = await page.evaluateHandle((t) => [...document.querySelectorAll('[role="option"]')].find((o) => o.textContent.includes(t)), optionText);
  await opt.asElement().click();
  await sleep(200);
}
const shot = (n) => page.screenshot({ path: `${SHOTS}/${n}.png`, fullPage: true });

// ── 1. Operations prepares a Cycle with the confirmed markup rule ─────────
await as("ops");
await go("/admin/maalrise/cycles/new");
await type("Cycle name", "E2E Cycle One");
await type("Business or transaction name", "E2E commodity Murabaha");
await page.select("#counterparty", "new");
await sleep(100);
await type("New counterparty name", "E2E Trading Ltd");
await setDate("Transaction start date", "2026-11-01");
await type("Duration (months)", "6");
await type("Transaction cost", "10000000");
await type("Unit price", "100000");
await type("Total markup for the Cycle (%)", "35");
await type("Agreed sale price", "13500000");
await type("Fee rate (%)", "5");
await pickOption(2, "Deducted");
await settle();
const breakdown = await text();
check("form: ₦10m at 35% total → markup ₦3,500,000 and sale price ₦13,500,000",
  breakdown.includes("₦3,500,000.00") && breakdown.includes("₦13,500,000.00"));
await shot("01-new-cycle-form");
await click("Save draft Cycle");
await page.waitForFunction(() => /\/admin\/maalrise\/cycles\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 20000 }).catch(() => {});
await settle();
const cycleId = page.url().match(/cycles\/([0-9a-f-]{36})/)?.[1];
check("ops: Save creates a draft Cycle and opens it", !!cycleId, page.url());
let t = await text();
check("cycle page shows the saved terms (markup ₦3.5m total, sale ₦13.5m)",
  t.includes("₦3,500,000.00") && t.includes("₦13,500,000.00") && t.includes("total for the whole Cycle"));
await shot("02-cycle-draft");

// ── 2. Submit; approval needs a different, authorised person ──────────────
await click("Submit for approval");
check("ops submits terms", await toast(/submitted/i));
await settle();
let r = await api("ops", "POST", `/api/admin/maalrise/cycles/${cycleId}/actions`, { action: "approve", terms_id: "x" });
check("ops cannot approve (role)", r.status === 403 || r.status === 400, JSON.stringify(r));

// super admin prepares a second Cycle and is refused when approving their own terms
const own = await api("sa", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "E2E Own Terms Ltd" },
  cycle: { name: "E2E Own-approval test", transaction_name: "Own", start_date: "2026-12-01", duration_months: 12, unit_price_kobo: 10_000_000 },
  terms: { costKobo: 1_000_000_000, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 0, treatment: "waived" }, schedule: { mode: "equal" }, statedSalePriceKobo: 1_350_000_000 },
});
check("12-month Cycle at 35% still gives ₦3.5m markup (not annualised)", own.status === 201 && !!own.body.terms_id, JSON.stringify(own));
await api("sa", "POST", `/api/admin/maalrise/cycles/${own.body.id}/actions`, { action: "submit", terms_id: own.body.terms_id });
r = await api("sa", "POST", `/api/admin/maalrise/cycles/${own.body.id}/actions`, { action: "approve", terms_id: own.body.terms_id });
check("preparer/submitter cannot approve their own terms (database refuses)", r.status === 400 && /prepared or submitted/i.test(r.body.error ?? ""), JSON.stringify(r));
await as("sa");
await go(`/admin/maalrise/cycles/${own.body.id}`);
t = await text();
check("UI: preparer sees 'a different authorised person must approve' and no Approve button",
  t.includes("different authorised person") && !(await hasButton("Approve terms")));
const ownTerms = await page.evaluate(() => document.body.innerText.match(/₦3,500,000\.00/g)?.length ?? 0);
check("12-month Cycle page shows ₦3,500,000 markup", ownTerms > 0);

// administrator returns Cycle One with a reason
await as("admin");
await go(`/admin/maalrise/cycles/${cycleId}`);
await click("Return for changes");
await page.type("textarea", "Please attach the signed contract reference.");
await click("Return with this reason");
check("administrator returns terms with a reason", await toast(/returned/i));
await settle();
t = await text();
check("return reason is shown on the Cycle", await waitText("Please attach the signed contract reference."));

// operations edits the returned terms via the terms page and resubmits
await as("ops");
await go(`/admin/maalrise/cycles/${cycleId}`);
check("ops sees 'Edit draft terms' after return", await hasButton("Edit draft terms"));
await go(`/admin/maalrise/cycles/${cycleId}/terms`);
t = await text();
check("terms page prefills from the draft (cost and markup)", await page.evaluate(() =>
  [...document.querySelectorAll("input")].some((i) => i.value === "10000000") && [...document.querySelectorAll("input")].some((i) => i.value === "35")));
check("terms page fixes Cycle fields (name disabled)", await page.evaluate(() =>
  [...document.querySelectorAll("input")].find((i) => i.value === "E2E Cycle One")?.disabled === true));
await type("Fee rate (%)", "4");
await settle();
await shot("03-edit-terms");
await click("Save draft terms");
check("ops saves edited draft terms", await toast(/saved/i));
await page.waitForFunction((id) => location.pathname === `/admin/maalrise/cycles/${id}`, { timeout: 15000 }, cycleId).catch(() => {});
await settle();
await click("Submit for approval");
check("ops resubmits", await toast(/submitted/i));

await as("admin");
await go(`/admin/maalrise/cycles/${cycleId}`);
await click("Approve terms");
check("administrator approves (different person)", await toast(/approved/i));
await settle();
t = await text();
check("Cycle status becomes Terms Approved", await waitText("Terms Approved"));
check("approved terms cannot be edited in place (no 'Edit draft terms')", !(await hasButton("Edit draft terms")));
await shot("04-cycle-approved");

// ── 3. Investors ─────────────────────────────────────────────────────────
await as("ops");
await go("/admin/maalrise/investors/new");
await type("Email address", "sa@test.local");
await click("Check email");
await settle();
check("staff email is refused at lookup", (await text()).includes("Staff cannot be MaalRise investors"));
check("Add investor stays disabled for staff", !(await hasEnabledButton("Add investor")));
await type("Email address", "nobody@test.local");
await click("Check email");
await settle();
check("unknown email: a new login would be created, nothing sent", (await text()).includes("A new login and investor record will be created"));
r = await api("ops", "POST", "/api/admin/maalrise/investors", { email: "nobody@test.local", full_name: "Nobody" });
check("API refuses unknown email with NO_LOGIN (nothing created or sent)", r.status === 409 && r.body.code === "NO_LOGIN", JSON.stringify(r));
r = await api("ops", "GET", "/api/admin/maalrise/investors/lookup?email=" + encodeURIComponent("b_th@test.local"));
check("wildcard in email does not match a different login (b_th ≠ both)", r.body.status === "no_login", JSON.stringify(r));

await type("Email address", "both@test.local");
await click("Check email");
await settle();
t = await text();
check("MaalGrow investor found: KYC reuse and bank prefill previewed",
  t.includes("verified MaalGrow KYC will be reused") && t.includes("0123456701") && t.includes("unconfirmed"));
await shot("05-add-investor-lookup");
await click("Add investor");
await page.waitForFunction(() => /\/investors\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 15000 }).catch(() => {});
await settle();
const bothId = page.url().match(/investors\/([0-9a-f-]{36})/)?.[1];
t = await text();
check("investor added and opened", !!bothId);
check("name taken from MaalGrow (profile name was blank)", t.includes("Both Products"));
check("KYC shows Verified via MaalGrow", /Verified via MaalGrow/i.test(t) && t.includes("Reused from verified MaalGrow KYC"));
check("bank pre-filled but awaiting confirmation", t.includes("0123456701") && t.includes("Awaiting admin confirmation") && t.includes("Pre-filled from MaalGrow"));
check("no KYC record/review buttons for MaalGrow-verified KYC", !(await hasButton("Record KYC details")));
await click("Confirm these bank details");
check("ops confirms bank details", await toast(/confirmed/i));
await settle();
t = await text();
check("bank confirmation shows who and when", await waitText("Confirmed by Test Operations"));
await shot("06-investor-maalgrow");

// MaalGrow investor whose KYC is not approved; then the MaalRise KYC review
await go("/admin/maalrise/investors/new");
await type("Email address", "pending.kyc@test.local");
await click("Check email");
await settle();
check("pending MaalGrow KYC: MaalRise waits for KYC approval", (await text()).includes("once it is approved in KYC Review, MaalRise uses it"));
await type("Bank name", "Access");
await type("Account name", "Pending Kyc");
await type("Account number", "0011223344");
await click("Add investor");
await page.waitForFunction(() => /\/investors\/[0-9a-f-]{36}/.test(location.pathname), { timeout: 15000 }).catch(() => {});
await settle();
const pendId = page.url().match(/investors\/([0-9a-f-]{36})/)?.[1];
t = await text();
check("entered bank details used instead of MaalGrow's", t.includes("0011223344") && !t.includes("0123456702"));
check("KYC not started; bank details alone are not KYC", /Not started/i.test(t));
await click("Record KYC details received");
await type("ID type", "NIN");
await type("ID number", "12345678901");
await setDate("Date of birth", "1990-01-01");
await type("Residential address", "1 Test Street, Lagos");
await click("Record for review");
check("ops records KYC details for review", await toast(/awaiting review/i));
await settle();
await click("Reject (reason required)").then(() => check("reject without reason must be blocked", false)).catch(() => check("reject is disabled until a reason is given", true));
await as("admin");
await go(`/admin/maalrise/investors/${pendId}`);
await click("Verify KYC");
check("administrator verifies KYC", await toast(/verified/i));
await settle();
t = await text();
check("KYC shows MaalRise verification with reviewer", await waitText("MaalRise verification") && (await text()).includes("Test Administrator"));
r = await api("support", "POST", `/api/admin/maalrise/investors/${pendId}`, { action: "confirm_bank" });
check("customer support cannot confirm bank details", r.status === 403, JSON.stringify(r));
await shot("07-investor-kyc-verified");

// ── 4. Funding: recorded by one finance person, confirmed by another ─────
await as("fin");
await go(`/admin/maalrise/cycles/${cycleId}`);
await page.select("#funding-investor", bothId);
await type("Units", "60");
await setDate("Date received", "2026-10-09");
await type("Bank reference", "E2E-REF-001");
await click("Record funding");
check("finance records funding (amount from units × unit price)", await toast(/recorded/i));
await settle();
t = await text();
check("funding row shows ₦6,000,000 awaiting confirmation", await waitText("₦6,000,000.00") && /awaiting confirmation/i.test(await text()));
t = await text();
check("recorder cannot confirm their own entry (UI)", t.includes("Another finance person must confirm"));
await as("sa");
await go(`/admin/maalrise/cycles/${cycleId}`);
await click("Confirm", { exact: true });
check("a different finance-role person confirms", await toast(/confirmed/i));
await settle();
t = await text();
await waitText("Confirmed");
t = await text();
check("allocation appears: 60 units, unsubscribed share shown separately", t.includes("Both Products") && /Unsubscribed|unallocated/i.test(t));
await shot("08-funding-confirmed");

// ── 5. Activation checks; activation refused while any check fails ────────
await as("admin");
await go(`/admin/maalrise/cycles/${cycleId}`);
await click("Run activation checks");
await page.waitForSelector("ul.grid li", { timeout: 15000 }).catch(() => {});
t = await text();
check("activation checks run and list results", /fully funded|units|KYC|bank/i.test(t));
check("Activate is offered but disabled while checks fail", await page.evaluate(() =>
  [...document.querySelectorAll("button")].some((b) => b.textContent.includes("Activate Cycle") && b.disabled)));
r = await api("admin", "POST", `/api/admin/maalrise/cycles/${cycleId}/actions`, { action: "activate" });
check("database refuses activation while checks fail (shortfall, no contract)", r.status === 400 && /checks failed/.test(r.body.error ?? ""), JSON.stringify(r));
check("operations cannot activate", (await api("ops", "POST", `/api/admin/maalrise/cycles/${cycleId}/actions`, { action: "activate" })).status === 403);
await shot("09-activation-checks");

// ── 6. Lists, dashboard and access ───────────────────────────────────────
await go("/admin/maalrise/dashboard");
t = await text();
check("dashboard shows real counts (2 investors, 2 Cycles in total)", t.includes("2 Cycle(s) in total") && /Total MaalRise investors\s*2/.test(t), t.slice(0, 600));
check("dashboard shows no sample tags by default", !t.includes("(sample)"));
await shot("10-dashboard");
await go("/admin/maalrise/cycles");
t = await text();
check("Cycles list shows both real Cycles", t.includes("E2E Cycle One") && t.includes("E2E Own-approval test"));
await go("/admin/maalrise/investors");
t = await text();
check("Investors list shows real investors", t.includes("Both Products") && t.includes("Pending Kyc"));
await go("/admin/maalrise/dashboard?sample=1");
check("sample view still available and labelled", (await text()).includes("(sample)"));

await as("officer");
const st = await go("/admin/maalrise/dashboard");
check("payment officer cannot open MaalRise admin", !page.url().includes("/admin/maalrise/dashboard") || st === 404 || st === 403, page.url());
r = await api("officer", "POST", "/api/admin/maalrise/cycles", {});
check("payment officer refused by API", r.status === 403);
r = await api("both", "GET", "/api/admin/maalrise/investors/lookup?email=sa@test.local");
check("investor login refused by API", r.status === 403);

await as("admin");
await go("/admin");
check("MaalGrow admin dashboard still loads", !page.url().includes("/login"));

check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
