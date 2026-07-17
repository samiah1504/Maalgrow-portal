"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, AlertCircle, CheckCircle2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";

interface CycleInfo {
  id: string;
  cycle_label: string;
  total_capital: number;
  total_investors: number;
  mudarabah_investor_ratio: number;
}

interface Props {
  cycle: CycleInfo;
}

export function DeclareProfitForm({ cycle }: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    net_profit: number;
    investor_profit_share: number;
    company_profit_share: number;
    profit_per_slot: number;
    total_slots: number;
    investments_updated: number;
  } | null>(null);

  const [totalRevenue, setTotalRevenue] = useState("");
  const [totalExpenses, setTotalExpenses] = useState("");
  const [notes, setNotes] = useState("");

  const revenueNum = parseFloat(totalRevenue) || 0;
  const expensesNum = parseFloat(totalExpenses) || 0;

  const preview = useMemo(() => {
    if (revenueNum <= 0 && expensesNum <= 0) return null;
    const netProfit = revenueNum - expensesNum;
    const investorShare = netProfit * cycle.mudarabah_investor_ratio;
    const companyShare = netProfit - investorShare;
    return { netProfit, investorShare, companyShare };
  }, [revenueNum, expensesNum, cycle.mudarabah_investor_ratio]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!totalRevenue || isNaN(revenueNum) || revenueNum < 0) {
      setError("Please enter a valid total revenue (0 or greater).");
      return;
    }
    if (!totalExpenses || isNaN(expensesNum) || expensesNum < 0) {
      setError("Please enter a valid total expenses (0 or greater).");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycle.id}/declare-profit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          total_revenue: revenueNum,
          total_expenses: expensesNum,
          notes: notes.trim() || null,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        setError(json.error ?? "Failed to declare profit.");
        return;
      }

      setSuccess(json);
      toast.success("Profit declared successfully — investors have been notified.");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 space-y-4">
        <div className="flex items-center gap-3">
          <CheckCircle2 className="h-6 w-6 text-emerald-600" />
          <div>
            <p className="font-semibold text-emerald-900">Profit Declaration Complete</p>
            <p className="text-sm text-emerald-700 mt-0.5">
              {success.investments_updated} investor{success.investments_updated !== 1 ? "s" : ""}{" "}
              have been notified.
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <Tile label="Net Profit" value={formatCurrency(success.net_profit)} />
          <Tile label="Investor Share" value={formatCurrency(success.investor_profit_share)} highlight />
          <Tile label="Company Share" value={formatCurrency(success.company_profit_share)} />
          <Tile label="Profit per Slot" value={formatCurrency(success.profit_per_slot)} highlight />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push("/admin/cycles")}
          className="mt-2"
        >
          Back to Cycles
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Cycle info strip */}
      <div className="rounded-xl bg-surface-2 border border-border p-4 text-sm space-y-1.5">
        <div className="flex justify-between">
          <span className="text-muted">Cycle</span>
          <span className="font-semibold">{cycle.cycle_label}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Total Capital</span>
          <span className="font-medium">{formatCurrency(cycle.total_capital)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Investors</span>
          <span className="font-medium">{cycle.total_investors}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Mudārabah investor ratio</span>
          <span className="font-semibold text-primary-700">
            {(cycle.mudarabah_investor_ratio * 100).toFixed(0)}% to investors
          </span>
        </div>
      </div>

      {/* Revenue & Expenses */}
      <div className="space-y-4">
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground">
            Total Revenue (₦) <span className="text-danger">*</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={totalRevenue}
            onChange={(e) => setTotalRevenue(e.target.value)}
            placeholder="e.g. 25000000"
            className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            required
          />
        </div>

        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground">
            Total Business Expenses (₦) <span className="text-danger">*</span>
          </label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={totalExpenses}
            onChange={(e) => setTotalExpenses(e.target.value)}
            placeholder="e.g. 7000000"
            className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            required
          />
        </div>
      </div>

      {/* Live preview */}
      {preview && (
        <div className="rounded-xl border border-border bg-surface-2 p-4 space-y-3">
          <p className="text-xs font-semibold text-muted uppercase tracking-wide">
            Calculated Breakdown
          </p>
          <div className="space-y-2 text-sm">
            <Row
              label="Net Profit"
              value={formatCurrency(preview.netProfit)}
              className={preview.netProfit < 0 ? "text-red-600" : ""}
            />
            <Row
              label={`Investor Share (${(cycle.mudarabah_investor_ratio * 100).toFixed(0)}%)`}
              value={formatCurrency(preview.investorShare)}
              highlight
            />
            <Row
              label={`Company Share (${((1 - cycle.mudarabah_investor_ratio) * 100).toFixed(0)}%)`}
              value={formatCurrency(preview.companyShare)}
            />
          </div>
          <p className="text-xs text-muted pt-1 border-t border-border">
            Profit per slot will be calculated automatically based on total slots in this cycle.
          </p>
        </div>
      )}

      <Input
        label="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="e.g. Q3 2025 profit declaration"
      />

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={isSubmitting} className="flex-1">
          {isSubmitting ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
          {isSubmitting ? "Declaring…" : "Declare Profit"}
        </Button>
      </div>
    </form>
  );
}

function Tile({
  label,
  value,
  highlight,
}: {
  label: string;
  value: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-3 border ${
        highlight
          ? "border-emerald-200 bg-emerald-50"
          : "border-border bg-white"
      }`}
    >
      <p className="text-[10px] text-muted uppercase tracking-wide">{label}</p>
      <p
        className={`font-semibold mt-0.5 ${
          highlight ? "text-emerald-700" : "text-foreground"
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  highlight,
  className,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  className?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-muted">{label}</span>
      <span
        className={`font-semibold ${highlight ? "text-primary-700" : ""} ${className ?? ""}`}
      >
        {value}
      </span>
    </div>
  );
}
