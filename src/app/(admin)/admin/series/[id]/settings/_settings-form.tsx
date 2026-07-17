"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface SeriesData {
  id: string;
  name: "A" | "B" | "C";
  description: string | null;
  mudarabah_investor_ratio: number;
  price_per_unit: number;
  min_units: number;
  max_units: number | null;
  is_active: boolean;
}

interface Props {
  series: SeriesData;
}

export function SeriesSettingsForm({ series }: Props) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    description: series.description ?? "",
    investor_ratio_pct: Math.round(series.mudarabah_investor_ratio * 100),
    price_per_unit: series.price_per_unit,
    min_units: series.min_units,
    max_units: series.max_units !== null ? series.max_units.toString() : "",
    is_active: series.is_active,
  });

  const companyPct = 100 - form.investor_ratio_pct;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const rationPct = Number(form.investor_ratio_pct);
    if (!rationPct || rationPct < 1 || rationPct > 99) {
      toast.error("Investor profit share must be between 1% and 99%");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/series/${series.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: form.description.trim() || null,
          mudarabah_investor_ratio: rationPct / 100,
          price_per_unit: Number(form.price_per_unit),
          min_units: Number(form.min_units),
          max_units: form.max_units.trim() === "" ? null : Number(form.max_units),
          is_active: form.is_active,
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Failed to save settings");
      } else {
        toast.success("Settings saved");
        router.refresh();
      }
    } catch {
      toast.error("Network error — please try again");
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Description */}
      <div className="space-y-1.5">
        <label htmlFor="description" className="block text-sm font-medium text-foreground">
          Description
        </label>
        <Input
          id="description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          placeholder="Brief description of this series"
          maxLength={200}
        />
      </div>

      {/* Profit sharing ratio */}
      <div className="space-y-1.5">
        <label htmlFor="investor_ratio" className="block text-sm font-medium text-foreground">
          Investor Profit Share (%)
        </label>
        <div className="flex items-center gap-3">
          <Input
            id="investor_ratio"
            type="number"
            min={1}
            max={99}
            step={1}
            required
            value={form.investor_ratio_pct}
            onChange={(e) =>
              setForm((f) => ({ ...f, investor_ratio_pct: Number(e.target.value) }))
            }
            className="w-28"
          />
          <span className="text-sm text-muted">
            % to investors / {companyPct >= 0 ? companyPct : "—"}% to company
          </span>
        </div>
        <p className="text-xs text-muted">
          Mudārabah profit sharing ratio applied when profit is declared after each cycle.
          This is a distribution of actual business profit — not a guaranteed return.
        </p>
      </div>

      {/* Slot value */}
      <div className="space-y-1.5">
        <label htmlFor="price_per_unit" className="block text-sm font-medium text-foreground">
          Slot Value (₦)
        </label>
        <Input
          id="price_per_unit"
          type="number"
          min={1}
          step={1}
          required
          value={form.price_per_unit}
          onChange={(e) =>
            setForm((f) => ({ ...f, price_per_unit: Number(e.target.value) }))
          }
          className="w-48"
        />
        <p className="text-xs text-muted">
          Value of one investment slot in Nigerian Naira.
        </p>
      </div>

      {/* Min slots */}
      <div className="space-y-1.5">
        <label htmlFor="min_units" className="block text-sm font-medium text-foreground">
          Minimum Slots
        </label>
        <Input
          id="min_units"
          type="number"
          min={0.5}
          step={0.5}
          required
          value={form.min_units}
          onChange={(e) =>
            setForm((f) => ({ ...f, min_units: Number(e.target.value) }))
          }
          className="w-28"
        />
        <p className="text-xs text-muted">Minimum number of slots an investor must purchase.</p>
      </div>

      {/* Max slots */}
      <div className="space-y-1.5">
        <label htmlFor="max_units" className="block text-sm font-medium text-foreground">
          Maximum Slots{" "}
          <span className="text-muted font-normal">(optional — leave blank for no limit)</span>
        </label>
        <Input
          id="max_units"
          type="number"
          min={1}
          step={0.5}
          value={form.max_units}
          onChange={(e) => setForm((f) => ({ ...f, max_units: e.target.value }))}
          placeholder="No limit"
          className="w-28"
        />
      </div>

      {/* Active toggle */}
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2 p-4">
        <input
          id="is_active"
          type="checkbox"
          checked={form.is_active}
          onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
          className="h-4 w-4 mt-0.5 rounded border-border text-primary-600 focus:ring-primary-500 cursor-pointer"
        />
        <div>
          <label htmlFor="is_active" className="block text-sm font-medium text-foreground cursor-pointer">
            Series is active
          </label>
          <p className="text-xs text-muted mt-0.5">
            Inactive series are hidden from investor-facing views and cannot accept new
            investments.
          </p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3 border-t border-border pt-4">
        <Button type="submit" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
          Save Settings
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push("/admin/series")}
        >
          <ArrowLeft className="h-4 w-4 mr-1" />
          Back to Series
        </Button>
      </div>
    </form>
  );
}
