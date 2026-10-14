/**
 * The check at the top of every MaalRise investor page.
 *
 * Reads with the investor's own session: the maalrise_my_* functions
 * decide what comes back from auth.uid(), so there is no investor id
 * to pass and nothing to get wrong. Anyone who is not a MaalRise
 * investor — a MaalGrow-only investor, or staff — goes to /dashboard.
 */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { mr, syncFromMaalgrow } from "./db";
import { getMyProfile } from "./portal";

export async function requireMaalriseInvestorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const db = mr(supabase);
  // An approved MaalGrow KYC shows here straight away (Phase 7).
  await syncFromMaalgrow(db);
  const profile = await getMyProfile(db).catch(() => null);
  if (!profile) redirect("/dashboard");
  return { db, profile };
}
