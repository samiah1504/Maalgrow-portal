/**
 * Renders the real admin cycle-entry component to a static HTML file
 * so the page can be looked at without a running Supabase.
 *
 * This is a preview harness, not a second implementation: it imports
 * the same CycleEditor the portal serves and the same engine, and
 * feeds it a cycle typed exactly as an admin would. Only the router
 * and the toast library are stubbed, because neither exists outside
 * Next's request context.
 *
 * The monthly chart is drawn by recharts in the browser after
 * hydration, so it is empty in this static render.
 *
 * Run: npx tsx scripts/preview-mudarabah-page.tsx <output.html>
 */
import Module from "module";
import { writeFileSync } from "fs";

// Stub the two things that only exist inside a running Next app
const load = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load;
(Module as unknown as { _load: unknown })._load = function (
  request: string,
  ...rest: unknown[]
) {
  if (request === "next/navigation") {
    return { useRouter: () => ({ replace() {}, refresh() {}, push() {} }) };
  }
  if (request === "sonner") {
    return { toast: Object.assign(() => {}, { success() {}, error() {} }) };
  }
  if (request === "next/link") {
    const React = load("react", ...rest) as typeof import("react");
    return {
      __esModule: true,
      default: ({ children, href }: { children: unknown; href: string }) =>
        React.createElement("a", { href }, children as never),
    };
  }
  return load(request, ...rest);
} as never;

/* eslint-disable @typescript-eslint/no-require-imports */
const React = require("react") as typeof import("react");
const { renderToStaticMarkup } = require("react-dom/server") as typeof import("react-dom/server");
const { CycleEditor } = require("../src/app/(admin)/admin/mudarabah/[id]/_cycle-editor") as typeof import("../src/app/(admin)/admin/mudarabah/[id]/_cycle-editor");
const { emptyDraft, addProduct } = require("../src/lib/mudarabah/editor") as typeof import("../src/lib/mudarabah/editor");
type CycleTerms = import("../src/lib/mudarabah/editor").CycleTerms;
type Draft = import("../src/lib/mudarabah/editor").Draft;
type DraftRow = import("../src/lib/mudarabah/editor").DraftRow;

function typeRow(draft: Draft, i: number, id: string, v: Partial<DraftRow>): Draft {
  const months = [...draft.months] as Draft["months"];
  const m = months[i];
  const base = m.rows[id] ?? { productId: id, unitCost: "", qty: "", soldQty: "", sellPrice: "", stockLeft: "" };
  months[i] = { ...m, rows: { ...m.rows, [id]: { ...base, ...v } } };
  return { ...draft, months };
}
function typeExp(draft: Draft, i: number, e: Partial<Draft["months"][number]>): Draft {
  const months = [...draft.months] as Draft["months"];
  months[i] = { ...months[i], ...e };
  return { ...draft, months };
}

// A real cycle: three products, three months of furniture trading
let d = emptyDraft("preview-cycle");
d = { ...d, description: "home furniture", status: "active" };

// The terms and membership come from the existing cycle
const TERMS: CycleTerms = {
  cycleId: "preview-cycle",
  seriesName: "A",
  cycleLabel: "A-901",
  cycleStatus: "active",
  startDate: "2026-01-01",
  endDate: "2026-03-31",
  termsLocked: false,
  unitValue: 100000 * 100,
  ratio: 0.7,
  whtRate: 0.05,
  totalUnits: 20,
  cycleTotalSlots: 20,
  pooledCapital: 2000000 * 100,
  amountReceived: 2000000 * 100,
  totalCapital: 2000000 * 100,
  withdrawSlots: 8,
  holders: [
    { investmentId: "i1", investorId: "v1", investorName: "Aisha Bello", investorCode: "MG0001", investorTin: "TIN-1", units: 12.5, capitalAction: "withdraw", slotsWithdrawn: 12.5 },
    { investmentId: "i2", investorId: "v2", investorName: "Yusuf Ibrahim", investorCode: "MG0002", investorTin: null, units: 7.5, capitalAction: "rollover", slotsWithdrawn: 0 },
  ],
};
d = addProduct(d, "3-seater sofa");
d = addProduct(d, "Dining table");
d = addProduct(d, "Bed frame");
const [sofa, table, bed] = d.products.map((p) => p.id);

d = typeRow(d, 0, sofa, { unitCost: "47000", qty: "20", soldQty: "13", sellPrice: "71000" });
d = typeRow(d, 0, table, { unitCost: "9100", qty: "50", soldQty: "31", sellPrice: "14300" });
d = typeRow(d, 0, bed, { unitCost: "21000", qty: "25", soldQty: "17", sellPrice: "31000" });
d = typeExp(d, 0, { ads: "60000", logistics: "25000", misc: "10000", bankCharges: "5000" });

d = typeRow(d, 1, sofa, { unitCost: "48500", qty: "12", soldQty: "14", sellPrice: "72500" });
// One dining table damaged in month 2 — counted stock is one short
d = typeRow(d, 1, table, { unitCost: "9400", qty: "30", soldQty: "33", sellPrice: "14600", stockLeft: "15" });
d = typeRow(d, 1, bed, { unitCost: "21500", qty: "10", soldQty: "12", sellPrice: "31500" });
d = typeExp(d, 1, { ads: "55000", logistics: "22000", misc: "8000", bankCharges: "6000" });

d = typeRow(d, 2, sofa, { unitCost: "49000", qty: "6", soldQty: "9", sellPrice: "73000" });
d = typeRow(d, 2, table, { unitCost: "9600", qty: "20", soldQty: "30", sellPrice: "15000" });
d = typeRow(d, 2, bed, { unitCost: "22000", qty: "8", soldQty: "13", sellPrice: "32000" });
d = typeExp(d, 2, { ads: "50000", logistics: "20000", misc: "12000", bankCharges: "7000" });

const body = renderToStaticMarkup(
  React.createElement(CycleEditor, {
    initialDraft: d,
    terms: TERMS,
    hasLedger: true,
    settlement: null,
    settledProducts: [],
  })
);

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mudarabah cycle — admin</title>
<style>
  body { margin: 0; padding: 20px; background: #efe9df; font-family: system-ui, sans-serif; }
  .text-muted, .text-sm { color: #6b6157; font-size: 13px; }
  .flex { display: flex; } .items-center { align-items: center; } .gap-2 { gap: 8px; }
  .mb-4 { margin-bottom: 16px; } a { color: #4a1f3d; text-decoration: none; }
</style>
</head><body>${body}</body></html>`;

const out = process.argv[2] ?? "mudarabah-preview.html";
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(0)} KB)`);
