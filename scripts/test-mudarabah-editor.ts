/**
 * Tests for the admin cycle-entry page's logic
 * (src/lib/mudarabah/editor.ts).
 *
 * The page component is a thin shell over these functions: what the
 * admin typed becomes a draft, the draft becomes the shared engine's
 * input, and every figure on the page comes back from compute(). So
 * testing this tests what the page shows.
 *
 * 1. A known cycle typed into the page matches the reference file.
 * 2. Multi-product: cost prices stay independent, stock carries
 *    forward per product.
 * 3. Every validation rule fires when it should and stays quiet when
 *    it shouldn't.
 * 4. A settled cycle is read-only.
 *
 * Run: npx tsx scripts/test-mudarabah-editor.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import {
  addProduct,
  cycleNotices,
  draftFigures,
  emptyDraft,
  isReadOnly,
  noticesForMonth,
  noticesForRow,
  productHasFigures,
  removeProduct,
  toSavePayload,
  type Draft,
  type DraftRow,
} from "../src/lib/mudarabah/editor";
import { parseNairaToKobo, naira, koboToInput } from "../src/lib/mudarabah/format";

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, detail ?? "");
  }
}

/* ── Helpers to "type into" the page ─────────────────────────────── */

function typeRow(
  draft: Draft,
  monthIndex: number,
  productId: string,
  values: Partial<DraftRow>
): Draft {
  const months = [...draft.months] as Draft["months"];
  const m = months[monthIndex];
  const existing = m.rows[productId] ?? {
    productId,
    unitCost: "",
    qty: "",
    soldQty: "",
    sellPrice: "",
    stockLeft: "",
  };
  months[monthIndex] = { ...m, rows: { ...m.rows, [productId]: { ...existing, ...values } } };
  return { ...draft, months };
}

function typeExpenses(
  draft: Draft,
  monthIndex: number,
  e: { ads?: string; logistics?: string; misc?: string; bankCharges?: string }
): Draft {
  const months = [...draft.months] as Draft["months"];
  months[monthIndex] = { ...months[monthIndex], ...e };
  return { ...draft, months };
}

/* ── 1. A known cycle matches the reference file ─────────────────── */

type RefMonth = {
  qty: number; unitCost: number; soldQty: number; sellPrice: number;
  ads: number; logi: number; misc: number; bank: number; stockLeft: number;
};

function referenceCompute(fields: Record<string, number>, months: RefMonth[]) {
  const html = readFileSync(
    join(__dirname, "..", "reference", "mudarabah-report-v4.html"),
    "utf8"
  );
  const start = html.indexOf("function compute(){");
  const end = html.indexOf("/* ==================== admin UI");
  const source = html.slice(start, end);
  const prelude = `
    var state = { months: MONTHS };
    var $ = function(id){ return { value: FIELDS[id] }; };
    function num(v){ var n=parseFloat(v); return isFinite(n)?n:0; }
    function int(v){ var n=parseFloat(v); return isFinite(n)?Math.round(n):0; }
  `;
  const fn = new Function("FIELDS", "MONTHS", prelude + source + "\nreturn compute();");
  return fn(fields, months) as Record<string, number> & { months: Record<string, number>[] };
}

const REF_MONTHS: RefMonth[] = [
  { qty: 200, unitCost: 8_000, soldQty: 150, sellPrice: 12_000, ads: 60_000, logi: 25_000, misc: 10_000, bank: 5_000, stockLeft: 50 },
  { qty: 120, unitCost: 8_500, soldQty: 140, sellPrice: 12_500, ads: 55_000, logi: 22_000, misc: 8_000, bank: 6_000, stockLeft: 28 },
  { qty: 100, unitCost: 9_000, soldQty: 120, sellPrice: 13_000, ads: 50_000, logi: 20_000, misc: 12_000, bank: 7_000, stockLeft: 8 },
];
const REF_FIELDS = { slotPrice: 100_000, slots: 20, ratio: 70, wht: 5, withdrawSlots: 8 };

// Type it in exactly as the admin would — naira strings, not kobo
let typed = emptyDraft();
typed = { ...typed, name: "Reference cycle", slotPrice: "100000", slots: "20", ratio: 70, wht: "5", withdrawSlots: "8" };
typed = addProduct(typed, "3-seater sofa");
const productId = typed.products[0].id;
REF_MONTHS.forEach((m, i) => {
  typed = typeRow(typed, i, productId, {
    unitCost: String(m.unitCost),
    qty: String(m.qty),
    soldQty: String(m.soldQty),
    sellPrice: String(m.sellPrice),
    stockLeft: String(m.stockLeft),
  });
  typed = typeExpenses(typed, i, {
    ads: String(m.ads),
    logistics: String(m.logi),
    misc: String(m.misc),
    bankCharges: String(m.bank),
  });
});

const { cycle: pageCycle } = draftFigures(typed);
const refCycle = referenceCompute(REF_FIELDS, REF_MONTHS);

// Money on the page is kobo; the reference works in naira
const drift = (oursKobo: number, refNaira: number) => Math.abs(oursKobo - refNaira * 100);
let worst = 0;
const cmp = (ours: number, ref: number) => {
  worst = Math.max(worst, drift(ours, ref));
  return drift(ours, ref) <= 20;
};

check(
  "a known cycle typed into the page matches the reference file",
  cmp(pageCycle.profit, refCycle.profit) &&
    cmp(pageCycle.revenue, refCycle.revenue) &&
    cmp(pageCycle.cogsTotal, refCycle.cogsTotal) &&
    cmp(pageCycle.holderPot, refCycle.holderPot) &&
    cmp(pageCycle.mudaribPot, refCycle.mudaribPot) &&
    cmp(pageCycle.netPerSlot, refCycle.netPerSlot) &&
    cmp(pageCycle.endCash, refCycle.endCash) &&
    cmp(pageCycle.endStock, refCycle.endStock) &&
    pageCycle.unitsSold === refCycle.unitsSold &&
    pageCycle.unitsBought === refCycle.unitsBought,
  { worstDriftKobo: worst }
);
check(
  "the page's month figures match the reference month by month",
  pageCycle.months.every(
    (m, i) =>
      cmp(m.revenue, refCycle.months[i].revenue) &&
      cmp(m.net, refCycle.months[i].net) &&
      cmp(m.cash, refCycle.months[i].cash) &&
      cmp(m.gross, refCycle.months[i].gross)
  )
);
check(
  "an empty field is not the same as a zero — a blank cycle computes cleanly",
  draftFigures(emptyDraft()).cycle.profit === 0
);

/* ── 2. Multi-product through the page's own state ───────────────── */

let multi = emptyDraft();
multi = { ...multi, slotPrice: "100000", slots: "10", ratio: 70, wht: "5" };
multi = addProduct(multi, "3-seater sofa");
multi = addProduct(multi, "Side table");
const sofa = multi.products[0].id;
const table = multi.products[1].id;

multi = typeRow(multi, 0, sofa, { unitCost: "50000", qty: "10", soldQty: "10", sellPrice: "70000" });
multi = typeRow(multi, 0, table, { unitCost: "2000", qty: "100", soldQty: "20", sellPrice: "3000" });
multi = typeRow(multi, 1, table, { soldQty: "30", sellPrice: "3100" });
multi = typeRow(multi, 2, table, { soldQty: "25", sellPrice: "3200" });

const multiFigures = draftFigures(multi);
const tableM3 = multiFigures.cycle.months[2].rows.find((r) => r.productId === table)!;
const sofaM3 = multiFigures.cycle.months[2].rows.find((r) => r.productId === sofa)!;

check(
  "each product keeps its own cost price through the page",
  tableM3.unitCP === 2_000 * 100 && sofaM3.closeUnits === 0,
  { table: tableM3.unitCP, sofaLeft: sofaM3.closeUnits }
);
check(
  "stock carries forward per product across months",
  multiFigures.cycle.months[1].rows.find((r) => r.productId === table)!.openUnits === 80 &&
    tableM3.openUnits === 50 &&
    tableM3.closeUnits === 25
);
// A product bought once and not touched again: the page still shows
// its row every month, and its stock carries through at its own cost.
let untouched = addProduct(multi, "Bed frame");
const bed = untouched.products[2].id;
untouched = typeRow(untouched, 0, bed, {
  unitCost: "21000", qty: "25", soldQty: "0", sellPrice: "0",
});
const untouchedFigures = draftFigures(untouched);
const bedM1 = untouchedFigures.cycle.months[0].rows.find((r) => r.productId === bed)!;
const bedM3 = untouchedFigures.cycle.months[2].rows.find((r) => r.productId === bed)!;
check(
  "a product left alone in later months keeps its stock at its own cost",
  untouchedFigures.cycle.months[2].rows.length === 3 &&
    bedM3.openUnits === 25 &&
    bedM3.closeUnits === 25 &&
    bedM3.closeValue === bedM1.closeValue &&
    bedM3.unitCP === 21_000 * 100,
  { open: bedM3.openUnits, value: bedM3.closeValue, unitCP: bedM3.unitCP }
);

// Adding and removing products
check("adding a product gives it a stable id", multi.products.length === 2 && sofa !== table);
check(
  "a product with figures entered is flagged before it is removed",
  productHasFigures(multi, sofa) === true
);
check(
  "a product with nothing entered can go quietly",
  productHasFigures(addProduct(multi, "Wardrobe"), addProduct(multi, "Wardrobe").products[2].id) === false
);
check(
  "removing a product takes its rows with it",
  Object.keys(removeProduct(multi, table).months[0].rows).length === 1
);

/* ── 3. Validation ───────────────────────────────────────────────── */

// Quiet when everything is in order
const clean = draftFigures(typed);
check(
  "no errors on a cycle that is in order",
  !clean.notices.some((n) => n.level === "error"),
  clean.notices.filter((n) => n.level === "error")
);

// Sold more than were available
const oversold = draftFigures(typeRow(multi, 0, sofa, { soldQty: "99" }));
const oversoldNotice = noticesForRow(oversold.notices, 1, sofa)[0];
check(
  "selling more than were available is an error that names the product",
  oversoldNotice?.level === "error" && /only 10/.test(oversoldNotice.text),
  oversoldNotice?.text
);

// Units left below the expectation — a warning, with the loss valued
const short = draftFigures(typeRow(multi, 0, table, { stockLeft: "75" }));
const shortNotice = noticesForRow(short.notices, 1, table)[0];
check(
  "counting fewer units than expected warns, values the loss, and says why it happens",
  shortNotice?.level === "warning" &&
    /5 /.test(shortNotice.text) &&
    /damage, a return or shrinkage/.test(shortNotice.text) &&
    /₦10,000/.test(shortNotice.text),
  shortNotice?.text
);

// Units left above the expectation — an error
const above = draftFigures(typeRow(multi, 0, table, { stockLeft: "500" }));
const aboveNotice = noticesForRow(above.notices, 1, table)[0];
check(
  "counting more units than existed is an error",
  aboveNotice?.level === "error" && /more/.test(aboveNotice.text),
  aboveNotice?.text
);

// Cash going negative in a month
let broke = emptyDraft();
broke = { ...broke, slotPrice: "1000", slots: "1", ratio: 70 };
broke = addProduct(broke, "Wardrobe");
const wardrobe = broke.products[0].id;
broke = typeRow(broke, 0, wardrobe, { unitCost: "50000", qty: "10", soldQty: "0", sellPrice: "0" });
const brokeFigures = draftFigures(broke);
const monthNotice = noticesForMonth(brokeFigures.notices, 1)[0];
check(
  "a month that ends with negative cash is an error that says where to record the money",
  monthNotice?.level === "error" && /funded from outside the cycle/.test(monthNotice.text),
  monthNotice?.text
);

// Payout shortfall at cycle level
let tight = emptyDraft();
tight = { ...tight, slotPrice: "100000", slots: "10", ratio: 70, wht: "0", withdrawSlots: "10" };
tight = addProduct(tight, "Wardrobe");
const w2 = tight.products[0].id;
tight = typeRow(tight, 0, w2, { unitCost: "10000", qty: "90", soldQty: "10", sellPrice: "12000" });
const tightNotice = cycleNotices(draftFigures(tight).notices)[0];
check(
  "a payout the cash cannot cover warns, and says what to do about it",
  tightNotice?.level === "warning" &&
    /tied up in/.test(tightNotice.text) &&
    /roll their capital over/.test(tightNotice.text),
  tightNotice?.text
);

const comfortable = cycleNotices(clean.notices)[0];
check(
  "when the cash covers the payout it says so, with the amount spare",
  comfortable?.level === "ok" && /spare/.test(comfortable.text),
  comfortable?.text
);

/* ── 4. A settled cycle is read-only ─────────────────────────────── */

const settledDraft: Draft = { ...typed, id: "cycle-1", status: "settled" };
check("a settled cycle is read-only", isReadOnly(settledDraft) === true);
check("a draft cycle is editable", isReadOnly({ status: "draft" }) === false);
check("an active cycle is editable", isReadOnly({ status: "active" }) === false);

/* ── Money formatting at the edge ────────────────────────────────── */

check("what is typed in naira becomes integer kobo", parseNairaToKobo("8,000.50") === 800_050);
check("a blank field stays blank rather than becoming zero", parseNairaToKobo("") === null);
check("kobo comes back as an editable naira string", koboToInput(800_050) === "8000.50");
check("summaries round to whole naira", naira(800_050) === "₦8,001");

/* ── The save payload carries inputs only ────────────────────────── */

const payload = toSavePayload(typed) as Record<string, unknown>;
const payloadText = JSON.stringify(payload);
check(
  "the saved payload holds inputs only — no profit, no ROI, no cost price",
  !/(profit|roi|unitCP|costPrice|gross|netPerSlot)/i.test(payloadText)
);
check(
  "the saved payload carries money as integer kobo",
  payload.slotPrice === 10_000_000 &&
    Number.isInteger(
      (payload.months as { rows: { unitCost: number }[] }[])[0].rows[0].unitCost
    )
);

console.log(`\nWorst drift from the reference file: ${worst} kobo`);
process.exit(failures === 0 ? 0 : 1);
