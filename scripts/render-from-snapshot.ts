/**
 * Render an investor's report FROM THE FROZEN SNAPSHOT.
 *
 * The engine is never called. reportFigures() is handed the stored
 * settlement and nothing else, so what comes out is what the database
 * recorded at settlement — no provisional banner, and identical in two
 * years' time.
 *
 *   npx tsx scripts/render-from-snapshot.ts <snapshot.json> <outdir>
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { reportFigures, type ReportCycle, type ReportHolding } from "../src/lib/mudarabah/report-figures";
import { renderReportDocument } from "../src/lib/mudarabah/report-html";
import { inlineReportFonts } from "../src/lib/mudarabah/report-assets";
import type { SettlementComputed } from "../src/lib/mudarabah/figures";

const [, , snapshotPath, outDir = "tmp-snapshot"] = process.argv;
const snap = JSON.parse(readFileSync(snapshotPath, "utf8")) as {
  computed: SettlementComputed;
  settledAt: string;
  engineVersion: string;
  whtRate: number;
  seriesName: string;
  cycleLabel: string;
  startDate: string;
  endDate: string;
  description: string | null;
  discloseMode: string;
  holders: {
    investmentId: string;
    investorName: string;
    investorCode: string;
    units: number;
    decision: string;
    slotsWithdrawn: number;
  }[];
};

// THE WHOLE POINT: status "settled", so the resolver reads the
// snapshot and never touches compute().
const figures = reportFigures({
  status: "settled",
  settlement: {
    computed: snap.computed,
    settledAt: snap.settledAt,
    engineVersion: snap.engineVersion,
    whtRate: Number(snap.whtRate),
  },
});

const cycle: ReportCycle = {
  seriesName: snap.seriesName,
  cycleLabel: snap.cycleLabel,
  startDate: snap.startDate,
  endDate: snap.endDate,
  description: snap.description,
  discloseMode: snap.discloseMode === "full" ? "full" : "perSlot",
  totalUnits: figures.totalUnits,
  investorCount: snap.holders.length,
};

mkdirSync(outDir, { recursive: true });
console.log(`source: ${figures.source}`);
console.log(`provisional: ${figures.provisional}`);
console.log(`settled at: ${figures.settledAt}`);
console.log(`engine: ${figures.engineVersion}`);
console.log(`net per slot: ₦${(figures.netPerSlot / 100).toLocaleString("en-NG")}`);

for (const h of snap.holders) {
  const holding: ReportHolding = {
    investmentId: h.investmentId,
    investorName: h.investorName,
    investorCode: h.investorCode,
    units: Number(h.units),
    decision:
      h.decision === "withdraw" ? "withdraw" : h.decision === "partial" ? "partial" : "rollover",
    slotsWithdrawn: Number(h.slotsWithdrawn),
  };
  const html = renderReportDocument(figures, cycle, holding);
  const { html: standalone } = inlineReportFonts(html);
  const file = `${outDir}/report-${h.investorCode}.html`;
  writeFileSync(file, standalone);
  console.log(`  ${h.investorName} · ${h.units} slots → ${file}`);
}
