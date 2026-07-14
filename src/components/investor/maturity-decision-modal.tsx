"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { CheckCircle2, ArrowRight, XCircle, DollarSign, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const schema = z.object({
  bank_name: z.string().min(2, "Please enter your bank name"),
  account_name: z.string().min(3, "Please enter your account name"),
  account_number: z.string().min(10, "Please enter a valid account number").max(10, "Account number must be 10 digits"),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface Investment {
  id: string;
  investment_code: string;
  capital: number;
  expected_roi: number;
  units: number;
  series?: { name: string };
  cycle?: { cycle_label: string };
  investor?: {
    bank_name?: string | null;
    account_name?: string | null;
    account_number?: string | null;
  };
}

interface MaturityDecisionModalProps {
  investment: Investment;
  open: boolean;
  onClose: () => void;
}

export function MaturityDecisionModal({ investment, open, onClose }: MaturityDecisionModalProps) {
  const [step, setStep] = useState<"choose" | "confirm" | "success">("choose");
  const [decision, setDecision] = useState<"continue" | "exit" | null>(null);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      bank_name: investment.investor?.bank_name ?? "",
      account_name: investment.investor?.account_name ?? "",
      account_number: investment.investor?.account_number ?? "",
    },
  });

  const handleDecisionSelect = (d: "continue" | "exit") => {
    setDecision(d);
    setStep("confirm");
  };

  const handleBack = () => {
    setStep("choose");
    setDecision(null);
    reset();
  };

  const onSubmit = async (data: FormData) => {
    if (!decision) return;

    const supabase = createClient();

    const { error } = await supabase.rpc("submit_maturity_decision", {
      p_investment_id: investment.id,
      p_decision: decision,
      p_bank_name: data.bank_name,
      p_account_name: data.account_name,
      p_account_number: data.account_number,
      p_notes: data.notes ?? null,
    });

    if (error) {
      toast.error(error.message || "Failed to submit decision. Please try again.");
      return;
    }

    setStep("success");
    router.refresh();
  };

  const handleClose = () => {
    setStep("choose");
    setDecision(null);
    reset();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {step === "success" ? "Decision Submitted" : "Maturity Decision"}
          </DialogTitle>
          <DialogDescription>
            {step === "success"
              ? "Your decision has been recorded successfully."
              : `Investment ${investment.investment_code} — ${investment.series?.name} · ${investment.cycle?.cycle_label}`}
          </DialogDescription>
        </DialogHeader>

        <div className="p-6">
          {/* Investment Summary */}
          {step !== "success" && (
            <div className="mb-6 rounded-xl bg-primary-50 border border-primary-100 p-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wide">Capital</p>
                  <p className="text-sm font-bold text-foreground mt-0.5">{formatCurrency(investment.capital)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wide">ROI Earned</p>
                  <p className="text-sm font-bold text-gold-600 mt-0.5">{formatCurrency(investment.expected_roi)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wide">Total</p>
                  <p className="text-sm font-bold text-primary-700 mt-0.5">
                    {formatCurrency(investment.capital + investment.expected_roi)}
                  </p>
                </div>
              </div>
              <p className="text-[10px] text-center text-muted mt-3 italic">
                ✓ ROI is always payable regardless of your capital decision
              </p>
            </div>
          )}

          {/* Step 1: Choose Decision */}
          {step === "choose" && (
            <div className="space-y-3">
              <p className="text-sm font-medium text-foreground mb-4">
                What would you like to do with your capital?
              </p>

              {/* Option 1: Continue */}
              <button
                onClick={() => handleDecisionSelect("continue")}
                className="w-full rounded-xl border-2 border-border p-4 text-left hover:border-primary-400 hover:bg-primary-50/50 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 group-hover:bg-primary-200 transition-colors flex-shrink-0">
                    <RefreshCw className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground text-sm">Continue into next cycle</p>
                    <p className="text-xs text-muted mt-1">
                      Roll your capital ({formatCurrency(investment.capital)}) into the next cycle.
                      ROI ({formatCurrency(investment.expected_roi)}) will be paid separately.
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted group-hover:text-primary-600 transition-colors mt-2.5" />
                </div>
              </button>

              {/* Option 2: Exit */}
              <button
                onClick={() => handleDecisionSelect("exit")}
                className="w-full rounded-xl border-2 border-border p-4 text-left hover:border-gold-400 hover:bg-gold-50/50 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-100 text-gold-700 group-hover:bg-gold-200 transition-colors flex-shrink-0">
                    <DollarSign className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground text-sm">Return my capital</p>
                    <p className="text-xs text-muted mt-1">
                      Return capital ({formatCurrency(investment.capital)}) and pay ROI ({formatCurrency(investment.expected_roi)}).
                      Both will be paid to your registered bank account.
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted group-hover:text-gold-600 transition-colors mt-2.5" />
                </div>
              </button>
            </div>
          )}

          {/* Step 2: Confirm with bank details */}
          {step === "confirm" && decision && (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg p-3 text-sm font-medium",
                  decision === "continue"
                    ? "bg-primary-50 text-primary-700"
                    : "bg-gold-50 text-gold-700"
                )}
              >
                {decision === "continue" ? (
                  <RefreshCw className="h-4 w-4" />
                ) : (
                  <DollarSign className="h-4 w-4" />
                )}
                {decision === "continue"
                  ? "Rolling capital into next cycle"
                  : "Returning capital + paying ROI"}
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">Payment details for ROI{decision === "exit" ? " & capital" : ""}:</p>
                <Input
                  {...register("bank_name")}
                  label="Bank Name"
                  placeholder="e.g. Access Bank"
                  error={errors.bank_name?.message}
                  required
                />
                <Input
                  {...register("account_name")}
                  label="Account Name"
                  placeholder="As on your bank account"
                  error={errors.account_name?.message}
                  required
                />
                <Input
                  {...register("account_number")}
                  label="Account Number"
                  placeholder="10-digit account number"
                  maxLength={10}
                  error={errors.account_number?.message}
                  required
                />
                <div className="w-full space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">
                    Notes (optional)
                  </label>
                  <textarea
                    {...register("notes")}
                    rows={2}
                    placeholder="Any additional instructions..."
                    className="flex w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
                  />
                </div>
              </div>

              <DialogFooter className="!p-0 !border-0 !mt-4">
                <Button type="button" variant="ghost" onClick={handleBack} disabled={isSubmitting}>
                  Back
                </Button>
                <Button type="submit" loading={isSubmitting} className={decision === "exit" ? "bg-gold-500 hover:bg-gold-400 text-primary-900" : ""}>
                  {isSubmitting ? "Submitting..." : "Confirm Decision"}
                </Button>
              </DialogFooter>
            </form>
          )}

          {/* Step 3: Success */}
          {step === "success" && (
            <div className="text-center space-y-4">
              <div className="flex justify-center">
                <CheckCircle2 className="h-16 w-16 text-success" />
              </div>
              <div>
                <p className="font-semibold text-foreground">Decision recorded successfully</p>
                <p className="text-sm text-muted mt-2">
                  {decision === "continue"
                    ? "Your capital has been rolled into the next cycle. A ROI payment request has been created and is pending approval."
                    : "Payment requests for your ROI and capital have been created and are pending approval. You will be notified once processed."}
                </p>
              </div>
              <Button onClick={handleClose} className="w-full">
                Done
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
