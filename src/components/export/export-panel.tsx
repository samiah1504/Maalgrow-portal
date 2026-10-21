"use client";

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Download, Phone, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FieldOption } from "@/lib/export/investor-export";

/**
 * Investor Data Export: choose who (a MaalGrow series / cycle, or a
 * MaalRise Cycle), which details, and Excel or CSV. The file is built
 * on the server and downloaded straight away.
 */
type Common = { canUnmask: boolean };
type MaalGrowProps = Common & {
  product: "maalgrow";
  series: string[];
  cycles: { id: string; series: string; label: string }[];
  contactFields: FieldOption[];
  investmentFields: FieldOption[];
};
type MaalRiseProps = Common & {
  product: "maalrise";
  cycles: { id: string; label: string }[];
  fields: FieldOption[];
};

const STATUSES = [
  { value: "active", label: "Active" },
  { value: "matured", label: "Matured" },
  { value: "completed", label: "Completed" },
  { value: "cancelled", label: "Cancelled" },
];
const PHONE_LIST = ["full_name", "phone", "email"];
const select = "flex h-10 w-full rounded-lg border border-border bg-white px-3 text-sm";

export function ExportPanel(props: MaalGrowProps | MaalRiseProps) {
  const mg = props.product === "maalgrow";
  const [series, setSeries] = useState(mg ? props.series[0] ?? "" : "");
  const [cycle, setCycle] = useState(mg ? "all" : props.cycles[0]?.id ?? "");
  const [statuses, setStatuses] = useState<string[]>(["active", "matured", "completed"]);
  const [mode, setMode] = useState<"contacts" | "investments">("contacts");
  const [format, setFormat] = useState<"xlsx" | "csv">("xlsx");
  const [unmask, setUnmask] = useState(false);
  const [busy, setBusy] = useState(false);

  const options = mg ? (mode === "contacts" ? props.contactFields : props.investmentFields) : props.fields;
  const [chosen, setChosen] = useState<string[]>(PHONE_LIST);
  const groups = useMemo(() => [...new Set(options.map((o) => o.group))], [options]);
  const cycleChoices = mg ? props.cycles.filter((c) => c.series === series) : props.cycles;
  const keys = options.map((o) => o.key).filter((k) => chosen.includes(k));

  function preset(which: "phones" | "report") {
    if (which === "phones") {
      if (mg) setMode("contacts");
      setChosen(PHONE_LIST);
    } else {
      if (mg) setMode("investments");
      const base = mg ? props.investmentFields : options;
      setChosen(base.filter((o) => ["Contact", "Investment", "Investment (totals)"].includes(o.group)).map((o) => o.key));
    }
  }
  const toggle = (k: string) => setChosen((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k]));

  async function download() {
    const q = new URLSearchParams({ fields: keys.join(","), format });
    if (unmask && keys.includes("account_number")) q.set("unmask", "1");
    let url: string;
    if (mg) {
      q.set("series", series);
      q.set("cycle", cycle);
      q.set("status", statuses.join(","));
      q.set("mode", mode);
      url = `/api/admin/exports/maalgrow?${q}`;
    } else {
      url = `/api/admin/maalrise/exports/${cycle}?${q}`;
    }
    setBusy(true);
    try {
      const res = await fetch(url);
      if (!res.ok) {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(d.error ?? `Export failed (error ${res.status}).`);
        return;
      }
      const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `investors.${format}`;
      const blob = await res.blob();
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast.success("Export downloaded.");
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const ready = keys.length > 0 && (mg ? !!series && statuses.length > 0 : !!cycle);
  return (
    <div className="space-y-5" data-testid={`export-${props.product}`}>
      <div className="grid gap-3 sm:grid-cols-3">
        {mg ? (
          <>
            <div className="space-y-1.5">
              <label htmlFor="export-series" className="block text-sm font-medium">Series</label>
              <select id="export-series" className={select} value={series} onChange={(e) => { setSeries(e.target.value); setCycle("all"); }}>
                {props.series.map((s) => <option key={s} value={s}>Series {s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="export-cycle" className="block text-sm font-medium">Cycle</label>
              <select id="export-cycle" className={select} value={cycle} onChange={(e) => setCycle(e.target.value)}>
                <option value="all">All cycles in Series {series}</option>
                {cycleChoices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <fieldset className="space-y-1.5">
              <legend className="block text-sm font-medium">Investment status</legend>
              <div className="flex flex-wrap gap-x-3 gap-y-1 pt-1 text-sm">
                {STATUSES.map((st) => (
                  <label key={st.value} className="inline-flex items-center gap-1.5">
                    <input type="checkbox" checked={statuses.includes(st.value)}
                      onChange={() => setStatuses((x) => (x.includes(st.value) ? x.filter((y) => y !== st.value) : [...x, st.value]))} />
                    {st.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </>
        ) : (
          <div className="space-y-1.5 sm:col-span-2">
            <label htmlFor="export-mr-cycle" className="block text-sm font-medium">MaalRise Cycle</label>
            <select id="export-mr-cycle" className={select} value={cycle} onChange={(e) => setCycle(e.target.value)}>
              {props.cycles.length === 0 && <option value="">No Cycles yet</option>}
              {props.cycles.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => preset("phones")}><Phone className="h-3.5 w-3.5" /> Phone list</Button>
        <Button size="sm" variant="outline" onClick={() => preset("report")}><FileSpreadsheet className="h-3.5 w-3.5" /> Investment report</Button>
      </div>

      {mg && (
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" checked={mode === "contacts"} onChange={() => setMode("contacts")} />
            One row per investor <span className="text-muted">(no duplicates — for contact lists)</span>
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" checked={mode === "investments"} onChange={() => setMode("investments")} />
            One row per investment <span className="text-muted">(totals match the series — for reports)</span>
          </label>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => (
          <fieldset key={g} className="rounded-lg border border-border p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">{g}</legend>
            <div className="space-y-1">
              {options.filter((o) => o.group === g).map((o) => (
                <label key={o.key} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={chosen.includes(o.key)} onChange={() => toggle(o.key)} data-field={o.key} />
                  {o.label}
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>

      {keys.includes("account_number") && (
        <p className="text-xs text-muted">
          Account numbers are masked (e.g. ******6701).
          {props.canUnmask && (
            <label className="ml-2 inline-flex items-center gap-1.5 text-foreground">
              <input type="checkbox" checked={unmask} onChange={(e) => setUnmask(e.target.checked)} />
              Show full account numbers (super admin; recorded in the audit log)
            </label>
          )}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex gap-4 text-sm">
          <label className="inline-flex items-center gap-1.5"><input type="radio" checked={format === "xlsx"} onChange={() => setFormat("xlsx")} /> Excel (.xlsx)</label>
          <label className="inline-flex items-center gap-1.5"><input type="radio" checked={format === "csv"} onChange={() => setFormat("csv")} /> CSV</label>
        </div>
        <Button disabled={!ready} loading={busy} onClick={download}><Download className="h-4 w-4" /> Download</Button>
        <span className="text-xs text-muted">
          {keys.length} detail{keys.length === 1 ? "" : "s"} chosen.{format === "csv" ? " Excel keeps phone numbers' leading 0 more reliably than CSV." : ""} Every export is recorded.
        </span>
      </div>
    </div>
  );
}
