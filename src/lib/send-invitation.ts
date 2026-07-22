import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/types/database.types";
import { sendOnboardingEmail } from "@/lib/email";
import { getPaymentStatus, SLOT_VALUE_NGN } from "@/lib/investment-utils";
import { SITE_URL } from "@/lib/site-url";

type AdminClient = SupabaseClient<Database>;

/**
 * Sends (or resends) the branded MaalGrow portal invitation to an
 * investor: generates a fresh password-setup link via Supabase admin
 * (which sends nothing itself) and delivers the branded email through
 * Resend. Updates the investor's invitation_status either way.
 */
export async function sendInvestorInvitation(
  adminClient: AdminClient,
  investorId: string
): Promise<{ success: boolean; error?: string; invitation_status: "sent" | "failed" }> {
  const { data: investor, error: investorErr } = await adminClient
    .from("investors")
    .select(
      `id, full_name, email, investor_code, profile_id,
       investments(
         id, investment_code, units, capital, investment_date, maturity_date,
         series(name),
         cycle:cycles(cycle_label, start_date, end_date),
         investment_payments(amount)
       )`
    )
    .eq("id", investorId)
    .single();

  if (investorErr || !investor) {
    return { success: false, error: "Investor not found", invitation_status: "failed" };
  }

  // Generate a fresh invite link (does NOT send Supabase's email)
  const { data: linkData, error: linkErr } =
    await adminClient.auth.admin.generateLink({
      type: "invite",
      email: investor.email,
      options: {
        data: { full_name: investor.full_name, role: "investor" },
        redirectTo: `${SITE_URL}/investor/dashboard`,
      },
    });

  if (linkErr) {
    return {
      success: false,
      error: "Failed to generate invite link: " + linkErr.message,
      invitation_status: "failed",
    };
  }

  const passwordSetupLink =
    linkData?.properties?.action_link ?? `${SITE_URL}/login`;

  type InvRow = {
    id: string;
    investment_code: string;
    units: number;
    capital: number;
    investment_date: string;
    maturity_date: string;
    series: { name: string } | null;
    cycle: { cycle_label: string; start_date: string; end_date: string } | null;
    investment_payments: { amount: number }[];
  };

  const investments = (investor.investments ?? []) as unknown as InvRow[];
  const latestInv = investments[0] ?? null;

  const totalPaid = latestInv
    ? latestInv.investment_payments.reduce((s, p) => s + p.amount, 0)
    : 0;
  const capital = latestInv?.capital ?? 0;
  const outstandingBalance = Math.max(0, capital - totalPaid);
  const payStatus = capital > 0 ? getPaymentStatus(capital, totalPaid) : "pending";

  const result = await sendOnboardingEmail({
    to: investor.email,
    fullName: investor.full_name,
    investorCode: investor.investor_code,
    email: investor.email,
    passwordSetupLink,
    portalLink: SITE_URL,
    seriesName: latestInv?.series?.name ?? "—",
    cycleLabel: latestInv?.cycle?.cycle_label ?? "—",
    slots: latestInv ? latestInv.units : 0,
    slotValue: SLOT_VALUE_NGN,
    totalInvestment: capital,
    totalPaid,
    outstandingBalance,
    paymentStatus: payStatus,
    cycleStart: latestInv?.cycle?.start_date ?? "",
    maturityDate: latestInv?.cycle?.end_date ?? "",
  });

  const newStatus: "sent" | "failed" = result.success ? "sent" : "failed";

  await adminClient
    .from("investors")
    .update({
      invitation_status: newStatus,
      invitation_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      ...(result.success ? { invitation_sent_at: new Date().toISOString() } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("id", investorId);

  return {
    success: result.success,
    error: result.error,
    invitation_status: newStatus,
  };
}
