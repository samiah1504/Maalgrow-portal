/**
 * What this investor still needs to be asked, if anything.
 *
 * Thin on purpose: the decision of who to ask and about what belongs
 * in my_maturity_prompts() (migration 027), where it is resolved from
 * auth.uid() rather than from anything the caller supplies. A page
 * cannot ask about somebody else's holdings even by accident.
 *
 * Returns an empty list on any failure. A prompt that fails to load
 * must never take a dashboard down with it — the investor's own
 * figures matter more than the reminder, and the reminder returns on
 * the next load anyway.
 *
 * SERVER ONLY.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MaturityPromptItem } from "@/components/investor/maturity-prompt";

export async function loadMaturityPrompts(
  supabase: SupabaseClient
): Promise<MaturityPromptItem[]> {
  try {
    const { data, error } = await supabase.rpc("my_maturity_prompts");
    if (error || !Array.isArray(data)) return [];
    return (data as MaturityPromptItem[]).map((p) => ({
      investmentId: String(p.investmentId),
      investmentCode: String(p.investmentCode ?? ""),
      seriesName: String(p.seriesName ?? ""),
      cycleLabel: String(p.cycleLabel ?? ""),
      units: Number(p.units ?? 0),
      capital: Number(p.capital ?? 0),
      maturityDate: String(p.maturityDate ?? ""),
      closesAt: String(p.closesAt ?? ""),
    }));
  } catch {
    // Includes the database not yet having migration 027.
    return [];
  }
}
