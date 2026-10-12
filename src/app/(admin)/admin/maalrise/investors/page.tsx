import Link from "next/link";
import type { Metadata } from "next";
import { UserPlus, Users, CheckCircle2, AlertCircle } from "lucide-react";
import { requireAdminPage } from "@/lib/admin-guard";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { KYC_STATUS_LABEL, KYC_STATUS_VARIANT } from "@/lib/maalrise/format";
import { SAMPLE_ALLOCATIONS, SAMPLE_AS_OF, SAMPLE_INVESTORS } from "@/lib/maalrise/sample-data";
import { EmptyState, SampleDataBanner, SampleTag, SampleToggle } from "@/components/maalrise/sample-notice";

export const metadata: Metadata = { title: "MaalRise Investors | Admin" };

const STATUS_VARIANT = { invited: "pending", active: "active", suspended: "danger" } as const;

export default async function MaalRiseInvestorsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  await requireAdminPage();
  const showSample = (await searchParams).sample === "1";
  const investors = showSample ? SAMPLE_INVESTORS : [];

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">MaalRise Investors</h1>
          <p className="text-sm text-muted mt-1">
            MaalRise access is separate from MaalGrow. A person may hold either product, or both, with one login.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SampleToggle href="/admin/maalrise/investors" showing={showSample} />
          <Button asChild size="sm">
            <Link href="/admin/maalrise/investors/new" className="flex items-center gap-2">
              <UserPlus className="h-4 w-4" /> Add Investor
            </Link>
          </Button>
        </div>
      </div>

      {showSample && <SampleDataBanner asOf={SAMPLE_AS_OF} />}

      {investors.length === 0 ? (
        <EmptyState icon={<Users className="h-5 w-5" />} title="No MaalRise investors yet">
          Add an investor by email. Existing MaalGrow investors keep their login; MaalRise access is granted alongside it.
        </EmptyState>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-2 text-left">
                    <th className="px-4 py-3 font-medium text-muted">Investor</th>
                    <th className="px-4 py-3 font-medium text-muted">Code</th>
                    <th className="px-4 py-3 font-medium text-muted">KYC</th>
                    <th className="px-4 py-3 font-medium text-muted">Bank details</th>
                    <th className="px-4 py-3 font-medium text-muted">Products</th>
                    <th className="px-4 py-3 text-right font-medium text-muted">Cycles</th>
                    <th className="px-4 py-3 text-center font-medium text-muted">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {investors.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface-2 transition-colors">
                      <td className="px-4 py-3">
                        <Link href={`/admin/maalrise/investors/${inv.id}`} className="font-medium text-primary-700 hover:underline">
                          {inv.fullName}
                        </Link>{" "}
                        <SampleTag />
                        <p className="text-xs text-muted">{inv.email}</p>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{inv.investorCode}</td>
                      <td className="px-4 py-3">
                        <Badge variant={KYC_STATUS_VARIANT[inv.kycStatus]}>{KYC_STATUS_LABEL[inv.kycStatus]}</Badge>
                      </td>
                      <td className="px-4 py-3">
                        {inv.bank.confirmed ? (
                          <span className="flex items-center gap-1 text-xs text-emerald-700"><CheckCircle2 className="h-3.5 w-3.5" /> Confirmed</span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-amber-700"><AlertCircle className="h-3.5 w-3.5" /> {inv.bank.accountNumber ? "Awaiting confirmation" : "Not provided"}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">{inv.alsoMaalGrow ? "MaalRise + MaalGrow" : "MaalRise only"}</td>
                      <td className="px-4 py-3 text-right">{SAMPLE_ALLOCATIONS.filter((a) => a.investorId === inv.id).length}</td>
                      <td className="px-4 py-3 text-center">
                        <Badge variant={STATUS_VARIANT[inv.status]} className="capitalize">{inv.status}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
