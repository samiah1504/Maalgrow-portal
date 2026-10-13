"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useMaalriseAction } from "@/components/maalrise/use-maalrise-action";

/** Ask for a different payment account. Staff review it before any payment uses it. */
export function BankChangeForm() {
  const { run, busy } = useMaalriseAction();
  const [open, setOpen] = useState(false);
  const [bankName, setBankName] = useState("");
  const [accountName, setAccountName] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  if (!open) {
    return <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Request a change of bank details</Button>;
  }
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-xs text-muted">
        MaalVest reviews every change before it is used. Until then, payments keep going to your confirmed account.
      </p>
      <Input label="Bank name" value={bankName} onChange={(e) => setBankName(e.target.value)} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Account name" value={accountName} onChange={(e) => setAccountName(e.target.value)} />
        <Input label="Account number (10 digits)" inputMode="numeric" maxLength={10} value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" disabled={!bankName.trim() || !accountName.trim() || accountNumber.length !== 10} loading={busy === "request"}
          onClick={async () => {
            if (await run("request", "/api/maalrise/bank-change",
              { bank_name: bankName, account_name: accountName, account_number: accountNumber },
              { success: "Request sent. We'll let you know when it has been reviewed." })) {
              setOpen(false); setBankName(""); setAccountName(""); setAccountNumber("");
            }
          }}>
          Submit for review
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
      </div>
    </div>
  );
}

export function CancelBankChange({ id }: { id: string }) {
  const { run, busy } = useMaalriseAction();
  return (
    <Button size="xs" variant="outline" loading={busy === "cancel"}
      onClick={() => run("cancel", `/api/maalrise/bank-change/${id}`, {}, { method: "DELETE", success: "Request withdrawn." })}>
      Withdraw request
    </Button>
  );
}
