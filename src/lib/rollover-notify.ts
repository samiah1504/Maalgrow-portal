import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { sendRolloverEmail } from "@/lib/email";

type AdminClient = SupabaseClient<Database>;

type RolloverRow = {
  id: string;
  decision: "continue" | "exit" | "rollover_all";
  status: string;
  units: number | null;
  capital_rolled_over: number;
  profit_rolled_over: number;
  withdrawal_amount: number;
  investor: { full_name: string; investor_code: string; email: string } | null;
  previous_investment: { declared_profit: number | null } | null;
  source_cycle: { cycle_label: string; start_date: string; end_date: string } | null;
  destination_cycle: { cycle_label: string; start_date: string; end_date: string } | null;
  series: { name: string } | null;
};

/**
 * Sends rollover confirmation emails for the given cycle_rollovers rows
 * (only those not yet emailed, with status completed/withdrawn).
 * Email failure NEVER affects the rollover records themselves — the
 * outcome is stored on email_sent / email_error and can be retried.
 */
export async function sendRolloverEmails(
  adminClient: AdminClient,
  sourceCycleId: string
): Promise<{ sent: number; failed: number }> {
  const { data: rows } = await adminClient
    .from("cycle_rollovers")
    .select(
      `id, decision, status, units, capital_rolled_over, profit_rolled_over, withdrawal_amount,
       investor:investors(full_name, investor_code, email),
       previous_investment:investments!previous_investment_id(declared_profit),
       source_cycle:cycles!source_cycle_id(cycle_label, start_date, end_date),
       destination_cycle:cycles!destination_cycle_id(cycle_label, start_date, end_date),
       series:series(name)`
    )
    .eq("source_cycle_id", sourceCycleId)
    .eq("email_sent", false)
    .in("status", ["completed", "withdrawn"]);

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL ?? "https://maalgrow-portal.vercel.app";

  let sent = 0;
  let failed = 0;

  for (const raw of (rows ?? []) as unknown as RolloverRow[]) {
    if (!raw.investor?.email) continue;

    const result = await sendRolloverEmail({
      to: raw.investor.email,
      fullName: raw.investor.full_name,
      investorCode: raw.investor.investor_code,
      seriesName: raw.series?.name ?? "?",
      completedCycleLabel: raw.source_cycle?.cycle_label ?? "",
      completedCycleStart: raw.source_cycle?.start_date ?? "",
      completedCycleEnd: raw.source_cycle?.end_date ?? "",
      newCycleLabel: raw.destination_cycle?.cycle_label ?? "",
      newCycleStart: raw.destination_cycle?.start_date ?? "",
      newCycleEnd: raw.destination_cycle?.end_date ?? "",
      decision: raw.decision,
      slots: raw.units ?? 0,
      actualProfit: raw.previous_investment?.declared_profit ?? 0,
      capitalRolledOver: raw.capital_rolled_over,
      profitRolledOver: raw.profit_rolled_over,
      withdrawalAmount: raw.withdrawal_amount,
      portalLink: `${siteUrl}/investments`,
    });

    await adminClient
      .from("cycle_rollovers")
      .update(
        result.success
          ? { email_sent: true, email_error: null }
          : { email_sent: false, email_error: result.error ?? "Unknown error" }
      )
      .eq("id", raw.id);

    if (result.success) sent++;
    else failed++;
  }

  return { sent, failed };
}
