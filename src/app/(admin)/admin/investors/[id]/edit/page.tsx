import { createClient } from "@/lib/supabase/server";
import { redirect, notFound } from "next/navigation";
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
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

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
