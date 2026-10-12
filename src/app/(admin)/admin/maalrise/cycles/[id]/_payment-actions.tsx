"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, RefreshCw, ShieldCheck, Upload, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/utils";
import { formatKobo, parseNairaToKobo } from "@/lib/maalrise/format";
import { useMaalriseAction } from "@/components/maalrise/use-maalrise-action";

const selectClass =
  "flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

export type MonthOption = { period: number; dueDate: string; outstandingKobo: number; scheduledKobo: number };

/**
 * Record a payment received from the counterparty. The scheduled date
 * and the date the money actually arrived are separate: the person
 * enters the real date, even when entering it late.
 */
export function RecordPaymentForm({
  cycleId,
  counterparty,
  months,
  suggested,
  today,
  canConfirm,
}: {
  cycleId: string;
  counterparty: string;
  months: MonthOption[];
  suggested: number | null;
  today: string;
  canConfirm: boolean;
}) {
  const { run, busy } = useMaalriseAction();
  const [period, setPeriod] = useState(suggested ? String(suggested) : "");
  const [amount, setAmount] = useState("");
  const [receivedOn, setReceivedOn] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [confirmNow, setConfirmNow] = useState(false);
  const kobo = parseNairaToKobo(amount);
  const month = months.find((m) => String(m.period) === period);
  const over = month && kobo ? kobo - month.outstandingKobo : 0;
  const ready = !!month && !!kobo && kobo > 0 && !!receivedOn && receivedOn <= today;

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-sm font-medium">Record a payment received from {counterparty}</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <label htmlFor="receipt-month" className="block text-sm font-medium">Month it is for</label>
          <select id="receipt-month" value={period} onChange={(e) => setPeriod(e.target.value)} className={selectClass}>
            <option value="">Select…</option>
            {months.map((m) => (
              <option key={m.period} value={m.period}>
                {`Month ${m.period} — scheduled ${formatDate(m.dueDate)} — ${m.outstandingKobo ? `${formatKobo(m.outstandingKobo)} outstanding` : "fully received"}`}
              </option>
            ))}
          </select>
        </div>
        <Input label="Amount received (₦)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)}
          hint={kobo ? formatKobo(kobo) : "As it arrived in the bank"} />
        <Input label="Date received" type="date" max={today} value={receivedOn} onChange={(e) => setReceivedOn(e.target.value)}
          hint="The actual date — not the scheduled date" />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Payment reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Input label="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
      {month && over > 0 && (
        <p className="text-xs text-amber-800 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          {`${formatKobo(over)} is more than is outstanding for month ${month.period}. The excess will be held, not distributed.`}
        </p>
      )}
      {month && kobo && kobo < month.outstandingKobo && (
        <p className="text-xs text-muted">
          {`Part-payment: ${formatKobo(month.outstandingKobo - kobo)} will remain outstanding for month ${month.period}. Only the money received is distributed.`}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {canConfirm && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} className="h-4 w-4" />
            Confirm now — I have checked this payment against the bank
          </label>
        )}
        <Button size="sm" disabled={!ready} loading={busy === "record"}
          onClick={async () => {
            if (await run("record", `/api/admin/maalrise/cycles/${cycleId}/receipts`,
              { period: Number(period), amount_kobo: kobo, received_on: receivedOn, reference, notes, confirm_now: confirmNow },
              { success: confirmNow ? "Payment recorded and confirmed. The distribution is ready for review." : "Payment recorded — awaiting confirmation." })) {
              setAmount(""); setReceivedOn(""); setReference(""); setNotes(""); setConfirmNow(false);
            }
          }}>
          Record payment
        </Button>
      </div>
    </div>
  );
}

/** Confirm (admins, including their own entry) or reject with a reason. */
export function ReceiptActions({ receiptId }: { receiptId: string }) {
  const { run, busy } = useMaalriseAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const url = `/api/admin/maalrise/receipts/${receiptId}`;
  return (
    <div className="flex flex-col items-end gap-1">
      <span className="inline-flex gap-1">
        <Button size="xs" loading={busy === "confirm"}
          onClick={() => run("confirm", url, { action: "confirm" }, { success: "Payment confirmed. The distribution has been calculated for review." })}>
          <CheckCircle2 className="h-3 w-3" /> Confirm
        </Button>
        <Button size="xs" variant="outline" onClick={() => setRejecting((v) => !v)}>
          <XCircle className="h-3 w-3" /> Reject
        </Button>
      </span>
      {rejecting && (
        <span className="flex gap-1">
          <input className="h-7 rounded-md border border-border px-2 text-xs" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
          <Button size="xs" variant="destructive" disabled={!reason.trim()} loading={busy === "reject"}
            onClick={async () => { if (await run("reject", url, { action: "reject", reason }, { success: "Entry rejected." })) { setRejecting(false); setReason(""); } }}>
            Reject
          </Button>
        </span>
      )}
    </div>
  );
}

/** Approve a prepared distribution, or refresh its bank snapshots first. */
export function DistributionActions({ distributionId, blocked }: { distributionId: string; blocked: boolean }) {
  const { run, busy } = useMaalriseAction();
  const url = `/api/admin/maalrise/distributions/${distributionId}`;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={blocked} loading={busy === "approve"}
        title={blocked ? "Every investor needs confirmed bank details first" : undefined}
        onClick={() => run("approve", url, { action: "approve" }, { success: "Distribution approved. The payments are ready to be made and marked paid." })}>
        <ShieldCheck className="h-3.5 w-3.5" /> Approve distribution
      </Button>
      <Button size="sm" variant="outline" loading={busy === "refresh"}
        onClick={() => run("refresh", url, { action: "refresh" }, { success: "Recalculated with each investor's current confirmed bank details." })}>
        <RefreshCw className="h-3.5 w-3.5" /> Refresh bank details
      </Button>
    </div>
  );
}

/** Upload the contract or a supporting document to private storage. */
export function DocumentUpload({ cycleId, hasContract }: { cycleId: string; hasContract: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [category, setCategory] = useState(hasContract ? "supporting" : "contract");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function upload() {
    if (!file) return;
    setBusy(true);
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("category", category);
      const res = await fetch(`/api/admin/maalrise/cycles/${cycleId}/documents`, { method: "POST", body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(typeof data.error === "string" ? data.error : "Upload failed."); return; }
      toast.success(category === "contract" ? "Contract uploaded." : "Document uploaded.");
      setFile(null);
      if (input.current) input.current.value = "";
      router.refresh();
    } catch {
      toast.error("Network error. Nothing was uploaded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <p className="text-sm font-medium">Upload a document</p>
      <div className="grid gap-3 sm:grid-cols-[200px_1fr_auto] sm:items-end">
        <div className="space-y-1.5">
          <label htmlFor="doc-category" className="block text-sm font-medium">Type</label>
          <select id="doc-category" value={category} onChange={(e) => setCategory(e.target.value)} className={selectClass}>
            <option value="contract">Original contract</option>
            <option value="supporting">Supporting document</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor="doc-file" className="block text-sm font-medium">File (PDF, Word or image, up to 15 MB)</label>
          <input id="doc-file" ref={input} type="file" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-2 file:text-sm file:text-primary-700" />
        </div>
        <Button size="sm" disabled={!file} loading={busy} onClick={upload}>
          <Upload className="h-3.5 w-3.5" /> Upload
        </Button>
      </div>
      <p className="text-xs text-muted">Stored privately; only staff can open it. Monthly bank receipts are not uploaded — payments are recorded above.</p>
    </div>
  );
}
