/**
 * End-to-end settlement proof.
 *
 * Runs the real engine, the real preview and the real payload builder,
 * and writes the JSON that mudarabah_settle_cycle is called with. The
 * point is that nothing here is hand-authored: the figures that reach
 * the database are the ones the engine produced.
 *
 *   npx tsx scripts/settle-demo.ts <outdir>
 */
import { writeFileSync, mkdirSync } from "node:fs";
import {
  compute,
  ENGINE_VERSION,
  type CycleInput,
  type MonthInput,
  type MonthRowInput,
} from "../src/lib/mudarabah/compute";
import { buildSettlement, buildSettlementProducts } from "../src/lib/mudarabah/figures";
import {
  settlementPayload,
  settlementPreview,
  type Participant,
} from "../src/lib/mudarabah/settlement";

const out = process.argv[2] ?? "tmp-settle";
mkdirSync(out, { recursive: true });

const K = 100;
const row = (
  productId: string, qty: number, unitCost: number, soldQty: number,
  sellPrice: number, stockLeft?: number
): MonthRowInput => ({ productId, qty, unitCost, soldQty, sellPrice, stockLeft });

/* 20 slots at ₦100,000 · 70/30 · 10% withholding tax */
const input: CycleInput = {
  slotPrice: 100_000 * K,
  slots: 20,
  ratio: 70,
  wht: 10,
  withdrawSlots: 14,
  products: [
    { id: "sofa", name: "3-seater sofa" },
    { id: "table", name: "Dining table" },
    { id: "bed", name: "Bed frame" },
  ],
  months: [
    {
      rows: [
        row("sofa", 20, 47_000 * K, 13, 71_000 * K),
        row("table", 50, 9_100 * K, 31, 14_300 * K),
        row("bed", 25, 21_000 * K, 17, 31_000 * K),
      ],
      ads: 60_000 * K, logistics: 25_000 * K, misc: 10_000 * K, bankCharges: 5_000 * K,
    },
    {
      rows: [
        row("sofa", 12, 48_500 * K, 14, 72_500 * K),
        row("table", 30, 9_400 * K, 33, 14_600 * K, 15),
        row("bed", 10, 21_500 * K, 12, 31_500 * K),
      ],
      ads: 55_000 * K, logistics: 22_000 * K, misc: 8_000 * K, bankCharges: 6_000 * K,
    },
    {
      rows: [
        row("sofa", 6, 49_000 * K, 9, 73_000 * K),
        row("table", 20, 9_600 * K, 30, 15_000 * K),
        row("bed", 8, 22_000 * K, 13, 32_000 * K),
      ],
      ads: 50_000 * K, logistics: 20_000 * K, misc: 12_000 * K, bankCharges: 7_000 * K,
    },
  ] as [MonthInput, MonthInput, MonthInput],
};

/* Three holders: one exits, one continues, one never answered */
const participants: Participant[] = [
  {
    investmentId: "@@INV1@@", investorId: "@@VID1@@",
    investorName: "Aisha Bello", investorCode: "MGS0001",
    units: 12.5, decision: "withdraw", slotsWithdrawn: 12.5, tin: "TIN-0001",
  },
  {
    investmentId: "@@INV2@@", investorId: "@@VID2@@",
    investorName: "Ibrahim Sanusi", investorCode: "MGS0002",
    units: 6, decision: "rollover", slotsWithdrawn: 0, tin: "TIN-0002",
  },
  {
    investmentId: "@@INV3@@", investorId: "@@VID3@@",
    investorName: "Fatima Yusuf", investorCode: "MGS0003",
    units: 1.5, decision: null, slotsWithdrawn: 0, tin: null,
  },
];

const preview = settlementPreview(input, participants);
const cycle = compute(input);
const { computed } = buildSettlement("@@CYCLE@@", cycle, [], "2026-05-02T10:00:00Z");

console.log(`engine ${ENGINE_VERSION}`);
console.log(`profit ₦${(cycle.profit / 100).toLocaleString("en-NG")}`);
console.log(`investors' share ₦${(cycle.holderPot / 100).toLocaleString("en-NG")}`);
for (const a of preview.assertions) {
  console.log(`  ${a.passed ? "PASS" : "FAIL"}  ${a.name}`);
}
for (const w of preview.warnings) console.log(`  warn: ${w.message}`);
console.log(`blocked: ${preview.blocked}`);

writeFileSync(`${out}/computed.json`, JSON.stringify(computed));
writeFileSync(`${out}/holders.json`, JSON.stringify(settlementPayload(preview)));
writeFileSync(`${out}/products.json`, JSON.stringify(buildSettlementProducts(cycle)));
writeFileSync(`${out}/preview.json`, JSON.stringify(preview, null, 2));
console.log(`wrote ${out}/computed.json, holders.json, products.json`);
