"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  Copy,
  Mail,
  ExternalLink,
  Download,
  UserPlus,
  AlertCircle,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import { slotLabel, SLOT_VALUE_NGN } from "@/lib/investment-utils";

export type SuccessData = {
  investor: {
    id: string;
    full_name: string;
    investor_code: string;
    email: string;
  };
  investment: {
    id: string;
    investment_code: string;
    units: number;
    capital: number;
    investment_date: string;
    maturity_date: string;
  };
  series_name: string;
  cycle_label: string;
  cycle_start: string;
  cycle_end: string;
  total_paid: number;
  invitation_status: string;
  email_sent: boolean;
  email_error?: string;
};

const INVITATION_STATUS_LABELS: Record<string, string> = {
  sent: "Invitation Sent",
  not_sent: "Not Sent",
  failed: "Delivery Failed",
  activated: "Account Activated",
  expired: "Link Expired",
};

const INVITATION_STATUS_VARIANT: Record<
  string,
  "active" | "pending" | "rejected" | "completed"
> = {
  sent: "active",
  not_sent: "pending",
  failed: "rejected",
  activated: "completed",
  expired: "rejected",
};

interface Props {
  data: SuccessData;
  onAddAnother: () => void;
}

export function SuccessScreen({ data, onAddAnother }: Props) {
  const { investor, investment, series_name, cycle_label, cycle_start, cycle_end, total_paid, invitation_status } = data;

  const [resending, setResending] = useState(false);
  const [currentInvStatus, setCurrentInvStatus] = useState(invitation_status);
  const [downloadingPdf, setDownloadingPdf] = useState(false);

  const siteUrl = typeof window !== "undefined" ? window.location.origin : "";
  const portalLink = `${siteUrl}/login`;

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      toast.success(`${label} copied to clipboard`);
    });
  };

  const handleResend = async () => {
    setResending(true);
    try {
      const res = await fetch(
        `/api/admin/investors/${investor.id}/resend-invitation`,
        { method: "POST" }
      );
      const json = await res.json();
      if (res.ok && json.success) {
        setCurrentInvStatus("sent");
        toast.success("Invitation email resent successfully");
      } else {
        toast.error(json.error ?? "Failed to resend invitation");
      }
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setResending(false);
    }
  };

  const handleDownloadAck = async () => {
    setDownloadingPdf(true);
    try {
      const { downloadAcknowledgementPDF } = await import(
        "@/lib/acknowledgement-pdf"
      );
      await downloadAcknowledgementPDF({
        investorCode: investor.investor_code,
        fullName: investor.full_name,
        email: investor.email,
        investmentCode: investment.investment_code,
        seriesName: series_name,
        cycleLabel: cycle_label,
        slots: investment.units,
        slotValue: SLOT_VALUE_NGN,
        totalInvestment: investment.capital,
        investmentDate: investment.investment_date,
        cycleStart: cycle_start,
        maturityDate: investment.maturity_date,
        acknowledgedAt: new Date().toISOString().split("T")[0],
      });
    } catch (err) {
      toast.error("PDF generation failed — please try again");
      console.error(err);
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Success banner */}
      <div className="rounded-xl border border-green-200 bg-green-50 p-5 flex items-start gap-4">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 flex-shrink-0">
          <CheckCircle2 className="h-6 w-6 text-green-600" />
        </div>
        <div className="flex-1">
          <h2 className="font-bold text-green-900 text-lg leading-tight">
            Investor Added Successfully
          </h2>
          <p className="text-sm text-green-700 mt-1">
            {investor.full_name}&apos;s account and investment allocation have been created.
          </p>

          {/* Invitation status */}
          <div className="mt-3 flex items-center gap-2">
            {currentInvStatus === "sent" ? (
              <div className="flex items-center gap-1.5 text-sm text-green-700">
                <Mail className="h-4 w-4" />
                <span>Invitation email sent to {investor.email}</span>
              </div>
            ) : currentInvStatus === "failed" ? (
              <div className="flex items-center gap-1.5 text-sm text-amber-700">
                <AlertCircle className="h-4 w-4" />
                <span>Invitation email could not be delivered — use Resend below</span>
              </div>
            ) : (
              <div className="flex items-center gap-1.5 text-sm text-muted">
                <Clock className="h-4 w-4" />
                <span>Invitation not yet sent</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Investor code highlight */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs text-muted uppercase tracking-wide font-medium mb-1">
                Investor Code
              </p>
              <p className="text-2xl font-mono font-bold text-primary-700 tracking-widest">
                {investor.investor_code}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() =>
                copyToClipboard(investor.investor_code, "Investor code")
              }
              className="flex items-center gap-1.5"
            >
              <Copy className="h-3.5 w-3.5" />
              Copy Code
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Investment details */}
      <Card>
        <CardContent className="p-5 space-y-4">
          <h3 className="font-semibold text-sm text-foreground">
            Investment Details
          </h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-4 text-sm">
            <div>
              <p className="text-xs text-muted">Full Name</p>
              <p className="font-medium">{investor.full_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Email</p>
              <p className="font-medium break-all">{investor.email}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Series</p>
              <p className="font-medium">Series {series_name}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Cycle</p>
              <p className="font-medium">{cycle_label}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Slots</p>
              <p className="font-medium">{slotLabel(investment.units)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Total Investment</p>
              <p className="font-bold text-foreground">
                {formatCurrency(investment.capital)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted">Cycle Start</p>
              <p className="font-medium">{formatDate(cycle_start)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Maturity Date</p>
              <p className="font-medium">{formatDate(cycle_end)}</p>
            </div>
            <div>
              <p className="text-xs text-muted">Investment Ref</p>
              <p className="font-mono text-xs text-muted">
                {investment.investment_code}
              </p>
            </div>
          </div>

          {/* Payment summary — always paid in full before onboarding */}
          <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted">Amount Paid</span>
              <span className="font-semibold text-green-600">
                {formatCurrency(total_paid)}
              </span>
            </div>
            <div className="flex justify-end">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-50 text-green-700">
                Paid in Full
              </span>
            </div>
          </div>

          {/* Invitation status */}
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted">Invitation Status</span>
            <Badge
              variant={
                INVITATION_STATUS_VARIANT[currentInvStatus] ?? "pending"
              }
              dot
            >
              {INVITATION_STATUS_LABELS[currentInvStatus] ?? currentInvStatus}
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Action buttons */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => copyToClipboard(investor.investor_code, "Investor code")}
          className="flex items-center gap-2"
        >
          <Copy className="h-4 w-4" />
          Copy Investor Code
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={() => copyToClipboard(portalLink, "Portal link")}
          className="flex items-center gap-2"
        >
          <ExternalLink className="h-4 w-4" />
          Copy Portal Link
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={handleResend}
          loading={resending}
          className="flex items-center gap-2"
        >
          <Mail className="h-4 w-4" />
          {resending ? "Sending…" : "Resend Invitation"}
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={handleDownloadAck}
          loading={downloadingPdf}
          className="flex items-center gap-2"
        >
          <Download className="h-4 w-4" />
          {downloadingPdf ? "Generating…" : "Download Acknowledgement"}
        </Button>

        <Button asChild className="flex items-center gap-2">
          <Link href={`/admin/investors/${investor.id}`}>
            <ExternalLink className="h-4 w-4" />
            View Investor Profile
          </Link>
        </Button>

        <Button
          type="button"
          variant="outline"
          onClick={onAddAnother}
          className="flex items-center gap-2"
        >
          <UserPlus className="h-4 w-4" />
          Add Another Investor
        </Button>
      </div>
    </div>
  );
}
