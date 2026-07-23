"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, AlertCircle, SlidersHorizontal, ArrowRight } from "lucide-react";
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
  currentUnits: number;
  currentCapital: number;
  pricePerUnit: number;
}

export function EditSlotsDialog({
  investmentId,
  investmentCode,
  currentUnits,
  currentCapital,
  pricePerUnit,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [units, setUnits] = useState(String(currentUnits));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const unitsNum = parseFloat(units) || 0;
  const validStep = unitsNum >= 0.5 && Number.isInteger(unitsNum * 2);
  const newCapital = Math.round(unitsNum * pricePerUnit * 100) / 100;
  const changed = validStep && unitsNum !== currentUnits;

  const handleSave = async () => {
    if (!validStep) {
      setError("Slots must be at least 0.5, in steps of 0.5 (e.g. 0.5, 1, 1.5, 2).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/investments/${investmentId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_slots",
          units: unitsNum,
          reason: reason.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to update slots.");
        return;
      }
      toast.success(`Slots updated to ${slotLabel(unitsNum)}`);
      setOpen(false);
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => { setUnits(String(currentUnits)); setReason(""); setError(null); setOpen(true); }}>
        <SlidersHorizontal className="h-4 w-4" />
        Edit Slots
      </Button>

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit Slots</DialogTitle>
            <DialogDescription>
              <span className="font-mono text-xs">{investmentCode}</span> —
              capital is recalculated at {formatCurrency(pricePerUnit)} per
              slot and reflects across the investor&apos;s portfolio
              immediately.
            </DialogDescription>
          </DialogHeader>

          <div className="px-6 py-4 space-y-4">
            <div className="rounded-lg bg-surface-2 border border-border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted">Current</span>
                <span className="font-medium">
                  {slotLabel(currentUnits)} · {formatCurrency(currentCapital)}
                </span>
              </div>
              <div className="flex justify-between items-center border-t border-border pt-1">
                <span className="font-semibold flex items-center gap-1">
                  New <ArrowRight className="h-3 w-3" />
                </span>
                <span className={`font-bold ${validStep ? "text-primary-700" : "text-red-600"}`}>
                  {validStep
                    ? `${slotLabel(unitsNum)} · ${formatCurrency(newCapital)}`
                    : "—"}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Number of Slots <span className="text-danger">*</span>
              </label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={units}
                onChange={(e) => setUnits(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
              {!validStep && units !== "" && (
                <p className="text-xs text-red-600">
                  Must be at least 0.5, in steps of 0.5.
                </p>
              )}
            </div>

            <Input
              label="Reason (recorded in the audit log)"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. correcting a data entry error"
            />

            <p className="text-xs text-muted">
              The payment history is not changed — if the new capital differs
              from what has been paid, the difference shows as outstanding or
              overpaid.
            </p>

            {error && (
              <div className="rounded-lg bg-red-50 border border-red-200 p-2.5 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-red-700">{error}</p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={busy || !changed}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
