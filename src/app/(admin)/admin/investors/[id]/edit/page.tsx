import { requireAdminPage } from "@/lib/admin-guard";
import { notFound } from "next/navigation";
import { EditInvestorForm } from "./_edit-form";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Edit Investor | Admin" };

export default async function EditInvestorPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  // Role checked HERE, not only in the middleware. This page reads
  // with the service-role client, so there is no RLS behind it.
  const { supabase } = await requireAdminPage();

  const { id } = await params;

  const { data: investor } = await supabase
    .from("investors")
    .select("*")
    .eq("id", id)
    .single();

  if (!investor) notFound();

  return (
    <div className="max-w-2xl space-y-6 animate-fade-in">
      <Link
        href={`/admin/investors/${id}`}
        className="flex items-center gap-1 text-sm text-muted hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Investor
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-foreground">Edit Investor</h1>
        <p className="text-sm text-muted mt-1">
          {investor.full_name} · {investor.investor_code}
        </p>
      </div>

      <EditInvestorForm investor={investor} />
    </div>
  );
}
