"use client";

import { Fragment, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Info,
  Lock,
  Plus,
  Save,
  ShieldCheck,
  Trash2,
  Unlock,
} from "lucide-react";
import {
  addProduct,
  cycleNotices,
  draftFigures,
  emptyRow,
  isReadOnly,
  noticesForMonth,
  noticesForRow,
  productHasFigures,
  removeProduct,
  toSavePayload,
  type CycleTerms,
  type Draft,
  type DraftMonth,
  type DraftRow,
  type Notice,
} from "@/lib/mudarabah/editor";
import { naira, nairaExact, percent, units } from "@/lib/mudarabah/format";
import type { SettlementComputed, SettlementProduct } from "@/lib/mudarabah/figures";

/* Deep plum, antique gold, warm parchment — the reference file's
   palette. Marcellus for headings, Karla for body, IBM Plex Mono for
   every figure, each with a graceful fallback so the page never waits
   on a font to be readable. Scoped to .mud so nothing here can reach
   the rest of the portal. */
const STYLES = `
.mud, .mud *, .mud *::before, .mud *::after { box-sizing: border-box; }
.mud {
  --plum: #4a1f3d;
  --plum-deep: #351429;
  --plum-soft: #6d3a5d;
  --gold: #b8912f;
  --gold-soft: #d9bd6a;
  --parchment: #faf6ee;
  --parchment-2: #f3ece0;
  --ink: #2f2a26;
  --ink-soft: #6b6157;
  --line: #e2d8c7;
  --danger: #9b2c2c;
  --danger-bg: #fdf0ef;
  --warn: #8a6100;
  --warn-bg: #fdf6e3;
  --ok: #1f6b45;
  --ok-bg: #eef7f1;
  --font-head: "Marcellus", "Cormorant Garamond", Georgia, "Times New Roman", serif;
  --font-body: "Karla", "Segoe UI", system-ui, -apple-system, sans-serif;
  --font-mono: "IBM Plex Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  background: var(--parchment);
  color: var(--ink);
  font-family: var(--font-body);
  border-radius: 16px;
  padding: 20px 16px 40px;
}
@media (min-width: 768px) { .mud { padding: 28px 28px 56px; } }
.mud h1, .mud h2, .mud h3 { font-family: var(--font-head); font-weight: 400; letter-spacing: .01em; }
.mud h1 { font-size: 1.75rem; color: var(--plum-deep); }
.mud h2 { font-size: 1.25rem; color: var(--plum); }
.mud h3 { font-size: 1.02rem; color: var(--plum); }
.mud .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
.mud .panel {
  background: #fff; border: 1px solid var(--line); border-radius: 14px;
  padding: 16px; margin-top: 16px;
}
@media (min-width: 768px) { .mud .panel { padding: 20px; } }
.mud .panel-head {
  display: flex; align-items: baseline; justify-content: space-between;
  gap: 12px; flex-wrap: wrap; margin-bottom: 14px;
}
.mud label { display: block; font-size: .72rem; text-transform: uppercase;
  letter-spacing: .07em; color: var(--ink-soft); margin-bottom: 5px; }
.mud input[type=text], .mud input[type=date], .mud input[type=number], .mud select, .mud textarea {
  width: 100%; padding: 9px 10px; border: 1px solid var(--line); border-radius: 9px;
  background: #fff; color: var(--ink); font-family: var(--font-mono); font-size: .88rem;
}
.mud input:focus, .mud select:focus, .mud textarea:focus {
  outline: none; border-color: var(--plum-soft); box-shadow: 0 0 0 3px rgba(109,58,93,.12);
}
.mud input:disabled, .mud select:disabled, .mud textarea:disabled {
  background: var(--parchment-2); color: var(--ink-soft); cursor: not-allowed;
}
.mud .grid-fields { display: grid; gap: 12px; grid-template-columns: 1fr; }
.mud .grid-fields > *, .mud .summary-grid > *, .mud .stats > * { min-width: 0; }
.mud .panel-head > * { min-width: 0; }
@media (min-width: 640px) { .mud .grid-fields { grid-template-columns: repeat(2, 1fr); } }
@media (min-width: 1024px) { .mud .grid-fields { grid-template-columns: repeat(4, 1fr); } }
.mud .split-bar { height: 14px; border-radius: 999px; overflow: hidden; display: flex; border: 1px solid var(--line); }
.mud .split-bar .holders { background: linear-gradient(90deg, var(--gold-soft), var(--gold)); }
.mud .split-bar .manager { background: linear-gradient(90deg, var(--plum-soft), var(--plum)); }
.mud .split-legend { display: flex; justify-content: space-between; font-size: .78rem; margin-top: 6px; }
.mud input[type=range] { width: 100%; accent-color: var(--plum); }
.mud .scroll-x { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.mud table { width: 100%; border-collapse: collapse; min-width: 860px; }
.mud thead th {
  text-align: left; font-size: .68rem; text-transform: uppercase; letter-spacing: .06em;
  color: var(--ink-soft); font-weight: 600; padding: 8px 8px; border-bottom: 1px solid var(--line);
  white-space: nowrap;
}
.mud tbody td { padding: 7px 8px; border-bottom: 1px solid var(--parchment-2); vertical-align: middle; }
.mud tbody tr:last-child td { border-bottom: none; }
.mud .cell-in input { min-width: 104px; }
.mud .ro { font-family: var(--font-mono); font-size: .84rem; white-space: nowrap; }
.mud .ro-strong {
  font-family: var(--font-mono); font-weight: 700; font-size: .92rem;
  color: var(--plum-deep); background: var(--parchment-2);
  padding: 5px 9px; border-radius: 7px; white-space: nowrap; display: inline-block;
}
.mud .stats {
  display: grid; gap: 10px; grid-template-columns: repeat(2, 1fr);
  background: var(--plum-deep); border-radius: 12px; padding: 14px; margin-top: 14px; color: #f5efe4;
}
@media (min-width: 768px) { .mud .stats { grid-template-columns: repeat(4, 1fr); } }
.mud .stats .k { font-size: .66rem; text-transform: uppercase; letter-spacing: .07em; opacity: .75; }
.mud .stats .v { font-family: var(--font-mono); font-size: 1.02rem; margin-top: 3px; }
.mud .stats .accent .v { color: var(--gold-soft); }
.mud .stats-note {
  grid-column: 1 / -1; font-size: .74rem; opacity: .82; line-height: 1.5;
  border-top: 1px solid rgba(255,255,255,.16); padding-top: 9px; margin-top: 2px;
}
.mud .notice { display: flex; gap: 8px; padding: 9px 11px; border-radius: 9px;
  font-size: .8rem; line-height: 1.45; margin-top: 8px; align-items: flex-start; }
.mud .notice svg { flex-shrink: 0; margin-top: 1px; }
.mud tr.has-notice td { border-bottom: none; }
.mud tr.notice-row td { padding-top: 0; }
.mud tr.notice-row .notice { margin-top: 4px; }
.mud .notice.error { background: var(--danger-bg); color: var(--danger); border: 1px solid #f0cfcc; }
.mud .notice.warning { background: var(--warn-bg); color: var(--warn); border: 1px solid #ecdcae; }
.mud .notice.ok { background: var(--ok-bg); color: var(--ok); border: 1px solid #cfe6da; }
.mud .carried {
  background: var(--parchment-2); border-radius: 10px; padding: 11px 13px;
  font-size: .8rem; display: flex; flex-wrap: wrap; gap: 6px 18px; align-items: center;
}
.mud .chip {
  display: inline-flex; align-items: center; gap: 7px; background: var(--parchment-2);
  border: 1px solid var(--line); border-radius: 999px; padding: 5px 6px 5px 13px; font-size: .84rem;
}
.mud .chip button { border: none; background: transparent; color: var(--ink-soft); cursor: pointer;
  display: inline-flex; padding: 3px; border-radius: 999px; }
.mud .chip button:hover { color: var(--danger); background: #fff; }
.mud .btn {
  display: inline-flex; align-items: center; gap: 7px; border-radius: 9px; padding: 9px 15px;
  font-size: .85rem; font-weight: 600; border: 1px solid transparent; cursor: pointer;
  font-family: var(--font-body);
}
.mud .btn-primary { background: var(--plum); color: #fff; }
.mud .btn-primary:hover { background: var(--plum-deep); }
.mud .btn-primary:disabled { opacity: .55; cursor: not-allowed; }
.mud .btn-ghost { background: #fff; border-color: var(--line); color: var(--ink); }
.mud .btn-ghost:hover { border-color: var(--plum-soft); }
.mud .summary-grid { display: grid; gap: 10px; grid-template-columns: repeat(2, 1fr); }
@media (min-width: 768px) { .mud .summary-grid { grid-template-columns: repeat(4, 1fr); } }
.mud .sum-item { background: var(--parchment); border: 1px solid var(--line); border-radius: 11px; padding: 11px 13px; }
.mud .sum-item .k { font-size: .66rem; text-transform: uppercase; letter-spacing: .06em; color: var(--ink-soft); }
.mud .sum-item .v { font-family: var(--font-mono); font-size: 1rem; margin-top: 4px; color: var(--plum-deep); }
.mud .sum-item.gold { border-color: var(--gold-soft); background: #fdf9ee; }
.mud .settled-banner {
  display: flex; gap: 10px; align-items: flex-start; background: var(--plum-deep); color: #f5efe4;
  border-radius: 12px; padding: 13px 15px; font-size: .84rem; line-height: 1.5;
}
.mud .muted { color: var(--ink-soft); }
.mud .tiny { font-size: .74rem; }
`;

type Settlement = {
  settledAt: string;
  engineVersion: string;
  computed: SettlementComputed;
} | null;

export function CycleEditor({
  initialDraft,
  terms,
  hasLedger,
  settlement,
  settledProducts,
}: {
  initialDraft: Draft;
  terms: CycleTerms;
  hasLedger: boolean;
  settlement: Settlement;
  settledProducts: SettlementProduct[];
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initialDraft);
  const [ratio, setRatio] = useState(Math.round(terms.ratio * 100));
  const [newProduct, setNewProduct] = useState("");
  const [saving, setSaving] = useState(false);
  const [unsettling, setUnsettling] = useState(false);
  const [reason, setReason] = useState("");

  // Percent in the box, fraction in the database — 10 here is 0.10
  // there, which is what mudarabah_effective_wht_rate returns and what
  // the engine multiplies by.
  const [whtPercent, setWhtPercent] = useState(
    String(Math.round(terms.whtRate * 10000) / 100)
  );
  const [savingWht, setSavingWht] = useState(false);
  const whtNum = Number(whtPercent);
  const whtValid = Number.isFinite(whtNum) && whtNum >= 0 && whtNum < 100;
  const whtDirty =
    whtValid && Math.abs(whtNum / 100 - terms.whtRate) > 1e-9;

  // The share investors actually subscribed on. Once subscriptions
  // close this is the floor, not just the starting position.
  const ratioFloor = Math.round(terms.ratio * 100);
  const [savingRatio, setSavingRatio] = useState(false);
  const ratioDirty = ratio !== ratioFloor;

  const readOnly = isReadOnly(draft);
  const symbol = "₦";

  // The ratio slider edits the CYCLE's own override, not the series,
  // and only while subscriptions are open.
  const liveTerms: CycleTerms = useMemo(
    () => ({ ...terms, ratio: ratio / 100 }),
    [terms, ratio]
  );

  // Everything recalculates as you type — one call, one source of truth
  const { cycle, notices } = useMemo(
    () => draftFigures(draft, liveTerms),
    [draft, liveTerms]
  );

  // Trading with money that never arrived is fiction
  const capitalGap = terms.pooledCapital - terms.amountReceived;
  const slotsDisagree = Math.abs(terms.totalUnits - terms.cycleTotalSlots) > 0.001;

  // A settled cycle shows its FROZEN figures, never a fresh calculation
  const frozen = settlement?.computed ?? null;

  // Settlement, not subscription close, is what fixes the withholding
  // rate: from then on it is in the snapshot and may be quoted on a
  // credit note already in an investor's hands.
  const settlementFrozen = frozen !== null;
  const headline = frozen
    ? {
        capital: frozen.capital,
        revenue: frozen.revenue,
        cogsTotal: frozen.cogsTotal,
        purchTotal: frozen.purchTotal,
        sellExpTotal: frozen.sellExpTotal,
        lostTotal: frozen.lostTotal,
        unitsBought: frozen.unitsBought,
        unitsSold: frozen.unitsSold,
        profit: frozen.profit,
        holderPot: frozen.holderPot,
        mudaribPot: frozen.managerPot,
        netPerSlot: frozen.netPerSlot,
        slotReturn: frozen.returnPerSlot,
        endCash: frozen.endCash,
        endStock: frozen.endStockValue,
      }
    : {
        capital: cycle.capital,
        revenue: cycle.revenue,
        cogsTotal: cycle.cogsTotal,
        purchTotal: cycle.purchTotal,
        sellExpTotal: cycle.sellExpTotal,
        lostTotal: cycle.lostTotal,
        unitsBought: cycle.unitsBought,
        unitsSold: cycle.unitsSold,
        profit: cycle.profit,
        holderPot: cycle.holderPot,
        mudaribPot: cycle.mudaribPot,
        netPerSlot: cycle.netPerSlot,
        slotReturn: cycle.slotReturn,
        endCash: cycle.endCash,
        endStock: cycle.endStock,
      };

  const products = settledProducts.length > 0 ? settledProducts : cycle.products;

  function set<K extends keyof Draft>(key: K, value: Draft[K]) {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  function setMonth(index: number, patch: Partial<DraftMonth>) {
    setDraft((d) => {
      const months = [...d.months] as Draft["months"];
      months[index] = { ...months[index], ...patch };
      return { ...d, months };
    });
  }

  function setRow(index: number, productId: string, patch: Partial<DraftRow>) {
    setDraft((d) => {
      const months = [...d.months] as Draft["months"];
      const month = months[index];
      const row = month.rows[productId] ?? emptyRow(productId);
      months[index] = { ...month, rows: { ...month.rows, [productId]: { ...row, ...patch } } };
      return { ...d, months };
    });
  }

  function handleAddProduct() {
    const name = newProduct.trim();
    if (!name) return;
    setDraft((d) => addProduct(d, name));
    setNewProduct("");
  }

  function handleRemoveProduct(id: string, name: string) {
    if (productHasFigures(draft, id)) {
      const ok = window.confirm(
        `${name} already has figures entered for this cycle. Removing it discards them. Remove anyway?`
      );
      if (!ok) return;
    }
    setDraft((d) => removeProduct(d, id));
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/admin/mudarabah", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ledger: toSavePayload(draft, liveTerms),
          ratio: terms.termsLocked ? undefined : ratio / 100,
        }),
      });
      const json = (await res.json()) as { id?: string; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not save the ledger");
      toast.success("Ledger saved");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the cycle");
    } finally {
      setSaving(false);
    }
  }

  async function saveWhtRate() {
    if (!whtValid) {
      toast.error("The withholding rate must be between 0 and 100 per cent.");
      return;
    }
    setSavingWht(true);
    try {
      const res = await fetch(`/api/admin/mudarabah/${draft.cycleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_wht_rate",
          // Percent on screen, fraction on the wire
          whtRate: whtNum / 100,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not set the withholding rate");
      toast.success(`Withholding tax set to ${whtNum}%`);
      router.refresh();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Could not set the withholding rate"
      );
    } finally {
      setSavingWht(false);
    }
  }

  async function saveRatio() {
    setSavingRatio(true);
    try {
      const res = await fetch(`/api/admin/mudarabah/${draft.cycleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set_investor_ratio",
          investorRatio: ratio / 100,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not change the ratio");
      toast.success(
        `Slot holders now take ${ratio}% — the manager takes ${100 - ratio}%`
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not change the ratio");
      setRatio(ratioFloor);
    } finally {
      setSavingRatio(false);
    }
  }

  async function unsettle() {
    if (reason.trim().length < 5) {
      toast.error("Say why this cycle is being reopened — it goes on the record.");
      return;
    }
    setUnsettling(true);
    try {
      const res = await fetch(`/api/admin/mudarabah/${draft.cycleId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "unsettle", reason: reason.trim() }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Could not reopen the cycle");
      toast.success("Cycle reopened — the earlier settlement is kept on record");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not reopen the cycle");
    } finally {
      setUnsettling(false);
    }
  }

  const chartData = (frozen ? frozen.months : cycle.months).map((m) => ({
    name: `Month ${m.i}`,
    Revenue: Math.round(m.revenue / 100),
    "Total costs": Math.round(
      ("spend" in m ? m.spend : 0) + m.sellExp + ("lostValue" in m ? m.lostValue : 0)
    ) / 100,
    Profit: Math.round(m.net / 100),
  }));

  return (
    <div className="animate-fade-in">
      <style dangerouslySetInnerHTML={{ __html: STYLES }} />

      <div className="flex items-center gap-2 text-sm text-muted mb-4">
        <Link href="/admin/mudarabah" className="hover:text-foreground flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" />
          Mudarabah Ledger
        </Link>
        <span>/</span>
        <span className="text-foreground">{terms.cycleLabel}</span>
      </div>

      <div className="mud">
        <div className="panel-head">
          <div>
            <h1>
              {hasLedger
                ? `Trading ledger — ${terms.cycleLabel}`
                : `Start a trading ledger for ${terms.cycleLabel}`}
            </h1>
            <p className="muted tiny" style={{ marginTop: 4 }}>
              Profit is shared as a ratio of what the trade actually realised. Capital
              and profit are always shown apart.
            </p>
          </div>
          {!readOnly && (
            <button className="btn btn-primary" onClick={save} disabled={saving}>
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save cycle"}
            </button>
          )}
        </div>

        {readOnly && settlement && (
          <div className="settled-banner">
            <Lock className="h-4 w-4" style={{ marginTop: 2 }} />
            <div>
              <strong>Settled on {new Date(settlement.settledAt).toLocaleDateString("en-NG", { day: "numeric", month: "long", year: "numeric" })}.</strong>{" "}
              The figures below are the frozen settlement figures, calculated under
              engine {settlement.engineVersion}. Nothing here can be edited.
              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Reason for reopening — goes on the record"
                  style={{ flex: "1 1 260px", background: "rgba(255,255,255,.1)", color: "#f5efe4", borderColor: "rgba(255,255,255,.25)" }}
                />
                <button className="btn btn-ghost" onClick={unsettle} disabled={unsettling}>
                  <Unlock className="h-4 w-4" />
                  {unsettling ? "Reopening…" : "Reopen to correct"}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Settling is a page of its own: it previews every figure
            that would be written before writing any of them. */}
        {draft.status !== "settled" && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
            <Link href={`/admin/mudarabah/${draft.cycleId}/settle`} className="btn btn-primary">
              <ShieldCheck className="h-4 w-4" />
              Settle this cycle
            </Link>
          </div>
        )}

        {/* ── 1. The cycle, read from the existing records ─────── */}
        <section className="panel">
          <div className="panel-head">
            <h2>
              Series {terms.seriesName} · {terms.cycleLabel}
            </h2>
            <span className="num muted tiny">
              {terms.startDate} → {terms.endDate} ·{" "}
              {terms.cycleStatus.replaceAll("_", " ")}
            </span>
          </div>

          <p className="muted tiny" style={{ marginBottom: 12 }}>
            The slot value, the slots taken and the investor list come from this
            cycle and its investments. They are shown here to confirm the right
            cycle, and are not edited on this page.
          </p>

          <div className="summary-grid">
            <Sum k="Value of one slot" v={naira(terms.unitValue, symbol)} />
            <Sum k="Slots taken" v={terms.totalUnits.toLocaleString("en-NG")} />
            <Sum k="Investors" v={String(terms.holders.length)} />
            <Sum k="Capital pooled" v={naira(terms.pooledCapital, symbol)} />
          </div>

          {capitalGap !== 0 && (
            <NoticeLine
              notice={{
                level: "warning",
                scope: "cycle",
                month: null,
                productId: null,
                text: `Slots taken come to ${naira(terms.pooledCapital, symbol)}, but ${naira(terms.amountReceived, symbol)} has been received — a gap of ${naira(Math.abs(capitalGap), symbol)}. Trading with money that never arrived is fiction; check for an unpaid or partly-paid subscription before settling.`,
              }}
            />
          )}

          {/*
            Which enrolments, by name. The notice above gives a total,
            and a total is not something anyone can act on — "₦500,000
            short" sends you to the SQL editor, whereas a name sends
            you to that investor's page. Worst first.
          */}
          {terms.fundingGaps.length > 0 && (
            <div
              className="notice warning"
              style={{ marginTop: 8, flexDirection: "column" }}
            >
              <p style={{ margin: 0, fontWeight: 600 }}>
                {terms.fundingGaps.length} enrolment
                {terms.fundingGaps.length === 1 ? "" : "s"} where the slots and
                the confirmed payments disagree
              </p>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {terms.fundingGaps.map((g) => (
                  <li key={g.investmentId} className="tiny">
                    <strong>{g.investorName}</strong>{" "}
                    <span className="num muted">({g.investorCode})</span> —{" "}
                    {g.units} slot{g.units === 1 ? "" : "s"} ={" "}
                    {naira(g.capital, symbol)}, but{" "}
                    {naira(g.confirmedPaid, symbol)} confirmed:{" "}
                    {g.gap > 0
                      ? `${naira(g.gap, symbol)} unpaid`
                      : `${naira(-g.gap, symbol)} uncredited`}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {slotsDisagree && (
            <NoticeLine
              notice={{
                level: "warning",
                scope: "cycle",
                month: null,
                productId: null,
                text: `The cycle record says ${terms.cycleTotalSlots} slots, but the active investments add up to ${terms.totalUnits}. Profit is divided by the investments, not the cycle total.`,
              }}
            />
          )}

          <div className="grid-fields" style={{ marginTop: 16 }}>
            <div>
              <label htmlFor="mud-desc">Description</label>
              <input
                id="mud-desc"
                type="text"
                value={draft.description}
                disabled={readOnly}
                onChange={(e) => set("description", e.target.value)}
                placeholder="home furniture"
              />
              <p className="muted tiny" style={{ marginTop: 4 }}>
                A category. This is the only product wording investors ever see.
              </p>
            </div>
            {/*
              The withholding rate is editable until SETTLEMENT, not
              until subscriptions close. It is set by the tax
              authority rather than agreed with investors, so a rate
              that was never entered — or one the law changed
              mid-cycle — has to be correctable. Settling is what
              freezes it, because from then on it is in the snapshot
              and may be quoted on an issued credit note.

              It was previously disabled outright and explained away
              as a closed subscription, which left a cycle sitting at
              0.00% with no way to say otherwise.
            */}
            <div>
              <label htmlFor="mud-wht">Withholding tax</label>
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  id="mud-wht"
                  type="number"
                  min="0"
                  max="99.99"
                  step="0.01"
                  value={whtPercent}
                  disabled={settlementFrozen || savingWht}
                  onChange={(e) => setWhtPercent(e.target.value)}
                  style={{ flex: 1 }}
                />
                <span className="muted">%</span>
                {!settlementFrozen && whtDirty && (
                  <button
                    type="button"
                    className="btn btn-primary"
                    style={{ padding: "6px 12px", fontSize: ".78rem" }}
                    onClick={saveWhtRate}
                    disabled={savingWht || !whtValid}
                  >
                    {savingWht ? "Saving…" : "Save"}
                  </button>
                )}
              </div>
              <p className="muted tiny" style={{ marginTop: 4 }}>
                {settlementFrozen
                  ? "Fixed — this cycle is settled and the rate is part of its snapshot."
                  : "A statutory rate, not a term investors agreed to, so it stays correctable until this cycle is settled."}
              </p>
              {!settlementFrozen && Number(terms.whtRate) === 0 && (
                <p className="tiny" style={{ marginTop: 4, color: "var(--warn)" }}>
                  Nothing will be withheld at 0%, and no credit note can be
                  issued for a cycle that withheld nothing. Set the rate before
                  settling if tax is due.
                </p>
              )}
            </div>
          </div>

          {/* The heart of a Mudarabah — it should look like it */}
          <div style={{ marginTop: 20 }}>
            <label htmlFor="mud-ratio">Profit-sharing ratio</label>
            <div className="split-bar">
              <div className="holders" style={{ width: `${ratio}%` }} />
              <div className="manager" style={{ width: `${100 - ratio}%` }} />
            </div>
            <div className="split-legend">
              <span>
                <strong className="num">{ratio}%</strong> slot holders
              </span>
              <span>
                <strong className="num">{100 - ratio}%</strong> manager
              </span>
            </div>
            {/*
              Once subscriptions close the slider's floor becomes the
              advertised share rather than 1%. The manager may take
              less than agreed — that is a gift and breaks nothing —
              but may not take more, which is what the lock was always
              really for. Before close it moves freely, as before.
            */}
            <input
              id="mud-ratio"
              type="range"
              min={terms.termsLocked ? ratioFloor : 1}
              max={99}
              step={1}
              value={ratio}
              disabled={readOnly || settlementFrozen}
              onChange={(e) => setRatio(Number(e.target.value))}
              style={{ marginTop: 10 }}
            />
            {!settlementFrozen && ratioDirty && (
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  style={{ padding: "6px 12px", fontSize: ".78rem" }}
                  onClick={saveRatio}
                  disabled={savingRatio}
                >
                  {savingRatio ? "Saving…" : `Give slot holders ${ratio}%`}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  style={{ padding: "6px 12px", fontSize: ".78rem" }}
                  onClick={() => setRatio(ratioFloor)}
                  disabled={savingRatio}
                >
                  Cancel
                </button>
              </div>
            )}
            <p className="muted tiny" style={{ marginTop: 8 }}>
              {settlementFrozen
                ? "Fixed — this cycle is settled and the profit was declared on this ratio."
                : terms.termsLocked
                ? `Subscriptions have closed at ${ratioFloor}% to slot holders. You can still give them more — taking a smaller manager's share breaks no promise — but it cannot go back below ${ratioFloor}% without reopening the cycle.`
                : "This cycle's own ratio. Changing it here does not touch the series default or any other cycle."}{" "}
              A ratio applied to profit the trade actually realised — never a rate
              on capital. On a loss the manager&apos;s share is nothing at all.
            </p>
          </div>
        </section>

        {/* ── Membership, straight from the cycle's investments ── */}
        <section className="panel">
          <div className="panel-head">
            <h2>Investors in this cycle</h2>
            <span className="num muted tiny">
              {terms.holders.length} investor{terms.holders.length === 1 ? "" : "s"} ·{" "}
              {terms.totalUnits} slot{terms.totalUnits === 1 ? "" : "s"}
            </span>
          </div>
          <p className="muted tiny" style={{ marginBottom: 10 }}>
            Read from this cycle&apos;s investments. Reports and emails go to these
            investors and no one else. Profit is paid to every one of them; only
            capital depends on their maturity instruction.
          </p>
          <div className="scroll-x">
            <table style={{ minWidth: 560 }}>
              <thead>
                <tr>
                  <th>Investor</th>
                  <th>Slots</th>
                  <th>Capital</th>
                  <th>At maturity</th>
                </tr>
              </thead>
              <tbody>
                {terms.holders.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="muted tiny">
                      No active investments in this cycle yet.
                    </td>
                  </tr>
                ) : (
                  terms.holders.map((h) => (
                    <tr key={h.investmentId}>
                      <td>
                        {h.investorName}
                        <div className="muted tiny num">{h.investorCode}</div>
                      </td>
                      <td className="ro">{h.units}</td>
                      <td className="ro">
                        {naira(Math.round(h.units * terms.unitValue), symbol)}
                      </td>
                      <td className="ro">
                        {h.capitalAction === "withdraw"
                          ? "capital out"
                          : h.capitalAction === "partial"
                          ? `${h.slotsWithdrawn} slot${h.slotsWithdrawn === 1 ? "" : "s"} out`
                          : h.capitalAction === "rollover"
                          ? "capital continues"
                          : // Nobody has answered. Saying "capital continues"
                            // here would read as a decision they never made.
                            <span className="muted">no instruction yet</span>}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── 2. Products ──────────────────────────────────────── */}
        <section className="panel">
          <div className="panel-head">
            <h2>Products</h2>
            <span className="muted tiny">
              {draft.products.length} in this cycle
            </span>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {draft.products.map((p) => (
              <span key={p.id} className="chip">
                {p.name}
                {!readOnly && (
                  <button
                    type="button"
                    onClick={() => handleRemoveProduct(p.id, p.name)}
                    aria-label={`Remove ${p.name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            ))}
            {draft.products.length === 0 && (
              <p className="muted tiny">
                Name the products this cycle trades in. You can add more at any time.
              </p>
            )}
          </div>

          {!readOnly && (
            <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
              <input
                type="text"
                value={newProduct}
                onChange={(e) => setNewProduct(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddProduct();
                  }
                }}
                placeholder="3-seater sofa"
                style={{ flex: "1 1 220px" }}
                aria-label="New product name"
              />
              <button className="btn btn-ghost" onClick={handleAddProduct}>
                <Plus className="h-4 w-4" />
                Add product
              </button>
            </div>
          )}
        </section>

        {/* ── 3. Month by month ────────────────────────────────── */}
        {[0, 1, 2].map((i) => (
          <MonthCard
            key={i}
            index={i}
            draft={draft}
            month={cycle.months[i]}
            frozen={frozen?.months?.[i] ?? null}
            notices={notices}
            symbol={symbol}
            readOnly={readOnly}
            onMonth={(patch) => setMonth(i, patch)}
            onRow={(pid, patch) => setRow(i, pid, patch)}
          />
        ))}

        {/* ── Cycle summary ────────────────────────────────────── */}
        <section className="panel">
          <div className="panel-head">
            <h2>Cycle summary</h2>
            {frozen && <span className="muted tiny">Frozen at settlement</span>}
          </div>

          {cycleNotices(notices).map((n, k) => (
            <NoticeLine key={k} notice={n} />
          ))}

          <div className="summary-grid" style={{ marginTop: 14 }}>
            <Sum k="Capital raised" v={naira(headline.capital, symbol)} />
            <Sum k="Units bought" v={units(headline.unitsBought)} />
            <Sum k="Units sold" v={units(headline.unitsSold)} />
            <Sum k="Revenue" v={naira(headline.revenue, symbol)} />
            <Sum k="Cost of goods sold" v={naira(headline.cogsTotal, symbol)} />
            <Sum k="Expenses" v={naira(headline.sellExpTotal, symbol)} />
            {headline.lostTotal !== 0 && (
              <Sum k="Stock unaccounted for" v={naira(headline.lostTotal, symbol)} />
            )}
            <Sum k="Net profit" v={naira(headline.profit, symbol)} gold />
            <Sum k="Slot holders' share" v={naira(headline.holderPot, symbol)} gold />
            <Sum k="My share" v={naira(headline.mudaribPot, symbol)} />
            <Sum k="Profit per slot" v={naira(headline.netPerSlot, symbol)} gold />
            <Sum k="Return per slot" v={percent(headline.slotReturn)} gold />
            <Sum k="Capital to return" v={naira(cycle.withdraw * cycle.slotPrice, symbol)} />
            <Sum k="Capital rolling over" v={naira(cycle.rollover * cycle.slotPrice, symbol)} />
            <Sum k="Total cash needed" v={naira(cycle.cashNeeded, symbol)} />
            <Sum k="Cash at close" v={naira(headline.endCash, symbol)} />
            <Sum k="Unsold stock at close" v={naira(headline.endStock, symbol)} />
          </div>

          {/* Which product to put more money into next cycle */}
          <h3 style={{ marginTop: 24 }}>Per product, across the cycle</h3>
          <p className="muted tiny" style={{ marginBottom: 8 }}>
            Admin only. Investors never see a product breakdown — only combined totals.
          </p>
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Product</th>
                  <th>Bought</th>
                  <th>Sold</th>
                  <th>Left</th>
                  <th>Revenue</th>
                  <th>Cost of goods sold</th>
                  <th>Gross profit</th>
                  <th>Gross margin</th>
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="muted tiny">
                      Add a product and enter a month to see this.
                    </td>
                  </tr>
                ) : (
                  products.map((p) => (
                    <tr key={p.productId}>
                      <td>{p.productName}</td>
                      <td className="ro">{units(p.unitsBought)}</td>
                      <td className="ro">{units(p.unitsSold)}</td>
                      <td className="ro">{units(p.unitsLeft)}</td>
                      <td className="ro">{naira(p.revenue, symbol)}</td>
                      <td className="ro">{naira(p.cogs, symbol)}</td>
                      <td className="ro">{naira(p.gross, symbol)}</td>
                      <td className="ro">{percent(p.grossMargin, 1)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <h3 style={{ marginTop: 24 }}>Month by month</h3>
          <div style={{ width: "100%", height: 260, marginTop: 8 }}>
            <ResponsiveContainer>
              <BarChart data={chartData} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e2d8c7" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12, fill: "#6b6157" }} />
                <YAxis
                  tick={{ fontSize: 11, fill: "#6b6157" }}
                  tickFormatter={(v: number) => `${symbol}${(v / 1000).toFixed(0)}k`}
                  width={54}
                />
                <Tooltip
                  formatter={(v) => `${symbol}${Number(v).toLocaleString("en-NG")}`}
                  contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e2d8c7" }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="Revenue" fill="#6d3a5d" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Total costs" fill="#d9bd6a" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Profit" fill="#b8912f" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>
    </div>
  );
}

function Sum({ k, v, gold }: { k: string; v: string; gold?: boolean }) {
  return (
    <div className={gold ? "sum-item gold" : "sum-item"}>
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function NoticeLine({ notice }: { notice: Notice }) {
  const Icon =
    notice.level === "error" ? AlertTriangle : notice.level === "warning" ? Info : CheckCircle2;
  return (
    <div className={`notice ${notice.level}`}>
      <Icon className="h-4 w-4" />
      <span>{notice.text}</span>
    </div>
  );
}

function MonthCard({
  index,
  draft,
  month,
  frozen,
  notices,
  symbol,
  readOnly,
  onMonth,
  onRow,
}: {
  index: number;
  draft: Draft;
  month: ReturnType<typeof draftFigures>["cycle"]["months"][number];
  frozen: SettlementComputed["months"][number] | null;
  notices: Notice[];
  symbol: string;
  readOnly: boolean;
  onMonth: (patch: Partial<DraftMonth>) => void;
  onRow: (productId: string, patch: Partial<DraftRow>) => void;
}) {
  const m = draft.months[index];
  const expenses = month.sellExp;
  const monthNotices = noticesForMonth(notices, index + 1);

  const stats = frozen
    ? { cogs: frozen.cogs, gross: frozen.revenue - frozen.cogs, net: frozen.net, cash: frozen.cash }
    : { cogs: month.cogs, gross: month.gross, net: month.net, cash: month.cash };

  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Month {index + 1}</h2>
        <span className="num muted tiny">
          Revenue {naira(frozen ? frozen.revenue : month.revenue, symbol)}
        </span>
      </div>

      {/* Carried in */}
      <div className="carried">
        {index === 0 ? (
          <span>
            <span className="muted">Slot capital received</span>{" "}
            <strong className="num">{naira(month.fundsIn, symbol)}</strong>
            <span className="muted"> · no stock carried in</span>
          </span>
        ) : (
          <>
            <span>
              <span className="muted">Cash carried in</span>{" "}
              <strong className="num">{naira(month.openCash, symbol)}</strong>
            </span>
            {month.rows
              .filter((r) => r.openUnits !== 0)
              .map((r) => (
                <span key={r.productId}>
                  <span className="muted">{r.productName}</span>{" "}
                  <strong className="num">
                    {units(r.openUnits)}u · {naira(r.openValue, symbol)}
                  </strong>
                </span>
              ))}
            {month.rows.every((r) => r.openUnits === 0) && (
              <span className="muted">no stock carried in</span>
            )}
          </>
        )}
      </div>

      {/* Product table */}
      <div className="scroll-x" style={{ marginTop: 14 }}>
        <table>
          <thead>
            <tr>
              <th>Product</th>
              <th>Cost of each</th>
              <th>Qty bought</th>
              <th>Qty sold</th>
              <th>Selling price</th>
              <th>Cost price / unit</th>
              <th>Revenue</th>
              <th>Cost of goods sold</th>
              <th>Gross profit</th>
              <th>Units left</th>
              <th>Value of units left</th>
            </tr>
          </thead>
          <tbody>
            {draft.products.length === 0 ? (
              <tr>
                <td colSpan={11} className="muted tiny">
                  Add a product above to start recording this month.
                </td>
              </tr>
            ) : (
              draft.products.map((p) => {
                const row = m.rows[p.id] ?? emptyRow(p.id);
                const r = month.rows.find((x) => x.productId === p.id)!;
                const rowNotices = noticesForRow(notices, index + 1, p.id);
                return (
                  <Fragment key={p.id}>
                  <tr className={rowNotices.length > 0 ? "has-notice" : undefined}>
                    <td>
                      <div style={{ minWidth: 130 }}>{p.name}</div>
                    </td>
                    <td className="cell-in">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.unitCost}
                        disabled={readOnly}
                        onChange={(e) => onRow(p.id, { unitCost: e.target.value })}
                        aria-label={`${p.name} cost of each, month ${index + 1}`}
                      />
                    </td>
                    <td className="cell-in">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.qty}
                        disabled={readOnly}
                        onChange={(e) => onRow(p.id, { qty: e.target.value })}
                        aria-label={`${p.name} quantity bought, month ${index + 1}`}
                      />
                    </td>
                    <td className="cell-in">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.soldQty}
                        disabled={readOnly}
                        onChange={(e) => onRow(p.id, { soldQty: e.target.value })}
                        aria-label={`${p.name} quantity sold, month ${index + 1}`}
                      />
                    </td>
                    <td className="cell-in">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={row.sellPrice}
                        disabled={readOnly}
                        onChange={(e) => onRow(p.id, { sellPrice: e.target.value })}
                        aria-label={`${p.name} selling price, month ${index + 1}`}
                      />
                    </td>
                    {/* The weighted average — the figure worth keeping */}
                    <td>
                      <span className="ro-strong">{nairaExact(r.unitCP, symbol)}</span>
                    </td>
                    <td className="ro">{naira(r.revenue, symbol)}</td>
                    <td className="ro">{naira(r.cogs, symbol)}</td>
                    <td className="ro">{naira(r.gross, symbol)}</td>
                    <td className="cell-in">
                      <input
                        type="text"
                        inputMode="numeric"
                        value={row.stockLeft}
                        disabled={readOnly}
                        placeholder={String(r.expectedLeft)}
                        onChange={(e) => onRow(p.id, { stockLeft: e.target.value })}
                        aria-label={`${p.name} units left, month ${index + 1}`}
                      />
                      <div className="muted tiny" style={{ marginTop: 3 }}>
                        expected {units(r.expectedLeft)}
                      </div>
                    </td>
                    <td className="ro">{naira(r.closeValue, symbol)}</td>
                  </tr>
                  {/* Notices sit under the row they concern, across its
                      full width — squeezed into the name cell they are
                      unreadable and shove the table about. */}
                  {rowNotices.length > 0 && (
                    <tr className="notice-row">
                      <td colSpan={11}>
                        {rowNotices.map((n, k) => (
                          <NoticeLine key={k} notice={n} />
                        ))}
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Month-level expenses */}
      <div className="grid-fields" style={{ marginTop: 16 }}>
        <div>
          <label htmlFor={`ads-${index}`}>Ads</label>
          <input
            id={`ads-${index}`}
            type="text"
            inputMode="decimal"
            value={m.ads}
            disabled={readOnly}
            onChange={(e) => onMonth({ ads: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`logi-${index}`}>Logistics</label>
          <input
            id={`logi-${index}`}
            type="text"
            inputMode="decimal"
            value={m.logistics}
            disabled={readOnly}
            onChange={(e) => onMonth({ logistics: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`misc-${index}`}>Miscellaneous</label>
          <input
            id={`misc-${index}`}
            type="text"
            inputMode="decimal"
            value={m.misc}
            disabled={readOnly}
            onChange={(e) => onMonth({ misc: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor={`bank-${index}`}>Bank charges</label>
          <input
            id={`bank-${index}`}
            type="text"
            inputMode="decimal"
            value={m.bankCharges}
            disabled={readOnly}
            onChange={(e) => onMonth({ bankCharges: e.target.value })}
          />
        </div>
      </div>
      <p className="muted tiny" style={{ marginTop: 8 }}>
        Total expenses this month{" "}
        <strong className="num">{naira(expenses, symbol)}</strong> — shared across the
        month, not split per product.
      </p>

      {monthNotices.map((n, k) => (
        <NoticeLine key={k} notice={n} />
      ))}

      {/* Stats strip */}
      <div className="stats">
        <div>
          <div className="k">Cost of goods sold</div>
          <div className="v">{naira(stats.cogs, symbol)}</div>
        </div>
        <div className="accent">
          <div className="k">Gross profit — goods only</div>
          <div className="v">{naira(stats.gross, symbol)}</div>
        </div>
        <div className="accent">
          <div className="k">Net profit — after expenses</div>
          <div className="v">{naira(stats.net, symbol)}</div>
        </div>
        <div>
          <div className="k">Cash at month end</div>
          <div className="v">{naira(stats.cash, symbol)}</div>
        </div>
        <p className="stats-note">
          Ads, logistics, bank charges and miscellaneous come off gross profit to give
          net profit. Net is the figure shared with slot holders — so changing an
          expense moves net, and leaves gross exactly where it was.
        </p>
      </div>
    </section>
  );
}
