"use client";

import { useState } from "react";
import { AlertCircle, CheckCircle2, Mail } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PhaseNotice } from "@/components/maalrise/sample-notice";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function NewInvestorForm() {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [checked, setChecked] = useState(false);

  const errors: string[] = [];
  if (!EMAIL_RE.test(email.trim())) errors.push("A valid email address is required.");
  if (!fullName.trim()) errors.push("Full name is required.");
  const anyBank = bankName || accountName || accountNumber;
  if (anyBank) {
    if (!bankName.trim() || !accountName.trim()) errors.push("Bank name and account name are both required when bank details are entered.");
    if (!/^\d{10}$/.test(accountNumber)) errors.push("Account number must be 10 digits (NUBAN).");
  }

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); setChecked(true); }}>
      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-base">1. Email and contact</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Input label="Email address" type="email" leftIcon={<Mail className="h-4 w-4" />} value={email}
            onChange={(e) => setEmail(e.target.value)} required
            hint="If this email already has a MaalVest login (for example a MaalGrow investor), MaalRise access is added to that login. Staff accounts cannot be added as investors." />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Full name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
            <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-base">2. Bank details</CardTitle>
          <p className="text-xs text-muted">
            For an existing MaalGrow investor these are pre-filled for review. They stay unconfirmed until an admin confirms
            them, and each payment records the exact account it was sent to.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input label="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Account name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
            <Input label="Account number" inputMode="numeric" maxLength={10} value={accountNumber}
              onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-base">3. KYC</CardTitle></CardHeader>
        <CardContent>
          <ul className="list-disc space-y-1 pl-5 text-sm text-foreground">
            <li>Verified MaalGrow KYC is reused where appropriate and shown as &quot;Verified via MaalGrow&quot;.</li>
            <li>MaalRise-only investors complete MaalRise verification before they can be allocated to an active Cycle.</li>
            <li>Bank details alone never count as completed KYC.</li>
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline"><CheckCircle2 className="h-4 w-4" /> Check details</Button>
        <Button type="button" disabled title="Enabled in Phase 2">Add investor</Button>
      </div>
      <PhaseNotice>
        Phase 1 preview: no account is created, no existing login is changed and no invitation is sent. Adding investors
        is enabled in Phase 2, after the MaalRise tables are approved and tested on staging.
      </PhaseNotice>

      {checked && (
        errors.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 mt-0.5" /> Details look complete. Nothing has been saved.
          </div>
        ) : (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <p className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" /> {errors.length} issue(s)</p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">{errors.map((m) => <li key={m}>{m}</li>)}</ul>
          </div>
        )
      )}
    </form>
  );
}
