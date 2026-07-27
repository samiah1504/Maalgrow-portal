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
  ReportMonth,
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
/**
 * "Month one", not "Month 1".
 *
 * Month headings are set in Marcellus, whose figures are its only set —
 * `lining-nums` changes nothing because there is nothing to change to.
 * Its 1 is a bare vertical stroke that reads as a capital I at 11pt, and
 * its 3 has a flat top. Spelling the ordinal removes the ambiguity
 * without moving the heading to another typeface. Numerals anywhere else
 * in this document are set in the mono face, which is unambiguous.
 */
function monthWord(i: number): string {
  const words = ["one", "two", "three", "four", "five", "six"];
  return words[i - 1] ? `Month ${words[i - 1]}` : `Month ${i}`;
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

/* The reconciliation: the deductions sit in one row and the result
   spans the width beneath them, so the subtraction reads as a
   subtraction rather than as six unrelated boxes. */
.mgr .recon.c4 { grid-template-columns: repeat(4, 1fr); }
.mgr .tot.neg .v { color: #9B2C2C; }
.mgr .tot.result {
  grid-column: 1 / -1;
  display: flex; align-items: baseline; justify-content: space-between;
  background: var(--plum); border-color: var(--plum);
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .tot.result .k { color: rgba(255,255,255,.75); }
.mgr .tot.result .v { color: #fff; margin-top: 0; font-size: 14pt; }
.mgr .qty {
  font-size: 9pt; color: var(--ink-soft); margin-bottom: 3mm;
}
.mgr .qty b { font-family: var(--font-mono); font-weight: 500; color: var(--ink); }
.mgr .rounding {
  font-size: 8.5pt; line-height: 1.6; color: var(--ink-soft);
  margin: 3mm 0 0;
}

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

/* ── Page 3: the same figures, drawn ─────────────────────────────── */
.mgr .band {
  background: linear-gradient(100deg, var(--plum-900), var(--plum) 60%, #52248F);
  color: #fff; border-radius: 8px; padding: 6mm 8mm; margin-bottom: 6mm;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .band .eyebrow {
  font-size: 7.5pt; letter-spacing: .18em; text-transform: uppercase;
  color: var(--gold-300);
}
.mgr .band .ttl { font-family: var(--font-head); font-size: 17pt; margin-top: 1.5mm; }
.mgr .band .sub { font-size: 9pt; opacity: .8; margin-top: 1mm; }

.mgr .pic-h {
  font-family: var(--font-head); font-size: 12.5pt; color: var(--plum);
  margin: 5mm 0 1mm; overflow: hidden;
}
.mgr .pic-h .mode {
  float: right; font-family: var(--font-body); font-size: 7.5pt;
  color: var(--ink-soft); padding-top: 2mm;
}
.mgr .pic-p { font-size: 9pt; line-height: 1.55; color: var(--ink-soft); margin: 0 0 3mm; }

.mgr .journey { display: flex; align-items: stretch; gap: 1.5mm; }
.mgr .step {
  flex: 1; text-align: center; border: 1px solid var(--line); border-radius: 6px;
  background: var(--parchment); padding: 3mm 2mm;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .step .n {
  font-size: 6.5pt; letter-spacing: .16em; text-transform: uppercase;
  color: var(--ink-soft);
}
.mgr .step .ic { color: var(--plum); margin: 1.5mm 0; }
.mgr .step .t { font-size: 9pt; font-weight: 700; color: var(--plum); margin-bottom: 1.5mm; }
.mgr .step .l { font-family: var(--font-mono); font-size: 8pt; line-height: 1.45; }
.mgr .arrow { align-self: center; color: var(--gold); font-size: 10pt; }

.mgr .stack {
  display: flex; height: 9mm; border-radius: 5px; overflow: hidden; margin-bottom: 2mm;
}
.mgr .seg {
  display: flex; align-items: center; justify-content: center;
  font-family: var(--font-mono); font-size: 8.5pt; color: #fff; font-weight: 500;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .seg.a, .mgr .dot.a { background: var(--plum-900); }
.mgr .seg.b, .mgr .dot.b { background: var(--plum); }
.mgr .seg.c, .mgr .dot.c { background: #8B6BB8; }
.mgr .seg.d, .mgr .dot.d { background: var(--plum-200); }
.mgr .seg.e, .mgr .dot.e { background: var(--gold); }

.mgr .divide { width: 100%; border-collapse: collapse; }
.mgr .divide td {
  padding: 1.4mm 0; font-size: 9pt; border-bottom: 1px solid var(--line);
}
.mgr .divide td.p, .mgr .divide td.m {
  font-family: var(--font-mono); text-align: right; white-space: nowrap;
}
.mgr .divide td.p { width: 18mm; font-weight: 500; }
.mgr .divide td.m { width: 34mm; }
.mgr .divide tr.sum td {
  border-top: 1.5px solid var(--plum); border-bottom: none;
  font-weight: 700; color: var(--plum); padding-top: 2mm;
}
.mgr .dot {
  display: inline-block; width: 2.4mm; height: 2.4mm; border-radius: 1px;
  margin-right: 2.2mm; vertical-align: middle;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}

.mgr .chart { display: flex; align-items: flex-end; gap: 6mm; padding: 0 2mm; }
.mgr .mb { flex: 1; text-align: center; }
.mgr .mb .cols {
  display: flex; align-items: flex-end; justify-content: center; gap: 2mm;
  height: 34mm; margin-bottom: 1.5mm;
}
.mgr .col {
  width: 9mm; border-radius: 2px 2px 0 0; min-height: .5mm;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
}
.mgr .col.rev, .mgr .sw.rev { background: var(--plum); }
.mgr .col.cst, .mgr .sw.cst { background: var(--plum-200); }
.mgr .mb .lbl { font-size: 8.5pt; color: var(--ink); }
.mgr .mb .sub { font-family: var(--font-mono); font-size: 8pt; color: var(--ink-soft); }
.mgr .key {
  display: flex; gap: 6mm; justify-content: center; margin-top: 2.5mm;
  font-size: 8pt; color: var(--ink-soft);
}
.mgr .sw {
  display: inline-block; width: 2.6mm; height: 2.6mm; border-radius: 1px;
  margin-right: 1.6mm; vertical-align: middle;
  -webkit-print-color-adjust: exact; print-color-adjust: exact;
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
    <span>Page 1 of 4</span>
  </div>
</section>`;
}

/* ── Pages 2 and 3 — identical for every investor ────────────────── */

/**
 * A month's running costs, itemised and already rounded for display.
 * Null when the snapshot predates the itemisation being recorded.
 */
function monthSplit(
  m: ReportMonth,
  d: (v: number) => number
): { ads: number; logistics: number; misc: number; bankCharges: number } | null {
  if (
    typeof m.ads !== "number" ||
    typeof m.logistics !== "number" ||
    typeof m.misc !== "number" ||
    typeof m.bankCharges !== "number"
  ) {
    return null;
  }
  return {
    ads: d(m.ads),
    logistics: d(m.logistics),
    misc: d(m.misc),
    bankCharges: d(m.bankCharges),
  };
}

function page2(f: ReportFigures, cycle: ReportCycle): string {
  const perSlot = cycle.discloseMode === "perSlot";
  const d = (v: number) =>
    perSlot && f.totalUnits > 0 ? Math.round(v / f.totalUnits) : v;
  const du = (v: number) =>
    perSlot && f.totalUnits > 0 ? Math.round((v / f.totalUnits) * 10) / 10 : v;

  // Every figure on this page is the figure the reader SEES, added up.
  // Rounding each month to the naira and then printing an unrounded
  // total would leave a statement whose own columns disagree by a naira
  // — which reads as an error even when the kobo underneath are exact.
  const shown = f.months.map((m) => {
    const split = monthSplit(m, d);
    return {
      i: m.i,
      unitsBought: du(m.unitsBought),
      unitsSold: du(m.unitsSold),
      revenue: d(m.revenue),
      cogs: d(m.revenue - m.net - m.expenses - m.lostValue),
      // When the itemisation is known, the month's running costs are
      // the sum of the printed items — so page 3, which lists them,
      // reaches the identical total rather than one a naira away.
      expenses: split
        ? split.ads + split.logistics + split.misc + split.bankCharges
        : d(m.expenses),
      split,
      lost: d(m.lostValue),
    };
  });
  const sum = (pick: (s: (typeof shown)[number]) => number) =>
    shown.reduce((t, s) => t + pick(s), 0);

  const total = {
    unitsBought: Math.round(sum((s) => s.unitsBought) * 10) / 10,
    unitsSold: Math.round(sum((s) => s.unitsSold) * 10) / 10,
    unitsLeft: du(f.unitsLeft),
    revenue: sum((s) => s.revenue),
    cogs: sum((s) => s.cogs),
    expenses: sum((s) => s.expenses),
    lost: sum((s) => s.lost),
  };
  const totalNet = total.revenue - total.cogs - total.expenses - total.lost;

  const months = shown
    .map(
      (m) => `<div class="mcard">
    <div class="h">${monthWord(m.i)}</div>
    <div class="b">
      <div class="mline"><span>Products purchased</span><span class="val">${units(
        m.unitsBought
      )}</span></div>
      <div class="mline"><span>Products sold</span><span class="val">${units(
        m.unitsSold
      )}</span></div>
      <div class="mline"><span>Sales</span><span class="val">${naira(
        m.revenue
      )}</span></div>
      <div class="mline minus"><span>Cost of the goods sold</span><span class="val">−${naira(
        m.cogs
      )}</span></div>
      <div class="mline minus"><span>Running costs — advertising, delivery, bank charges and other</span><span class="val">−${naira(
        m.expenses
      )}</span></div>
      ${
        m.lost !== 0
          ? `<div class="mline minus"><span>Stock unaccounted for</span><span class="val">−${naira(
              m.lost
            )}</span></div>`
          : ""
      }
      <div class="mline net"><span>Net profit for the month</span><span class="val">${naira(
        m.revenue - m.cogs - m.expenses - m.lost
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

  <div class="qty">Products purchased <b>${units(
    total.unitsBought
  )}</b> · sold <b>${units(total.unitsSold)}</b> · still in stock <b>${units(
    total.unitsLeft
  )}</b></div>

  <!--
    These four cells SUBTRACT to the fifth. The earlier version put
    total sales beside the total cost of PURCHASE, which are not the two
    figures profit is the difference of — stock is bought before it is
    sold — so anyone who did the subtraction got a number that was not
    the profit printed next to it, and concluded we could not add up.
  -->
  <div class="totals recon ${total.lost !== 0 ? "c4" : ""}">
    <div class="tot"><div class="k">Total sales</div><div class="v">${naira(
      total.revenue
    )}</div></div>
    <div class="tot neg"><div class="k">Cost of the goods sold</div><div class="v">−${naira(
      total.cogs
    )}</div></div>
    <div class="tot neg"><div class="k">Running costs</div><div class="v">−${naira(
      total.expenses
    )}</div></div>
    ${
      total.lost !== 0
        ? `<div class="tot neg"><div class="k">Stock unaccounted for</div><div class="v">−${naira(
            total.lost
          )}</div></div>`
        : ""
    }
    <div class="tot result"><div class="k">Net profit</div><div class="v">${naira(
      totalNet
    )}</div></div>
  </div>

  ${months}

  <div class="foot">
    <span>MaalGrow · ${esc(cycle.description ?? "Trading cycle")}</span>
    <span>Page 2 of 4</span>
  </div>
</section>`;
}

function page4(f: ReportFigures, cycle: ReportCycle): string {
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
    <div class="tot"><div class="k">Net profit for the whole cycle</div><div class="v">${naira(
      f.profit
    )}</div></div>
  </div>
  ${
    // These are WHOLE-CYCLE figures; the previous page is per slot and
    // rounded to the naira. Multiply one by the slot count and you land
    // a few naira from the other — say so, rather than let a reader
    // find the gap and wonder which figure to trust.
    cycle.discloseMode === "perSlot" && f.totalUnits > 0
      ? `<p class="rounding">The month-by-month figures on the previous page are shown
      per slot and rounded to the nearest naira, so multiplying them by the
      ${units(f.totalUnits)} slots in the cycle lands within a few naira of the totals
      above rather than exactly on them. Nothing is lost in the rounding: every payment
      is worked out from the exact figures, to the kobo.</p>`
      : ""
  }

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
    <span>Page 4 of 4</span>
  </div>
</section>`;
}

/* ── Page 3 — the same figures, drawn ────────────────────────────── */

/**
 * Percentages that add to exactly 100.0.
 *
 * Rounding each share on its own gives a column reading 99.9 or 100.1
 * beside a row labelled "Total 100.0%". Largest remainder on tenths of
 * a percent, the same method the engine uses for money.
 */
function sharesOf(parts: number[], whole: number): number[] {
  if (whole <= 0) return parts.map(() => 0);
  const exact = parts.map((p) => (p / whole) * 1000);
  const floors = exact.map(Math.floor);
  let left = 1000 - floors.reduce((t, v) => t + v, 0);
  const order = exact
    .map((v, i) => ({ i, rem: v - Math.floor(v) }))
    .sort((a, b) => b.rem - a.rem);
  const out = [...floors];
  for (let k = 0; left > 0 && k < order.length; k++, left--) out[order[k].i]++;
  return out.map((v) => v / 10);
}

/** Small stroke icons. Inline, because nothing may be fetched. */
const ICONS: Record<string, string> = {
  pooled: `<ellipse cx="12" cy="6" rx="7.5" ry="3"/><path d="M4.5 6v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3V6"/><path d="M4.5 12v6c0 1.66 3.36 3 7.5 3s7.5-1.34 7.5-3v-6"/>`,
  stock: `<path d="M12 2.5 21 7v10l-9 4.5L3 17V7z"/><path d="M3 7l9 4.5L21 7"/><path d="M12 11.5V21"/>`,
  sold: `<circle cx="9.5" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M2.5 3h3l2.4 12.2a1.6 1.6 0 0 0 1.6 1.3h8.1a1.6 1.6 0 0 0 1.6-1.3L21.5 7H6"/>`,
  shared: `<circle cx="12" cy="12" r="9"/><path d="M12 3v18"/><path d="M12 12h9"/>`,
};

function icon(name: keyof typeof ICONS): string {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function page3(f: ReportFigures, cycle: ReportCycle): string {
  const perSlot = cycle.discloseMode === "perSlot";
  const d = (v: number) =>
    perSlot && f.totalUnits > 0 ? Math.round(v / f.totalUnits) : v;

  /* The journey — four steps, whole cycle, said so plainly */
  const goods = cycle.description ?? "goods bought to sell";
  const steps = [
    {
      n: "One", k: "pooled" as const, t: "Slots pooled",
      lines: [`${units(f.totalUnits)} slot${f.totalUnits === 1 ? "" : "s"}`,
              `${naira(f.slotPrice)} each`],
    },
    {
      n: "Two", k: "stock" as const, t: "Stock bought",
      // The CATEGORY, never a product. Naming what was bought would put
      // the trade's buying list in the hands of every investor.
      lines: [`${units(f.unitsBought)} items`, esc(goods)],
    },
    {
      n: "Three", k: "sold" as const, t: "Sold to customers",
      lines: [`${units(f.unitsSold)} items`, "over three months"],
    },
    {
      n: "Four", k: "shared" as const, t: "Profit shared",
      lines: [`${Math.round(f.ratio)} : ${100 - Math.round(f.ratio)}`,
              `${naira(f.netPerSlot)} per slot`],
    },
  ]
    .map(
      (s, i) => `${i > 0 ? `<div class="arrow" aria-hidden="true">&#10148;</div>` : ""}
    <div class="step">
      <div class="n">${s.n}</div>
      <div class="ic">${icon(s.k)}</div>
      <div class="t">${s.t}</div>
      ${s.lines.map((l) => `<div class="l">${l}</div>`).join("")}
    </div>`
    )
    .join("");

  /* Every naira of sales income — the page 2 identity, as proportions.
     Built from the SAME month-level values page 2 prints, added the
     same way, so the two pages cannot land a naira apart. */
  const per = f.months.map((m) => ({
    revenue: d(m.revenue),
    cogs: d(m.revenue - m.net - m.expenses - m.lostValue),
    lost: d(m.lostValue),
    expenses: d(m.expenses),
    split: monthSplit(m, d),
  }));
  const add = (pick: (p: (typeof per)[number]) => number) =>
    per.reduce((t, p) => t + pick(p), 0);
  const itemised = per.every((p) => p.split !== null);

  const rows: { label: string; value: number; tone: string }[] = [
    { label: "Buying the goods", value: add((p) => p.cogs), tone: "a" },
  ];
  if (itemised) {
    const misc = add((p) => p.split!.misc);
    rows.push({ label: "Advertising", value: add((p) => p.split!.ads), tone: "b" });
    rows.push({
      label: "Delivery to customers",
      value: add((p) => p.split!.logistics),
      tone: "c",
    });
    if (misc > 0) rows.push({ label: "Other running costs", value: misc, tone: "c" });
    rows.push({
      label: "Bank charges",
      value: add((p) => p.split!.bankCharges),
      tone: "d",
    });
  } else {
    rows.push({ label: "Running costs", value: add((p) => p.expenses), tone: "b" });
  }
  const lost = add((p) => p.lost);
  if (lost > 0) rows.push({ label: "Stock unaccounted for", value: lost, tone: "d" });

  // Sales income is what the parts add to — the same figure page 2
  // prints as total sales, reached the same way.
  const income = add((p) => p.revenue);
  const profit = income - rows.reduce((t, r) => t + r.value, 0);
  rows.push({ label: "Profit", value: profit, tone: "e" });

  const shares = sharesOf(rows.map((r) => r.value), income);
  const bar = rows
    .map((r, i) =>
      shares[i] > 0
        ? `<div class="seg ${r.tone}" style="width:${shares[i]}%">${
            shares[i] >= 12 ? `${shares[i].toFixed(1)}%` : ""
          }</div>`
        : ""
    )
    .join("");
  const table = rows
    .map(
      (r, i) => `<tr><td><span class="dot ${r.tone}"></span>${r.label}</td>
      <td class="p">${shares[i].toFixed(1)}%</td><td class="m">${naira(r.value)}</td></tr>`
    )
    .join("");

  /* Each month side by side */
  const bars = per.map((p, i) => {
    const cost =
      p.cogs +
      (p.split
        ? p.split.ads + p.split.logistics + p.split.misc + p.split.bankCharges
        : p.expenses) +
      p.lost;
    return { i: f.months[i].i, revenue: p.revenue, cost, net: p.revenue - cost };
  });
  const peak = Math.max(1, ...bars.map((b) => Math.max(b.revenue, b.cost)));
  const H = 34; // mm of drawing height
  const chart = bars
    .map(
      (b) => `<div class="mb">
      <div class="cols">
        <div class="col rev" style="height:${(b.revenue / peak) * H}mm"></div>
        <div class="col cst" style="height:${(Math.max(0, b.cost) / peak) * H}mm"></div>
      </div>
      <div class="lbl">${monthWord(b.i)}</div>
      <div class="sub">${naira(b.net)} left</div>
    </div>`
    )
    .join("");

  return `<section class="page">
  <div class="band">
    <div class="eyebrow">Page three</div>
    <div class="ttl">The cycle in pictures</div>
    <div class="sub">The same numbers, drawn out.</div>
  </div>

  <h3 class="pic-h">The journey of a slot
    <span class="mode">Across the whole cycle</span>
  </h3>
  <p class="pic-p">Capital pooled once at the start, spent on goods, sold to customers
    across three months, and the profit divided at the end.</p>
  <div class="journey">${steps}</div>

  <h3 class="pic-h">Every naira of sales income, divided
    <span class="mode">${perSlot ? "Figures per slot" : "Whole cycle"}</span>
  </h3>
  <p class="pic-p">What customers paid us, and what it went on. The largest slice is
    always the goods themselves — that is the nature of trading.</p>
  <div class="stack">${bar}</div>
  <table class="divide">
    ${table}
    <tr class="sum"><td>Total sales income</td><td class="p">100.0%</td>
      <td class="m">${naira(income)}</td></tr>
  </table>

  <h3 class="pic-h">Each month side by side</h3>
  <p class="pic-p">Sales against everything the month cost, and what was left as profit.</p>
  <div class="chart">${chart}</div>
  <div class="key">
    <span><i class="sw rev"></i>Sales</span>
    <span><i class="sw cst"></i>What it cost</span>
  </div>

  <div class="foot">
    <span>MaalGrow · ${esc(cycle.description ?? "Trading cycle")}</span>
    <span>Page 3 of 4</span>
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
  )}${page4(f, cycle)}</div>`;
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
