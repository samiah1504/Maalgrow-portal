import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { requireAdminPage } from "@/lib/admin-guard";
import { getInvestorDetail, mr } from "@/lib/maalrise/db";
import { isSampleId } from "@/lib/maalrise/sample-data";
import { canPrepare } from "@/lib/maalrise/permissions";
import { isUuid } from "@/lib/maalrise/api";
import { SampleInvestorDetail } from "./_sample-investor-detail";
import { InvestorDetailView } from "./_investor-detail";

export const metadata: Metadata = { title: "MaalRise Investor | Admin" };

export default async function MaalRiseInvestorDetailsPage({ params }: { params: Promise<{ id: string }> }) {
  const { supabase, role } = await requireAdminPage();
  const { id } = await params;

  if (isSampleId(id)) return <SampleInvestorDetail id={id} />;
  if (!isUuid(id)) notFound();

  const d = await getInvestorDetail(mr(supabase), id);
  if (!d) notFound();
  return <InvestorDetailView d={d} canPrepare={canPrepare(role)} />;
}
