"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  RefreshCw,
  Wallet,
  Scissors,
  Lock,
  CheckCircle2,
  CalendarClock,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate } from "@/lib/utils";
import { SLOT_VALUE_NGN, isValidSlots, slotLabel } from "@/lib/investment-utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Decision = "continue" | "exit" | "partial_exit";

const OPTION_LABEL: Record<string, string> = {
  continue: "Receive My Profit and Continue with My Capital",
  exit: "Receive My Profit and Withdraw All My Capital",
  partial_exit: "Receive My Profit and Withdraw Part of My Capital",
  rollover_all: "Roll over capital and profit (set by administrator)",
};

export interface MaturityInstructionsProps {
  investment: {
    id: string;
    investment_code: string;
    units: number;
    capital: number;
    declared_profit: number | null;
    status: string;
    maturity_date: string;
    series?: { name: string };
    cycle?: { cycle_label: string; end_date?: string; rollover_deadline?: string | null };
  };
  savedInstruction: {
    decision: string;
    slots_to_withdraw: number | null;
    locked: boolean;
  } | null;
  investorBank: {
    bank_name?: string | null;
    account_name?: string | null;
    account_number?: string | null;
  };
}

export function MaturityInstructions({
  investment,
  savedInstruction,
  investorBank,
}: MaturityInstructionsProps) {
  const router = useRouter();
  const isLocked =
    investment.status !== "active" || (savedInstruction?.locked ?? false);

  const [editing, setEditing] = useState(!savedInstruction && !isLocked);
  const [decision, setDecision] = useState<Decision | null>(
    savedInstruction && savedInstruction.decision !== "rollover_all"
      ? (savedInstruction.decision as Decision)
      : null
  );
  const [slotsInput, setSlotsInput] = useState(
    savedInstruction?.slots_to_withdraw != null
      ? String(savedInstruction.slots_to_withdraw)
      : ""
  );
  const [bank, setBank] = useState({
    bank_name: investorBank.bank_name ?? "",
    account_name: investorBank.account_name ?? "",
    account_number: investorBank.account_number ?? "",
  });
  const [submitting, setSubmitting] = useState(false);

  const deadline =
    investment.cycle?.rollover_deadline ??
    investment.cycle?.end_date ??
    investment.maturity_date;

  const totalSlots = Number(investment.units);

  // ── Partial withdrawal live calculations ──
  const partial = useMemo(() => {
    const raw = slotsInput.trim();
    if (raw === "") return { valid: false as const, error: null };
    const n = Number(raw);
    if (!isFinite(n) || isNaN(n)) {
      return { valid: false as const, error: "Enter a valid number of slots" };
    }
    if (n <= 0) {
      return { valid: false as const, error: "Enter a number greater than zero" };
    }
    if (!isValidSlots(n)) {
      return { valid: false as const, error: "Slots must be in 0.5 increments (0.5, 1, 1.5, …)" };
    }
    if (n > totalSlots) {
      return {
        valid: false as const,
        error: "You cannot withdraw more slots than your current investment.",
      };
    }
    if (n === totalSlots) {
      return {
        valid: false as const,
        error:
          "You are withdrawing all your slots — please use “Receive My Profit and Withdraw All My Capital” instead.",
        suggestFull: true as const,
      };
    }
    const withdrawValue = n * SLOT_VALUE_NGN;
    const remaining = totalSlots - n;
    return {
      valid: true as const,
      error: null,
      slots: n,
      withdrawValue,
      remaining,
      continuing: remaining * SLOT_VALUE_NGN,
    };
  }, [slotsInput, totalSlots]);

  const bankComplete =
    bank.bank_name.trim().length >= 2 &&
    bank.account_name.trim().length >= 3 &&
    /^\d{10}$/.test(bank.account_number.trim());

  const canSubmit =
    decision !== null &&
    bankComplete &&
    (decision !== "partial_exit" || partial.valid);

  const submit = async () => {
    if (!decision) return;
    setSubmitting(true);
    try {
      const supabase = createClient();
      const { error } = await supabase.rpc("submit_rollover_decision", {
        p_investment_id: investment.id,
        p_decision: decision,
        p_bank_name: bank.bank_name.trim(),
        p_account_name: bank.account_name.trim(),
        p_account_number: bank.account_number.trim(),
        p_notes: null,
        p_admin_override: false,
        p_slots_to_withdraw:
          decision === "partial_exit" && partial.valid ? partial.slots : null,
      });
      if (error) {
        toast.error(error.message || "Failed to save your instruction");
        return;
      }
      toast.success("Maturity instruction saved — you can change it any time before maturity");
      setEditing(false);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  };

  // ── Locked view (matured / processing) ──
  if (isLocked) {
    const label = savedInstruction
      ? OPTION_LABEL[savedInstruction.decision] ?? savedInstruction.decision
      : "No instruction submitted — default applies: your profit is paid to your bank account and your capital continues into the next cycle";
    return (
      <Card className="border-primary-200">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Lock className="h-4 w-4 text-primary-600" />
            Maturity Instructions — Locked
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-foreground font-medium">{label}</p>
          {savedInstruction?.decision === "partial_exit" &&
            savedInstruction.slots_to_withdraw != null && (
              <p className="text-xs text-muted">
                Withdrawing {slotLabel(savedInstruction.slots_to_withdraw)} (
                {formatCurrency(savedInstruction.slots_to_withdraw * SLOT_VALUE_NGN)});{" "}
                {slotLabel(totalSlots - savedInstruction.slots_to_withdraw)} continuing (
                {formatCurrency((totalSlots - savedInstruction.slots_to_withdraw) * SLOT_VALUE_NGN)}).
              </p>
            )}
          <p className="text-xs text-muted">
            This investment has reached maturity, so instructions can no longer be
            changed. Contact support if you need an exception.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Saved summary view (editable until maturity) ──
  if (!editing && savedInstruction) {
    return (
      <Card className="border-emerald-200">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Maturity Instruction Saved
            </CardTitle>
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              Change
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm font-medium text-foreground">
            {OPTION_LABEL[savedInstruction.decision] ?? savedInstruction.decision}
          </p>
          {savedInstruction.decision === "partial_exit" &&
            savedInstruction.slots_to_withdraw != null && (
              <p className="text-xs text-muted">
                Withdrawing {slotLabel(savedInstruction.slots_to_withdraw)} (
                {formatCurrency(savedInstruction.slots_to_withdraw * SLOT_VALUE_NGN)});{" "}
                {slotLabel(totalSlots - savedInstruction.slots_to_withdraw)} continuing into
                the next cycle.
              </p>
            )}
          <p className="text-xs text-muted">
            You can edit this instruction any time before {formatDate(deadline)}.
          </p>
        </CardContent>
      </Card>
    );
  }

  // ── Instruction form ──
  return (
    <Card className="border-gold-300">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <CalendarClock className="h-4 w-4 text-gold-600" />
          Maturity Instructions
        </CardTitle>
        <p className="text-sm text-muted mt-1 leading-relaxed">
          Your 3-month investment cycle is approaching maturity. Your declared profit
          will be paid to you at maturity. Please choose how you would like us to
          handle your investment capital for the next investment cycle.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Option 1 */}
        <button
          onClick={() => setDecision("continue")}
          className={cn(
            "w-full rounded-xl border-2 p-4 text-left transition-all",
            decision === "continue"
              ? "border-primary-500 bg-primary-50"
              : "border-border hover:border-primary-300"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-100 text-primary-700 shrink-0">
              <RefreshCw className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">
                Receive My Profit and Continue with My Capital
              </p>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                Pay my declared profit to my registered bank account and automatically
                continue investing my existing capital in the next 3-month MaalGrow
                investment cycle.
              </p>
            </div>
          </div>
        </button>

        {/* Option 2 */}
        <button
          onClick={() => setDecision("exit")}
          className={cn(
            "w-full rounded-xl border-2 p-4 text-left transition-all",
            decision === "exit"
              ? "border-gold-500 bg-gold-50"
              : "border-border hover:border-gold-300"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-gold-100 text-gold-700 shrink-0">
              <Wallet className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">
                Receive My Profit and Withdraw All My Capital
              </p>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                Pay my declared profit together with my full investment capital to my
                registered bank account at maturity.
              </p>
            </div>
          </div>
        </button>

        {/* Option 3 */}
        <button
          onClick={() => setDecision("partial_exit")}
          className={cn(
            "w-full rounded-xl border-2 p-4 text-left transition-all",
            decision === "partial_exit"
              ? "border-blue-500 bg-blue-50"
              : "border-border hover:border-blue-300"
          )}
        >
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100 text-blue-700 shrink-0">
              <Scissors className="h-5 w-5" />
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">
                Receive My Profit and Withdraw Part of My Capital
              </p>
              <p className="text-xs text-muted mt-1 leading-relaxed">
                Pay my declared profit at maturity and withdraw only part of my
                investment capital. The remaining investment capital will automatically
                continue into the next 3-month MaalGrow investment cycle.
              </p>
            </div>
          </div>
        </button>

        {/* Option 3 dynamic fields */}
        {decision === "partial_exit" && (
          <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4 space-y-3">
            <Input
              label={`Number of Slots to Withdraw (you own ${slotLabel(totalSlots)})`}
              type="number"
              inputMode="decimal"
              min={0.5}
              max={totalSlots}
              step={0.5}
              value={slotsInput}
              onChange={(e) => setSlotsInput(e.target.value)}
              error={partial.error ?? undefined}
              placeholder="e.g. 1.5"
              required
            />
            {partial.valid && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-white border border-border p-2.5">
                  <p className="text-[10px] text-muted uppercase tracking-wide">
                    Value of Slots to Withdraw
                  </p>
                  <p className="text-sm font-bold text-gold-600 mt-0.5">
                    {formatCurrency(partial.withdrawValue)}
                  </p>
                </div>
                <div className="rounded-lg bg-white border border-border p-2.5">
                  <p className="text-[10px] text-muted uppercase tracking-wide">
                    Slots Remaining
                  </p>
                  <p className="text-sm font-bold text-foreground mt-0.5">
                    {partial.remaining}
                  </p>
                </div>
                <div className="rounded-lg bg-white border border-border p-2.5">
                  <p className="text-[10px] text-muted uppercase tracking-wide">
                    Capital Continuing into Next Cycle
                  </p>
                  <p className="text-sm font-bold text-emerald-600 mt-0.5">
                    {formatCurrency(partial.continuing)}
                  </p>
                </div>
              </div>
            )}
            {"suggestFull" in partial && partial.suggestFull && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setDecision("exit")}
                className="w-full"
              >
                Switch to “Withdraw All My Capital” instead
              </Button>
            )}
          </div>
        )}

        {/* Bank details (profit is always paid) */}
        {decision !== null && (
          <div className="space-y-3 pt-2 border-t border-border">
            <p className="text-sm font-medium text-foreground">
              Bank account for your payout:
            </p>
            <Input
              label="Bank Name"
              value={bank.bank_name}
              onChange={(e) => setBank((b) => ({ ...b, bank_name: e.target.value }))}
              placeholder="e.g. Access Bank"
              required
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <Input
                label="Account Name"
                value={bank.account_name}
                onChange={(e) => setBank((b) => ({ ...b, account_name: e.target.value }))}
                placeholder="As on your bank account"
                required
              />
              <Input
                label="Account Number"
                value={bank.account_number}
                onChange={(e) =>
                  setBank((b) => ({ ...b, account_number: e.target.value.replace(/\D/g, "") }))
                }
                maxLength={10}
                inputMode="numeric"
                placeholder="10 digits"
                required
              />
            </div>
          </div>
        )}

        <div className="flex gap-2">
          {savedInstruction && (
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={submitting}>
              Cancel
            </Button>
          )}
          <Button
            onClick={submit}
            loading={submitting}
            disabled={!canSubmit}
            className="flex-1"
          >
            {submitting ? "Saving…" : "Save Maturity Instruction"}
          </Button>
        </div>
        <p className="text-xs text-muted text-center">
          You can edit this instruction any time before {formatDate(deadline)}. It locks
          automatically at maturity.
        </p>
      </CardContent>
    </Card>
  );
}
