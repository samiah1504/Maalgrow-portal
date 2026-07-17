"use client";

import { useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";
import { MaturityDecisionModal } from "@/components/investor/maturity-decision-modal";

interface Props {
  investment: {
    id: string;
    investment_code: string;
    capital: number;
    declared_profit: number | null;
    units: number;
    status: string;
    maturity_decision?: "continue" | "exit" | "rollover_all" | null;
    series?: { name: string };
    cycle?: { cycle_label: string; end_date?: string; rollover_deadline?: string | null };
    investor?: {
      bank_name?: string | null;
      account_name?: string | null;
      account_number?: string | null;
    };
  };
}

const DECISION_LABEL: Record<string, string> = {
  rollover_all: "Roll over capital + profit",
  continue: "Withdraw profit · continue with capital",
  exit: "Withdraw capital and profit",
};

export function InvestmentDetailClient({ investment }: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  const isMatured = investment.status === "matured";
  const deadline =
    investment.cycle?.rollover_deadline ?? investment.cycle?.end_date ?? null;
  const currentChoice = investment.maturity_decision
    ? DECISION_LABEL[investment.maturity_decision]
    : null;

  return (
    <>
      {isMatured ? (
        <div className="flex items-start gap-3 rounded-xl border-2 border-gold-400 bg-gold-50 p-4">
          <AlertCircle className="h-5 w-5 text-gold-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-gold-800">Cycle Matured — Rollover In Progress</p>
            <p className="text-sm text-gold-700 mt-0.5">
              {currentChoice ? (
                <>
                  Your choice: <span className="font-semibold">{currentChoice}</span>. It
                  will be applied when the rollover is processed.
                </>
              ) : (
                <>
                  Unless you choose otherwise, your capital and declared profit will
                  automatically continue into the next cycle.
                </>
              )}
            </p>
          </div>
          <Button
            onClick={() => setModalOpen(true)}
            className="bg-gold-500 hover:bg-gold-400 text-primary-900 flex-shrink-0"
            size="sm"
          >
            {currentChoice ? "Change Decision" : "Submit Decision"}
          </Button>
        </div>
      ) : (
        <div className="flex items-start gap-3 rounded-xl border border-primary-200 bg-primary-50/60 p-4">
          <RefreshCw className="h-5 w-5 text-primary-600 flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-semibold text-primary-800">Automatic Rollover</p>
            <p className="text-sm text-primary-700 mt-0.5">
              {currentChoice ? (
                <>
                  Your rollover preference:{" "}
                  <span className="font-semibold">{currentChoice}</span>
                  {deadline ? ` (changeable until ${formatDate(deadline)})` : ""}.
                </>
              ) : (
                <>
                  At maturity you will automatically continue into the next cycle with
                  your capital and declared profit — unless you opt out
                  {deadline ? ` before ${formatDate(deadline)}` : ""}.
                </>
              )}
            </p>
          </div>
          <Button
            onClick={() => setModalOpen(true)}
            variant="outline"
            className="flex-shrink-0"
            size="sm"
          >
            {currentChoice ? "Change Preference" : "Set Preference"}
          </Button>
        </div>
      )}

      <MaturityDecisionModal
        investment={investment}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
