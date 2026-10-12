import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { ArrowLeft } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { MAALRISE_PREPARE_ROLES } from "@/lib/maalrise/permissions";
import { getCycleDetail, mr } from "@/lib/maalrise/db";
import { isUuid } from "@/lib/maalrise/api";
import { NewCycleForm } from "../../new/_new-cycle-form";

export const metadata: Metadata = { title: "MaalRise Cycle Terms | Admin" };

/**
 * Prepare or edit a Cycle's draft terms. Starts from the open draft if
 * there is one, otherwise from the approved version (a new version
 * leaves the approved one frozen until it is itself approved).
 */
export default async function MaalRiseCycleTermsPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase } = await requireAdminPage(MAALRISE_PREPARE_ROLES);
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const d = await getCycleDetail(mr(supabase), id);
  if (!d) notFound();

  // Submitted terms are with the approver; anything past approval is not editable here.
  const editable = ["draft", "terms_approved"].includes(d.cycle.status) && (!d.open || d.open.status === "draft");
  if (!editable) redirect(`/admin/maalrise/cycles/${id}`);

  const base = d.open ?? d.approved;
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center gap-3">
        <Link
          href={`/admin/maalrise/cycles/${id}`}
          className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
          aria-label="Back to the Cycle"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold text-foreground">{d.cycle.name}: {d.open ? "edit draft terms" : base ? "prepare a new version" : "prepare terms"}</h1>
          <p className="text-sm text-muted mt-0.5">
            Enter the terms exactly as the contract states them. Saving keeps them as a draft until submitted and approved.
          </p>
        </div>
      </div>
      <NewCycleForm
        counterparties={[]}
        edit={{
          cycle: { ...d.cycle, counterparty_name: d.counterparty?.name ?? "—" },
          terms: base,
          schedule: base ? d.schedules[base.id] ?? [] : [],
        }}
      />
    </div>
  );
}
