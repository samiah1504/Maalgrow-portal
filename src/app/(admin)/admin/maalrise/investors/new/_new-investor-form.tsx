"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, CheckCircle2, Mail, Search, UserPlus } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { PhaseNotice } from "@/components/maalrise/sample-notice";
import { useMaalriseAction } from "@/components/maalrise/use-maalrise-action";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Lookup =
  | { status: "no_login" | "staff" }
  | { status: "already_maalrise"; investor_id: string }
  | {
      status: "can_add";
      name: string;
      maalgrow: { kyc_approved: boolean; bank_name: string | null; account_name: string | null; account_number: string | null } | null;
    };

export function NewInvestorForm() {
  const router = useRouter();
  const { run, busy } = useMaalriseAction();
  const [lookup, setLookup] = useState<{ email: string; result: Lookup } | null>(null);
  const [looking, setLooking] = useState(false);
  const [lookupError, setLookupError] = useState("");
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

  const normalized = email.trim().toLowerCase();
  const found = lookup && lookup.email === normalized ? lookup.result : null;
  const mg = found?.status === "can_add" ? found.maalgrow : null;
  const mgBank = mg?.account_number ? mg : null;

  /** Read only: what adding this email would do. Nothing is created or sent. */
  async function checkEmail() {
    if (!EMAIL_RE.test(normalized)) return;
    setLooking(true);
    setLookupError("");
    try {
      const res = await fetch(`/api/admin/maalrise/investors/lookup?email=${encodeURIComponent(normalized)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setLookupError(data.error ?? "Could not check this email."); return; }
      setLookup({ email: normalized, result: data as Lookup });
      if (data.status === "can_add" && !fullName.trim() && data.name) setFullName(data.name);
    } catch {
      setLookupError("Network error. Please try again.");
    } finally {
      setLooking(false);
    }
  }

  const newLogin = found?.status === "no_login";
  const canAdd = (found?.status === "can_add" || newLogin) && errors.length === 0;

  return (
    <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); setChecked(true); }}>
      <Card>
        <CardHeader className="pb-4"><CardTitle className="text-base">1. Email and contact</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex-1 min-w-[240px]">
              <Input label="Email address" type="email" leftIcon={<Mail className="h-4 w-4" />} value={email}
                onChange={(e) => setEmail(e.target.value)} onBlur={checkEmail} required
                hint="If this email already has a MaalVest login, MaalRise access is added to it. Otherwise a new login is created. Staff accounts cannot be investors." />
            </div>
            <Button type="button" variant="outline" size="sm" onClick={checkEmail} loading={looking} disabled={!EMAIL_RE.test(normalized)}>
              <Search className="h-3.5 w-3.5" /> Check email
            </Button>
          </div>
          {lookupError && <p className="text-xs text-red-700">{lookupError}</p>}
          {found && <LookupResult r={found} />}
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
            Bank details stay unconfirmed until an admin confirms them on the investor&apos;s page, and each payment records
            the exact account it was sent to.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {mgBank && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">MaalGrow bank details on file — used if you leave the fields below empty:</p>
              <p className="mt-1">{mgBank.bank_name} · {mgBank.account_name} · <span className="font-mono">{mgBank.account_number}</span></p>
              <p className="mt-1">They are copied as <strong>unconfirmed</strong> and must be confirmed before any payment.</p>
            </div>
          )}
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
            <li>Every investor completes the same KYC form as MaalGrow on first sign-in; staff review it in KYC Review and MaalRise uses the result.</li>
            <li>A Cycle cannot be activated until every investor in it has verified KYC.</li>
            <li>Bank details alone never count as completed KYC.</li>
          </ul>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="outline"><CheckCircle2 className="h-4 w-4" /> Check details</Button>
        <Button type="button" disabled={!canAdd} loading={busy === "add"}
          title={canAdd ? undefined : "Check the email first"}
          onClick={() => run("add", "/api/admin/maalrise/investors",
            { email: normalized, full_name: fullName, phone, bank_name: bankName, account_name: accountName, account_number: accountNumber,
              create_login: newLogin },
            { success: newLogin ? "Investor created. No email was sent — use “Send invitation” on their page when ready." : "MaalRise access added. No email or invitation was sent.",
              onDone: (d) => { if (typeof d.id === "string") router.push(`/admin/maalrise/investors/${d.id}`); } })}>
          <UserPlus className="h-4 w-4" /> {newLogin ? "Create login and add investor" : "Add investor"}
        </Button>
      </div>
      <PhaseNotice>
        Nothing is emailed when you add an investor. A new person gets a login and an investor record (used for the
        invitation, the KYC form and messages); send the invitation from their page when you are ready. An existing
        login&apos;s MaalGrow investments are not changed.
      </PhaseNotice>

      {checked && (
        errors.length === 0 ? (
          <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
            <CheckCircle2 className="h-4 w-4 mt-0.5" /> Details look complete.{found?.status === "can_add" ? "" : " Check the email to continue."}
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

function LookupResult({ r }: { r: Lookup }) {
  const box = "rounded-lg border p-3 text-xs";
  switch (r.status) {
    case "no_login":
      return (
        <p className={`${box} border-amber-200 bg-amber-50 text-amber-900`}>
          No MaalVest login uses this email. A new login and investor record will be created — nothing is sent. Send the
          invitation from their page when you are ready; they set a password and complete the KYC form on first sign-in.
        </p>
      );
    case "staff":
      return <p className={`${box} border-red-200 bg-red-50 text-red-800`}>This is a staff account. Staff cannot be MaalRise investors.</p>;
    case "already_maalrise":
      return (
        <p className={`${box} border-border bg-surface-2 text-foreground`}>
          This person already has MaalRise access.{" "}
          <Link href={`/admin/maalrise/investors/${r.investor_id}`} className="text-primary-700 hover:underline">Open their record</Link>
        </p>
      );
    case "can_add":
      return (
        <div className={`${box} border-emerald-200 bg-emerald-50 text-emerald-900 space-y-1`}>
          <p className="font-medium">Existing login found{r.name ? `: ${r.name}` : ""}. MaalRise access will be added to it.</p>
          {r.maalgrow ? (
            <p>
              Also a MaalGrow investor.{" "}
              {r.maalgrow.kyc_approved
                ? "Their verified MaalGrow KYC will be reused (shown as “Verified via MaalGrow”)."
                : "Their KYC is not approved yet; once it is approved in KYC Review, MaalRise uses it."}
            </p>
          ) : (
            <p>Not a MaalGrow investor yet. An investor record will be created for the KYC form; they complete it on first sign-in.</p>
          )}
        </div>
      );
  }
}
