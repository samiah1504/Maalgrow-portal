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
import { instructionDeadline, longDate } from "../src/lib/maturity-deadline";
import {
  buildPaymentReminderHtml,
  type PaymentReminderParams,
} from "../src/lib/email";

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

async function main() {
  /* ── The deadline is ASKED FOR, never worked out ──────────────── */

  /*
   * THE REPORTED FAULT. The email printed "Please answer by 30 July
   * 2026" for a cycle whose instructions the database accepted until 4
   * August. It built the date itself, as the greatest of the cycle's
   * stored columns, which silently drops the five-day default behind
   * instruction_closes_at — a column nothing in the portal ever sets.
   *
   * The fix was to stop computing it. These check that the asking is
   * done properly and, above all, that a database which cannot answer
   * produces NO deadline rather than a plausible wrong one.
   */

  const fakeClient = (result: { data?: unknown; error?: unknown }) => ({
    rpc: async (fn: string, args: Record<string, unknown>) => {
      check(
        "it asks rollover_decision_deadline, the same function submission uses",
        fn === "rollover_decision_deadline" && args.p_cycle_id === "cycle-1"
      );
      return result;
    },
  });

  const asked = await instructionDeadline(fakeClient({ data: "2026-08-04" }), "cycle-1");
  check("the database's answer is what comes back", asked === "2026-08-04", asked);

  // PostgREST can hand a DATE back wrapped, or with a time on it.
  check(
    "a single-row array is unwrapped",
    (await instructionDeadline(fakeClient({ data: ["2026-08-04"] }), "cycle-1")) ===
      "2026-08-04"
  );
  check(
    "a timestamp is reduced to its date",
    (await instructionDeadline(
      fakeClient({ data: "2026-08-04T00:00:00+00:00" }),
      "cycle-1"
    )) === "2026-08-04"
  );

  // THE ONES THAT MATTER. Anything other than a date it trusts must
  // produce null, so the email leaves the sentence out entirely.
  check(
    "an error gives no date at all — not a guess",
    (await instructionDeadline(
      fakeClient({ data: null, error: { message: "function does not exist" } }),
      "cycle-1"
    )) === null
  );
  check(
    "and neither does nonsense",
    (await instructionDeadline(fakeClient({ data: "soon" }), "cycle-1")) === null
  );
  check(
    "a client that throws is not allowed to break the send",
    (await instructionDeadline(
      { rpc: () => { throw new Error("network"); } },
      "cycle-1"
    )) === null
  );

  check("it reads as a date a person would write", longDate("2026-08-04") === "4 August 2026");
  check("and nothing at all when there is nothing", longDate(null) === null);

  // The whole point of returning null: SILENCE, not a wrong date.
  const noDeadline = buildStatementHtml({ ...base, instructionDeadline: null });
  check(
    "with no deadline the email simply does not name one",
    !/please answer by/i.test(noDeadline),
    noDeadline.match(/.{0,60}answer by.{0,60}/i)?.[0]
  );
  check(
    "but it still asks the question, and still says the answer is final",
    /capital returned/i.test(noDeadline) && /final once submitted/i.test(noDeadline)
  );

  /* ── Chasing an investor whose money is waiting ─────────────── */

  /*
   * THE TRAP. The obvious wording — "you have not submitted a payment
   * request, please log in and submit one" — describes a button that
   * does not exist. Investors here never raise their own requests:
   * sync_maturity_payment_requests raises one the moment a maturity
   * instruction is submitted. Sending that sentence would have
   * thirty-eight people hunting a screen that was never built.
   *
   * So each reason must ask for the thing that actually unblocks it.
   */

  const reminderBase: PaymentReminderParams = {
    to: "aisha@example.com",
    fullName: "Aisha Bello",
    investorCode: "MG0041",
    seriesName: "B",
    cycleLabel: "Apr 2026 – July 2026",
    profitAvailable: 757_248,
    capital: 3_000_000,
    reason: "no_instruction",
    deadline: "4 August 2026",
    portalLink: "https://maalgrow.maalvest.com",
  };

  const silent = buildPaymentReminderHtml(reminderBase);

  check("the profit waiting is stated", silent.includes("757,248"));
  check(
    "and the ask is the maturity answer, which is what unblocks it",
    /what you would like done with|capital/i.test(silent) &&
      /Choose What Happens to Your Capital/i.test(silent)
  );
  check("with the deadline", silent.includes("4 August 2026"));
  // THE ONE THAT MATTERS MOST.
  check(
    "it does NOT tell them to submit a payment request",
    !/submit (a |your )?payment request|payment request/i.test(silent),
    silent.match(/.{0,80}payment request.{0,80}/i)?.[0]
  );
  check(
    "and it offers a way through for somebody who cannot sign in",
    /phone or WhatsApp|record it for you/i.test(silent)
  );

  const noBank = buildPaymentReminderHtml({
    ...reminderBase,
    reason: "no_bank_details",
  });
  check(
    "somebody with no bank account is asked for their bank account",
    /bank account details/i.test(noBank) && /Add Your Bank Details/i.test(noBank)
  );
  check(
    "and is NOT asked to choose what happens to their capital — they already did",
    !/Choose What Happens to Your Capital/i.test(noBank)
  );

  const inHand = buildPaymentReminderHtml({ ...reminderBase, reason: "not_raised" });
  check(
    "and somebody we are already dealing with is asked for nothing",
    /nothing you need to do/i.test(inHand)
  );

  /* Confidentiality, same rule as the statement */
  const reminderText = silent.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
  check(
    "no whole-Series trading figure reaches the reminder",
    !/total sales|cost of the goods|gross profit/i.test(reminderText)
  );

  console.log(
    failures === 0 ? "\nALL STATEMENT EMAIL TESTS PASSED" : `\n${failures} FAILED`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
