"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { toast } from "sonner";
import { getPaymentStatus, SLOT_VALUE_NGN } from "@/lib/investment-utils";

type InvestmentForAck = {
  id: string;
  investment_code: string;
  units: number;
  capital: number;
  investment_date: string;
  maturity_date: string;
  series: { name: string } | null;
  cycle: { cycle_label: string; start_date: string; end_date: string } | null;
};

interface Props {
  investorCode: string;
  fullName: string;
  email: string;
  investment: InvestmentForAck;
  totalPaid: number;
}

export function AcknowledgementDownloadButton({
  investorCode,
  fullName,
  email,
  investment,
  totalPaid,
}: Props) {
  const [loading, setLoading] = useState(false);

  const handleDownload = async () => {
    setLoading(true);
    try {
      const { downloadAcknowledgementPDF } = await import(
        "@/lib/acknowledgement-pdf"
      );
      const outstanding = Math.max(0, investment.capital - totalPaid);
      const payStatus = getPaymentStatus(investment.capital, totalPaid);

      await downloadAcknowledgementPDF({
        investorCode,
        fullName,
        email,
        investmentCode: investment.investment_code,
        seriesName: investment.series?.name ?? "—",
        cycleLabel: investment.cycle?.cycle_label ?? "—",
        slots: investment.units,
        slotValue: SLOT_VALUE_NGN,
        totalInvestment: investment.capital,
        totalPaid,
        outstandingBalance: outstanding,
        paymentStatus: payStatus,
        investmentDate: investment.investment_date,
        cycleStart: investment.cycle?.start_date ?? "",
        maturityDate: investment.maturity_date,
        acknowledgedAt: new Date().toISOString().split("T")[0],
      });
    } catch (err) {
      toast.error("PDF generation failed — please try again");
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleDownload}
      disabled={loading}
      className="inline-flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700 hover:underline disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      title="Download investment acknowledgement PDF"
    >
      <Download className="h-3 w-3" />
      {loading ? "Generating…" : "Acknowledgement"}
    </button>
  );
}
