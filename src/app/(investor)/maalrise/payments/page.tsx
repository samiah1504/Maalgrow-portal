import Link from "next/link";
import type { Metadata } from "next";
import { Download, Printer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { listMyPayments } from "@/lib/maalrise/portal";
import { requireMaalriseInvestorPage } from "@/lib/maalrise/portal-guard";
import { PaymentsTable, PortalHeading } from "@/components/maalrise/portal-ui";

export const metadata: Metadata = { title: "MaalRise Payments" };

export default async function MyPaymentsPage() {
  const { db } = await requireMaalriseInvestorPage();
  const payments = await listMyPayments(db);
  return (
    <div className="space-y-6 animate-fade-in">
      <PortalHeading
        title="Payment history"
        description="Profit and capital payments approved for you, and the date each was transferred. Accounts are shown by their last four digits."
        action={
          <div className="flex flex-wrap gap-2">
            <Link href="/maalrise-statement" target="_blank"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border-2 border-primary-700 px-3 text-xs font-medium text-primary-700 hover:bg-primary-50">
              <Printer className="h-3.5 w-3.5" /> Printable statement
            </Link>
            <a href="/api/maalrise/statement"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary-700 px-3 text-xs font-medium text-white hover:bg-primary-600">
              <Download className="h-3.5 w-3.5" /> Download CSV
            </a>
          </div>
        }
      />
      <Card><CardContent className="pt-6"><PaymentsTable payments={payments} /></CardContent></Card>
    </div>
  );
}
