import type { Metadata } from "next";
import { AlertCircle, CheckCircle2, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatDate, formatDateTime } from "@/lib/utils";
import { KYC_STATUS_LABEL, KYC_STATUS_VARIANT } from "@/lib/maalrise/format";
import { requireMaalriseInvestorPage } from "@/lib/maalrise/portal-guard";
import { PortalHeading } from "@/components/maalrise/portal-ui";
import { BankChangeForm, CancelBankChange } from "./_bank-change";

export const metadata: Metadata = { title: "My MaalRise Details" };

export default async function MyMaalRiseProfilePage() {
  const { profile: p } = await requireMaalriseInvestorPage();
  return (
    <div className="max-w-3xl space-y-6 animate-fade-in">
      <PortalHeading title="My details" description="Your MaalRise investor record and the bank account your payments go to." />

      <Card>
        <CardHeader><CardTitle className="text-base">Investor record</CardTitle></CardHeader>
        <CardContent>
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-muted">Name</dt><dd className="font-medium">{p.full_name}</dd></div>
            <div><dt className="text-xs text-muted">Investor code</dt><dd className="font-mono">{p.investor_code}</dd></div>
            <div><dt className="text-xs text-muted">Email</dt><dd>{p.email}</dd></div>
            <div><dt className="text-xs text-muted">Phone</dt><dd>{p.phone || "—"}</dd></div>
            <div>
              <dt className="text-xs text-muted">KYC</dt>
              <dd><Badge variant={KYC_STATUS_VARIANT[p.kyc_status] ?? "pending"}>{KYC_STATUS_LABEL[p.kyc_status] ?? p.kyc_status}</Badge></dd>
            </div>
          </dl>
          <p className="mt-4 text-xs text-muted">To correct your name, email or phone, contact MaalVest support.</p>
        </CardContent>
      </Card>

      <Card id="bank">
        <CardHeader>
          <CardTitle className="text-base">Payment account</CardTitle>
          <p className="text-xs text-muted">Every MaalRise payment goes to this account once it is confirmed by MaalVest.</p>
        </CardHeader>
        <CardContent className="space-y-4">
          {p.bank ? (
            <dl className="grid gap-4 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted">Bank</dt><dd className="font-medium">{p.bank.bank_name}</dd></div>
              <div><dt className="text-xs text-muted">Account name</dt><dd className="font-medium">{p.bank.account_name}</dd></div>
              <div><dt className="text-xs text-muted">Account number</dt><dd className="font-mono">{p.bank.account_number}</dd></div>
              <div>
                <dt className="text-xs text-muted">Status</dt>
                <dd>
                  {p.bank.confirmed ? (
                    <span className="flex items-center gap-1 text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Confirmed</span>
                  ) : (
                    <span className="flex items-center gap-1 text-amber-700"><AlertCircle className="h-4 w-4" /> Awaiting confirmation by MaalVest</span>
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">No payment account on record yet.</p>
          )}

          {p.pending_request ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm" data-testid="pending-bank-change">
              <p className="flex items-center gap-1.5 font-medium text-amber-800"><Clock className="h-4 w-4" /> Change waiting for review</p>
              <p className="mt-1 text-amber-900">
                {p.pending_request.bank_name} · {p.pending_request.account_name} ·{" "}
                <span className="font-mono">{p.pending_request.account_number}</span>
              </p>
              <p className="mt-1 text-xs text-amber-800">Requested {formatDateTime(p.pending_request.requested_at)}. Payments go to your confirmed account until it is approved.</p>
              <div className="mt-2"><CancelBankChange id={p.pending_request.id} /></div>
            </div>
          ) : (
            <BankChangeForm />
          )}

          {p.last_decision && !p.pending_request && (
            <p className={`text-xs ${p.last_decision.status === "approved" ? "text-emerald-700" : "text-red-700"}`}>
              {p.last_decision.status === "approved"
                ? `Your change to the account ending ${p.last_decision.account_ending} was approved on ${formatDate(p.last_decision.reviewed_at)}.`
                : `Your change to the account ending ${p.last_decision.account_ending} was not approved on ${formatDate(p.last_decision.reviewed_at)}: ${p.last_decision.reason}`}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
