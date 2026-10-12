"use client";

import { useState } from "react";
import { CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMaalriseAction } from "@/components/maalrise/use-maalrise-action";

/** Confirm the current bank details, or replace them (which clears any confirmation). */
export function BankActions({
  investorId,
  hasDetails,
  confirmed,
}: {
  investorId: string;
  hasDetails: boolean;
  confirmed: boolean;
}) {
  const { run, busy } = useMaalriseAction();
  const [editing, setEditing] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const url = `/api/admin/maalrise/investors/${investorId}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {hasDetails && !confirmed && (
          <Button size="sm" loading={busy === "confirm"}
            onClick={() => run("confirm", url, { action: "confirm_bank" }, { success: "Bank details confirmed." })}>
            <CheckCircle2 className="h-3.5 w-3.5" /> Confirm these bank details
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setEditing((v) => !v)}>
          {hasDetails ? "Change bank details" : "Add bank details"}
        </Button>
      </div>
      {editing && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <p className="text-xs text-muted">Saving new details clears any previous confirmation; past payments keep the account they were sent to.</p>
          <Input label="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="Account name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            <Input label="Account number" inputMode="numeric" maxLength={10} value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))} />
          </div>
          <Button size="sm" disabled={!bankName.trim() || !accountName.trim() || accountNumber.length !== 10} loading={busy === "set"}
            onClick={async () => {
              if (await run("set", url, { action: "set_bank", bank_name: bankName, account_name: accountName, account_number: accountNumber },
                { success: "Bank details saved — they now need confirming." })) {
                setEditing(false); setBankName(""); setAccountName(""); setAccountNumber("");
              }
            }}>
            Save bank details
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Record a KYC submission received from the investor, and review it.
 * The fields are the minimum the review needs; the full MaalRise KYC
 * form for investors themselves arrives with the investor portal.
 */
export function KycActions({
  investorId,
  kycStatus,
  hasPending,
}: {
  investorId: string;
  kycStatus: string;
  hasPending: boolean;
}) {
  const { run, busy } = useMaalriseAction();
  const [recording, setRecording] = useState(false);
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [dob, setDob] = useState("");
  const [address, setAddress] = useState("");
  const [notes, setNotes] = useState("");
  const url = `/api/admin/maalrise/investors/${investorId}`;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(kycStatus === "not_started" || kycStatus === "rejected") && (
          <Button size="sm" variant="outline" onClick={() => setRecording((v) => !v)}>Record KYC details received</Button>
        )}
        {hasPending && (
          <>
            <Button size="sm" loading={busy === "verify"}
              onClick={() => run("verify", url, { action: "review_kyc", decision: "verified", notes }, { success: "KYC verified." })}>
              <ShieldCheck className="h-3.5 w-3.5" /> Verify KYC
            </Button>
            <Button size="sm" variant="outline" disabled={!notes.trim()} loading={busy === "reject"}
              onClick={() => run("reject", url, { action: "review_kyc", decision: "rejected", notes }, { success: "KYC rejected." })}>
              <XCircle className="h-3.5 w-3.5" /> Reject (reason required)
            </Button>
          </>
        )}
      </div>
      {hasPending && (
        <Input label="Review notes" placeholder="Required to reject; optional to verify" value={notes} onChange={(e) => setNotes(e.target.value)} />
      )}
      {recording && (
        <div className="rounded-lg border border-border p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Input label="ID type" placeholder="e.g. NIN, passport" value={idType} onChange={(e) => setIdType(e.target.value)} />
            <Input label="ID number" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
            <Input label="Date of birth" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            <Input label="Residential address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          <Button size="sm" disabled={!idType.trim() || !idNumber.trim() || !dob || !address.trim()} loading={busy === "record"}
            onClick={async () => {
              if (await run("record", url, { action: "record_kyc", details: { id_type: idType, id_number: idNumber, date_of_birth: dob, address } },
                { success: "KYC details recorded — awaiting review." })) {
                setRecording(false); setIdType(""); setIdNumber(""); setDob(""); setAddress("");
              }
            }}>
            Record for review
          </Button>
        </div>
      )}
    </div>
  );
}
