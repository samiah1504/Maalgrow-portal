"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  PlusCircle,
  Loader2,
  AlertCircle,
  Pencil,
  Undo2,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { slotLabel } from "@/lib/investment-utils";

export type SeriesOption = {
  id: string;
  name: string;
  price_per_unit: number;
  is_active: boolean;
};

export type CycleOption = {
  id: string;
  series_id: string;
  cycle_label: string;
  cycle_number: number;
  start_date: string;
  end_date: string;
  status: string;
};

export type EnrolmentInfo = {
  investment_id: string;
  series_id: string;
  cycle_id: string;
  units: number;
  capital: number;
  /** Confirmed payments against this enrolment. capital − this = outstanding. */
  confirmed_paid: number;
};

export type PaymentForEdit = {
  id: string;
  series_id: string | null;
  cycle_id: string | null;
  amount: number;
  units: number;
  payment_date: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
  status: string;
};

export type InvestorSummary = {
  id: string;
  full_name: string;
  investor_code: string;
  email: string;
  active_capital: number;
  active_slots: number;
};

const OPEN_CYCLE_STATUSES = ["upcoming", "active", "subscription_open"];
const METHODS = [
  { value: "bank_transfer", label: "Bank Transfer" },
  { value: "cash", label: "Cash" },
  { value: "pos", label: "POS" },
  { value: "cheque", label: "Cheque" },
  { value: "other", label: "Other" },
];

function cycleStatusLabel(status: string) {
  return status
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

interface PaymentDialogProps {
  investor: InvestorSummary;
  series: SeriesOption[];
  cycles: CycleOption[];
  enrolments: EnrolmentInfo[];
  /** Edit mode when set */
  payment?: PaymentForEdit;
  preselectSeriesId?: string;
  preselectCycleId?: string;
  open: boolean;
  onClose: () => void;
}

function PaymentDialog({
  investor,
  series,
  cycles,
  enrolments,
  payment,
  preselectSeriesId,
  preselectCycleId,
  open,
  onClose,
}: PaymentDialogProps) {
  const router = useRouter();
  const isEdit = Boolean(payment);
  const isInstalmentEdit = isEdit && payment!.units === 0;

  const [seriesId, setSeriesId] = useState(
    payment?.series_id ?? preselectSeriesId ?? ""
  );
  const [cycleId, setCycleId] = useState(
    payment?.cycle_id ?? preselectCycleId ?? ""
  );
  const [amount, setAmount] = useState(
    payment ? String(payment.amount) : ""
  );
  const [units, setUnits] = useState(
    payment && payment.units > 0 ? String(payment.units) : ""
  );
  const [paymentDate, setPaymentDate] = useState(
    payment?.payment_date ?? new Date().toISOString().split("T")[0]
  );
  const [method, setMethod] = useState(payment?.method ?? "bank_transfer");
  const [reference, setReference] = useState(payment?.reference ?? "");
  const [notes, setNotes] = useState(payment?.notes ?? "");
  const [status, setStatus] = useState<"confirmed" | "pending">("confirmed");
  const [applyToOutstanding, setApplyToOutstanding] =
    useState(isInstalmentEdit);
  const [confirming, setConfirming] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedSeries = series.find((s) => s.id === seriesId);
  const unitPrice = selectedSeries?.price_per_unit ?? 500000;
  const seriesCycles = useMemo(
    () => cycles.filter((c) => c.series_id === seriesId),
    [cycles, seriesId]
  );
  const selectedCycle = seriesCycles.find((c) => c.id === cycleId);
  const enrolment = enrolments.find((e) => e.cycle_id === cycleId);

  const amountNum = parseFloat(amount) || 0;
  const unitsNum = parseFloat(units) || 0;
  const validStep = unitsNum >= 0.5 && Number.isInteger(unitsNum * 2);
  const amountMatches =
    Math.round(unitsNum * unitPrice * 100) === Math.round(amountNum * 100);

  /*
   * TOPPING UP THE MONEY WITHOUT MOVING THE SLOTS.
   *
   * record_investor_payment has supported this since migration 014
   * (p_apply_to_outstanding), and the API has always passed it
   * through, but nothing in this form ever set it on a NEW payment —
   * it was only ever switched on when editing a payment that already
   * carried no slots. So the only way to record money against an
   * enrolment was to buy slots with it, which is wrong whenever the
   * slots are already right and only the money record is short: a
   * payment reversed in error, or one keyed below what arrived.
   *
   * Offered only where it can actually succeed. The function refuses
   * an instalment with no enrolment to attach to, and refuses one
   * larger than the outstanding balance, so a toggle that appears
   * without an enrolment would only ever produce an error.
   */
  const outstanding = enrolment
    ? Math.round((enrolment.capital - enrolment.confirmed_paid) * 100) / 100
    : 0;
  const canTopUp = !isEdit && Boolean(enrolment) && outstanding > 0.005;
  const overOutstanding =
    applyToOutstanding && !isEdit && amountNum > outstanding + 0.005;

  const handleSeriesChange = (id: string) => {
    setSeriesId(id);
    setApplyToOutstanding(false);
    // Auto-select when the series has exactly one open cycle
    const open = cycles.filter(
      (c) => c.series_id === id && OPEN_CYCLE_STATUSES.includes(c.status)
    );
    setCycleId(open.length === 1 ? open[0].id : "");
  };

  const syncFromAmount = (value: string) => {
    setAmount(value);
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0 && unitPrice > 0) {
      const slots = num / unitPrice;
      setUnits(Number.isInteger(slots * 2) ? String(slots) : slots.toFixed(2));
    } else {
      setUnits("");
    }
  };

  const syncFromUnits = (value: string) => {
    setUnits(value);
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      setAmount(String(Math.round(num * unitPrice * 100) / 100));
    } else {
      setAmount("");
    }
  };

  const validate = (): string | null => {
    if (!seriesId) return "Select a series for this payment.";
    if (!cycleId) return "Select a cycle for this payment.";
    if (!paymentDate) return "Payment date is required.";
    if (!amount || isNaN(amountNum) || amountNum <= 0)
      return "Enter a payment amount greater than 0.";
    if (applyToOutstanding) {
      // No slots change hands: amount only. The one ceiling is the
      // outstanding balance, checked here so the message arrives
      // before the round trip — the function enforces it regardless.
      if (overOutstanding) {
        return `${formatCurrency(amountNum)} is more than the ${formatCurrency(
          outstanding
        )} outstanding on this enrolment. To add slots as well, clear the tick box.`;
      }
      return null;
    }
    if (!validStep)
      return "Slots must be at least 0.5, in steps of 0.5 (e.g. 0.5, 1, 1.5, 2).";
    if (!amountMatches)
      return `The amount does not match ${slotLabel(unitsNum)} at ${formatCurrency(unitPrice)} per slot (expected ${formatCurrency(unitsNum * unitPrice)}).`;
    return null;
  };

  const handleReview = () => {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    setConfirming(true);
  };

  const handleSubmit = async () => {
    setIsSubmitting(true);
    setError(null);
    try {
      const payload = {
        series_id: seriesId,
        cycle_id: cycleId,
        amount: amountNum,
        units: applyToOutstanding ? 0 : unitsNum,
        payment_date: paymentDate,
        method,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      };
      const res = isEdit
        ? await fetch(`/api/admin/payments/${payment!.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "edit", ...payload }),
          })
        : await fetch("/api/admin/payments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              ...payload,
              investor_id: investor.id,
              status,
              apply_to_outstanding: applyToOutstanding,
            }),
          });
      const json = await res.json();
      if (!res.ok) {
        setConfirming(false);
        setError(json.error ?? "Failed to save the payment.");
        return;
      }
      toast.success(isEdit ? "Payment updated" : "Payment recorded");
      onClose();
      router.refresh();
    } catch {
      setConfirming(false);
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const inputCls =
    "h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isEdit ? "Edit Payment" : "Add New Payment"}
          </DialogTitle>
          <DialogDescription>
            Every payment is allocated to a series and cycle and reflects on
            the investor&apos;s portal immediately.
          </DialogDescription>
        </DialogHeader>

        {confirming ? (
          <div className="px-6 py-4 space-y-4">
            <div className="rounded-lg bg-primary-50 border border-primary-200 p-4 text-sm text-primary-900">
              You are {isEdit ? "updating this payment to" : "adding"}{" "}
              <strong>{formatCurrency(amountNum)}</strong>
              {applyToOutstanding ? (
                <>
                  {" "}
                  as money only — <strong>no new slots</strong>, toward the
                  outstanding balance
                </>
              ) : (
                <>
                  , equal to <strong>{slotLabel(unitsNum)}</strong>,
                </>
              )}{" "}
              for <strong>{investor.full_name}</strong> under{" "}
              <strong>Series {selectedSeries?.name}</strong>,{" "}
              <strong>{selectedCycle?.cycle_label}</strong>.
            </div>
            <div className="rounded-lg border border-border divide-y divide-border text-sm">
              {[
                ["Investor", `${investor.full_name} (${investor.investor_code})`],
                ["Series", `Series ${selectedSeries?.name ?? "—"}`],
                ["Cycle", selectedCycle?.cycle_label ?? "—"],
                ["Amount", formatCurrency(amountNum)],
                [
                  "Slots",
                  applyToOutstanding
                    ? "No new slots (instalment)"
                    : slotLabel(unitsNum),
                ],
                ["Payment date", formatDate(paymentDate)],
                ...(isEdit ? [] : [["Status", status === "pending" ? "Pending (no allocation until confirmed)" : "Confirmed"]]),
              ].map(([k, v]) => (
                <div key={k as string} className="flex justify-between px-3 py-2">
                  <span className="text-muted">{k}</span>
                  <span className="font-medium text-right">{v}</span>
                </div>
              ))}
            </div>
            {error && (
              <p className="text-xs text-red-700 flex items-start gap-1.5">
                <AlertCircle className="h-4 w-4 flex-shrink-0" /> {error}
              </p>
            )}
            <DialogFooter className="px-0">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirming(false)}
                disabled={isSubmitting}
              >
                Back
              </Button>
              <Button size="sm" onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : null}
                Confirm &amp; Save
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="px-6 py-4 space-y-4">
            {/* Investor (preselected, read only) */}
            <div className="rounded-lg bg-surface-2 border border-border p-3 text-sm space-y-0.5">
              <p className="font-semibold text-foreground">
                {investor.full_name}{" "}
                <span className="font-mono text-xs text-muted">
                  {investor.investor_code}
                </span>
              </p>
              <p className="text-xs text-muted">{investor.email}</p>
              <p className="text-xs text-muted">
                Current active investment:{" "}
                <span className="font-medium text-foreground">
                  {formatCurrency(investor.active_capital)}
                </span>{" "}
                · {slotLabel(investor.active_slots)}
              </p>
            </div>

            {/* Series */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Select Series <span className="text-danger">*</span>
              </label>
              <select
                value={seriesId}
                onChange={(e) => handleSeriesChange(e.target.value)}
                disabled={isInstalmentEdit}
                className={inputCls}
              >
                <option value="">— Choose a series —</option>
                {series.map((s) => (
                  <option key={s.id} value={s.id} disabled={!s.is_active}>
                    Series {s.name} · {formatCurrency(s.price_per_unit)}/slot ·{" "}
                    {s.is_active ? "Active" : "Inactive"}
                  </option>
                ))}
              </select>
            </div>

            {/* Cycle */}
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Select Cycle <span className="text-danger">*</span>
              </label>
              <select
                value={cycleId}
                onChange={(e) => {
                  setCycleId(e.target.value);
                  setApplyToOutstanding(false);
                }}
                disabled={!seriesId || isInstalmentEdit}
                className={inputCls}
              >
                <option value="">
                  {seriesId ? "— Choose a cycle —" : "Select a series first"}
                </option>
                {seriesCycles.map((c) => (
                  <option
                    key={c.id}
                    value={c.id}
                    disabled={!OPEN_CYCLE_STATUSES.includes(c.status)}
                  >
                    {c.cycle_label} · {formatDate(c.start_date)} →{" "}
                    {formatDate(c.end_date)} · {cycleStatusLabel(c.status)}
                  </option>
                ))}
              </select>
              {enrolment && !applyToOutstanding && (
                <p className="text-xs text-muted">
                  Already enrolled in this cycle with{" "}
                  {slotLabel(enrolment.units)} (
                  {formatCurrency(enrolment.capital)}) — this payment will be
                  added to the existing enrolment.
                </p>
              )}

              {canTopUp && (
                <label className="flex items-start gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={applyToOutstanding}
                    onChange={(e) => {
                      setApplyToOutstanding(e.target.checked);
                      setUnits("");
                      if (e.target.checked) setAmount(String(outstanding));
                    }}
                    className="mt-0.5"
                  />
                  <span className="text-xs text-foreground">
                    <strong>Money only — add no slots.</strong>
                    <span className="block text-muted mt-0.5">
                      This enrolment holds {slotLabel(enrolment!.units)} worth{" "}
                      {formatCurrency(enrolment!.capital)} but only{" "}
                      {formatCurrency(enrolment!.confirmed_paid)} is confirmed
                      against it — {formatCurrency(outstanding)} outstanding.
                      Tick this when the slots are already right and it is the
                      payment record that is short, such as a payment reversed
                      in error.
                    </span>
                  </span>
                </label>
              )}
            </div>

            {/* Amount + slots */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                  Amount Paid (₦) <span className="text-danger">*</span>
                </label>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  value={amount}
                  onChange={(e) =>
                    applyToOutstanding
                      ? setAmount(e.target.value)
                      : syncFromAmount(e.target.value)
                  }
                  placeholder="e.g. 500000"
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                  Slots {applyToOutstanding ? "" : <span className="text-danger">*</span>}
                </label>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  value={applyToOutstanding ? "" : units}
                  onChange={(e) => syncFromUnits(e.target.value)}
                  disabled={applyToOutstanding}
                  placeholder={applyToOutstanding ? "No new slots" : "e.g. 1"}
                  className={inputCls}
                />
              </div>
            </div>
            {!applyToOutstanding && amountNum > 0 && (
              <p
                className={`text-xs ${
                  validStep && amountMatches ? "text-muted" : "text-red-600"
                }`}
              >
                {formatCurrency(amountNum)} ={" "}
                {unitPrice > 0 ? (amountNum / unitPrice).toFixed(2) : "—"}{" "}
                slot(s) at {formatCurrency(unitPrice)} per slot
                {validStep && amountMatches
                  ? ""
                  : " — amount must equal slots × slot value, in 0.5-slot steps"}
              </p>
            )}

            {/* Date + method */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                  Payment Date <span className="text-danger">*</span>
                </label>
                <input
                  type="date"
                  value={paymentDate}
                  onChange={(e) => setPaymentDate(e.target.value)}
                  className={inputCls}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                  Payment Method
                </label>
                <select
                  value={method}
                  onChange={(e) => setMethod(e.target.value)}
                  className={inputCls}
                >
                  {METHODS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <Input
              label="Payment Reference"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TXN123456 (must be unique)"
            />
            <Input
              label="Notes (optional)"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal note"
            />

            {!isEdit && (
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                  Payment Status
                </label>
                <select
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value === "pending" ? "pending" : "confirmed")
                  }
                  className={inputCls}
                >
                  <option value="confirmed">
                    Confirmed — counts toward the investment immediately
                  </option>
                  <option value="pending">
                    Pending — held until confirmed, no allocation yet
                  </option>
                </select>
              </div>
            )}

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}

            <DialogFooter className="px-0">
              <Button variant="outline" size="sm" onClick={onClose}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleReview}>
                Review &amp; Save
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Add button (investor level) ─────────────────────────────

interface AddPaymentButtonProps {
  investor: InvestorSummary;
  series: SeriesOption[];
  cycles: CycleOption[];
  enrolments: EnrolmentInfo[];
  preselectSeriesId?: string;
  preselectCycleId?: string;
  variant?: "primary" | "outline";
  label?: string;
}

export function AddPaymentButton({
  investor,
  series,
  cycles,
  enrolments,
  preselectSeriesId,
  preselectCycleId,
  variant = "primary",
  label = "Add New Payment",
}: AddPaymentButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        variant={variant === "primary" ? "default" : "outline"}
        size="sm"
        onClick={() => setOpen(true)}
      >
        <PlusCircle className="h-4 w-4" />
        {label}
      </Button>
      {open && (
        <PaymentDialog
          investor={investor}
          series={series}
          cycles={cycles}
          enrolments={enrolments}
          preselectSeriesId={preselectSeriesId}
          preselectCycleId={preselectCycleId}
          open={open}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

// ─── Per-payment actions (edit / reverse / confirm / reject) ─

interface PaymentRowActionsProps {
  investor: InvestorSummary;
  series: SeriesOption[];
  cycles: CycleOption[];
  enrolments: EnrolmentInfo[];
  payment: PaymentForEdit;
}

export function PaymentRowActions({
  investor,
  series,
  cycles,
  enrolments,
  payment,
}: PaymentRowActionsProps) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const act = async (action: "reverse" | "confirm" | "reject") => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/payments/${payment.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason.trim() || undefined }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Action failed.");
        return false;
      }
      toast.success(
        action === "reverse"
          ? "Payment reversed"
          : action === "confirm"
          ? "Payment confirmed"
          : "Payment rejected"
      );
      router.refresh();
      return true;
    } catch {
      setError("Network error. Please try again.");
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (payment.status === "reversed" || payment.status === "rejected") {
    return null;
  }

  return (
    <span className="flex items-center gap-1">
      {payment.status === "pending" && (
        <>
          <button
            title="Confirm payment"
            disabled={busy}
            onClick={() => act("confirm")}
            className="rounded p-1 text-green-600 hover:bg-green-50"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
          </button>
          <button
            title="Reject payment"
            disabled={busy}
            onClick={() => act("reject")}
            className="rounded p-1 text-red-500 hover:bg-red-50"
          >
            <XCircle className="h-3.5 w-3.5" />
          </button>
        </>
      )}
      <button
        title="Edit payment"
        onClick={() => setEditOpen(true)}
        className="rounded p-1 text-muted hover:bg-surface-2 hover:text-foreground"
      >
        <Pencil className="h-3.5 w-3.5" />
      </button>
      {payment.status === "confirmed" && (
        <button
          title="Reverse payment"
          onClick={() => setReverseOpen(true)}
          className="rounded p-1 text-amber-600 hover:bg-amber-50"
        >
          <Undo2 className="h-3.5 w-3.5" />
        </button>
      )}

      {editOpen && (
        <PaymentDialog
          investor={investor}
          series={series}
          cycles={cycles}
          enrolments={enrolments}
          payment={payment}
          open={editOpen}
          onClose={() => setEditOpen(false)}
        />
      )}

      <Dialog open={reverseOpen} onOpenChange={(o) => !o && setReverseOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Reverse Payment</DialogTitle>
            <DialogDescription>
              {formatCurrency(payment.amount)}
              {payment.units > 0 ? ` · ${slotLabel(payment.units)}` : ""} — the
              allocation will be removed and totals recalculated. The payment
              record is kept for audit purposes.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3">
            <Input
              label="Reason for reversal"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. recorded in error"
              required
            />
            {error && <p className="text-xs text-red-700">{error}</p>}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setReverseOpen(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy || reason.trim().length === 0}
              onClick={async () => {
                const ok = await act("reverse");
                if (ok) setReverseOpen(false);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Reverse Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </span>
  );
}
