// LOCAL end-to-end run of the Investor Data Export: MaalGrow by series (and cycle), MaalRise by
// Cycle; only the right people, no duplicates in contact lists, figures equal the database,
// masking, roles, audit log, and the download from the screen.
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
const XLSX = createRequire(new URL("../../../package.json", import.meta.url))("xlsx");
async function file(who, path) {
  const r = await fetch(BASE + path, { headers: { Cookie: `sb-127-auth-token=${cookieFor(who)}` } });
  const buf = Buffer.from(await r.arrayBuffer());
  return { status: r.status, type: r.headers.get("content-type") ?? "", name: r.headers.get("content-disposition") ?? "", buf };
}
const rowsOf = (buf) => {
  const wb = XLSX.read(buf, { type: "buffer" });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" });
};
const csvLines = (buf) => buf.toString("utf8").replace(/^﻿/, "").trim().split("\r\n");

// ── MaalGrow test data: Series A (two cycles) and B, overlapping investors ──
sql(`
insert into auth.users (id, email) values
 ('10000000-0000-0000-0000-0000000000e1','xena@exp.local'),('10000000-0000-0000-0000-0000000000e2','yemi@exp.local'),
 ('10000000-0000-0000-0000-0000000000e3','zara@exp.local') on conflict do nothing;
insert into profiles (id, email, full_name, role) values
 ('10000000-0000-0000-0000-0000000000e1','xena@exp.local','Xena Export','investor'),
 ('10000000-0000-0000-0000-0000000000e2','yemi@exp.local','Yemi Export','investor'),
 ('10000000-0000-0000-0000-0000000000e3','zara@exp.local','Zara Export','investor') on conflict (id) do update set full_name = excluded.full_name, role = excluded.role;
insert into investors (id, profile_id, investor_code, full_name, email, phone, bank_name, account_name, account_number, kyc_status) values
 ('20000000-0000-0000-0000-0000000000e1','10000000-0000-0000-0000-0000000000e1','MG-XENA','Xena Export','xena@exp.local','08031110001','GTB','Xena Export','0123456789','approved'),
 ('20000000-0000-0000-0000-0000000000e2','10000000-0000-0000-0000-0000000000e2','MG-YEMI','Yemi Export','yemi@exp.local','08031110002',null,null,null,'pending'),
 ('20000000-0000-0000-0000-0000000000e3','10000000-0000-0000-0000-0000000000e3','MG-ZARA','Zara Export','zara@exp.local','08031110003',null,null,null,'approved');
insert into next_of_kin (investor_id, full_name, relationship, phone, address, city, state)
 values ('20000000-0000-0000-0000-0000000000e1','Kin Export','Brother','08039990000','1 Road','Ikeja','Lagos');
insert into cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status)
 select '30000000-0000-0000-0000-0000000000e2', id, 2, 'A-E2E-2', '2026-10-01', '2027-04-01', 'active' from series where name='A';
insert into cycles (id, series_id, cycle_number, cycle_label, start_date, end_date, status)
 select '30000000-0000-0000-0000-0000000000e3', id, 1, 'B-E2E-1', '2026-08-01', '2027-02-01', 'active' from series where name='B';
insert into investments (id, investment_code, investor_id, series_id, cycle_id, units, price_per_unit, capital, investment_date, maturity_date, status)
 select '40000000-0000-0000-0000-0000000000e1'::uuid,'INV-E-BOTH2','20000000-0000-0000-0000-0000000000c1'::uuid, series_id, id, 2, 500000, 1000000, '2026-10-01'::date,'2027-04-01'::date,'active'::investment_status from cycles where id='30000000-0000-0000-0000-0000000000e2'
 union all select '40000000-0000-0000-0000-0000000000e2'::uuid,'INV-E-XENA-A','20000000-0000-0000-0000-0000000000e1'::uuid, series_id, id, 1.5, 500000, 750000, '2026-07-02','2027-01-01','active' from cycles where id='30000000-0000-0000-0000-0000000000c1'
 union all select '40000000-0000-0000-0000-0000000000e3'::uuid,'INV-E-XENA-B','20000000-0000-0000-0000-0000000000e1'::uuid, series_id, id, 1, 500000, 500000, '2026-08-01','2027-02-01','active' from cycles where id='30000000-0000-0000-0000-0000000000e3'
 union all select '40000000-0000-0000-0000-0000000000e4'::uuid,'INV-E-YEMI-B','20000000-0000-0000-0000-0000000000e2'::uuid, series_id, id, 2, 500000, 1000000, '2026-08-01','2027-02-01','matured' from cycles where id='30000000-0000-0000-0000-0000000000e3'
 union all select '40000000-0000-0000-0000-0000000000e5'::uuid,'INV-E-ZARA-A','20000000-0000-0000-0000-0000000000e3'::uuid, series_id, id, 1, 500000, 500000, '2026-07-03','2027-01-01','cancelled' from cycles where id='30000000-0000-0000-0000-0000000000c1';
insert into investment_payments (investment_id, investor_id, amount, payment_date, reference, status)
 select id, investor_id, 1000000, '2026-07-01'::date, 'P-BOTH-1', 'confirmed' from investments where investment_code='INV-E2E-BOTH'
 union all select '40000000-0000-0000-0000-0000000000e2'::uuid,'20000000-0000-0000-0000-0000000000e1'::uuid, 500000, '2026-07-02', 'P-X-1', 'confirmed'
 union all select '40000000-0000-0000-0000-0000000000e2'::uuid,'20000000-0000-0000-0000-0000000000e1'::uuid, 250000, '2026-07-03', 'P-X-2', 'rejected';
`);
const fileA = (q) => `/api/admin/exports/maalgrow?series=A&cycle=all&status=active,matured,completed&${q}`;

// ── Who may export ──
for (const who of ["fin", "ops", "support", "officer", "both"]) {
  check(`${who} cannot export MaalGrow`, (await file(who, fileA("mode=contacts&fields=full_name,phone&format=csv"))).status >= 401);
}
check("an administrator cannot unmask account numbers", (await file("admin", fileA("mode=contacts&fields=full_name,account_number&format=csv&unmask=1"))).status === 403);
check("an unknown field is refused", (await file("admin", fileA("mode=contacts&fields=full_name,nin&format=csv"))).status === 400);

// ── Series A phone list: one row per person; B-only and cancelled people left out ──
const pl = await file("admin", fileA("mode=contacts&fields=full_name,phone,email&format=xlsx"));
const plRows = rowsOf(pl.buf);
check("Excel download with a clear file name", pl.status === 200 && pl.type.includes("spreadsheetml") && /maalgrow-series-A-contacts-\d{4}-\d{2}-\d{2}\.xlsx/.test(pl.name), pl.name);
check("Series A phone list: exactly Both Products and Xena (Yemi is Series B only; Zara's investment is cancelled)",
  plRows.map((r) => r["Email address"]).sort().join() === "both@test.local,xena@exp.local", plRows);
check("each person once, though Both Products holds two Series A investments", plRows.length === 2);
const xenaPhone = XLSX.read(pl.buf, { type: "buffer" });
const ws = xenaPhone.Sheets[xenaPhone.SheetNames[0]];
const xenaRow = plRows.findIndex((r) => r["Email address"] === "xena@exp.local") + 1;
check("phone number kept as text with its leading 0", ws[XLSX.utils.encode_cell({ r: xenaRow, c: 1 })]?.v === "08031110001"
  && ws[XLSX.utils.encode_cell({ r: xenaRow, c: 1 })]?.t === "s");
const withCancelled = rowsOf((await file("admin", "/api/admin/exports/maalgrow?series=A&cycle=all&status=active,cancelled&mode=contacts&fields=email&format=xlsx")).buf);
check("ticking Cancelled brings Zara in", withCancelled.map((r) => r["Email address"]).sort().join() === "both@test.local,xena@exp.local,zara@exp.local");

// ── Series A investment report: one row per investment, figures from the database ──
const rep = await file("admin", fileA("mode=investments&fields=full_name,cycle,investment_code,slots,capital,amount_paid,payment_status,status,nok_name,account_number&format=csv"));
const lines = csvLines(rep.buf);
check("CSV investment report: header and three investments", rep.status === 200 && rep.type.includes("text/csv")
  && lines[0] === "Full name,Next of kin,Account number,Cycle,Investment code,Number of slots,Investment amount (NGN),Amount paid (NGN),Payment status,Investment status"
  && lines.length === 4, lines);
check("rows: Both Products ×2 (fully paid, unpaid), Xena part paid — the rejected payment is not counted; next of kin; account masked",
  lines.includes("Both Products,,******6701,A-E2E-1,INV-E2E-BOTH,1,1000000,1000000,Fully Paid,Active")
  && lines.includes("Both Products,,******6701,A-E2E-2,INV-E-BOTH2,2,1000000,0,Unpaid,Active")
  && lines.includes("Xena Export,Kin Export,******6789,A-E2E-1,INV-E-XENA-A,1.5,750000,500000,Part Paid,Active"), lines);
const dbTotal = sql(`select sum(capital)::numeric(20,0) from investments i join series s on s.id = i.series_id
                     where s.name = 'A' and i.status in ('active','matured','completed')`);
check("the report's total equals the database's Series A total",
  lines.slice(1).reduce((t, l) => t + Number(l.split(",")[6]), 0) === Number(dbTotal), dbTotal);
const one = rowsOf((await file("admin", "/api/admin/exports/maalgrow?series=A&cycle=30000000-0000-0000-0000-0000000000e2&status=active&mode=investments&fields=investment_code&format=xlsx")).buf);
check("one cycle only: A-E2E-2 has just Both Products' second investment", one.length === 1 && one[0]["Investment code"] === "INV-E-BOTH2", one);
check("a cycle from another series is refused",
  (await file("admin", "/api/admin/exports/maalgrow?series=A&cycle=30000000-0000-0000-0000-0000000000e3&status=active&mode=contacts&fields=email&format=csv")).status === 400);
const b = rowsOf((await file("admin", "/api/admin/exports/maalgrow?series=B&cycle=all&status=active,matured,completed&mode=contacts&fields=email,investments,capital&format=xlsx")).buf);
check("Series B: Xena and Yemi only, with their Series B totals",
  b.map((r) => `${r["Email address"]}:${r["Number of investments"]}:${r["Total invested (NGN)"]}`).sort().join() === "xena@exp.local:1:500000,yemi@exp.local:1:1000000", b);
const full = csvLines((await file("sa", fileA("mode=contacts&fields=email,account_number&format=csv&unmask=1"))).buf);
check("a super admin can export full account numbers", full.includes("xena@exp.local,0123456789"), full);
check("every successful export is in the audit log (refused ones are not files), with the unmasked one marked",
  sql(`select count(*) from audit_logs where action='investor_export'`) === "6"
  && sql(`select count(*) from audit_logs where action='investor_export' and new_values->>'unmasked' = 'true'`) === "1");

// ── MaalRise: a Cycle with two confirmed investors and one entry still awaiting confirmation ──
const c = await must("ops", "POST", "/api/admin/maalrise/cycles", {
  counterparty: { name: "Export E2E Ltd" },
  cycle: { name: "E2E Export Cycle", transaction_name: "Murabaha", start_date: TODAY, duration_months: 3, unit_price_kobo: 10_000_000 },
  terms: { costKobo: 1_000_000_000, markup: { type: "percent", bps: 3500 }, fee: { basis: "markup", bps: 400, treatment: "deducted_from_investors" },
           schedule: { mode: "equal" }, statedSalePriceKobo: 1_350_000_000 },
});
await must("ops", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "submit", terms_id: c.terms_id });
await must("admin", "POST", `/api/admin/maalrise/cycles/${c.id}/actions`, { action: "approve", terms_id: c.terms_id });
const mBoth = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "both@test.local", full_name: "" })).id;
const mLogin = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "login.only@test.local", full_name: "Login Only" })).id;
const mPend = (await must("ops", "POST", "/api/admin/maalrise/investors", { email: "pending.kyc@test.local", full_name: "Pending Kyc" })).id;
for (const [inv, units, ref] of [[mBoth, 60, "EX-1"], [mLogin, 30, "EX-2"]]) {
  const f = (await must("fin", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings`, { investor_id: inv, units, received_on: TODAY, reference: ref })).id;
  await must("admin", "POST", `/api/admin/maalrise/fundings/${f}`, { action: "confirm" });
}
await must("fin", "POST", `/api/admin/maalrise/cycles/${c.id}/fundings`, { investor_id: mPend, units: 10, received_on: TODAY, reference: "EX-3" });
const mrUrl = `/api/admin/maalrise/exports/${c.id}?fields=full_name,phone,units,capital,participation,funding_refs,account_number&format=xlsx`;
for (const who of ["fin", "ops", "support", "officer", "both"]) check(`${who} cannot export MaalRise`, (await file(who, mrUrl)).status >= 401);
const mrRows = rowsOf((await file("admin", mrUrl)).buf);
check("MaalRise: the two confirmed investors only — the unconfirmed entry is left out",
  mrRows.map((r) => `${r["Full name"]}:${r["Units"]}:${r["Capital (NGN)"]}:${r["Funding bank reference(s)"]}`).join("|")
    === "Both Products:60:6000000:EX-1|Login Only:30:3000000:EX-2", mrRows);
check("MaalRise: participation from the Cycle's units (60 of 100 → 60%)", mrRows[0]["Participation (%)"] === 60, mrRows[0]);
const dbUnits = sql(`select sum(units) from maalrise_allocations where cycle_id='${c.id}'`);
check("MaalRise: the units equal the database's allocations", mrRows.reduce((t, r) => t + r["Units"], 0) === Number(dbUnits));

// ── The screens ──
await as("fin");
await go("/admin/reports/export");
check("finance is sent away from the export page", !page.url().includes("/admin/reports/export"), page.url());
await go("/admin/maalrise/reports");
check("finance sees no MaalRise export panel", !(await page.$("[data-testid='export-maalrise']")));
await as("admin");
await go("/admin/reports");
check("Reports has an Export investors button", (await text()).includes("Export investors"));
await go("/admin/reports/export");
await click("Phone list");
const [resp] = await Promise.all([
  page.waitForResponse((r) => r.url().includes("/api/admin/exports/maalgrow"), { timeout: 20000 }),
  click("Download", { exact: true }),
]);
check("Download from the screen asks for Series A contacts as Excel and succeeds",
  resp.status() === 200 && resp.url().includes("series=A") && resp.url().includes("mode=contacts")
  && resp.url().includes("fields=full_name%2Cphone%2Cemail") && resp.url().includes("format=xlsx"), resp.url());
check("success shown", await toast(/Export downloaded/i));
await shot("export-01-maalgrow");
await go("/admin/maalrise/reports#export");
check("the MaalRise export panel is on MaalRise Reports", !!(await page.$("[data-testid='export-maalrise']")));
await page.select("#export-mr-cycle", c.id);
const [resp2] = await Promise.all([
  page.waitForResponse((r) => r.url().includes(`/api/admin/maalrise/exports/${c.id}`), { timeout: 20000 }),
  click("Download", { exact: true }),
]);
check("Download from MaalRise Reports succeeds for the chosen Cycle", resp2.status() === 200);
await shot("export-02-maalrise");

check("no browser errors", pageErrors.length === 0, pageErrors.join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
