"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

type Row = { investor_id: string } & Record<string, unknown>;

/**
 * Inside the Communication Centre's "Individual Investors": select
 * MaalRise investors — all, or those in one Cycle. They are added to
 * the selection like any hand-picked investor, so the campaign is
 * built, previewed and sent exactly as before.
 */
export function MaalriseRecipientPicker<T extends Row>({ forEmail, onAdd }: { forEmail: boolean; onAdd: (rows: T[]) => void }) {
  const [cycles, setCycles] = useState<{ id: string; name: string; status: string }[] | null>(null);
  const [cycleId, setCycleId] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    fetch("/api/admin/maalrise/comms-recipients")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live && d) setCycles(d.cycles); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  if (!cycles) return null;

  async function add(which: "all" | "cycle") {
    setBusy(true);
    try {
      const q = which === "cycle" && cycleId ? `?cycle_id=${cycleId}` : "";
      const r = await fetch(`/api/admin/maalrise/comms-recipients${q}`);
      const d = await r.json();
      if (!r.ok) { toast.error(d.error ?? "Could not load MaalRise investors"); return; }
      const ids: string[] = d.investor_ids;
      if (ids.length === 0) { toast.info("No MaalRise investors to add."); return; }
      const p = new URLSearchParams({ group: "individual", ids: ids.join(",") });
      if (forEmail) p.set("for_email", "1");
      const rr = await fetch(`/api/admin/comms/recipients?${p.toString()}`);
      const dd = await rr.json();
      if (!rr.ok) { toast.error(dd.error ?? "Could not load recipients"); return; }
      onAdd(dd.recipients as T[]);
      toast.success(`${dd.recipients.length} MaalRise investor(s) added to the selection.`);
    } catch {
      toast.error("Network error. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gold-200 bg-gold-50/50 p-2 text-xs" data-testid="maalrise-picker">
      <span className="font-medium text-foreground">MaalRise investors:</span>
      <Button type="button" size="xs" variant="outline" loading={busy} onClick={() => add("all")}>Add all</Button>
      <select className="h-7 rounded-md border border-border bg-white px-2 text-xs" value={cycleId} onChange={(e) => setCycleId(e.target.value)}
        aria-label="MaalRise Cycle">
        <option value="">Choose a MaalRise Cycle…</option>
        {cycles.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.status}</option>)}
      </select>
      <Button type="button" size="xs" variant="outline" disabled={!cycleId} loading={busy} onClick={() => add("cycle")}>Add this Cycle&apos;s investors</Button>
    </div>
  );
}
