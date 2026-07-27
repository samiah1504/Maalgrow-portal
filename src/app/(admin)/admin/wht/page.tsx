import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { WhtScreen } from "./_wht-screen";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Withholding Tax | Admin" };
export const revalidate = 0;

const ADMIN_ROLES = ["super_admin", "administrator"];

/**
 * The screen an administrator lives on at filing time.
 *
 * Deliberately separate from the trading ledger: filing tax and
 * recording trade are different jobs done at different moments, and
 * the outstanding work should be the first thing on the page.
 */
export default async function WhtPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || !ADMIN_ROLES.includes(profile.role ?? "")) redirect("/admin");

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <Receipt className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Withholding Tax</h1>
          <p className="text-sm text-muted mt-0.5">
            Tax deducted at settlement, filed with the authority, then certified
            to each investor. A credit note is only ever issued against a filing
            that has actually happened.
          </p>
        </div>
      </div>

      <WhtScreen />
    </div>
  );
}
