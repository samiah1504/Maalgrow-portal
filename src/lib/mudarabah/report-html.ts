/**
 * The investor report, as HTML.
 *
 * THE RULE: this module never queries the database and never calls
 * compute(). It takes a resolved ReportFigures object (see
 * report-figures.ts) and turns it into a document. That is what makes
 * a settled cycle's report identical today and in two years.
 *
 * CONFIDENTIALITY: aggregate figures only. If the cycle traded 20
 * sofas, 50 chairs and 25 tables, the investor sees 95 purchased and
 * 95 sold. No product names, no per-product quantities, no per-product
 * revenue, no unit cost. The only product reference is the cycle-level
 * description — "home furniture", a category. ReportFigures carries no
 * product-shaped field, so this holds by construction.
 *
 * Net profit only. Gross profit is an internal figure and appears
 * nowhere investor-facing.
 *
 * Money arrives as integer kobo and is formatted here, at the edge.
 */

import type {
  HolderFigures,
  ReportCycle,
  ReportFigures,
  ReportHolding,
} from "./report-figures";
import { holderReportFigures, slotWord } from "./report-figures";

/* ── Formatting ──────────────────────────────────────────────────── */

/** ₦1,234,568 — rounded, the way money reads in a statement */
function naira(kobo: number): string {
  const sign = kobo < 0 ? "−" : "";
  return `${sign}₦${Math.round(Math.abs(kobo) / 100).toLocaleString("en-NG")}`;
}
function units(n: number): string {
  return (Number(n) || 0).toLocaleString("en-NG");
}
function percent(v: number, dp = 2): string {
  return `${(Number(v) || 0).toFixed(dp)}%`;
}
function longDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}
/** Every value that reaches the document goes through this */
function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ── The stylesheet ──────────────────────────────────────────────── */

/**
 * Brand values are the portal's own tokens from globals.css — plum
 * #3D1A6E and gold #C9A435 — not approximations.
 *
 * Fonts are self-hosted. A font that silently falls back changes every
 * line break in the document, and step 7 renders this on a server
 * where Google Fonts may be unreachable.
 */
export const REPORT_CSS = `
@font-face{font-family:'Marcellus';src:url('/fonts/marcellus-latin-400-normal.woff2') format('woff2');font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:'Karla';src:url('/fonts/karla-latin-400-normal.woff2') format('woff2');font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:'Karla';src:url('/fonts/karla-latin-500-normal.woff2') format('woff2');font-weight:500;font-style:normal;font-display:block}
@font-face{font-family:'Karla';src:url('/fonts/karla-latin-700-normal.woff2') format('woff2');font-weight:700;font-style:normal;font-display:block}
@font-face{font-family:'IBM Plex Mono';src:url('/fonts/ibm-plex-mono-latin-400-normal.woff2') format('woff2');font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:'IBM Plex Mono';src:url('/fonts/ibm-plex-mono-latin-500-normal.woff2') format('woff2');font-weight:500;font-style:normal;font-display:block}
@font-face{font-family:'IBM Plex Mono';src:url('/fonts/ibm-plex-mono-latin-600-normal.woff2') format('woff2');font-weight:600;font-style:normal;font-display:block}
/*
 * THE NAIRA SIGN IS NOT IN THE LATIN SUBSET. U+20A6 sits in latin-ext
 * — the latin subset carries the euro and stops there. Without these
 * faces every ₦ on the statement falls back to whatever font the
 * machine rendering it happens to own, which on a print server is
 * often nothing at all. On a document about Nigerian money that is not
 * a detail worth economising on.
 */
@font-face{font-family:'Karla';src:url('/fonts/karla-latin-ext-400-normal.woff2') format('woff2');font-weight:400;font-style:normal;font-display:block;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Karla';src:url('/fonts/karla-latin-ext-500-normal.woff2') format('woff2');font-weight:500;font-style:normal;font-display:block;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'Karla';src:url('/fonts/karla-latin-ext-700-normal.woff2') format('woff2');font-weight:700;font-style:normal;font-display:block;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'IBM Plex Mono';src:url('/fonts/ibm-plex-mono-latin-ext-400-normal.woff2') format('woff2');font-weight:400;font-style:normal;font-display:block;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'IBM Plex Mono';src:url('/fonts/ibm-plex-mono-latin-ext-500-normal.woff2') format('woff2');font-weight:500;font-style:normal;font-display:block;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}
@font-face{font-family:'IBM Plex Mono';src:url('/fonts/ibm-plex-mono-latin-ext-600-normal.woff2') format('woff2');font-weight:600;font-style:normal;font-display:block;unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF}

.mgr, .mgr *, .mgr *::before, .mgr *::after { box-sizing: border-box; }
.mgr {
  --plum: #3D1A6E; --plum-800: #2C1350; --plum-900: #1A0B31;
  --plum-100: #E4D5F5; --plum-200: #C9ABE9;
  --gold: #C9A435; --gold-100: #FAF0CC; --gold-300: #ECC866;
  --parchment: #FBF8F2; --parchment-2: #F2ECE0;
  --ink: #2C2620; --ink-soft: #6A6157; --line: #E2D9C9;
  --font-head: 'Marcellus', Georgia, serif;
  --font-body: 'Karla', system-ui, sans-serif;
  --font-mono: 'IBM Plex Mono', Menlo, monospace;
  font-family: var(--font-body); color: var(--ink);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .page {
  width: 210mm; min-height: 297mm; padding: 11mm;
  margin: 0 auto 8mm; background: #fff; position: relative;
  display: flex; flex-direction: column;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
/*
 * The page is a flex column so the footer can sit at the bottom. Left
 * to itself, flex would then SHRINK the cards to fit 297mm and the
 * overflow would only show up at print time — the sheet measures a
 * tidy 297mm on screen and still prints a fourth page. Nothing on a
 * page may shrink; if it does not fit, it has to be visible that it
 * does not fit.
 */
.mgr .page > * { flex-shrink: 0; }
.mgr h1, .mgr h2, .mgr h3 { font-family: var(--font-head); font-weight: 400; margin: 0; }
.mgr .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

.mgr .masthead {
  background: var(--plum); color: #fff; border-radius: 8px;
  padding: 7mm 8mm; -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .masthead .brand { font-family: var(--font-head); font-size: 15pt; letter-spacing: .04em; }
.mgr .masthead .meta { font-size: 8.5pt; opacity: .85; margin-top: 2mm; }
.mgr .provisional {
  margin-top: 4mm; background: #FDF3D4; border: 1px solid var(--gold);
  color: #6B5310; border-radius: 6px; padding: 3mm 4mm; font-size: 8.5pt;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .provisional strong { display: block; font-size: 9.5pt; margin-bottom: 1mm; }

.mgr .headline { text-align: center; padding: 9mm 0 6mm; }
.mgr .headline .k {
  font-size: 8.5pt; letter-spacing: .18em; text-transform: uppercase;
  color: var(--ink-soft);
}
.mgr .headline .v {
  font-family: var(--font-mono); font-size: 34pt; font-weight: 600;
  color: var(--plum); margin: 2mm 0 1mm; line-height: 1;
}
.mgr .headline .sub { font-size: 10pt; color: var(--gold); font-weight: 700; }
.mgr .headline .loss { color: #9B2C2C; }

.mgr .ledger { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
.mgr .ledger .row {
  display: flex; justify-content: space-between; align-items: baseline;
  padding: 3.4mm 5mm; font-size: 10pt; border-bottom: 1px solid var(--parchment-2);
}
.mgr .ledger .row:last-child { border-bottom: none; }
.mgr .ledger .row .lbl { color: var(--ink-soft); }
.mgr .ledger .row .val { font-family: var(--font-mono); font-weight: 500; }
.mgr .ledger .row.deduct .val { color: #9B2C2C; }
.mgr .ledger .row.total {
  background: var(--plum); color: #fff; padding: 4.5mm 5mm;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .ledger .row.total .lbl {
  color: #fff; font-size: 9pt; letter-spacing: .12em; text-transform: uppercase;
}
.mgr .ledger .row.total .val { font-size: 15pt; font-weight: 600; }
.mgr .ledger .row.total .net { display: block; font-size: 8pt; opacity: .8;
  text-align: right; letter-spacing: 0; text-transform: none; font-weight: 400; }

.mgr .choice-head { text-align: center; margin: 8mm 0 4mm; }
.mgr .choice-head .a { font-family: var(--font-head); font-size: 13pt; color: var(--plum); }
.mgr .choice-head .b { font-size: 9.5pt; color: var(--ink-soft); margin-top: 1mm; }
.mgr .options { display: flex; gap: 4mm; }
.mgr .opt {
  flex: 1; border: 1px solid var(--line); border-radius: 8px; padding: 5mm;
  background: var(--parchment);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .opt.chosen {
  border-color: var(--gold); border-width: 2px; background: #FFFDF5;
}
.mgr .opt .t { font-family: var(--font-head); font-size: 11pt; color: var(--plum); }
.mgr .opt .amt { font-family: var(--font-mono); font-size: 13pt; margin: 2mm 0 1.5mm; }
.mgr .opt .d { font-size: 8.5pt; color: var(--ink-soft); line-height: 1.5; }
.mgr .opt .tag {
  display: inline-block; margin-top: 3mm; background: var(--gold); color: #1A0B31;
  font-size: 7.5pt; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
  padding: 1mm 2.5mm; border-radius: 3px;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .undecided {
  margin-top: 3mm; font-size: 8.5pt; color: var(--ink-soft); text-align: center;
}

.mgr .split { display: flex; align-items: center; gap: 7mm; margin-top: 9mm; }
.mgr .ring { flex-shrink: 0; }
.mgr .split .words { font-size: 9pt; color: var(--ink-soft); line-height: 1.6; }
.mgr .split .words h3 { font-size: 11pt; color: var(--plum); margin-bottom: 2mm; }
.mgr .key { display: flex; gap: 5mm; margin-top: 2.5mm; font-size: 8.5pt; }
.mgr .key i { display: inline-block; width: 3mm; height: 3mm; border-radius: 1px; margin-right: 1.5mm;
  -webkit-print-color-adjust: exact; print-color-adjust: exact; }

.mgr .sect { font-family: var(--font-head); font-size: 13pt; color: var(--plum);
  border-bottom: 1px solid var(--line); padding-bottom: 2mm; margin: 0 0 4mm; }
.mgr .sect .mode { float: right; font-family: var(--font-body); font-size: 8pt;
  color: var(--ink-soft); padding-top: 2mm; }

.mgr .totals { display: grid; grid-template-columns: repeat(3, 1fr); gap: 2.5mm; }
.mgr .tot {
  border: 1px solid var(--line); border-radius: 6px; padding: 3mm 4mm;
  background: var(--parchment);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .tot .k { font-size: 7.5pt; letter-spacing: .08em; text-transform: uppercase; color: var(--ink-soft); }
.mgr .tot .v { font-family: var(--font-mono); font-size: 12pt; margin-top: 1mm; color: var(--plum-800); }

/*
 * Page 2 carries three month cards and a six-figure summary, and it
 * has to hold all of it on ONE sheet even in the worst case — every
 * month showing an unaccounted-stock line. The rhythm below is sized
 * for that case, not for the common one.
 */
.mgr .mcard {
  border: 1px solid var(--line); border-radius: 8px; margin-top: 3mm;
  page-break-inside: avoid; break-inside: avoid;
}
.mgr .mcard .h {
  background: var(--parchment-2); padding: 2.5mm 5mm; font-family: var(--font-head);
  font-size: 11pt; color: var(--plum); border-radius: 7px 7px 0 0;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .mcard .b { padding: 3mm 5mm; }
.mgr .mline {
  display: flex; justify-content: space-between; gap: 4mm; font-size: 9.5pt;
  padding: 1.1mm 0; border-bottom: 1px dotted var(--line);
}
.mgr .mline:last-of-type { border-bottom: none; }
.mgr .mline .val { font-family: var(--font-mono); }
.mgr .mline.minus .val { color: #9B2C2C; }
.mgr .mline.net {
  border-top: 1.5px solid var(--plum); margin-top: 1.5mm; padding-top: 2mm;
  font-weight: 700; color: var(--plum); border-bottom: none;
}

.mgr .panel {
  background: var(--parchment); border-left: 3px solid var(--gold);
  border-radius: 0 6px 6px 0; padding: 5mm 6mm; margin-top: 5mm;
  page-break-inside: avoid; break-inside: avoid;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .panel h3 { font-size: 11pt; color: var(--plum); margin-bottom: 2.5mm; }
.mgr .panel p { font-size: 9pt; line-height: 1.65; margin: 0 0 2.5mm; color: var(--ink); }
.mgr .panel p:last-child { margin-bottom: 0; }
.mgr .panel strong { color: var(--plum-800); }

.mgr .foot {
  margin-top: auto; padding-top: 5mm; border-top: 1px solid var(--line);
  font-size: 7.5pt; color: var(--ink-soft); display: flex; justify-content: space-between;
}

/* ── Credit note: a tax document, plainer and more formal ───────── */
.mgr .cn-head {
  border-bottom: 2px solid var(--plum); padding-bottom: 5mm; margin-bottom: 6mm;
  display: flex; justify-content: space-between; align-items: flex-start;
}
.mgr .cn-title { font-family: var(--font-head); font-size: 15pt; color: var(--plum); }
.mgr .cn-ref { text-align: right; font-size: 8.5pt; color: var(--ink-soft); }
.mgr .cn-ref .r { font-family: var(--font-mono); font-size: 11pt; color: var(--ink); font-weight: 600; }
.mgr .cn-parties { display: flex; gap: 6mm; margin-bottom: 6mm; }
.mgr .cn-party { flex: 1; border: 1px solid var(--line); border-radius: 6px; padding: 4mm 5mm; }
.mgr .cn-party .k { font-size: 7.5pt; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 2mm; }
.mgr .cn-party .n { font-size: 10.5pt; font-weight: 700; margin-bottom: 1mm; }
.mgr .cn-party .l { font-size: 8.5pt; color: var(--ink-soft); line-height: 1.5; }
.mgr .cn-party .tin { font-family: var(--font-mono); font-size: 9pt; margin-top: 2mm; }
.mgr .cn-party .absent { color: #9B2C2C; font-style: italic; font-family: var(--font-body); }
.mgr .cn-table { width: 100%; border-collapse: collapse; margin-bottom: 6mm; }
.mgr .cn-table th, .mgr .cn-table td {
  border: 1px solid var(--line); padding: 3mm 4mm; font-size: 9.5pt; text-align: left;
}
.mgr .cn-table th {
  background: var(--parchment-2); font-weight: 700; width: 55%;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .cn-table td { font-family: var(--font-mono); text-align: right; }
.mgr .cn-table tr.emph th, .mgr .cn-table tr.emph td {
  background: var(--plum); color: #fff; font-size: 11pt;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .cn-sign { margin-top: auto; display: flex; justify-content: space-between; gap: 8mm; padding-top: 12mm; }
.mgr .cn-sign .box { flex: 1; }
.mgr .cn-sign .rule { border-top: 1px solid var(--ink); padding-top: 2mm; font-size: 8.5pt; }
.mgr .cn-note { font-size: 8pt; color: var(--ink-soft); line-height: 1.6; margin-top: 6mm; }

@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { margin: 0; padding: 0; background: #fff; }
  .mgr .page {
    margin: 0; box-shadow: none; page-break-after: always; break-after: page;
  }
  .mgr .page:last-child { page-break-after: auto; break-after: auto; }
  .no-print { display: none !important; }
}
@media screen {
  .mgr { background: #EFE9DF; padding: 8mm 0; }
  .mgr .page { box-shadow: 0 2px 12px rgba(0,0,0,.12); }
}
`;

/* ── The profit-split ring ───────────────────────────────────────── */

function ring(ratio: number): string {
  const r = 26;
  const c = 2 * Math.PI * r;
  const holders = Math.max(0, Math.min(100, ratio));
  const dash = (holders / 100) * c;
  return `<svg class="ring" width="72" height="72" viewBox="0 0 72 72" role="img" aria-label="${esc(
    holders
  )} per cent to slot holders">
  <circle cx="36" cy="36" r="${r}" fill="none" stroke="#3D1A6E" stroke-width="13"/>
  <circle cx="36" cy="36" r="${r}" fill="none" stroke="#C9A435" stroke-width="13"
    stroke-dasharray="${dash.toFixed(2)} ${(c - dash).toFixed(2)}" transform="rotate(-90 36 36)"/>
  <text x="36" y="39" text-anchor="middle" font-family="IBM Plex Mono, monospace"
    font-size="13" font-weight="600" fill="#3D1A6E">${Math.round(holders)}%</text>
</svg>`;
}

/* ── Page 1 — the only page that varies by investor ──────────────── */

function page1(
  f: ReportFigures,
  cycle: ReportCycle,
  holding: ReportHolding,
  h: HolderFigures
): string {
  const period = `${longDate(cycle.startDate)} to ${longDate(cycle.endDate)}`;
  const taxLine =
    h.wht > 0
      ? `<div class="row deduct"><span class="lbl">Less withholding tax (${percent(
          f.whtRate * 100,
          0
        )})</span><span class="val">−${naira(h.wht)}</span></div>`
      : "";

  const withdrawChosen = h.decision === "withdraw";
  const rolloverChosen = h.decision === "rollover";
  const partial = h.decision === "partial";

  const optOut = `<div class="opt${withdrawChosen || partial ? " chosen" : ""}">
      <div class="t">Take your capital out</div>
      <div class="amt">${naira(partial ? h.capitalWithdrawn : h.capital)}</div>
      <div class="d">returned to you alongside your profit${
        partial ? `, being ${esc(slotWord(h.slotsWithdrawn))}` : ""
      }</div>
      ${withdrawChosen ? '<div class="tag">Your choice</div>' : ""}
      ${partial ? '<div class="tag">Part of your choice</div>' : ""}
    </div>`;

  const optIn = `<div class="opt${rolloverChosen || partial ? " chosen" : ""}">
      <div class="t">Leave your capital in</div>
      <div class="amt">${naira(partial ? h.capitalContinuing : h.capital)}</div>
      <div class="d">continues as ${esc(
        slotWord(partial ? h.slotsContinuing : h.units)
      )} in the next cycle</div>
      ${rolloverChosen ? '<div class="tag">Your choice</div>' : ""}
      ${partial ? '<div class="tag">Part of your choice</div>' : ""}
    </div>`;

  const undecided =
    h.decision === "none"
      ? `<div class="undecided">We have not received your instruction yet. Your profit is paid to you either way; let us know what you would like to do with your capital.</div>`
      : "";

  return `<section class="page">
  <div class="masthead">
    <div class="brand">MaalGrow · Cycle Statement</div>
    <div class="meta">Series ${esc(cycle.seriesName)} · ${esc(period)}</div>
    <div class="meta">${esc(holding.investorName)} · ${esc(
    holding.investorCode
  )} · ${esc(slotWord(h.units))}</div>
  </div>
  ${
    f.provisional
      ? `<div class="provisional"><strong>Provisional — this cycle is not yet settled.</strong>
      These figures are based on trading recorded so far and will change. This is not a final statement.</div>`
      : ""
  }

  <div class="headline">
    <div class="k">Your ${f.isLoss ? "result" : "profit"} this cycle</div>
    <div class="v${f.isLoss ? " loss" : ""}">${naira(h.grossProfit)}</div>
    <div class="sub${f.isLoss ? " loss" : ""}">${percent(
    h.grossReturn
  )} gross return on your capital</div>
  </div>

  <div class="ledger">
    <div class="row"><span class="lbl">Your capital · ${esc(
      slotWord(h.units)
    )}</span><span class="val">${naira(h.capital)}</span></div>
    <div class="row"><span class="lbl">Agreed profit-sharing ratio</span><span class="val">${Math.round(
      f.ratio
    )} : ${100 - Math.round(f.ratio)}</span></div>
    <div class="row"><span class="lbl">Your ${
      f.isLoss ? "share of the loss" : "profit"
    }</span><span class="val">${naira(h.grossProfit)}</span></div>
    ${taxLine}
    <div class="row total">
      <span class="lbl">Amount you receive</span>
      <span class="val">${naira(h.netProfit)}<span class="net">${percent(
    h.netReturn
  )} net return</span></span>
    </div>
  </div>

  <div class="choice-head">
    <div class="a">Your profit is paid to you either way.</div>
    <div class="b">Your capital is your choice.</div>
  </div>
  <div class="options">${optOut}${optIn}</div>
  ${undecided}

  <div class="split">
    ${ring(f.ratio)}
    <div class="words">
      <h3>How the profit was shared</h3>
      <p>${Math.round(f.ratio)} per cent of the profit goes to slot holders and ${
    100 - Math.round(f.ratio)
  } per cent to MaalGrow as manager. This ratio was agreed and fixed before the cycle opened, and it applies only to profit the trade actually earned — never to your capital.</p>
      <div class="key">
        <span><i style="background:#C9A435"></i>Slot holders</span>
        <span><i style="background:#3D1A6E"></i>Manager</span>
      </div>
    </div>
  </div>

  <div class="foot">
    <span>MaalGrow · Series ${esc(cycle.seriesName)} · ${esc(cycle.cycleLabel)}</span>
    <span>Page 1 of 3</span>
  </div>
</section>`;
}

/* ── Pages 2 and 3 — identical for every investor ────────────────── */

function page2(f: ReportFigures, cycle: ReportCycle): string {
  const perSlot = cycle.discloseMode === "perSlot";
  const d = (v: number) =>
    perSlot && f.totalUnits > 0 ? Math.round(v / f.totalUnits) : v;
  const du = (v: number) =>
    perSlot && f.totalUnits > 0 ? Math.round((v / f.totalUnits) * 10) / 10 : v;

  const months = f.months
    .map(
      (m) => `<div class="mcard">
    <div class="h">Month ${m.i}</div>
    <div class="b">
      <div class="mline"><span>Products purchased</span><span class="val">${units(
        du(m.unitsBought)
      )}</span></div>
      <div class="mline"><span>Products sold</span><span class="val">${units(
        du(m.unitsSold)
      )}</span></div>
      <div class="mline"><span>Sales</span><span class="val">${naira(
        d(m.revenue)
      )}</span></div>
      <div class="mline minus"><span>Cost of the goods sold</span><span class="val">−${naira(
        d(m.revenue - m.net - m.expenses - m.lostValue)
      )}</span></div>
      <div class="mline minus"><span>Running costs — advertising, delivery, bank charges and other</span><span class="val">−${naira(
        d(m.expenses)
      )}</span></div>
      ${
        m.lostValue !== 0
          ? `<div class="mline minus"><span>Stock unaccounted for</span><span class="val">−${naira(
              d(m.lostValue)
            )}</span></div>`
          : ""
      }
      <div class="mline net"><span>Net profit for the month</span><span class="val">${naira(
        d(m.net)
      )}</span></div>
    </div>
  </div>`
    )
    .join("");

  return `<section class="page">
  <h2 class="sect">The trading, month by month
    <span class="mode">${
      perSlot ? "Figures shown per slot" : "Figures shown for the whole cycle"
    }</span>
  </h2>

  <div class="totals">
    <div class="tot"><div class="k">Products purchased</div><div class="v">${units(
      du(f.unitsBought)
    )}</div></div>
    <div class="tot"><div class="k">Products sold</div><div class="v">${units(
      du(f.unitsSold)
    )}</div></div>
    <div class="tot"><div class="k">Still in stock</div><div class="v">${units(
      du(f.unitsLeft)
    )}</div></div>
    <div class="tot"><div class="k">Total cost of purchase</div><div class="v">${naira(
      d(f.purchaseCost)
    )}</div></div>
    <div class="tot"><div class="k">Total sales</div><div class="v">${naira(
      d(f.revenue)
    )}</div></div>
    <div class="tot"><div class="k">Net profit</div><div class="v">${naira(
      d(f.profit)
    )}</div></div>
  </div>

  ${months}

  <div class="foot">
    <span>MaalGrow · ${esc(cycle.description ?? "Trading cycle")}</span>
    <span>Page 2 of 3</span>
  </div>
</section>`;
}

function page3(f: ReportFigures, cycle: ReportCycle): string {
  return `<section class="page">
  <h2 class="sect">What this cycle traded in</h2>
  <p style="font-size:10pt;line-height:1.7;margin:0 0 5mm">
    This cycle traded in <strong>${esc(
      cycle.description ?? "goods bought and sold for profit"
    )}</strong>. Goods were bought, held and sold over three months, and what the trade
    actually earned after every cost is what was shared.
  </p>

  <div class="totals">
    <div class="tot"><div class="k">Capital pooled</div><div class="v">${naira(
      f.capital
    )}</div></div>
    <div class="tot"><div class="k">Slots in the cycle</div><div class="v">${units(
      f.totalUnits
    )}</div></div>
    <div class="tot"><div class="k">Net profit</div><div class="v">${naira(
      f.profit
    )}</div></div>
  </div>

  <div class="panel">
    <h3>Your capital and your profit are two different things</h3>
    <p><strong>Your capital</strong> is the money you put in. It is not income and it is
      never counted as profit. At the end of a cycle you decide what happens to it: take
      it out, or leave it in for the next cycle.</p>
    <p><strong>Your profit</strong> is your share of what the trade actually earned.
      It is <strong>always paid out at the end of every cycle</strong> — there is no
      choice to make about it, and it is never rolled forward. Only capital can continue.</p>
  </div>

  <div class="panel">
    <h3>Why there is no fixed rate</h3>
    <p>This is a Mudarabah. You provide capital, MaalGrow trades with it, and the two of
      you share whatever profit results in a ratio agreed before the cycle opened —
      ${Math.round(f.ratio)} to you, ${100 - Math.round(f.ratio)} to us.</p>
    <p>A fixed rate would mean a return promised regardless of what the trade earned.
      That is not what this is. If the trade earns more, you receive more. If it earns
      less, you receive less. If it makes a loss, the loss is borne by the capital and
      the manager earns nothing at all for the work.</p>
  </div>

  <div class="panel">
    <h3>What counts as a cost</h3>
    <p>Before profit is worked out, the trade pays for what it bought and what it cost to
      sell: the goods themselves, advertising, delivery to customers, bank charges and
      other running costs. Stock that cannot be accounted for at the end of a month —
      damaged, returned or missing — is charged as a cost too, at what it cost to buy.</p>
    <p>Only what remains after all of that is profit, and only that is shared.</p>
  </div>

  <div class="foot">
    <span>MaalGrow · Series ${esc(cycle.seriesName)} · ${esc(cycle.cycleLabel)}${
    f.settledAt ? ` · settled ${longDate(f.settledAt.slice(0, 10))}` : ""
  }</span>
    <span>Page 3 of 3</span>
  </div>
</section>`;
}

/* ── The whole report ────────────────────────────────────────────── */

export function renderReportBody(
  f: ReportFigures,
  cycle: ReportCycle,
  holding: ReportHolding
): string {
  const h = holderReportFigures(f, holding);
  return `<div class="mgr">${page1(f, cycle, holding, h)}${page2(f, cycle)}${page3(
    f,
    cycle
  )}</div>`;
}

/** A standalone document — what the browser prints and step 7 renders */
export function renderReportDocument(
  f: ReportFigures,
  cycle: ReportCycle,
  holding: ReportHolding
): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(holding.investorName)} — ${esc(cycle.seriesName)} ${esc(
    cycle.cycleLabel
  )} statement</title>
<style>${REPORT_CSS}</style>
</head><body>${renderReportBody(f, cycle, holding)}</body></html>`;
}

/* ── The withholding tax credit note ─────────────────────────────── */

export type CreditNoteData = {
  reference: string;
  issuer: {
    companyName: string;
    companyAddress: string | null;
    companyTin: string | null;
    signatoryName: string | null;
    signatoryTitle: string | null;
  };
  investorName: string;
  investorAddress: string | null;
  /** Shown as "not provided" rather than breaking when absent */
  investorTin: string | null;
  seriesName: string;
  cycleLabel: string;
  periodStart: string;
  periodEnd: string;
  grossProfit: number;
  whtRate: number;
  whtAmount: number;
  netPaid: number;
  deductedOn: string;
  remittanceReference: string | null;
  filedOn: string | null;
};

/**
 * A separate single-page document, not a section of the report:
 * investors hand this to an accountant or a tax office and should not
 * have to disclose their whole investment report to do so.
 *
 * Reissuing produces the same reference and the same figures — this
 * renders whatever the frozen note holds and computes nothing.
 */
export function renderCreditNoteBody(n: CreditNoteData): string {
  const tin = n.investorTin
    ? `<div class="tin">TIN ${esc(n.investorTin)}</div>`
    : `<div class="tin absent">Tax identification number not provided</div>`;

  return `<div class="mgr"><section class="page">
  <div class="cn-head">
    <div>
      <div class="cn-title">Withholding Tax Credit Note</div>
      <div style="font-size:8.5pt;color:#6A6157;margin-top:1.5mm">
        Tax deducted at source and remitted on your behalf
      </div>
    </div>
    <div class="cn-ref">
      Reference<div class="r">${esc(n.reference)}</div>
    </div>
  </div>

  <div class="cn-parties">
    <div class="cn-party">
      <div class="k">Deducted and remitted by</div>
      <div class="n">${esc(n.issuer.companyName)}</div>
      <div class="l">${esc(n.issuer.companyAddress ?? "")}</div>
      ${
        n.issuer.companyTin
          ? `<div class="tin">TIN ${esc(n.issuer.companyTin)}</div>`
          : ""
      }
    </div>
    <div class="cn-party">
      <div class="k">On behalf of</div>
      <div class="n">${esc(n.investorName)}</div>
      <div class="l">${esc(n.investorAddress ?? "")}</div>
      ${tin}
    </div>
  </div>

  <table class="cn-table">
    <tbody>
      <tr><th>Cycle</th><td>Series ${esc(n.seriesName)} · ${esc(
    n.cycleLabel
  )}</td></tr>
      <tr><th>Period covered</th><td>${esc(longDate(n.periodStart))} to ${esc(
    longDate(n.periodEnd)
  )}</td></tr>
      <tr><th>Gross profit — the amount subject to deduction</th><td>${naira(
        n.grossProfit
      )}</td></tr>
      <tr><th>Rate applied</th><td>${percent(n.whtRate * 100, 2)}</td></tr>
      <tr class="emph"><th>Amount withheld</th><td>${naira(n.whtAmount)}</td></tr>
      <tr><th>Net amount paid to the investor</th><td>${naira(n.netPaid)}</td></tr>
      <tr><th>Date of deduction</th><td>${esc(longDate(n.deductedOn))}</td></tr>
      <tr><th>Remittance reference</th><td>${
        n.remittanceReference ? esc(n.remittanceReference) : "—"
      }</td></tr>
      <tr><th>Date filed</th><td>${
        n.filedOn ? esc(longDate(n.filedOn)) : "—"
      }</td></tr>
    </tbody>
  </table>

  <div class="cn-note">
    This note certifies that the amount shown was withheld from the profit due to the
    named investor and remitted to the relevant tax authority. It is issued once for each
    investor for each cycle. A reissued copy carries the same reference and the same
    figures as the original.
  </div>

  <div class="cn-sign">
    <div class="box">
      <div class="rule">
        ${esc(n.issuer.signatoryName ?? "Authorised signatory")}<br>
        <span style="color:#6A6157">${esc(
          n.issuer.signatoryTitle ?? ""
        )}, ${esc(n.issuer.companyName)}</span>
      </div>
    </div>
    <div class="box">
      <div class="rule" style="color:#6A6157">Company seal</div>
    </div>
  </div>
</section></div>`;
}

export function renderCreditNoteDocument(n: CreditNoteData): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Withholding tax credit note ${esc(n.reference)}</title>
<style>${REPORT_CSS}</style>
</head><body>${renderCreditNoteBody(n)}</body></html>`;
}
