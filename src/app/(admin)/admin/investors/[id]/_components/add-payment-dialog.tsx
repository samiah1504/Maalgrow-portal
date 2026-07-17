"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlusCircle, Loader2, AlertCircle } from "lucide-react";
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
import { formatCurrency } from "@/lib/utils";
import { slotLabel } from "@/lib/investment-utils";

interface Props {
  investmentId: string;
  investmentCode: string;
  capital: number;
  units: number;
  totalPaid: number;
}

export function AddPaymentDialog({
  investmentId,
  investmentCode,
  capital,
  units,
  totalPaid,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [reference, setReference] = useState("");

  const balance = capital - totalPaid;

  const handleSubmit = async () => {
    setError(null);
    const amountNum = parseFloat(amount);

    if (!amount || isNaN(amountNum) || amountNum <= 0) {
      setError("Please enter a valid amount greater than 0.");
      return;
    }
    if (!paymentDate) {
      setError("Payment date is required.");
      return;
    }

    setIsSubmitting(true);

    try {
      const res = await fetch(
        `/api/admin/investments/${investmentId}/payments`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: amountNum,
            payment_date: paymentDate,
            reference: reference.trim() || null,
          }),
        }
      );

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Failed to record payment.");
        return;
      }

      toast.success("Payment recorded successfully");
      setOpen(false);
      setAmount("");
      setReference("");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <PlusCircle className="h-4 w-4" />
        Add Payment
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add Payment</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs">{investmentCode}</span> ·{" "}
              {slotLabel(units)} · {formatCurrency(capital)}
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4">
            {/* Balance summary */}
            <div className="rounded-lg bg-surface-2 border border-border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted">Investment amount</span>
                <span className="font-medium">{formatCurrency(capital)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Previously paid</span>
                <span className="font-medium">{formatCurrency(totalPaid)}</span>
              </div>
              <div className="flex justify-between border-t border-border pt-1">
                <span className="font-semibold">Outstanding</span>
                <span
                  className={`font-bold ${
                    balance > 0
                      ? "text-amber-600"
                      : balance === 0
                      ? "text-green-600"
                      : "text-blue-600"
                  }`}
                >
                  {formatCurrency(Math.max(0, balance))}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Amount (₦) <span className="text-danger">*</span>
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="e.g. 500000"
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Payment Date <span className="text-danger">*</span>
              </label>
              <input
                type="date"
                value={paymentDate}
                onChange={(e) => setPaymentDate(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>

            <Input
              label="Reference / Note (optional)"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. TXN123456"
            />

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setOpen(false)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSubmit} disabled={isSubmitting}>
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : null}
              Record Payment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
