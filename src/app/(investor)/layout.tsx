import { redirect } from "next/navigation";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { InvestorShell } from "@/components/layout/investor-shell";

/**
 * Server-side KYC gate for the entire investor portal.
 *
 * Investors who have not yet submitted their KYC form — or whose KYC
 * was rejected and needs resubmission — are redirected to /kyc (which
 * lives OUTSIDE this route group, so the gate cannot loop) before they
 * can access any portal page.
 */
export default async function InvestorLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = await createAdminClient();
  const { data: investor } = await db
    .from("investors")
    .select("id, kyc_status, kyc_submitted_at")
    .eq("profile_id", user.id)
    .maybeSingle();

  // Only gate actual investors; admin/staff accounts have no investor row.
  if (investor && (!investor.kyc_submitted_at || investor.kyc_status === "rejected")) {
    redirect("/kyc");
  }

  return <InvestorShell>{children}</InvestorShell>;
}
