import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { sendPaymentReminderEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site-url";
import { instructionDeadline, longDate } from "@/lib/maturity-deadline";

/**
 * The investors whose money is settled and who have no payment
 * request — and the two things an administrator can do about it.
 *
 * WHY RECORDING AN INSTRUCTION IS THE ACTION, NOT CREATING A REQUEST.
 * Nothing in this portal lets an investor raise a payment request;
 * sync_maturity_payment_requests raises it the moment a maturity
 * instruction is submitted. So the way to unblock somebody who told
 * you their answer on WhatsApp is to record that answer, through the
 * same function their own form calls — which then raises the request
 * itself, from the frozen settlement figures.
 *
 * A second route that minted payment requests directly would be a
 * second set of numbers, and the day it disagreed with the settlement
 * nobody would know which was right.
 *
 * SERVER ONLY. The reminder goes out through Resend from here; the
 * key never reaches a browser.
 */

// Recording somebody else's instruction about their own capital is
// not a support action. Deliberately narrower than the page.
const MAY_RECORD = ["super_admin", "administrator", "finance"];
// Chasing is harmless — it sends the investor to their own portal.
const MAY_REMIND = [
  "super_admin",
  "administrator",
  "finance",
  "operations",
  "customer_support",
];

const REASONS = [
  "Investor requested by WhatsApp",
  "Investor requested by phone call",
  "Investor requested by email",
  "Investor cannot sign in",
  "Investor has an email problem",
  "Recorded in person",
  "Other",
];

type GapRow = {
  investment_id: string;
  investor_code: string;
  full_name: string;
  email: string | null;
  series_name: string;
  cycle_label: string;
  cycle_id: string;
  profit_available: number;
  capital: number;
  reason: string;
};

async function guard(allowed: string[]) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 } as const;

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, full_name")
    .eq("id", user.id)
    .single();

  if (!profile || !allowed.includes(profile.role ?? "")) {
    return { error: "Forbidden", status: 403 } as const;
  }
  return { supabase, user, profile };
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      action?: string;
      investmentIds?: string[];
      investmentId?: string;
      decision?: "continue" | "exit" | "partial_exit";
      slotsToWithdraw?: number | null;
      reason?: string;
      comment?: string;
      bankName?: string;
      accountName?: string;
      accountNumber?: string;
    };

    /* ── Chase them ─────────────────────────────────────────── */

    if (body.action === "remind") {
      const auth = await guard(MAY_REMIND);
      if ("error" in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
      }

      const ids = body.investmentIds ?? (body.investmentId ? [body.investmentId] : []);
      if (ids.length === 0) {
        return NextResponse.json({ error: "Nobody was selected" }, { status: 400 });
      }

      const admin = await createAdminClient();
      const { data: rows, error } = await admin.rpc(
        "investors_awaiting_payment_request",
        { p_cycle_id: null }
      );
      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }

      // Only the ones asked for, and only the ones there is anything
      // to say to. A rollover_all owes nothing, so chasing it would
      // be a message about money that is not coming.
      const wanted = new Set(ids);
      const targets = ((rows ?? []) as unknown as GapRow[]).filter(
        (r) => wanted.has(r.investment_id) && r.reason !== "nothing_payable"
      );

      let sent = 0;
      let failed = 0;
      let skipped = 0;
      const results: { name: string; state: string; detail?: string }[] = [];

      for (const row of targets) {
        const to = (row.email ?? "").trim();

        // No address is not a failure to retry — it is a fact about
        // their record, and it stays visible until somebody fixes it.
        if (!to) {
          skipped++;
          results.push({
            name: row.full_name,
            state: "skipped",
            detail: "No email address on record",
          });
          continue;
        }

        const deadline = longDate(await instructionDeadline(admin, row.cycle_id));

        const outcome = await sendPaymentReminderEmail({
          to,
          fullName: row.full_name,
          investorCode: row.investor_code,
          seriesName: row.series_name,
          cycleLabel: row.cycle_label,
          // NOT divided by 100. investors_awaiting_payment_request is
          // on the naira side of the portal: profit_available and
          // capital come from investments.declared_profit and
          // investments.capital, which declare_cycle_profit writes as
          // `gross_kobo / 100.0`. fmtNGN then formats naira.
          //
          // Dividing here converted naira to naira-again and put a
          // figure a hundred times too small into the subject line and
          // the headline of an email to the investor — a real ₦120,100
          // profit announced as ₦1,201. The kobo-denominated half of
          // the portal is the Mudarabah engine (see
          // lib/mudarabah/format.ts, which divides correctly because
          // its input really is kobo); this route does not read it.
          profitAvailable: Number(row.profit_available),
          capital: Number(row.capital),
          reason: row.reason as "no_instruction" | "no_bank_details" | "not_raised",
          deadline,
          portalLink: SITE_URL,
        });

        // Recorded either way. A table that only holds successes
        // reads as though nobody was ever missed.
        await admin.rpc("record_payment_reminder", {
          p_investment_id: row.investment_id,
          p_to_address: to,
          p_state: outcome.success ? "sent" : "failed",
          p_message_id: outcome.messageId ?? null,
          p_error: outcome.error ?? null,
        });

        if (outcome.success) {
          sent++;
          results.push({ name: row.full_name, state: "sent", detail: to });
        } else {
          failed++;
          results.push({
            name: row.full_name,
            state: "failed",
            detail: outcome.error,
          });
        }
      }

      return NextResponse.json({ ok: true, sent, failed, skipped, results });
    }

    /* ── Record what they told you ──────────────────────────── */

    if (body.action === "record-instruction") {
      const auth = await guard(MAY_RECORD);
      if ("error" in auth) {
        return NextResponse.json({ error: auth.error }, { status: auth.status });
      }

      if (!body.investmentId || !body.decision) {
        return NextResponse.json(
          { error: "An investment and a decision are required" },
          { status: 400 }
        );
      }

      // MANDATORY, and not free text alone. In a year somebody has to
      // be able to see why a member of staff answered on an
      // investor's behalf; "Other" without a comment says nothing.
      const reason = (body.reason ?? "").trim();
      const comment = (body.comment ?? "").trim();
      if (!reason || !REASONS.includes(reason)) {
        return NextResponse.json(
          { error: "Choose a reason for recording this on the investor's behalf" },
          { status: 400 }
        );
      }
      if (reason === "Other" && comment.length < 5) {
        return NextResponse.json(
          { error: "Describe the reason — 'Other' on its own is not a record" },
          { status: 400 }
        );
      }
      if (body.decision === "partial_exit" && !body.slotsToWithdraw) {
        return NextResponse.json(
          { error: "Say how many slots are being withdrawn" },
          { status: 400 }
        );
      }

      const note = [
        `Recorded by ${auth.profile.full_name ?? "an administrator"} on the investor's behalf`,
        reason,
        comment || null,
      ]
        .filter(Boolean)
        .join(" — ");

      // THE SAME FUNCTION THE INVESTOR'S OWN FORM CALLS. It stamps
      // via = 'admin_exception' and decided_by = the acting staff
      // member, locks the instruction, and raises the payment request
      // from the settlement's frozen figures. Nothing here computes
      // an amount.
      const { data, error } = await auth.supabase.rpc("submit_rollover_decision", {
        p_investment_id: body.investmentId,
        p_decision: body.decision,
        p_bank_name: body.bankName?.trim() || null,
        p_account_name: body.accountName?.trim() || null,
        p_account_number: body.accountNumber?.trim() || null,
        p_notes: note,
        p_admin_override: true,
        p_slots_to_withdraw:
          body.decision === "partial_exit" ? body.slotsToWithdraw ?? null : null,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      return NextResponse.json({ ok: true, result: data });
    }

    return NextResponse.json(
      { error: "action must be remind or record-instruction" },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not complete the action" },
      { status: 500 }
    );
  }
}

/** The reasons the form offers. One list, so the API and the form agree. */
export async function GET() {
  const auth = await guard(MAY_RECORD);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  return NextResponse.json({ reasons: REASONS });
}
