import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-guard";
import { getCycleDetail, listInvestors, mr } from "@/lib/maalrise/db";
import { isSampleId } from "@/lib/maalrise/sample-data";
import { activationEnabled, canApprove, canFinance, canPrepare } from "@/lib/maalrise/permissions";
import { isUuid } from "@/lib/maalrise/api";
import { SampleCycleDetail } from "./_sample-cycle-detail";
import { CycleDetailView } from "./_cycle-detail";

export const metadata: Metadata = { title: "MaalRise Cycle | Admin" };

export default async function MaalRiseCycleDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, user, role } = await requireAdminPage();
  const { id } = await params;

  // The labelled sample preview keeps its own ids; everything else is real.
  if (isSampleId(id)) return <SampleCycleDetail id={id} />;
  if (!isUuid(id)) notFound();

  const db = mr(supabase);
  const d = await getCycleDetail(db, id);
  if (!d) notFound();

  const investors = canFinance(role) ? await listInvestors(db) : [];
  return (
    <CycleDetailView
      d={d}
      me={user.id}
      role={role}
      permissions={{ prepare: canPrepare(role), approve: canApprove(role), finance: canFinance(role) }}
      activationOn={activationEnabled()}
      investorOptions={investors.map((i) => ({ id: i.id, label: `${i.full_name} (${i.investor_code})` }))}
    />
  );
}
