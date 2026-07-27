"use client";

/**
 * Asking for a maturity instruction, unmissably.
 *
 * The form itself has always existed, on one investment's detail
 * page. Almost nobody found it, so cycles reached maturity with a
 * third of their members silent and the administrator guessing on
 * their behalf. Nothing was broken — it simply never asked.
 *
 * So it asks three times over, while the window is open: a dialog on
 * arrival, and a banner at the top of the dashboard and of the
 * investments list. All three read from the same source and all three
 * disappear together the moment an instruction is recorded, because
 * my_maturity_prompts() stops returning the investment. There is no
 * dismissed flag to keep in step with anything.
 *
 * The dialog can be closed — it returns on the next visit rather than
 * trapping anyone mid-task — but it cannot be mistaken for something
 * optional, and the banners do not go away at all.
 *
 * WHEN THE WINDOW CLOSES, ALL OF IT GOES QUIET. No "you missed it",
 * no "contact support". By then silence means the capital continues
 * and the profit is paid, which asks nothing of the investor. Anyone
 * who wanted otherwise raises it themselves, and a person answers.
 */

import { useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, X } from "lucide-react";
import { formatCurrency, formatDate } from "@/lib/utils";

export type MaturityPromptItem = {
  investmentId: string;
  investmentCode: string;
  seriesName: string;
  cycleLabel: string;
  units: number;
  capital: number;
  maturityDate: string;
  closesAt: string;
};

function Ask({ item }: { item: MaturityPromptItem }) {
  return (
    <>
      Your <strong>Series {item.seriesName}</strong> investment (
      {item.units} slot{item.units === 1 ? "" : "s"},{" "}
      {formatCurrency(item.capital)}) matures on{" "}
      <strong>{formatDate(item.maturityDate)}</strong>.
    </>
  );
}

/* ── The banner, for the top of a page ───────────────────────────── */

export function MaturityBanner({ items }: { items: MaturityPromptItem[] }) {
  if (items.length === 0) return null;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item.investmentId}
          className="rounded-xl border border-gold-300 bg-gold-50 p-4"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-gold-700 mt-0.5 shrink-0" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gold-900">
                Tell us what to do with your capital
              </p>
              <p className="text-sm text-gold-800 mt-1">
                <Ask item={item} /> Would you like your capital returned, or
                would you like to continue with it? Your profit is paid to you
                either way.
              </p>
              <Link
                href={`/investments/${item.investmentId}`}
                className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gold-700 px-3 py-2 text-xs font-semibold text-white hover:bg-gold-800"
              >
                Choose what happens <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── The dialog, on arrival ──────────────────────────────────────── */

export function MaturityDialog({ items }: { items: MaturityPromptItem[] }) {
  /*
   * Closing it lasts for this page only — open the dashboard again,
   * or move to the investments list, and it is back.
   *
   * Deliberate. There is no "seen" marker in storage, because a
   * marker would mean an investor who closed it once on Monday is
   * never asked again, and the whole reason this exists is that
   * people were not being asked. The one thing that stops it for
   * good is answering, which removes the investment from
   * my_maturity_prompts() and takes the banners with it.
   *
   * It also keeps the component honest: no persistence, no effect,
   * nothing to fall out of step with the database.
   */
  const [closed, setClosed] = useState(false);
  const setOpen = (v: boolean) => setClosed(!v);

  if (items.length === 0 || closed) return null;
  const first = items[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="maturity-prompt-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-5">
          <h2
            id="maturity-prompt-title"
            className="text-lg font-bold text-foreground"
          >
            Your investment is maturing
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close"
            className="rounded-lg p-1 text-muted hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-5">
          <p className="text-sm text-foreground">
            <Ask item={first} />
          </p>
          <p className="text-sm text-foreground">
            Would you like your <strong>capital returned</strong> to your bank
            account, or would you like to{" "}
            <strong>continue with your capital</strong> into the next cycle?
          </p>
          <p className="text-xs text-muted">
            Your profit is paid to you either way — this is only about your
            capital. You have until {formatDate(first.closesAt)} to decide, and
            your answer is final once you give it.
          </p>
          {items.length > 1 && (
            <p className="text-xs text-muted">
              You have {items.length} investments maturing. You will be asked
              about each of them.
            </p>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border p-4">
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted hover:text-foreground"
          >
            Not now
          </button>
          <Link
            href={`/investments/${first.investmentId}`}
            onClick={() => setOpen(false)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-700"
          >
            Choose what happens <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}
