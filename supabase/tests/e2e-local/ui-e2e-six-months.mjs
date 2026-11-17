// LOCAL end-to-end run of migration 064: MaalGrow cycles run as long as their series says (6 months):
// series setting, new cycles, the Mudarabah ledger with six months, and investor wording.
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

const A = sql(`select id from series where name='A'`);
const B = sql(`select id from series where name='B'`);
const A1 = "30000000-0000-0000-0000-0000000000c1";

// ── The series setting ──
check("every series runs 6-month cycles", sql(`select string_agg(distinct cycle_months::text, ',') from series`) === "6");
check("the seeded cycle keeps the length its dates span", sql(`select cycle_months from cycles where id='${A1}'`) === "6");
await as("sa");
await go(`/admin/series/${A}/settings`);
check("the Series settings page shows the cycle length", await page.evaluate(() => document.querySelector("#cycle_months")?.value) === "6");
let r = await api("sa", "PATCH", `/api/admin/series/${A}`, { cycle_months: 13 });
check("a cycle length over 12 is refused", r.status === 400 && /1 to 12/.test(r.body.error ?? ""), JSON.stringify(r));
r = await api("ops", "PATCH", `/api/admin/series/${A}`, { cycle_months: 4 });
check("operations cannot change the cycle length", r.status === 403, JSON.stringify(r));
check("…and nothing changed", sql(`select cycle_months from series where id='${A}'`) === "6");
await shot("six-01-series");

// ── A new cycle made by hand runs the series' length ──
r = await api("sa", "POST", "/api/admin/cycles", { series_id: B, start_date: "2030-01-15", unit_value: 100000 });
check("a cycle created by hand is 6 months: 15 Jan → 15 Jul 2030", r.status < 300
  && sql(`select end_date || ':' || cycle_months from cycles where series_id='${B}' and start_date='2030-01-15'`) === "2030-07-15:6", JSON.stringify(r));
await go("/admin/cycles/new");
check("the Create Cycle page says the length comes from the series", (await text()).includes("cycle length (now 6 months)"));

// ── The rollover makes the next cycle 6 months ──
const next = sql(`select create_next_cycle('${A}')`);
check("the rollover's next cycle is 6 months on, same day: 1 Jan → 1 Jul 2027",
  sql(`select start_date || '→' || end_date || ':' || cycle_months from cycles where id='${next}'`) === "2027-01-01→2027-07-01:6");

// ── The Mudarabah ledger: six months ──
await go(`/admin/mudarabah/${next}`);
let t = await text();
check("the ledger of a 6-month cycle has Month 1 to Month 6", t.includes("Month 6") && !t.includes("Month 7"));
await shot("six-02-ledger");
const months = Array.from({ length: 6 }, (_, i) => ({ ads: (i + 1) * 100000, logistics: 0, misc: 0, bankCharges: 0, rows: [] }));
r = await api("sa", "POST", "/api/admin/mudarabah", { ledger: { cycleId: next, description: "home furniture", status: "draft", discloseMode: "perSlot", products: [], months } });
check("six months save", r.status < 300 && sql(`select count(*) from mudarabah_months m join mudarabah_ledgers l on l.id = m.ledger_id where l.cycle_id='${next}'`) === "6", JSON.stringify(r));
r = await api("sa", "POST", "/api/admin/mudarabah", { ledger: { cycleId: next, description: "home furniture", status: "draft", discloseMode: "perSlot", products: [],
  months: [...months, { ads: 1, logistics: 0, misc: 0, bankCharges: 0, rows: [] }] } });
check("a seventh month is refused", r.status >= 400 && /no month 7/.test(r.body.error ?? ""), JSON.stringify(r));
await go(`/admin/mudarabah/${next}`);
check("the saved sixth month shows on the page", (await page.evaluate(() => [...document.querySelectorAll("input")].map((i) => i.value).join("|"))).includes("6000"));

// A 3-month cycle's ledger still has three months
sql(`insert into cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status, cycle_months)
  values ('30000000-0000-0000-0000-0000000003c3', '${B}', 90, 'Old 3-month', '2025-01-15', '2025-04-15', 'completed', 3)`);
await go("/admin/mudarabah/30000000-0000-0000-0000-0000000003c3");
t = await text();
check("a 3-month cycle's ledger still has Month 1 to Month 3", t.includes("Month 3") && !t.includes("Month 4"));

// ── What investors read ──
sql(`update investors set kyc_submitted_at = now() where email = 'both@test.local' and kyc_submitted_at is null`); // past the KYC form
await as("both");
await go("/support");
// The answers sit in collapsed <details>, so read the content, not the visible text
check("the investor FAQ says cycles now run 6 months",
  (await page.evaluate(() => document.body.textContent)).includes("now runs for 6 months"));

check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
