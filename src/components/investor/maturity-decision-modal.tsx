"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CheckCircle2,
  ArrowRight,
  DollarSign,
  RefreshCw,
  Wallet,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
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
  account_number: z
    .string()
    .min(10, "Please enter a valid account number")
    .max(10, "Account number must be 10 digits"),
  notes: z.string().optional(),
});

type FormData = z.infer<typeof schema>;

type Decision = "rollover_all" | "continue" | "exit";

interface Investment {
  id: string;
  investment_code: string;
  capital: number;
  declared_profit: number | null;
  units: number;
  maturity_decision?: Decision | null;
  series?: { name: string };
  cycle?: { cycle_label: string; end_date?: string; rollover_deadline?: string | null };
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

const NEEDS_BANK: Record<Decision, boolean> = {
  rollover_all: false,
  continue: true,
  exit: true,
};

export function MaturityDecisionModal({ investment, open, onClose }: MaturityDecisionModalProps) {
  const [step, setStep] = useState<"choose" | "confirm" | "success">("choose");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const router = useRouter();

  const deadline =
    investment.cycle?.rollover_deadline ?? investment.cycle?.end_date ?? null;

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

  const profit = investment.declared_profit;

  const submitDecision = async (d: Decision, bank?: FormData) => {
    const supabase = createClient();
    const { error } = await supabase.rpc("submit_rollover_decision", {
      p_investment_id: investment.id,
      p_decision: d,
      p_bank_name: bank?.bank_name ?? null,
      p_account_name: bank?.account_name ?? null,
      p_account_number: bank?.account_number ?? null,
      p_notes: bank?.notes ?? null,
    });

    if (error) {
      toast.error(error.message || "Failed to submit decision. Please try again.");
      return false;
    }
    setStep("success");
    router.refresh();
    return true;
  };

  const handleDecisionSelect = (d: Decision) => {
    setDecision(d);
    setStep("confirm");
  };

  const handleBack = () => {
    setStep("choose");
    setDecision(null);
    reset();
  };

  const onSubmitWithBank = async (data: FormData) => {
    if (!decision) return;
    await submitDecision(decision, data);
  };

  const onConfirmRollover = async () => {
    setSubmitting(true);
    await submitDecision("rollover_all");
    setSubmitting(false);
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
            {step === "success" ? "Decision Submitted" : "Rollover Decision"}
          </DialogTitle>
          <DialogDescription>
            {step === "success"
              ? "Your decision has been recorded successfully."
              : `Investment ${investment.investment_code} — Series ${investment.series?.name} · ${investment.cycle?.cycle_label}`}
          </DialogDescription>
        </DialogHeader>

        <div className="p-6">
          {/* Summary */}
          {step !== "success" && (
            <div className="mb-5 rounded-xl bg-primary-50 border border-primary-100 p-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wide">Capital</p>
                  <p className="text-sm font-bold text-foreground mt-0.5">
                    {formatCurrency(investment.capital)}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wide">Actual Profit</p>
                  {profit != null ? (
                    <p className="text-sm font-bold text-emerald-600 mt-0.5">
                      {formatCurrency(profit)}
                    </p>
                  ) : (
                    <p className="text-xs text-muted mt-1">Declared at maturity</p>
                  )}
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wide">Slots</p>
                  <p className="text-sm font-bold text-primary-700 mt-0.5">{investment.units}</p>
                </div>
              </div>
            </div>
          )}

          {/* Default rule notice */}
          {step === "choose" && (
            <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-blue-200 bg-blue-50 p-3">
              <Info className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-800 leading-relaxed">
                <span className="font-semibold">Automatic continuation:</span> if you do
                not submit a choice{deadline ? ` before ${formatDate(deadline)}` : ""},
                your capital and declared profit will automatically continue into the
                next cycle. After the deadline your decision can only be changed with
                Super Admin approval.
              </p>
            </div>
          )}

          {/* Step 1: Choose */}
          {step === "choose" && (
            <div className="space-y-3">
              {/* Option 1: Roll over everything (default) */}
              <button
                onClick={() => handleDecisionSelect("rollover_all")}
                className="w-full rounded-xl border-2 border-primary-300 bg-primary-50/40 p-4 text-left hover:border-primary-500 hover:bg-primary-50 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 group-hover:bg-primary-200 transition-colors flex-shrink-0">
                    <RefreshCw className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground text-sm">
                      Roll over capital + profit{" "}
                      <span className="ml-1 rounded-full bg-primary-100 px-2 py-0.5 text-[10px] font-bold text-primary-700 uppercase">
                        Default
                      </span>
                    </p>
                    <p className="text-xs text-muted mt-1">
                      Continue into the next cycle with your capital
                      {profit != null ? ` (${formatCurrency(investment.capital)})` : ""} and
                      declared profit{profit != null ? ` (${formatCurrency(profit)})` : ""}. No
                      payout is made.
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted group-hover:text-primary-600 transition-colors mt-2.5" />
                </div>
              </button>

              {/* Option 2: Withdraw profit, continue capital */}
              <button
                onClick={() => handleDecisionSelect("continue")}
                className="w-full rounded-xl border-2 border-border p-4 text-left hover:border-emerald-400 hover:bg-emerald-50/50 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 group-hover:bg-emerald-200 transition-colors flex-shrink-0">
                    <Wallet className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground text-sm">
                      Withdraw profit · continue with capital
                    </p>
                    <p className="text-xs text-muted mt-1">
                      Your declared profit is paid to your bank account; your capital
                      ({formatCurrency(investment.capital)}) rolls into the next cycle.
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted group-hover:text-emerald-600 transition-colors mt-2.5" />
                </div>
              </button>

              {/* Option 3: Withdraw everything */}
              <button
                onClick={() => handleDecisionSelect("exit")}
                className="w-full rounded-xl border-2 border-border p-4 text-left hover:border-gold-400 hover:bg-gold-50/50 transition-all group"
              >
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-100 text-gold-700 group-hover:bg-gold-200 transition-colors flex-shrink-0">
                    <DollarSign className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <p className="font-semibold text-foreground text-sm">
                      Withdraw capital and profit
                    </p>
                    <p className="text-xs text-muted mt-1">
                      Exit this series. Your capital and declared profit are both paid to
                      your registered bank account.
                    </p>
                  </div>
                  <ArrowRight className="h-5 w-5 text-muted group-hover:text-gold-600 transition-colors mt-2.5" />
                </div>
              </button>
            </div>
          )}

          {/* Step 2a: Confirm rollover (no bank details needed) */}
          {step === "confirm" && decision === "rollover_all" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 rounded-lg bg-primary-50 p-3 text-sm font-medium text-primary-700">
                <RefreshCw className="h-4 w-4" />
                Rolling capital + profit into the next cycle
              </div>
              <p className="text-sm text-muted leading-relaxed">
                Your capital{profit != null ? ` (${formatCurrency(investment.capital)})` : ""}
                {profit != null ? ` and declared profit (${formatCurrency(profit)})` : " and declared profit"}{" "}
                will continue into the next Series {investment.series?.name} cycle. Your
                slots stay the same; profit is carried as a rollover balance and is not
                converted into additional slots.
              </p>
              <DialogFooter className="!p-0 !border-0 !mt-4">
                <Button type="button" variant="ghost" onClick={handleBack} disabled={submitting}>
                  Back
                </Button>
                <Button onClick={onConfirmRollover} loading={submitting}>
                  {submitting ? "Submitting..." : "Confirm Rollover"}
                </Button>
              </DialogFooter>
            </div>
          )}

          {/* Step 2b: Confirm with bank details */}
          {step === "confirm" && decision && NEEDS_BANK[decision] && (
            <form onSubmit={handleSubmit(onSubmitWithBank)} className="space-y-4">
              <div
                className={cn(
                  "flex items-center gap-2 rounded-lg p-3 text-sm font-medium",
                  decision === "continue"
                    ? "bg-emerald-50 text-emerald-700"
                    : "bg-gold-50 text-gold-700"
                )}
              >
                {decision === "continue" ? (
                  <Wallet className="h-4 w-4" />
                ) : (
                  <DollarSign className="h-4 w-4" />
                )}
                {decision === "continue"
                  ? "Withdrawing profit · capital continues"
                  : "Withdrawing capital + profit"}
              </div>

              <div className="space-y-3">
                <p className="text-sm font-medium text-foreground">
                  Bank account for your payout:
                </p>
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
                <Button
                  type="submit"
                  loading={isSubmitting}
                  className={decision === "exit" ? "bg-gold-500 hover:bg-gold-400 text-primary-900" : ""}
                >
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
                  {decision === "rollover_all"
                    ? "Your capital and profit will be rolled into the next cycle when the rollover is processed after profit declaration."
                    : decision === "continue"
                    ? "Your capital will continue into the next cycle. Your profit payout will be processed after the cycle profit is finalised."
                    : "Your withdrawal will be processed after the cycle profit is finalised. You will be notified once payment requests are approved."}
                  {deadline
                    ? ` You can change this choice until ${formatDate(deadline)}.`
                    : ""}
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
