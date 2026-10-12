import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { NewInvestorForm } from "./_new-investor-form";

export const metadata: Metadata = { title: "Add MaalRise Investor | Admin" };

export default async function NewMaalRiseInvestorPage() {
  await requireAdminPage(MAALRISE_PREPARE_ROLES);

  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/maalrise/investors"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
          aria-label="Back to MaalRise Investors"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Add MaalRise Investor</h1>
          <p className="text-sm text-muted mt-0.5">Investors are added by email and use the existing MaalVest login.</p>
        </div>
      </div>
      <NewInvestorForm />
    </div>
  );
}
