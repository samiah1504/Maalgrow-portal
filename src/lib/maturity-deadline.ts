/**
 * When an instruction can no longer be given.
 *
 * THERE IS ONE ANSWER TO THIS, AND IT LIVES IN THE DATABASE.
 * rollover_decision_deadline() is the date submit_rollover_decision
 * actually measures against — nothing else decides whether an
 * instruction is accepted. Anything that PRINTS a date must ask that
 * function, because a screen quoting a different date is not a
 * cosmetic difference: it tells someone they have run out of time to
 * make a final decision about their own money when they have not.
 *
 * WHY THIS FILE EXISTS. Three places rebuilt the rule in TypeScript,
 * as the greatest of instruction_closes_at, rollover_deadline and
 * end_date. That misses the whole point of the first of those columns:
 *
 *     COALESCE(instruction_closes_at, end_date + INTERVAL '5 days')
 *
 * Nothing in the portal ever SETS instruction_closes_at — it is the
 * override, and it is NULL on every cycle we have. So the greatest of
 * the three stored values was always just end_date, the five days were
 * never added, and the statement email told investors the window shut
 * on 30 July when the database went on accepting until 4 August.
 *
 * The fix is not a better formula here. It is to stop having a formula
 * here at all.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The last day an instruction will be accepted for a cycle, as
 * YYYY-MM-DD, or null if it cannot be determined.
 *
 * NULL RATHER THAN A GUESS. If the database cannot answer — migration
 * 027 not applied, no such cycle — every caller here would rather
 * print nothing than print a date that might be wrong. An email
 * missing its deadline sentence prompts a question; an email with the
 * wrong deadline stops someone asking at all.
 */
export async function instructionDeadline(
  client: unknown,
  cycleId: string
): Promise<string | null> {
  try {
    const db = client as SupabaseClient;
    const { data, error } = await db.rpc("rollover_decision_deadline", {
      p_cycle_id: cycleId,
    });
    if (error || !data) return null;
    const value = Array.isArray(data) ? data[0] : data;
    const iso = String(value ?? "").slice(0, 10);
    return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? iso : null;
  } catch {
    return null;
  }
}

/** "4 August 2026" — how a deadline reads to an investor. */
export function longDate(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
