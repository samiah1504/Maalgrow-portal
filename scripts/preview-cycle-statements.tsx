/**
 * Static render of the investor's cycle-statement card.
 *
 * Uses the REAL component and the app's REAL compiled stylesheet, so
 * what appears here is what an investor sees — not an approximation
 * drawn for the occasion.
 *
 *   npx tsx scripts/preview-cycle-statements.tsx <out.html>
 */
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import React from "react";
import {
  CycleStatements,
  type CycleStatement,
} from "../src/app/(investor)/investments/_cycle-statements";

const out = process.argv[2] ?? "tmp-view.html";

// The compiled stylesheet the built app serves
const cssDir = join(process.cwd(), ".next", "static", "chunks");
const cssFile = readdirSync(cssDir).find((f) => f.endsWith(".css"));
const css = cssFile ? readFileSync(join(cssDir, cssFile), "utf8") : "";

/* Figures taken from the cycle actually settled in step 6A */
const statements: CycleStatement[] = [
  {
    cycleId: "40000000-0000-0000-0000-00000000d001",
    seriesName: "A",
    cycleLabel: "Feb 2026 – Apr 2026",
    startDate: "2026-02-01",
    endDate: "2026-04-30",
    units: 12.5,
    capital: 125_000_000,
    grossProfit: 66_331_812,
    wht: 6_633_187,
    netProfit: 59_698_625,
    netReturnPct: 47.76,
    capitalAction: "withdraw",
    slotsWithdrawn: 12.5,
    whtState: "withheld",
    documentState: "ready",
  },
  {
    cycleId: "40000000-0000-0000-0000-00000000d002",
    seriesName: "A",
    cycleLabel: "Nov 2025 – Jan 2026",
    startDate: "2025-11-01",
    endDate: "2026-01-31",
    units: 2.5,
    capital: 25_000_000,
    grossProfit: 11_200_000,
    wht: 1_120_000,
    netProfit: 10_080_000,
    netReturnPct: 40.32,
    capitalAction: "rollover",
    slotsWithdrawn: 0,
    whtState: "certified",
    documentState: "ready",
  },
  {
    cycleId: "40000000-0000-0000-0000-00000000d003",
    seriesName: "A",
    cycleLabel: "Aug 2025 – Oct 2025",
    startDate: "2025-08-01",
    endDate: "2025-10-31",
    units: 1.5,
    capital: 15_000_000,
    grossProfit: 5_400_000,
    wht: 540_000,
    netProfit: 4_860_000,
    netReturnPct: 32.4,
    capitalAction: "partial",
    slotsWithdrawn: 0.5,
    whtState: "remitted",
    documentState: null,
  },
];

const body = renderToStaticMarkup(
  React.createElement(CycleStatements, { statements })
);

writeFileSync(
  out,
  `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cycle statements — investor view</title>
<style>${css}</style>
<style>body{background:#F7F5F1;padding:24px;font-family:ui-sans-serif,system-ui,sans-serif}</style>
</head><body><div class="max-w-6xl mx-auto">${body}</div></body></html>`
);
console.log(`wrote ${out} (${css.length} bytes of the app's own CSS)`);
