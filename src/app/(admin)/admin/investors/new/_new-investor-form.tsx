"use client";

import { useState, useEffect, useCallback } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import {
  Search,
  UserPlus,
  User,
  CheckCircle2,
  AlertCircle,
  Info,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  SLOT_VALUE_NGN,
  isValidSlots,
  calcCapital,
  getPaymentStatus,
  paymentStatusColor,
  slotLabel,
} from "@/lib/investment-utils";
import { SuccessScreen, type SuccessData } from "./_success-screen";

// ─── Types ────────────────────────────────────────────────────────────────────

type SeriesRow = {
  id: string;
  name: string;
  mudarabah_investor_ratio: number;
  is_active: boolean;
};

type CycleRow = {
  id: string;
  series_id: string;
  cycle_number: number;
  cycle_label: string;
  start_date: string;
  end_date: string;
  status: string;
};

type FoundInvestor = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  investor_code: string;
  kyc_status: string;
};

// ─── Validation schemas ───────────────────────────────────────────────────────

const newInvestorSchema = z.object({
  full_name: z.string().min(2, "Full name must be at least 2 characters"),
  email: z.string().email("Please enter a valid email address"),
  phone: z.string().optional(),
  address: z.string().optional(),
});

const investmentSchema = z.object({
  series_id: z.string().min(1, "Please select a series"),
  cycle_id: z.string().min(1, "Please select a cycle"),
  units: z
    .number({ error: "Enter a number" })
    .refine((v) => isValidSlots(v), {
      message: "Slots must be ≥ 0.5 in increments of 0.5 (e.g. 0.5, 1, 1.5, 2…)",
    }),
  investment_date: z.string().min(1, "Investment date is required"),
  notes: z.string().optional(),
  payment_amount: z
    .number({ error: "Enter a number" })
    .min(0, "Amount cannot be negative")
    .optional(),
  payment_date: z.string().optional(),
  payment_reference: z.string().optional(),
});

type NewInvestorData = z.infer<typeof newInvestorSchema>;
type InvestmentData = z.infer<typeof investmentSchema>;

// ─── Investment sub-form ──────────────────────────────────────────────────────

function InvestmentSection({
  series,
  cycles,
  form,
}: {
  series: SeriesRow[];
  cycles: CycleRow[];
  form: ReturnType<typeof useForm<InvestmentData>>;
}) {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = form;

  const selectedSeriesId = watch("series_id");
  const selectedCycleId = watch("cycle_id");
  const units = watch("units");
  const paymentAmount = watch("payment_amount") ?? 0;

  const filteredCycles = cycles.filter((c) => c.series_id === selectedSeriesId);
  const selectedSeries = series.find((s) => s.id === selectedSeriesId);
  const selectedCycle = filteredCycles.find((c) => c.id === selectedCycleId);

  const capital = units && isValidSlots(units) ? calcCapital(units) : 0;
  const balance = capital - (paymentAmount || 0);
  const payStatus = capital > 0 ? getPaymentStatus(capital, paymentAmount || 0) : null;

  useEffect(() => {
    setValue("cycle_id", "");
  }, [selectedSeriesId, setValue]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Investment Allocation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-lg bg-primary-50 border border-primary-100 p-3 flex items-center gap-2">
            <Info className="h-4 w-4 text-primary-600 flex-shrink-0" />
            <p className="text-sm text-primary-700">
              <span className="font-semibold">Slot value: ₦500,000</span> — fixed
              across all series and cycles
            </p>
          </div>

          {/* Series */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Series <span className="text-danger ml-0.5">*</span>
            </label>
            <div className="flex gap-2">
              {series.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setValue("series_id", s.id)}
                  className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold transition-all ${
                    selectedSeriesId === s.id
                      ? "bg-primary-700 text-white border-primary-700"
                      : "bg-white text-foreground border-border hover:border-primary-400 hover:bg-primary-50"
                  }`}
                >
                  Series {s.name}
                  <span className="block text-xs font-normal mt-0.5 opacity-80">
                    {(s.mudarabah_investor_ratio * 100).toFixed(0)}% investor share
                  </span>
                </button>
              ))}
            </div>
            {errors.series_id && (
              <p className="text-xs text-danger">{errors.series_id.message}</p>
            )}
            <input type="hidden" {...register("series_id")} />
          </div>

          {/* Cycle */}
          {selectedSeriesId && (
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Cycle <span className="text-danger ml-0.5">*</span>
              </label>
              {filteredCycles.length === 0 ? (
                <div className="rounded-lg bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                  No open cycles for Series {selectedSeries?.name}. Please create
                  a cycle first.
                </div>
              ) : (
                <select
                  {...register("cycle_id")}
                  className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value="">Select a cycle…</option>
                  {filteredCycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.cycle_label} ({c.status})
                    </option>
                  ))}
                </select>
              )}
              {errors.cycle_id && (
                <p className="text-xs text-danger">{errors.cycle_id.message}</p>
              )}
            </div>
          )}

          {/* Cycle info */}
          {selectedCycle && (
            <div className="rounded-lg bg-surface-2 border border-border p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-muted">Cycle</span>
                <span className="font-medium">{selectedCycle.cycle_label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Start date</span>
                <span className="font-medium">{formatDate(selectedCycle.start_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Maturity date</span>
                <span className="font-medium">{formatDate(selectedCycle.end_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Status</span>
                <span className="font-medium capitalize">{selectedCycle.status}</span>
              </div>
            </div>
          )}

          {/* Slots */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Number of Slots <span className="text-danger ml-0.5">*</span>
            </label>
            <div className="flex items-center gap-3">
              <input
                type="number"
                step="0.5"
                min="0.5"
                placeholder="e.g. 1.5"
                {...register("units", { valueAsNumber: true })}
                className="h-10 w-36 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
              <p className="text-xs text-muted">Min 0.5 · increments of 0.5</p>
            </div>
            {errors.units && (
              <p className="text-xs text-danger">{errors.units.message}</p>
            )}
          </div>

          {capital > 0 && (
            <div className="rounded-xl bg-gradient-to-r from-primary-50 to-primary-100 border border-primary-200 p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-primary-700 font-medium">
                  {units && isValidSlots(units) ? slotLabel(units) : "—"} ×{" "}
                  {formatCurrency(SLOT_VALUE_NGN)}
                </span>
                <span className="font-bold text-primary-900 text-base">
                  {formatCurrency(capital)}
                </span>
              </div>
              <p className="text-xs text-primary-600 italic">
                Profit will be declared by admin at cycle maturity (Mudarabah)
              </p>
            </div>
          )}

          {/* Investment date */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Investment Date <span className="text-danger ml-0.5">*</span>
            </label>
            <input
              type="date"
              {...register("investment_date")}
              className="h-10 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
            />
            {errors.investment_date && (
              <p className="text-xs text-danger">{errors.investment_date.message}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-foreground">
              Notes (optional)
            </label>
            <textarea
              {...register("notes")}
              rows={2}
              placeholder="Any notes about this allocation…"
              className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Payment */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Initial Payment (optional)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted">
            Record an upfront payment. You can add further payments later from
            the investor&apos;s profile.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Amount Paid (₦)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                placeholder="0.00"
                {...register("payment_amount", { valueAsNumber: true })}
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
              {errors.payment_amount && (
                <p className="text-xs text-danger">{errors.payment_amount.message}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-foreground">
                Payment Date
              </label>
              <input
                type="date"
                {...register("payment_date")}
                className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
              />
            </div>
          </div>

          <Input
            {...register("payment_reference")}
            label="Payment Reference / Note (optional)"
            placeholder="e.g. Bank transfer ref: TXN123456"
          />

          {capital > 0 && (
            <div className="rounded-lg border border-border p-3 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Investment amount</span>
                <span className="font-medium">{formatCurrency(capital)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Amount paid</span>
                <span className="font-medium">
                  {formatCurrency(paymentAmount || 0)}
                </span>
              </div>
              <div className="flex justify-between border-t border-border pt-2">
                <span className="font-semibold">Outstanding balance</span>
                <span
                  className={`font-bold ${balance > 0 ? "text-amber-600" : balance === 0 ? "text-green-600" : "text-blue-600"}`}
                >
                  {formatCurrency(Math.max(0, balance))}
                </span>
              </div>
              {payStatus && (
                <div className="flex justify-end">
                  <span
                    className={`text-xs font-semibold px-2 py-0.5 rounded-full ${paymentStatusColor(payStatus)}`}
                  >
                    {payStatus}
                  </span>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main form component ───────────────────────────────────────────────────────

interface Props {
  series: SeriesRow[];
  cycles: CycleRow[];
}

export function NewInvestorForm({ series, cycles }: Props) {
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<FoundInvestor[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [selectedInvestor, setSelectedInvestor] = useState<FoundInvestor | null>(null);
  const [mode, setMode] = useState<"search" | "new">("search");

  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successData, setSuccessData] = useState<SuccessData | null>(null);
  const [createdInvestor, setCreatedInvestor] = useState<SuccessData["investor"] | null>(null);

  const investorForm = useForm<NewInvestorData>({
    resolver: zodResolver(newInvestorSchema),
  });

  const investmentForm = useForm<InvestmentData>({
    resolver: zodResolver(investmentSchema),
    defaultValues: { series_id: "", cycle_id: "" },
  });

  const search = useCallback(async (q: string) => {
    if (q.length < 3) {
      setSearchResults([]);
      return;
    }
    setIsSearching(true);
    try {
      const res = await fetch(
        `/api/admin/investors?search=${encodeURIComponent(q)}`
      );
      const json = await res.json();
      setSearchResults(json.investors ?? []);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => search(searchQuery), 350);
    return () => clearTimeout(t);
  }, [searchQuery, search]);

  const handleSelectInvestor = (inv: FoundInvestor) => {
    setSelectedInvestor(inv);
    setSearchResults([]);
    setSearchQuery("");
  };

  const handleSubmit = async () => {
    setServerError(null);

    const investmentValid = await investmentForm.trigger();
    if (!investmentValid) return;

    const investmentData = investmentForm.getValues();

    let investorId: string;
    let isNewInvestor = false;
    let newInvestorData: SuccessData["investor"] | null = null;

    if (selectedInvestor) {
      investorId = selectedInvestor.id;
    } else {
      const investorValid = await investorForm.trigger();
      if (!investorValid) return;

      const investorData = investorForm.getValues();
      setIsSubmitting(true);

      const res = await fetch("/api/admin/investors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(investorData),
      });

      const json = await res.json();

      if (!res.ok) {
        setServerError(json.error ?? "Failed to create investor account.");
        setIsSubmitting(false);
        return;
      }

      investorId = json.investor.id;
      isNewInvestor = true;
      newInvestorData = {
        id: json.investor.id,
        full_name: json.investor.full_name,
        investor_code: json.investor.investor_code,
        email: json.investor.email,
      };
      setCreatedInvestor(newInvestorData);
    }

    setIsSubmitting(true);

    const invRes = await fetch("/api/admin/investments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        investor_id: investorId,
        series_id: investmentData.series_id,
        cycle_id: investmentData.cycle_id,
        units: investmentData.units,
        investment_date: investmentData.investment_date,
        notes: investmentData.notes,
        payment_amount: investmentData.payment_amount || undefined,
        payment_date: investmentData.payment_date || undefined,
        payment_reference: investmentData.payment_reference || undefined,
        send_onboarding_email: isNewInvestor,
      }),
    });

    const invJson = await invRes.json();

    if (!invRes.ok) {
      setServerError(invJson.error ?? "Failed to create investment.");
      setIsSubmitting(false);
      return;
    }

    if (invJson.warning) {
      toast.warning(invJson.warning);
    }

    // Build success data from what we have
    const inv = invJson.investment;
    const selectedCycle = cycles.find((c) => c.id === investmentData.cycle_id);
    const selectedSeries = series.find((s) => s.id === investmentData.series_id);

    const finalInvestorData = selectedInvestor
      ? {
          id: selectedInvestor.id,
          full_name: selectedInvestor.full_name,
          investor_code: selectedInvestor.investor_code,
          email: selectedInvestor.email,
        }
      : newInvestorData ?? {
          id: investorId,
          full_name: investorForm.getValues("full_name"),
          investor_code: "—",
          email: investorForm.getValues("email"),
        };

    const totalPaid =
      investmentData.payment_amount && investmentData.payment_amount > 0
        ? investmentData.payment_amount
        : 0;

    setSuccessData({
      investor: finalInvestorData,
      investment: {
        id: inv.id,
        investment_code: inv.investment_code,
        units: investmentData.units,
        capital: inv.capital,
        investment_date: investmentData.investment_date,
        maturity_date: inv.maturity_date,
      },
      series_name: selectedSeries?.name ?? "—",
      cycle_label: selectedCycle?.cycle_label ?? "—",
      cycle_start: selectedCycle?.start_date ?? "",
      cycle_end: selectedCycle?.end_date ?? "",
      total_paid: totalPaid,
      invitation_status: invJson.invitation_status ?? "not_sent",
      email_sent: invJson.email_sent ?? false,
      email_error: invJson.email_error,
    });

    setIsSubmitting(false);
  };

  const handleAddAnother = () => {
    setSuccessData(null);
    setCreatedInvestor(null);
    setSelectedInvestor(null);
    setMode("search");
    setServerError(null);
    investorForm.reset();
    investmentForm.reset({ series_id: "", cycle_id: "" });
  };

  if (successData) {
    return <SuccessScreen data={successData} onAddAnother={handleAddAnother} />;
  }

  const kycVariant: Record<string, "approved" | "pending" | "rejected"> = {
    approved: "approved",
    pending: "pending",
    rejected: "rejected",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary-100 text-primary-700">
          <UserPlus className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Add Investor</h1>
          <p className="text-sm text-muted">
            Search for an existing investor or create a new account.
          </p>
        </div>
      </div>

      {/* Step 1: Investor selection */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            <User className="h-4 w-4" />
            Investor
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedInvestor ? (
            <div className="rounded-lg bg-green-50 border border-green-200 p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary-100 text-primary-700 font-bold text-sm flex-shrink-0">
                    {selectedInvestor.full_name.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-semibold text-foreground">
                        {selectedInvestor.full_name}
                      </p>
                      <Badge
                        variant={
                          kycVariant[selectedInvestor.kyc_status] ?? "pending"
                        }
                      >
                        KYC{" "}
                        {selectedInvestor.kyc_status.charAt(0).toUpperCase() +
                          selectedInvestor.kyc_status.slice(1)}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted">
                      {selectedInvestor.email} · {selectedInvestor.investor_code}
                    </p>
                    {selectedInvestor.phone && (
                      <p className="text-xs text-muted">{selectedInvestor.phone}</p>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedInvestor(null);
                    setMode("search");
                  }}
                  className="text-xs text-muted hover:text-foreground underline flex-shrink-0"
                >
                  Change
                </button>
              </div>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-green-700">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Existing investor — a new investment will be added to their account.
                No new auth account will be created.
              </div>
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">
                  Search existing investor
                </label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by email or phone number…"
                    className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                  />
                  {isSearching && (
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary-300 border-t-primary-700" />
                    </div>
                  )}
                </div>

                {searchResults.length > 0 && (
                  <div className="rounded-lg border border-border bg-white shadow-lg overflow-hidden">
                    {searchResults.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        onClick={() => handleSelectInvestor(inv)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-primary-50 transition-colors border-b border-border last:border-0"
                      >
                        <div>
                          <p className="font-medium text-sm text-foreground">
                            {inv.full_name}
                          </p>
                          <p className="text-xs text-muted">
                            {inv.email} · {inv.investor_code}
                          </p>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted" />
                      </button>
                    ))}
                  </div>
                )}

                {searchQuery.length >= 3 &&
                  !isSearching &&
                  searchResults.length === 0 && (
                    <p className="text-xs text-muted pt-1">
                      No investor found with that email or phone.
                    </p>
                  )}
              </div>

              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-border" />
                <span className="text-xs text-muted">or</span>
                <div className="h-px flex-1 bg-border" />
              </div>

              <div>
                <button
                  type="button"
                  onClick={() => setMode(mode === "new" ? "search" : "new")}
                  className="flex items-center gap-2 text-sm font-medium text-primary-600 hover:text-primary-700 transition-colors"
                >
                  <UserPlus className="h-4 w-4" />
                  {mode === "new"
                    ? "Cancel — search instead"
                    : "Create new investor account"}
                </button>
              </div>

              {mode === "new" && (
                <div className="space-y-4 pt-2 border-t border-border">
                  <p className="text-xs text-muted">
                    An invitation email with a secure password-setup link will be
                    sent to the address below after the investment is created.
                  </p>
                  <Input
                    {...investorForm.register("full_name")}
                    label="Full Name"
                    placeholder="Aminu Ibrahim"
                    error={investorForm.formState.errors.full_name?.message}
                    required
                  />
                  <Input
                    {...investorForm.register("email")}
                    type="email"
                    label="Email Address"
                    placeholder="investor@example.com"
                    error={investorForm.formState.errors.email?.message}
                    required
                  />
                  <Input
                    {...investorForm.register("phone")}
                    type="tel"
                    label="Phone Number"
                    placeholder="+2348012345678"
                  />
                  <Input
                    {...investorForm.register("address")}
                    label="Address"
                    placeholder="123 Main Street, Lagos"
                  />
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Step 2: Investment + Payment */}
      {(selectedInvestor || mode === "new") && (
        <InvestmentSection
          series={series}
          cycles={cycles}
          form={investmentForm}
        />
      )}

      {serverError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 flex-shrink-0" />
          <p className="text-sm text-red-700">{serverError}</p>
        </div>
      )}

      {(selectedInvestor || mode === "new") && (
        <div className="flex gap-3">
          <Button
            type="button"
            onClick={handleSubmit}
            loading={isSubmitting}
            className="flex-1 sm:flex-none sm:min-w-48"
          >
            {isSubmitting
              ? "Saving…"
              : selectedInvestor
              ? "Add Investment"
              : "Create Investor & Add Investment"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setMode("search");
              setSelectedInvestor(null);
              setServerError(null);
            }}
            disabled={isSubmitting}
          >
            Cancel
          </Button>
        </div>
      )}
    </div>
  );
}
