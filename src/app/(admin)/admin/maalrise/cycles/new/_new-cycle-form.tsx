"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Calculator, CheckCircle2, Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import {
  computeTerms,
  type FeeBasis,
  type FeeTreatment,
  type TermsInput,
} from "@/lib/maalrise/compute";
import { maturityDate, parseIsoDate, periodDueDate } from "@/lib/maalrise/dates";
import {
  FEE_BASIS_LABEL,
  FEE_TREATMENT_LABEL,
  formatBps,
  formatKobo,
  parseNairaToKobo,
  parsePercentToBps,
} from "@/lib/maalrise/format";
import { PhaseNotice } from "@/components/maalrise/sample-notice";
import { useMaalriseAction } from "@/components/maalrise/use-maalrise-action";
import type { ScheduleLineRow, TermsRow } from "@/lib/maalrise/types";

/** An existing Cycle whose terms are being edited; its own fields are fixed by now. */
export type EditTarget = {
  cycle: {
    id: string;
    name: string;
    transaction_name: string;
    description: string | null;
    counterparty_name: string;
    start_date: string;
    duration_months: number;
    stated_maturity_date: string | null;
    unit_price_kobo: number;
  };
  /** The terms to start from: the open draft, or the approved version for a new one. */
  terms: TermsRow | null;
  schedule: ScheduleLineRow[];
};

const koboInput = (k: number | null | undefined) =>
  k == null ? "" : `${Math.floor(k / 100)}${k % 100 ? `.${String(k % 100).padStart(2, "0")}` : ""}`;
const bpsInput = koboInput; // both are hundredths

const textareaClass =
  "flex min-h-[88px] w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-4">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">{children}</CardContent>
    </Card>
  );
}

export function NewCycleForm({
  counterparties,
  edit,
}: {
  counterparties: { id: string; name: string }[];
  edit?: EditTarget;
}) {
  const router = useRouter();
  const { run, busy } = useMaalriseAction();
  const c0 = edit?.cycle;
  const t0 = edit?.terms ?? null;
  const fixed = !!edit; // an existing Cycle: only its terms change here

  // Business and transaction
  const [name, setName] = useState(c0?.name ?? "");
  const [transactionName, setTransactionName] = useState(c0?.transaction_name ?? "");
  const [description, setDescription] = useState(c0?.description ?? "");
  const [counterpartyId, setCounterpartyId] = useState(counterparties.length ? "" : "new");
  const [counterparty, setCounterparty] = useState("");
  const [counterpartyReg, setCounterpartyReg] = useState("");
  const [counterpartyEmail, setCounterpartyEmail] = useState("");

  // Dates
  const [startDate, setStartDate] = useState(c0?.start_date ?? "");
  const [duration, setDuration] = useState(c0 ? String(c0.duration_months) : "");
  const [statedMaturity, setStatedMaturity] = useState(c0?.stated_maturity_date ?? "");

  // Financial terms
  const [cost, setCost] = useState(koboInput(t0?.cost_kobo));
  const [unitPrice, setUnitPrice] = useState(koboInput(c0?.unit_price_kobo));
  const [markupType, setMarkupType] = useState<"percent" | "amount">(t0?.markup_type ?? "percent");
  const [markupValue, setMarkupValue] = useState(
    t0 ? (t0.markup_type === "percent" ? bpsInput(t0.markup_bps) : koboInput(t0.markup_amount_kobo)) : ""
  );
  const [statedSalePrice, setStatedSalePrice] = useState(koboInput(t0?.stated_sale_price_kobo));

  // Service fee — no default treatment: the contract decides.
  const [feeBasis, setFeeBasis] = useState<FeeBasis>(t0?.fee_basis ?? "markup");
  const [feeValue, setFeeValue] = useState(
    t0 ? (t0.fee_basis === "fixed" ? koboInput(t0.fee_amount_kobo) : bpsInput(t0.fee_bps)) : ""
  );
  const [feeTreatment, setFeeTreatment] = useState<FeeTreatment | "">(t0?.fee_treatment ?? "");

  // Schedule
  const [scheduleMode, setScheduleMode] = useState<"equal" | "contract">(t0?.schedule_mode ?? "equal");
  const [contractAmounts, setContractAmounts] = useState<string[]>(
    t0?.schedule_mode === "contract" ? [...(edit?.schedule ?? [])].sort((a, b) => a.period - b.period).map((l) => koboInput(l.investor_net_kobo)) : []
  );

  const [checked, setChecked] = useState(false);

  const months = /^\d+$/.test(duration) ? Number(duration) : 0;

  const parsed = useMemo(() => {
    const costKobo = parseNairaToKobo(cost);
    const markupNum =
      markupType === "percent" ? parsePercentToBps(markupValue) : parseNairaToKobo(markupValue);
    const feeNum = feeBasis === "fixed" ? parseNairaToKobo(feeValue) : parsePercentToBps(feeValue);
    const stated = statedSalePrice.trim() ? parseNairaToKobo(statedSalePrice) : null;
    const contractKobo = contractAmounts.slice(0, months).map((a) => parseNairaToKobo(a) ?? NaN);
    return { costKobo, markupNum, feeNum, stated, contractKobo };
  }, [cost, markupType, markupValue, feeBasis, feeValue, statedSalePrice, contractAmounts, months]);

  const ready =
    parsed.costKobo !== null &&
    parsed.markupNum !== null &&
    months > 0 &&
    feeTreatment !== "" &&
    (feeTreatment === "waived" || parsed.feeNum !== null);

  const breakdown = useMemo(() => {
    if (!ready) return null;
    const input: TermsInput = {
      costKobo: parsed.costKobo!,
      markup:
        markupType === "percent"
          ? { type: "percent", bps: parsed.markupNum! }
          : { type: "amount", kobo: parsed.markupNum! },
      statedSalePriceKobo: parsed.stated,
      fee:
        feeBasis === "fixed"
          ? { basis: "fixed", kobo: parsed.feeNum ?? 0, treatment: feeTreatment as FeeTreatment }
          : { basis: feeBasis, bps: parsed.feeNum ?? 0, treatment: feeTreatment as FeeTreatment },
      durationMonths: months,
      schedule:
        scheduleMode === "equal"
          ? { mode: "equal" }
          : { mode: "contract", netKobo: Array.from({ length: months }, (_, i) => parsed.contractKobo[i] ?? NaN) },
    };
    return computeTerms(input);
  }, [ready, parsed, markupType, feeBasis, feeTreatment, months, scheduleMode]);

  const computedMaturity = startDate && months > 0 ? maturityDate(startDate, months) : null;
  const unitPriceKobo = parseNairaToKobo(unitPrice);
  const unitsRequired =
    parsed.costKobo && unitPriceKobo ? Math.ceil(parsed.costKobo / unitPriceKobo) : null;

  const formErrors: string[] = [];
  if (!name.trim()) formErrors.push("Cycle name is required.");
  if (!transactionName.trim()) formErrors.push("Business or transaction name is required.");
  if (!fixed && counterpartyId === "") formErrors.push("Choose the counterparty, or add a new one.");
  if (!fixed && counterpartyId === "new" && !counterparty.trim()) formErrors.push("Enter the new counterparty's name.");
  if (!startDate || !parseIsoDate(startDate)) formErrors.push("A valid transaction start date is required.");
  if (months <= 0) formErrors.push("Duration must be a whole number of months.");
  if (parsed.costKobo === null) formErrors.push("Transaction cost must be a naira amount, e.g. 100000000 or 100,000,000.00.");
  if (parsed.markupNum === null) formErrors.push("Enter the markup as the contract states it.");
  if (feeTreatment === "") formErrors.push("Choose how the service fee is treated — the contract decides this; there is no default.");
  if (feeTreatment !== "waived" && parsed.feeNum === null) formErrors.push("Enter the service fee (0 is allowed).");
  if (unitPriceKobo === null) formErrors.push("Unit price is required to work out units and participation.");
  if (statedMaturity && computedMaturity && statedMaturity !== computedMaturity) {
    formErrors.push(
      `The contract's maturity date (${statedMaturity}) differs from start + duration (${computedMaturity}). Confirm which the contract intends.`
    );
  }
  if (unitsRequired !== null && parsed.costKobo !== null && unitPriceKobo && parsed.costKobo % unitPriceKobo !== 0) {
    formErrors.push("Transaction cost is not a whole number of units at this unit price.");
  }
  const allErrors = [...formErrors, ...(breakdown?.errors.map((e) => e.message) ?? [])];

  const canSave = !!breakdown && allErrors.length === 0;

  /** Inputs only; the server and then the database recalculate every figure. */
  function termsPayload() {
    const fee = feeTreatment === "waived" ? 0 : parsed.feeNum ?? 0;
    return {
      costKobo: parsed.costKobo,
      markup: markupType === "percent" ? { type: "percent", bps: parsed.markupNum } : { type: "amount", kobo: parsed.markupNum },
      fee: feeBasis === "fixed" ? { basis: "fixed", kobo: fee, treatment: feeTreatment } : { basis: feeBasis, bps: fee, treatment: feeTreatment },
      schedule: scheduleMode === "equal" ? { mode: "equal" } : { mode: "contract", netKobo: parsed.contractKobo },
      statedSalePriceKobo: parsed.stated,
    };
  }

  async function save() {
    setChecked(true);
    if (!canSave) return;
    if (edit) {
      await run("save", `/api/admin/maalrise/cycles/${edit.cycle.id}/terms`, { terms: termsPayload() }, {
        method: "PUT",
        success: "Draft terms saved. Submit them for approval from the Cycle page.",
        onDone: () => router.push(`/admin/maalrise/cycles/${edit.cycle.id}#terms`),
      });
      return;
    }
    await run("save", "/api/admin/maalrise/cycles", {
      counterparty: counterpartyId === "new"
        ? { name: counterparty, registration_no: counterpartyReg, contact_email: counterpartyEmail }
        : { id: counterpartyId },
      cycle: {
        name, transaction_name: transactionName, description, start_date: startDate,
        duration_months: months, stated_maturity_date: statedMaturity || null, unit_price_kobo: unitPriceKobo,
      },
      terms: termsPayload(),
    }, {
      success: "Draft Cycle created. Nothing has been submitted, approved or sent to anyone.",
      onDone: (d) => { if (typeof d.id === "string") router.push(`/admin/maalrise/cycles/${d.id}`); },
    });
  }

  const setContractAmount = (i: number, v: string) =>
    setContractAmounts((prev) => {
      const next = [...prev];
      next[i] = v;
      return next;
    });

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <form className="space-y-6" onSubmit={(e) => { e.preventDefault(); setChecked(true); }}>
        <FormSection title="1. Cycle and business">
          {fixed && (
            <p className="text-xs text-muted">The Cycle&apos;s name, counterparty, dates and unit price are set when it is created. Only its terms change here.</p>
          )}
          <Input label="Cycle name" placeholder="e.g. MaalRise Cycle One" value={name} onChange={(e) => setName(e.target.value)} required disabled={fixed} />
          <Input label="Business or transaction name" value={transactionName} onChange={(e) => setTransactionName(e.target.value)} required disabled={fixed} />
          <div className="space-y-1.5">
            <label htmlFor="description" className="block text-sm font-medium text-foreground">Description</label>
            <textarea id="description" className={textareaClass} value={description} onChange={(e) => setDescription(e.target.value)} disabled={fixed}
              placeholder="What is being bought and sold, and on what terms — this is shown to investors once approved." />
          </div>
          {fixed ? (
            <Input label="Counterparty / business" value={c0?.counterparty_name ?? ""} disabled />
          ) : (
            <>
              <div className="space-y-1.5">
                <label htmlFor="counterparty" className="block text-sm font-medium text-foreground">Counterparty / business</label>
                <select id="counterparty" value={counterpartyId} onChange={(e) => setCounterpartyId(e.target.value)}
                  className="flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20">
                  <option value="">Select…</option>
                  {counterparties.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  <option value="new">+ Add a new counterparty</option>
                </select>
              </div>
              {counterpartyId === "new" && (
                <div className="grid gap-4 sm:grid-cols-3">
                  <Input label="New counterparty name" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} required />
                  <Input label="Registration (RC no.)" value={counterpartyReg} onChange={(e) => setCounterpartyReg(e.target.value)} />
                  <Input label="Contact email" type="email" value={counterpartyEmail} onChange={(e) => setCounterpartyEmail(e.target.value)}
                    hint="Kept on record only — nothing is sent" />
                </div>
              )}
            </>
          )}
        </FormSection>

        <FormSection title="2. Dates">
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Transaction start date" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required disabled={fixed} />
            <Input label="Duration (months)" inputMode="numeric" value={duration} onChange={(e) => setDuration(e.target.value.replace(/\D/g, ""))} required disabled={fixed} />
            <Input label="Maturity date per contract" type="date" value={statedMaturity} onChange={(e) => setStatedMaturity(e.target.value)} disabled={fixed}
              hint={computedMaturity ? `Start + duration: ${formatDate(computedMaturity)}` : "Optional — checked against start + duration"} />
          </div>
        </FormSection>

        <FormSection title="3. Financial terms">
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Transaction cost (₦)" inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} required />
            <Input label="Unit price (₦)" inputMode="decimal" value={unitPrice} onChange={(e) => setUnitPrice(e.target.value)} disabled={fixed}
              hint={unitsRequired ? `${unitsRequired.toLocaleString("en-NG")} units to fully fund the cost` : "Used for units and participation"} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Select value={markupType} onValueChange={(v) => setMarkupType(v as "percent" | "amount")}>
              <SelectTrigger label="Murabaha markup entered as"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="percent">Percentage of cost — total for the whole Cycle</SelectItem>
                <SelectItem value="amount">Fixed amount</SelectItem>
              </SelectContent>
            </Select>
            <Input label={markupType === "percent" ? "Total markup for the Cycle (%)" : "Total markup for the Cycle (₦)"}
              inputMode="decimal" value={markupValue} onChange={(e) => setMarkupValue(e.target.value)} required
              hint={markupType === "percent" ? "The total for the whole Cycle duration — not an annual or monthly rate." : undefined} />
          </div>
          <Input label="Agreed sale price per contract (₦)" inputMode="decimal" value={statedSalePrice}
            onChange={(e) => setStatedSalePrice(e.target.value)}
            hint="Optional. If entered, it must equal cost + markup exactly or the terms cannot be submitted." />
        </FormSection>

        <FormSection title="4. Service fee (separate from markup)">
          <div className="grid gap-4 sm:grid-cols-2">
            <Select value={feeBasis} onValueChange={(v) => setFeeBasis(v as FeeBasis)}>
              <SelectTrigger label="Fee basis"><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(FEE_BASIS_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input label={feeBasis === "fixed" ? "Fee amount (₦)" : "Fee rate (%)"} inputMode="decimal" value={feeValue}
              onChange={(e) => setFeeValue(e.target.value)} disabled={feeTreatment === "waived"}
              hint="0%, 5% or any agreed rate" />
          </div>
          <Select value={feeTreatment} onValueChange={(v) => setFeeTreatment(v as FeeTreatment)}>
            <SelectTrigger label="Fee treatment per contract"><SelectValue placeholder="Select the treatment the contract states" /></SelectTrigger>
            <SelectContent>
              {Object.entries(FEE_TREATMENT_LABEL).map(([k, l]) => <SelectItem key={k} value={k}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </FormSection>

        <FormSection title="5. Monthly profit schedule">
          <Select value={scheduleMode} onValueChange={(v) => setScheduleMode(v as "equal" | "contract")}>
            <SelectTrigger label="Schedule type"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="equal">Equal monthly instalments</SelectItem>
              <SelectItem value="contract">Contract-specific monthly amounts</SelectItem>
            </SelectContent>
          </Select>
          {scheduleMode === "contract" && (
            months > 0 ? (
              <div className="grid gap-3 sm:grid-cols-3">
                {Array.from({ length: months }, (_, i) => (
                  <Input key={i} label={`Month ${i + 1} — net to investors (₦)`} inputMode="decimal"
                    value={contractAmounts[i] ?? ""} onChange={(e) => setContractAmount(i, e.target.value)} />
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted">Enter the duration first.</p>
            )
          )}
          <p className="text-xs text-muted">
            No part-month prorating is applied. The schedule must reconcile to the contractual total to the kobo.
          </p>
        </FormSection>

        <FormSection title="6. Tax, documents and approval">
          <PhaseNotice>
            <p><strong>Tax:</strong> no withholding is applied. Tax treatment stays unconfigured until the applicable Nigerian treatment is confirmed (A12).</p>
            <p className="mt-1"><strong>Documents:</strong> the original contract and supporting files are uploaded from the Cycle&apos;s Documents section once document storage is connected (next phase).</p>
            <p className="mt-1"><strong>Approval:</strong> whoever prepares or submits these terms cannot approve them. Approval freezes the terms and this breakdown.</p>
          </PhaseNotice>
        </FormSection>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" variant="outline">
            <CheckCircle2 className="h-4 w-4" /> Check terms
          </Button>
          <Button type="button" onClick={save} disabled={checked && !canSave} loading={busy === "save"}>
            <Save className="h-4 w-4" /> {fixed ? "Save draft terms" : "Save draft Cycle"}
          </Button>
        </div>
        <PhaseNotice>
          Saving creates or updates a <strong>draft</strong> only. Submitting for approval is a separate step on the Cycle page;
          nothing here approves, activates or notifies anyone.
        </PhaseNotice>

        {checked && (
          allErrors.length === 0 ? (
            <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 mt-0.5" /> All checks pass. These terms would be ready to submit for approval.
            </div>
          ) : (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
              <p className="flex items-center gap-2 font-semibold"><AlertCircle className="h-4 w-4" /> {allErrors.length} issue(s) to resolve</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-xs">
                {allErrors.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          )
        )}
      </form>

      <div className="space-y-6 xl:sticky xl:top-0 xl:self-start">
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-base">
              <Calculator className="h-4 w-4 text-primary-600" /> Calculation breakdown
            </CardTitle>
            <p className="text-xs text-muted">Whole kobo; percentages rounded half-up once, at the step shown.</p>
          </CardHeader>
          <CardContent>
            {!breakdown ? (
              <p className="text-sm text-muted">
                Enter the cost, markup, duration and fee treatment to see the breakdown.
              </p>
            ) : (
              <div className="space-y-4">
                <dl className="divide-y divide-border text-sm">
                  {[
                    ["Transaction cost", formatKobo(breakdown.costKobo)],
                    ["Murabaha markup", `${formatKobo(breakdown.markupKobo)} (${formatBps(breakdown.markupBpsOfCost)} of cost)`],
                    ["Agreed sale price (cost + markup)", formatKobo(breakdown.salePriceKobo)],
                    ["Service fee", `${formatKobo(breakdown.feeKobo)} — ${FEE_TREATMENT_LABEL[breakdown.feeTreatment]}`],
                    ["Investor profit pool", formatKobo(breakdown.investorProfitPoolKobo)],
                    ["Total payable by counterparty", formatKobo(breakdown.counterpartyTotalKobo)],
                    ["Capital due at maturity", formatKobo(breakdown.capitalAtMaturityKobo)],
                  ].map(([l, v]) => (
                    <div key={l} className="flex justify-between gap-4 py-2">
                      <dt className="text-muted">{l}</dt>
                      <dd className="text-right font-medium text-foreground">{v}</dd>
                    </div>
                  ))}
                </dl>

                {breakdown.schedule.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-border text-left text-muted">
                          <th className="py-1.5 font-medium">Month</th>
                          <th className="py-1.5 font-medium">Due</th>
                          <th className="py-1.5 text-right font-medium">Counterparty gross</th>
                          <th className="py-1.5 text-right font-medium">Fee</th>
                          <th className="py-1.5 text-right font-medium">Net to investors</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {breakdown.schedule.map((l) => {
                          const due = startDate ? periodDueDate(startDate, l.period) : null;
                          return (
                            <tr key={l.period}>
                              <td className="py-1.5">{l.period}</td>
                              <td className="py-1.5 text-muted">{due ? formatDate(due) : "—"}</td>
                              <td className="py-1.5 text-right">{formatKobo(l.counterpartyGrossKobo)}</td>
                              <td className="py-1.5 text-right">{formatKobo(l.feeKobo)}</td>
                              <td className="py-1.5 text-right font-medium">
                                {formatKobo(l.investorNetKobo)}
                                {l.roundingAdjustmentKobo > 0 && (
                                  <span className="block text-[10px] text-amber-700">
                                    incl. rounding {formatKobo(l.roundingAdjustmentKobo)}
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="border-t border-border font-semibold">
                          <td className="py-1.5" colSpan={2}>Total</td>
                          <td className="py-1.5 text-right">{formatKobo(breakdown.scheduleTotals.counterpartyGrossKobo)}</td>
                          <td className="py-1.5 text-right">{formatKobo(breakdown.scheduleTotals.feeKobo)}</td>
                          <td className="py-1.5 text-right">{formatKobo(breakdown.scheduleTotals.investorNetKobo)}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}

                {breakdown.errors.length > 0 && (
                  <ul className="space-y-1 rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800">
                    {breakdown.errors.map((e) => <li key={e.message}>{e.message}</li>)}
                  </ul>
                )}
                <ul className="space-y-1 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  {breakdown.notes.map((n) => <li key={n}>{n}</li>)}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
