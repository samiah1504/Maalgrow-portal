"use client";

import { useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, AlertCircle, Calendar, Info, Clock, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select, SelectTrigger, SelectValue,
  SelectContent, SelectItem,
} from "@/components/ui/select";
import { formatDate, formatDateTime } from "@/lib/utils";
import { calcMaturityDateStr, calcCycleLabel, parseCycleDate } from "@/lib/cycle-dates";

interface AuditEntry {
  id: string;
  action: string;
  changes: Record<string, unknown>;
  changed_at: string;
  changed_by: string | null;
}

interface CycleData {
  id: string;
  cycle_label: string;
  start_date: string;
  end_date: string;
  status: string;
  subscription_open_date: string | null;
  subscription_close_date: string | null;
  unit_value: number | null;
  notes: string | null;
  series: { name: string } | null;
}

interface Props {
  cycle: CycleData;
  auditLog: AuditEntry[];
}

const ALL_STATUSES = [
  { value: "draft",                      label: "Draft" },
  { value: "subscription_open",          label: "Subscription Open" },
  { value: "subscription_closed",        label: "Subscription Closed" },
  { value: "upcoming",                   label: "Upcoming" },
  { value: "active",                     label: "Active" },
  { value: "maturity_window",            label: "Maturity Window" },
  { value: "awaiting_profit_declaration", label: "Awaiting Profit Declaration" },
  { value: "completed",                  label: "Completed" },
  { value: "cancelled",                  label: "Cancelled" },
] as const;

export function EditCycleForm({ cycle, auditLog }: Props) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [cycleLabel, setCycleLabel] = useState(cycle.cycle_label);
  const [startDate, setStartDate] = useState(cycle.start_date);
  const [subOpenDate, setSubOpenDate] = useState(cycle.subscription_open_date ?? "");
  const [subCloseDate, setSubCloseDate] = useState(cycle.subscription_close_date ?? "");
  const [unitValue, setUnitValue] = useState(String(cycle.unit_value ?? ""));
  const [status, setStatus] = useState<string>(cycle.status);
  const [notes, setNotes] = useState(cycle.notes ?? "");

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

  const startDateChanged = startDate !== cycle.start_date;
  const maturityDateDisplay = datePreview?.maturityDate
    ? formatDate(datePreview.maturityDate)
    : formatDate(cycle.end_date);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!startDate) { setError("Start date is required."); return; }
    if (!datePreview && startDateChanged) { setError("Invalid start date."); return; }

    const unitValueNum = unitValue ? parseFloat(unitValue) : undefined;
    if (unitValueNum !== undefined && (isNaN(unitValueNum) || unitValueNum <= 0)) {
      setError("Unit value must be a positive number.");
      return;
    }

    if (subOpenDate && subCloseDate && subCloseDate <= subOpenDate) {
      setError("Subscription close date must be after the open date.");
      return;
    }

    const payload: Record<string, unknown> = {};
    if (cycleLabel.trim() !== cycle.cycle_label) payload.cycle_label = cycleLabel.trim();
    if (startDateChanged) payload.start_date = startDate;
    if ((subOpenDate || null) !== cycle.subscription_open_date) payload.subscription_open_date = subOpenDate || null;
    if ((subCloseDate || null) !== cycle.subscription_close_date) payload.subscription_close_date = subCloseDate || null;
    if (unitValueNum !== undefined && unitValueNum !== cycle.unit_value) payload.unit_value = unitValueNum;
    if (status !== cycle.status) payload.status = status;
    const notesVal = notes.trim() || null;
    if (notesVal !== cycle.notes) payload.notes = notesVal;

    if (Object.keys(payload).length === 0) {
      toast("No changes to save.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/admin/cycles/${cycle.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        setError(json.error ?? "Failed to update cycle.");
        return;
      }

      toast.success("Cycle updated successfully.");
      router.push("/admin/cycles");
      router.refresh();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Series (read-only) */}
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground">Series</label>
          <div className="flex h-10 w-full items-center rounded-lg border border-border bg-surface-2 px-3 text-sm text-muted">
            MaalGrow Series {cycle.series?.name}
          </div>
          <p className="text-xs text-muted">Series cannot be changed after creation</p>
        </div>

        {/* Cycle label */}
        <Input
          label="Cycle Label"
          value={cycleLabel}
          onChange={(e) => setCycleLabel(e.target.value)}
          required
        />

        {/* Start date */}
        <Input
          label="Start Date"
          type="date"
          value={startDate}
          onChange={(e) => setStartDate(e.target.value)}
          required
        />

        {/* Date preview */}
        <div className={`rounded-xl border p-4 space-y-2 text-sm ${startDateChanged ? "border-primary-100 bg-primary-50" : "border-border bg-surface-2"}`}>
          <p className="text-xs font-semibold text-muted uppercase tracking-wide flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" /> {startDateChanged ? "Updated Date Preview" : "Current Dates"}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide">Start</p>
              <p className={`font-semibold ${startDateChanged ? "text-primary-900" : "text-foreground"}`}>
                {datePreview ? formatDate(datePreview.startDate) : formatDate(cycle.start_date)}
              </p>
            </div>
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wide">Maturity</p>
              <p className={`font-semibold ${startDateChanged ? "text-primary-900" : "text-foreground"}`}>
                {maturityDateDisplay}
              </p>
            </div>
          </div>
          {startDateChanged && (
            <p className="text-xs text-primary-600 flex items-center gap-1">
              <Info className="h-3 w-3" /> Duration: 3 calendar months
            </p>
          )}
        </div>

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
          hint="Price per investment slot"
        />

        {/* Status */}
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger label="Status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ALL_STATUSES.map((s) => (
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
            {isSubmitting ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </form>

      {/* Audit Log */}
      {auditLog.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted" /> Change History
          </h3>
          <div className="space-y-2">
            {auditLog.map((entry) => (
              <div key={entry.id} className="rounded-lg border border-border bg-surface-2 p-3 text-xs">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-medium text-foreground capitalize">{entry.action}</span>
                  <span className="text-muted">{formatDateTime(entry.changed_at)}</span>
                </div>
                {entry.action === "update" && (
                  <div className="space-y-1 text-muted">
                    {Object.entries(entry.changes as Record<string, { old: unknown; new: unknown }>).map(([field, { old: oldVal, new: newVal }]) => (
                      <div key={field} className="flex gap-2">
                        <span className="font-mono text-foreground">{field}:</span>
                        <span className="line-through opacity-60">{String(oldVal ?? "—")}</span>
                        <span>→</span>
                        <span className="text-foreground">{String(newVal ?? "—")}</span>
                      </div>
                    ))}
                  </div>
                )}
                {entry.action === "create" && (
                  <p className="text-muted">Cycle created</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
