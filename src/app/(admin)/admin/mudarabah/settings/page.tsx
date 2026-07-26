import { createClient, createAdminClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ReceiptText } from "lucide-react";
import { mudarabahDb } from "@/lib/mudarabah/db";
import { IssuerForm, type Issuer } from "./_issuer-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Credit Note Settings | Admin" };
export const revalidate = 0;

const ADMIN_ROLES = ["super_admin", "administrator"];

export default async function IssuerSettingsPage() {
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

  const db = mudarabahDb(await createAdminClient());
  const { data } = await db
    .from("wht_issuer_settings")
    .select("company_name, company_address, company_tin, signatory_name, signatory_title")
    .eq("id", 1)
    .maybeSingle();

  const issuer: Issuer = {
    companyName: data?.company_name ?? "",
    companyAddress: data?.company_address ?? "",
    companyTin: data?.company_tin ?? "",
    signatoryName: data?.signatory_name ?? "",
    signatoryTitle: data?.signatory_title ?? "",
  };

  return (
    <div className="space-y-6 animate-fade-in max-w-2xl">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link href="/admin/mudarabah" className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          Mudarabah Ledger
        </Link>
        <span>/</span>
        <span className="text-foreground">Credit note settings</span>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <ReceiptText className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Credit note settings</h1>
          <p className="text-sm text-muted mt-0.5">
            The company details printed on every withholding tax credit note
          </p>
        </div>
      </div>

      <IssuerForm initial={issuer} />
    </div>
  );
}
