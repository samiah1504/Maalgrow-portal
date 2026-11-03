// LOCAL end-to-end run of staff chat alerts: the Investor Chats badge, the admin bell, the
// pop-up and the tab count when investors send messages; who sees what; clearing on opening.
// (No Realtime server locally, so this exercises the 30-second re-check path.)
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
void api;

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
const BOTH = "20000000-0000-0000-0000-0000000000c1", KYC = "20000000-0000-0000-0000-0000000000c2";
const OPS = "a0000000-0000-0000-0000-0000000000a3";
const say = (profile, body) => sql(`select set_config('request.jwt.claims', '{"sub":"${profile}","role":"authenticated"}', true);
  select chat_start_conversation('General Enquiry', '${body}')`);
const conv = (inv) => sql(`select id from chat_conversations where investor_id='${inv}' order by created_at desc limit 1`);
const badge = () => page.evaluate(() => document.querySelector("[data-testid='chat-unread-badge']")?.textContent?.trim() ?? "");
const bellCount = () => page.evaluate(() => document.querySelector("[data-testid='admin-bell-count']")?.textContent?.trim() ?? "");
const waitFor = (fn, want, ms = 45000) => page.waitForFunction(fn, { timeout: ms, polling: 500 }, want).then(() => true).catch(() => false);
const badgeIs = (v) => waitFor((v) => (document.querySelector("[data-testid='chat-unread-badge']")?.textContent?.trim() ?? "") === v, v);
const bellIs = (v) => waitFor((v) => (document.querySelector("[data-testid='admin-bell-count']")?.textContent?.trim() ?? "") === v, v);
sql(`update investors set assigned_manager_id = '${OPS}' where id = '${KYC}'`);
sql(`update investors set kyc_submitted_at = now() where id in ('${BOTH}', '${KYC}')`);

// ── Before any message ──
await as("admin");
await go("/admin/dashboard");
check("no badge and no bell count before any message", (await badge()) === "" && (await bellCount()) === "");
check("the admin bell is the admin one (not the investor page link)", !!(await page.$("[data-testid='admin-bell']")));

// ── Both Products (no manager assigned) writes: senior staff are alerted ──
say("10000000-0000-0000-0000-0000000000c1", "Hello, when is my next payment?");
check("the Investor Chats badge shows 1 without a refresh", await badgeIs("1"));
check("the pop-up names the investor", await toast(/New message from Both Products/));
check("the bell counts the new-message alert", await bellIs("1"));
check("the browser tab shows the count", (await page.title()).startsWith("(1) "), await page.title());
await shot("chat-alerts-01-admin");

// ── Pending Kyc (assigned to Operations) writes twice ──
say("10000000-0000-0000-0000-0000000000c2", "First question");
const c2 = conv(KYC);
sql(`select set_config('request.jwt.claims', '{"sub":"10000000-0000-0000-0000-0000000000c2","role":"authenticated"}', true);
     select chat_send_message('${c2}', 'Second question')`);
check("an administrator sees every unread message (1 + 2 = 3)", await badgeIs("3"));
check("…but the assigned chat's alerts go to its manager, not to the administrator's bell", await bellIs("1"));

await as("ops");
await go("/admin/dashboard");
check("Operations (the manager) sees their chat and the unassigned one: 3", await badgeIs("3"));
check("Operations' bell has the two alerts for their chat", await bellIs("2"));
await as("support");
await go("/admin/dashboard");
check("Customer support sees only the unassigned chat: 1", await badgeIs("1"));
await as("officer");
await go("/admin/payment-requests");
check("the payment officer sees no chat badge and no admin bell", (await badge()) === "" && !(await page.$("[data-testid='admin-bell']")));

// ── Opening from the bell clears it ──
await as("admin");
await go("/admin/dashboard");
await badgeIs("3");
await page.click("[data-testid='admin-bell']");
await page.waitForSelector("[data-testid='admin-bell-menu']");
check("the bell lists the alert", await waitFor((t) => document.querySelector("[data-testid='admin-bell-menu']")?.innerText.includes(t),
  "Both Products (MGT001) sent a new message.", 15000));
await shot("chat-alerts-02-bell");
await click("New investor chat message");
check("clicking it opens that chat", await page.waitForFunction((id) => location.pathname === `/admin/chats/${id}`, { timeout: 15000 }, conv(BOTH)).then(() => true).catch(() => false), page.url());
check("opening the chat clears its messages from the badge (3 → 2)", await badgeIs("2"));
check("…and its alert from the bell", await bellIs(""));
check("the database agrees", sql(`select admin_unread from chat_conversations where id='${conv(BOTH)}'`) === "0"
  && sql(`select count(*) from notifications where user_id='a0000000-0000-0000-0000-0000000000a2' and is_read = false`) === "0");

// ── The notifications page ──
await go("/admin/notifications");
await page.waitForSelector("[data-testid='admin-notifications']", { timeout: 15000 });
check("before: one alert listed", (await page.$$("[data-testid='admin-notifications'] li")).length === 1);
say("10000000-0000-0000-0000-0000000000c1", "One more thing");
await badgeIs("3"); // the re-check has seen it (no Realtime locally)
check("a message arriving while on another page pops up", await toast(/New message from Both Products/));
check("the open notifications page shows the new alert without a refresh", await page.waitForFunction(() => document.querySelectorAll("[data-testid='admin-notifications'] li").length >= 2,
  { timeout: 15000 }).then(() => true).catch(() => false), await page.evaluate(() => document.body.innerText.slice(0, 400)));
await click("Mark all read");
check("Mark all read empties the bell", await bellIs(""));
await shot("chat-alerts-03-page");

check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
