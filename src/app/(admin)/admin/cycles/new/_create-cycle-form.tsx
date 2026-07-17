"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, AlertCircle, Calendar, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectTrigger, SelectValue,
  SelectContent, SelectItem,
} from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import { calcMaturityDateStr, calcCycleLabel, parseCycleDate } from "@/lib/cycle-dates";

interface SeriesOption {
  id: string;
  name: "A" | "B" | "C";
}

interface Props {
  series: SeriesOption[];
  defaultUnitValue: number;
}

const STATUSES = [
  { value: "draft",               label: "Draft" },
  { value: "subscription_open",   label: "Subscription Open" },
  { value: "subscription_closed", label: "Subscription Closed" },
  { value: "upcoming",            label: "Upcoming" },
  { value: "active",              label: "Active" },
] as const;

export function CreateCycleForm({ series, defaultUnitValue }: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [seriesId, setSeriesId] = useState("");
  const [startDate, setStartDate] = useState("");
  const [cycleLabel, setCycleLabel] = useState("");
  const [subOpenDate, setSubOpenDate] = useState("");
  const [subCloseDate, setSubCloseDate] = useState("");
  const [unitValue, setUnitValue] = useState(String(defaultUnitValue));
  const [status, setStatus] = useState<string>("draft");
  const [notes, setNotes] = useState("");

  // Live date preview
  const datePreview = useMemo(() => {
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null;
    try {
      const maturityStr = calcMaturityDateStr(startDate);
      const autoLabel = calcCycleLabel(startDate);
      const start = parseCycleDate(startDate);
      const maturity = parseCycleDate(maturityStr);
      return { startDate: start, maturityDate: maturity, autoLabel, maturityStr };
    } catch {
      return null;
    }
  }, [startDate]);

  const displayLabel = cycleLabel.trim() || datePreview?.autoLabel || "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!seriesId) { setError("Please select a series."); return; }
    if (!startDate) { setError("Start date is required."); return; }
    if (!datePreview) { setError("Invalid start date."); return; }

    const unitValueNum = parseFloat(unitValue);
    if (isNaN(unitValueNum) || unitValueNum <= 0) {
      setError("Unit value must be a positive number.");
      return;
    }

    if (subOpenDate && subCloseDate && subCloseDate <= subOpenDate) {
      setError("Subscription close date must be after the open date.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/cycles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          series_id: seriesId,
          start_date: startDate,
          cycle_label: cycleLabel.trim() || undefined,
          subscription_open_date: subOpenDate || null,
          subscription_close_date: subCloseDate || null,
          unit_value: unitValueNum,
          status,
          notes: notes.trim() || null,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to create cycle.");
        return;
      }

      toast.success("Cycle created successfully.");
      router.push("/admin/cycles");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Series */}
      <Select value={seriesId} onValueChange={setSeriesId}>
        <SelectTrigger label="Series" error={!seriesId && error ? "Required" : undefined}>
          <SelectValue placeholder="Select series" />
        </SelectTrigger>
        <SelectContent>
          {series.map((s) => (
            <SelectItem key={s.id} value={s.id}>
              MaalGrow Series {s.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Start date */}
      <Input
        label="Start Date"
        type="date"
        value={startDate}
        onChange={(e) => setStartDate(e.target.value)}
        required
      />

      {/* Date preview */}
      {datePreview && (
        <div className="rounded-xl border border-primary-100 bg-primary-50 p-4 space-y-2 text-sm">
          <p className="text-xs font-semibold text-primary-700 uppercase tracking-wide flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> Date Preview
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-primary-600 uppercase tracking-wide">Start</p>
              <p className="font-semibold text-primary-900">{formatDate(datePreview.startDate)}</p>
            </div>
            <div>
              <p className="text-[10px] text-primary-600 uppercase tracking-wide">Maturity</p>
              <p className="font-semibold text-primary-900">{formatDate(datePreview.maturityDate)}</p>
            </div>
          </div>
          <p className="text-xs text-primary-600 flex items-center gap-1">
            <Info className="h-3 w-3" /> Duration: 3 calendar months
          </p>
          <p className="text-xs text-primary-600">
            Auto-label: <span className="font-medium">{datePreview.autoLabel}</span>
          </p>
        </div>
      )}

      {/* Cycle label (optional override) */}
      <Input
        label="Cycle Label (optional)"
        value={cycleLabel}
        onChange={(e) => setCycleLabel(e.target.value)}
        placeholder={datePreview?.autoLabel ?? "e.g. Jan 2026 – Mar 2026"}
        hint={displayLabel ? `Will be saved as: ${displayLabel}` : undefined}
      />

      {/* Subscription dates */}
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Subscription Opens"
          type="date"
          value={subOpenDate}
          onChange={(e) => setSubOpenDate(e.target.value)}
          hint="Optional"
        />
        <Input
          label="Subscription Closes"
          type="date"
          value={subCloseDate}
          onChange={(e) => setSubCloseDate(e.target.value)}
          hint="Optional"
        />
      </div>

      {/* Unit value */}
      <Input
        label="Unit Value (₦)"
        type="number"
        min="1"
        step="1"
        value={unitValue}
        onChange={(e) => setUnitValue(e.target.value)}
        required
        hint="Price per investment slot for this cycle"
      />

      {/* Status */}
      <Select value={status} onValueChange={setStatus}>
        <SelectTrigger label="Initial Status">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {STATUSES.map((s) => (
            <SelectItem key={s.value} value={s.value}>
              {s.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Notes */}
      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">Notes (optional)</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any internal notes about this cycle..."
          rows={3}
          className="w-full rounded-lg border border-border bg-white px-3 py-2 text-sm text-foreground placeholder:text-muted/60 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
        />
      </div>

      {error && (
        <div className="rounded-lg bg-red-50 border border-red-200 p-3 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-red-500 mt-0.5 shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => router.back()}
          disabled={isSubmitting}
        >
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting} className="flex-1">
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
          {isSubmitting ? "Creating…" : "Create Cycle"}
        </Button>
      </div>
    </form>
  );
}
