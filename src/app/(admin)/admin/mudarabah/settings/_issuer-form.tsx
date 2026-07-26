"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Save, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export type Issuer = {
  companyName: string;
  companyAddress: string;
  companyTin: string;
  signatoryName: string;
  signatoryTitle: string;
};

const FIELDS: { key: keyof Issuer; label: string; hint?: string; required?: boolean }[] = [
  { key: "companyName", label: "Company name", required: true },
  { key: "companyAddress", label: "Company address" },
  { key: "companyTin", label: "Company tax identification number" },
  { key: "signatoryName", label: "Authorised signatory" },
  { key: "signatoryTitle", label: "Signatory title", hint: "For example, Managing Director" },
];

export function IssuerForm({ initial }: { initial: Issuer }) {
  const router = useRouter();
  const [form, setForm] = useState<Issuer>(initial);
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!form.companyName.trim()) {
      toast.error("The company name appears on every credit note — it cannot be blank.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/admin/mudarabah/issuer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not save the issuer details");
      toast.success("Credit note settings saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the issuer details");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex gap-2 rounded-lg bg-surface-2 p-3 text-xs text-muted">
          <Info className="h-4 w-4 shrink-0 mt-0.5" />
          <p>
            These appear on every credit note. A note already issued keeps the details
            it was issued with — changing them here affects notes issued from now on,
            so an investor&apos;s copy never disagrees with yours.
          </p>
        </div>

        {FIELDS.map((f) => (
          <div key={f.key}>
            <label
              htmlFor={f.key}
              className="block text-xs font-semibold uppercase tracking-wide text-muted mb-1.5"
            >
              {f.label}
              {f.required && <span className="text-red-600"> *</span>}
            </label>
            <input
              id={f.key}
              type="text"
              value={form[f.key]}
              onChange={(e) => setForm((s) => ({ ...s, [f.key]: e.target.value }))}
              className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
            {f.hint && <p className="text-[11px] text-muted mt-1">{f.hint}</p>}
          </div>
        ))}

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="inline-flex items-center gap-2 rounded-lg bg-primary-700 px-4 py-2 text-sm font-semibold text-white hover:bg-primary-800 disabled:opacity-60 transition-colors"
        >
          <Save className="h-4 w-4" />
          {saving ? "Saving…" : "Save settings"}
        </button>
      </CardContent>
    </Card>
  );
}
