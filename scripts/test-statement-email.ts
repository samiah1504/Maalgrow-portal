/**
 * The covering note on the cycle-end statement.
 *
 * This is the one email that asks for an irreversible decision, and
 * the words are the risky part. Three things have to hold or it
 * misleads someone about their own money:
 *
 *   1. the figure quoted is the NET — what reaches their account.
 *      The gross is a larger, friendlier number that does not match
 *      the transfer.
 *   2. someone who has NOT answered is told the deadline AND that the
 *      answer is final. Since migration 036 it cannot be changed, and
 *      an email that omitted that would be inviting a mistake.
 *   3. someone who HAS answered is not asked again. Sending the
 *      asking paragraph to somebody who decided last week reads as
 *      though the portal lost their instruction.
 *
 *   npx tsx scripts/test-statement-email.ts
 */
import { buildStatementHtml, type StatementEmailParams } from "../src/lib/email";

let failures = 0;
function check(name: string, ok: boolean, extra?: unknown) {
  if (ok) console.log("PASS:", name);
  else {
    failures++;
    console.error("FAIL:", name, extra ?? "");
  }
}

const base: StatementEmailParams = {
  to: "aisha@example.com",
  fullName: "Aisha Bello",
  investorCode: "MG0041",
  seriesName: "B",
  cycleLabel: "Apr 2026 – July 2026",
  slots: 6,
  netProfit: 757_248,
  capital: 3_000_000,
  instructionDeadline: "4 August 2026",
  decisionMade: false,
  decisionLabel: null,
  portalLink: "https://maalgrow.maalvest.com",
};

/* ── The investor who has NOT answered ───────────────────────── */

const asking = buildStatementHtml(base);

check("their profit is stated", asking.includes("757,248"), );
check(
  "and it is named as being after tax",
  /after withholding tax/i.test(asking)
);
check("their capital is stated", asking.includes("3,000,000"));
check("the slots are stated", /6 slots/.test(asking));

check(
  "they are asked about their capital",
  /capital returned/i.test(asking) && /continue into the next cycle/i.test(asking)
);
check(
  "the deadline is given",
  asking.includes("4 August 2026")
);
// THE ONE THAT MATTERS MOST.
check(
  "they are told the answer is FINAL before they give it",
  /final once submitted/i.test(asking),
  asking.match(/.{0,80}final.{0,80}/i)?.[0]
);
check(
  "and that silence continues the capital, not withdraws it",
  /do not answer, your capital continues/i.test(asking)
);
check(
  "the profit is promised either way, so the choice is not about it",
  /profit is paid either way/i.test(asking)
);

/* ── The investor who HAS answered ───────────────────────────── */

const confirming = buildStatementHtml({
  ...base,
  decisionMade: true,
  decisionLabel: "Profit paid · capital continues into the next cycle",
});

check(
  "somebody who answered is NOT asked again",
  !/capital returned/i.test(confirming),
  confirming.match(/.{0,80}capital returned.{0,80}/i)?.[0]
);
check(
  "their instruction is repeated back to them",
  confirming.includes("capital continues into the next cycle")
);
check(
  "and they are told nothing further is needed",
  /does not need anything further/i.test(confirming)
);
check(
  "the button changes from asking to viewing",
  /View Your Investment/.test(confirming) &&
    !/Choose What Happens/.test(confirming)
);
check(
  "while the one who has not answered gets the asking button",
  /Choose What Happens to Your Capital/.test(asking)
);

/* ── A cycle with no deadline recorded ───────────────────────── */

const noDeadline = buildStatementHtml({ ...base, instructionDeadline: null });
check(
  "with no deadline on record, none is invented",
  !/Please answer by/.test(noDeadline)
);
check(
  "but the choice is still described as final",
  /final once submitted/i.test(noDeadline)
);

/* ── Confidentiality ─────────────────────────────────────────── */

// Tags stripped first: <table> is an HTML element, not a product, and
// matching the raw markup would fail on the layout rather than on
// anything the reader ever sees.
const readable = asking
  .replace(/<[^>]*>/g, " ")
  .replace(/\s+/g, " ");

check(
  "no product name or trading detail appears in the covering note",
  !/\b(sofa|chair|table|furniture|wardrobe)s?\b/i.test(readable),
  readable.match(/.{0,60}(sofa|chair|table|furniture|wardrobe).{0,60}/i)?.[0]
);
check(
  "and no whole-Series trading figure either — that is the attachment's job",
  !/total sales|cost of the goods|gross profit/i.test(readable),
  readable.match(/.{0,60}(total sales|cost of the goods|gross profit).{0,60}/i)?.[0]
);

console.log(
  failures === 0 ? "\nALL STATEMENT EMAIL TESTS PASSED" : `\n${failures} FAILED`
);
process.exit(failures === 0 ? 0 : 1);
