/**
 * The terms engine and the database must agree to the kobo.
 *
 * maalrise_save_terms() recalculates every figure the app submits and
 * refuses terms it cannot reproduce. That protects the data — but if
 * the two implementations drift, it also means good terms get refused
 * in production. This runs a few hundred generated combinations of
 * cost, markup, fee basis, fee treatment, duration and schedule mode
 * through BOTH, and expects:
 *
 *   - every set the engine accepts is accepted by the database, and
 *   - the same set with any one figure nudged by one kobo is refused.
 *
 * Needs a scratch database with the stub, migrations 001–050 and the
 * MaalRise draft applied. NEVER point this at staging or production.
 *
 *   npx tsx scripts/test-maalrise-sql-contract.ts <scratch-database>
 */
import { execFileSync } from "node:child_process";
import { computeTerms, type FeeBasis, type FeeTreatment, type TermsInput } from "../src/lib/maalrise/compute";
import { saveTermsArgs } from "../src/lib/maalrise/terms-payload";

const db = process.argv[2];
if (!db) {
  console.error("usage: tsx scripts/test-maalrise-sql-contract.ts <scratch-database>");
  process.exit(2);
}

// Deterministic pseudo-random, so a failure is reproducible.
let seed = 20261012;
const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];

const cases: TermsInput[] = [];
for (let i = 0; i < 240; i++) {
  const cost = pick([1_000_000_00, 25_000_000_00, 100_000_000_00, 7_777_777_77, 333_333_33]);
  const n = pick([1, 2, 3, 4, 6, 7, 9, 12]);
  const markup = rnd() < 0.5
    ? { type: "percent" as const, bps: pick([0, 1, 333, 750, 1200, 1999]) }
    : { type: "amount" as const, kobo: pick([0, 1, 999_999, 3_000_000_00, 12_345_678]) };
  const treatment = pick<FeeTreatment>(["deducted_from_investors", "charged_to_counterparty", "waived"]);
  const basis = pick<FeeBasis>(["cost", "markup", "fixed"]);
  const fee = basis === "fixed"
    ? { basis, kobo: pick([0, 1, 50_000_00, 7]), treatment }
    : { basis, bps: pick([0, 1, 250, 500, 333]), treatment };
  const input: TermsInput = { costKobo: cost, markup, statedSalePriceKobo: null, fee, durationMonths: n, schedule: { mode: "equal" } };
  const b = computeTerms(input);
  if (b.errors.length) continue; // e.g. a deducted fee larger than the markup — refused by both, tested elsewhere

  // Half the cases use a contract schedule: a random split of the pool.
  if (rnd() < 0.5 && b.investorProfitPoolKobo > 0) {
    const weights = Array.from({ length: n }, () => 1 + Math.floor(rnd() * 5));
    const total = weights.reduce((s, w) => s + w, 0);
    const parts = weights.map((w) => Math.floor((b.investorProfitPoolKobo * w) / total));
    parts[n - 1] += b.investorProfitPoolKobo - parts.reduce((s, p) => s + p, 0);
    cases.push({ ...input, schedule: { mode: "contract", netKobo: parts } });
  } else {
    cases.push(input);
  }
}

const q = (v: unknown) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
const OPS = "a0000000-0000-0000-0000-00000000c003";

let sql = `\\set ON_ERROR_STOP on
BEGIN;
INSERT INTO auth.users (id, email) VALUES ('${OPS}', 'contract.ops@t.com') ON CONFLICT DO NOTHING;
INSERT INTO profiles (id, email, full_name, role) VALUES ('${OPS}', 'contract.ops@t.com', 'Contract Ops', 'operations')
  ON CONFLICT (id) DO UPDATE SET role = EXCLUDED.role;
SET LOCAL test.uid = '${OPS}';
CREATE TEMP TABLE contract_cp AS SELECT maalrise_create_counterparty('{"name":"Contract Counterparty"}') AS id;
`;

cases.forEach((input, i) => {
  const b = computeTerms(input);
  const args = saveTermsArgs(input, b);

  // One-kobo tamperings, each of which must be refused.
  const tampered: { label: string; terms: object; schedule: object[] }[] = [
    { label: "pool+1", terms: { ...args.p_terms, investor_pool_kobo: b.investorProfitPoolKobo + 1 }, schedule: args.p_schedule },
    { label: "fee+1", terms: { ...args.p_terms, fee_kobo: b.feeKobo + 1 }, schedule: args.p_schedule },
    { label: "markup+1", terms: { ...args.p_terms, markup_kobo: b.markupKobo + 1 }, schedule: args.p_schedule },
    {
      label: "month1 net+1",
      terms: args.p_terms,
      schedule: args.p_schedule.map((l, k) => (k === 0 ? { ...l, investor_net_kobo: l.investor_net_kobo + 1, counterparty_gross_kobo: l.counterparty_gross_kobo + 1 } : l)),
    },
    { label: "a month missing", terms: args.p_terms, schedule: args.p_schedule.slice(0, -1) },
  ];

  sql += `
DO $$
DECLARE v_cycle UUID; v_ok BOOLEAN;
BEGIN
  v_cycle := maalrise_create_cycle(jsonb_build_object(
    'name', 'Contract case ${i}', 'transaction_name', 'Contract test', 'counterparty_id', (SELECT id FROM contract_cp),
    'start_date', '2026-01-31', 'duration_months', ${input.durationMonths}, 'unit_price_kobo', 100));
  PERFORM maalrise_save_terms(v_cycle, ${q(args.p_terms)}, ${q(args.p_schedule)});
`;
  for (const t of tampered) {
    sql += `  BEGIN
    PERFORM maalrise_save_terms(v_cycle, ${q(t.terms)}, ${q(t.schedule)});
    v_ok := TRUE;
  EXCEPTION WHEN OTHERS THEN v_ok := FALSE; END;
  IF v_ok THEN RAISE EXCEPTION 'TEST FAIL case ${i}: tampered (${t.label}) terms were accepted'; END IF;
`;
  }
  sql += `END $$;
`;
});
sql += `
DO $$ BEGIN
  IF (SELECT COUNT(*) FROM maalrise_cycle_terms) <> ${cases.length} THEN
    RAISE EXCEPTION 'TEST FAIL: expected ${cases.length} stored terms, found %', (SELECT COUNT(*) FROM maalrise_cycle_terms);
  END IF;
  IF EXISTS (SELECT 1 FROM maalrise_cycle_terms t
             WHERE t.investor_pool_kobo <> (SELECT SUM(investor_net_kobo) FROM maalrise_schedule_lines WHERE terms_id = t.id)
                OR t.fee_kobo <> (SELECT SUM(fee_kobo) FROM maalrise_schedule_lines WHERE terms_id = t.id)) THEN
    RAISE EXCEPTION 'TEST FAIL: a stored schedule does not reconcile';
  END IF;
END $$;
ROLLBACK;
`;

try {
  execFileSync("psql", ["-d", db, "-q", "-v", "ON_ERROR_STOP=1", "-f", "-"], { input: sql, stdio: ["pipe", "pipe", "pipe"] });
} catch (e) {
  const err = e as { stderr?: Buffer };
  console.error("FAIL:", err.stderr?.toString().split("\n").find((l) => l.includes("ERROR")) ?? e);
  process.exit(1);
}
console.log(`PASS: ${cases.length} engine-accepted term sets accepted by the database`);
console.log(`PASS: ${cases.length * 5} one-kobo tamperings refused by the database`);
console.log("\nTerms engine and database agree.");
