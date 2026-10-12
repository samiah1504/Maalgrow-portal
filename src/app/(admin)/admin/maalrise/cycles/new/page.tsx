import Link from "next/link";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { NewCycleForm } from "./_new-cycle-form";

export const metadata: Metadata = { title: "New MaalRise Cycle | Admin" };

export default async function NewMaalRiseCyclePage() {
  // Preparing terms is for the roles in D8. Approving them is a
  // different person's job, and is not on this page.
  await requireAdminPage(MAALRISE_PREPARE_ROLES);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link
          href="/admin/maalrise/cycles"
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
          aria-label="Back to MaalRise Cycles"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">New MaalRise Cycle</h1>
          <p className="text-sm text-muted mt-0.5">
            Enter the terms exactly as the contract states them. The breakdown updates as you type.
          </p>
        </div>
      </div>
      <NewCycleForm />
    </div>
  );
}
