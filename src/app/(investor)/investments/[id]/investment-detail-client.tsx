"use client";

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MaturityDecisionModal } from "@/components/investor/maturity-decision-modal";

interface Props {
  investment: {
    id: string;
    investment_code: string;
    capital: number;
    declared_profit: number | null;
    units: number;
    series?: { name: string };
    cycle?: { cycle_label: string };
    investor?: {
      bank_name?: string | null;
      account_name?: string | null;
      account_number?: string | null;
    };
  };
}

export function InvestmentDetailClient({ investment }: Props) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <div className="flex items-start gap-3 rounded-xl border-2 border-gold-400 bg-gold-50 p-4">
        <AlertCircle className="h-5 w-5 text-gold-600 flex-shrink-0 mt-0.5" />
        <div className="flex-1">
          <p className="font-semibold text-gold-800">Action Required — Investment Matured</p>
          <p className="text-sm text-gold-700 mt-0.5">
            This investment has reached maturity. Please submit your decision to either
            continue into the next cycle or withdraw your capital.
          </p>
        </div>
        <Button
          onClick={() => setModalOpen(true)}
          className="bg-gold-500 hover:bg-gold-400 text-primary-900 flex-shrink-0"
          size="sm"
        >
          Submit Decision
        </Button>
      </div>

      <MaturityDecisionModal
        investment={investment}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}
