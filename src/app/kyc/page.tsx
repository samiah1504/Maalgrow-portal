import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import { ShieldCheck, AlertTriangle, Info } from "lucide-react";
import { kycMissingFields } from "@/lib/kyc";
import { KycForm } from "./_kyc-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Complete Your KYC | MaalGrow" };
export const revalidate = 0;

export default async function KycPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const db = await createAdminClient();
  const { data: investor } = await db
    .from("investors")
    .select(
      "id, full_name, investor_code, email, phone, address, nin, bank_name, account_name, account_number, gender, nationality, occupation, kyc_status, kyc_notes, kyc_submitted_at"
    )
    .eq("profile_id", user.id)
    .maybeSingle();

  // Staff accounts have no investor record — nothing to do here.
  if (!investor) redirect("/login");

  const { data: nok } = await db
    .from("next_of_kin")
    .select("*")
    .eq("investor_id", investor.id)
    .maybeSingle();

  const missing = kycMissingFields(investor, nok);

  // Fully submitted, complete and not rejected → straight to the portal.
  if (
    investor.kyc_submitted_at &&
    investor.kyc_status !== "rejected" &&
    missing.length === 0
  ) {
    redirect("/dashboard");
  }

  const isResubmission = investor.kyc_status === "rejected";
  // Previously submitted (possibly approved) but new required fields
  // are missing — only the gaps need filling.
  const isUpdate = Boolean(investor.kyc_submitted_at) && !isResubmission;

  return (
    <div className="min-h-screen bg-gradient-to-br from-primary-900 via-primary-700 to-primary-800 py-10 px-4">
      <div className="mx-auto w-full max-w-2xl animate-slide-up">
        <div className="bg-white rounded-2xl shadow-2xl overflow-hidden">
          <div className="px-8 pt-8 pb-6 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary-50 shrink-0">
                <ShieldCheck className="h-6 w-6 text-primary-700" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-foreground">
                  {isUpdate
                    ? `${investor.full_name.split(" ")[0]}, your KYC record requires an update`
                    : `As-salamu alaykum, ${investor.full_name.split(" ")[0]} — complete your KYC`}
                </h1>
                <p className="text-sm text-muted mt-0.5">
                  Investor {investor.investor_code} ·{" "}
                  {isUpdate
                    ? "Your existing details are safe — only the new sections below are needed."
                    : "This is required before you can access your MaalGrow portal."}
                </p>
              </div>
            </div>

            {isResubmission && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 p-3">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" />
                <div className="text-xs text-red-800 leading-relaxed">
                  <span className="font-semibold">Your previous submission was not approved.</span>
                  {investor.kyc_notes ? <> Reason: {investor.kyc_notes}</> : null} Please
                  correct your details and submit again.
                </div>
              </div>
            )}

            {isUpdate && (
              <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3">
                <Info className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                <div className="text-xs text-amber-800 leading-relaxed">
                  <span className="font-semibold">
                    Please add: {missing.join(", ")}.
                  </span>{" "}
                  Everything you provided before is already filled in below and
                  does not need to be re-entered.
                </div>
              </div>
            )}
          </div>

          <div className="px-8 py-8">
            <KycForm investor={investor} nextOfKin={nok} isUpdate={isUpdate} />
          </div>
        </div>
        <p className="text-center text-xs text-white/50 mt-6">
          Your information is used solely for identity verification and payout
          processing, in line with regulatory requirements.
        </p>
      </div>
    </div>
  );
}
