"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Download,
  FileSpreadsheet,
  Link2,
  UploadCloud,
  Pencil,
  Trash2,
  SkipForward,
  UserCheck,
  PlayCircle,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getPaymentStatus, paymentStatusColor, calcCapital, isValidSlots } from "@/lib/investment-utils";

// ─── Types ───────────────────────────────────────────────────────────

type SeriesOption = {
  id: string;
  name: string;
  price_per_unit: number;
  cycles: {
    id: string;
    cycle_label: string;
    start_date: string;
    end_date: string;
    status: string;
  }[];
};

type Row = {
  id: string;
  row_number: number;
  full_name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  slots: number | null;
  amount_paid: number;
  payment_date: string | null;
  payment_reference: string | null;
  notes: string | null;
  status: string;
  issue: string | null;
  action: string | null;
  error: string | null;
  existing_investor: { full_name: string; investor_code: string } | null;
};

type Totals = {
  total_rows: number;
  importable: number;
  imported: number;
  invalid: number;
  duplicates: number;
  skipped: number;
  failed: number;
  total_slots: number;
  expected_capital: number;
  amount_paid: number;
  outstanding: number;
};

type BatchDetail = {
  batch: {
    id: string;
    status: string;
    email_mode: string;
    series: { name: string } | null;
    cycle: { cycle_label: string; status: string } | null;
  };
  rows: Row[];
  totals: Totals;
};

type Method = "google_sheets" | "xlsx" | "csv";

const HISTORICAL = ["completed", "matured", "awaiting_profit_declaration", "cancelled"];

// ─── Component ───────────────────────────────────────────────────────

export function MigrationWizard({ series }: { series: SeriesOption[] }) {
  const router = useRouter();

  // Step 1 state
  const [seriesId, setSeriesId] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [method, setMethod] = useState<Method>("google_sheets");
  const [sheetUrl, setSheetUrl] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Step 2/3 state
  const [detail, setDetail] = useState<BatchDetail | null>(null);
  const [editRow, setEditRow] = useState<Row | null>(null);
  const [emailMode, setEmailMode] = useState<"now" | "queue" | "none">("queue");
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const selectedSeries = series.find((s) => s.id === seriesId);
  const cycles = selectedSeries?.cycles ?? [];
  const selectedCycle = cycles.find((c) => c.id === cycleId);

  const refreshBatch = useCallback(async (batchId: string) => {
    const res = await fetch(`/api/admin/migration/batches/${batchId}`);
    const json = await res.json();
    if (res.ok) setDetail(json);
    return res.ok ? (json as BatchDetail) : null;
  }, []);

  // ── Step 1: create the batch ──
  const handleUpload = async () => {
    if (!seriesId || !cycleId) {
      toast.error("Select the Series and Cycle first");
      return;
    }
    setUploading(true);
    try {
      let res: Response;
      if (method === "google_sheets") {
        if (!sheetUrl.trim()) {
          toast.error("Paste the Google Sheets link");
          return;
        }
        res = await fetch("/api/admin/migration/batches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ series_id: seriesId, cycle_id: cycleId, sheet_url: sheetUrl }),
        });
      } else {
        const file = fileRef.current?.files?.[0];
        if (!file) {
          toast.error("Choose a file to upload");
          return;
        }
        const form = new FormData();
        form.set("series_id", seriesId);
        form.set("cycle_id", cycleId);
        form.set("file", file);
        res = await fetch("/api/admin/migration/batches", { method: "POST", body: form });
      }
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Upload failed");
        return;
      }
      await refreshBatch(json.batch_id);
      toast.success("File read successfully — review the rows below before importing");
    } finally {
      setUploading(false);
    }
  };

  // ── Step 2: row actions ──
  const rowAction = async (row: Row, body: object) => {
    if (!detail) return;
    const res = await fetch(
      `/api/admin/migration/batches/${detail.batch.id}/rows/${row.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    const json = await res.json();
    if (!res.ok) toast.error(json.error ?? "Action failed");
    await refreshBatch(detail.batch.id);
  };

  const deleteRow = async (row: Row) => {
    if (!detail) return;
    if (!window.confirm(`Remove row ${row.row_number} (${row.full_name}) from this import?`)) return;
    await fetch(`/api/admin/migration/batches/${detail.batch.id}/rows/${row.id}`, {
      method: "DELETE",
    });
    await refreshBatch(detail.batch.id);
  };

  // ── Step 3: resumable import loop ──
  const runImport = async (retryFailed: boolean) => {
    if (!detail) return;
    setImporting(true);
    const total = detail.totals.importable;
    setProgress({ done: 0, total });
    try {
      let done = false;
      let processedSoFar = 0;
      let guard = 0;
      while (!done && guard < 200) {
        guard++;
        const res = await fetch(
          `/api/admin/migration/batches/${detail.batch.id}/import`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email_mode: emailMode,
              limit: 20,
              retry_failed: retryFailed,
            }),
          }
        );
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? "Import failed — you can safely retry; completed rows are never repeated");
          break;
        }
        processedSoFar += json.processed + json.failed_in_chunk;
        setProgress({ done: processedSoFar, total });
        done = json.done || json.processed + json.failed_in_chunk === 0;
      }
      const fresh = await refreshBatch(detail.batch.id);
      if (fresh) {
        const t = fresh.totals;
        if (t.failed > 0) {
          toast.warning(
            `Import finished: ${t.imported} imported, ${t.failed} failed. Fix the failed rows and press “Retry Failed”.`
          );
        } else {
          toast.success(`Import complete: ${t.imported} investors migrated ✓`);
        }
      }
      router.refresh(); // refresh history + dashboard data
    } finally {
      setImporting(false);
    }
  };

  const startOver = () => {
    setDetail(null);
    setSheetUrl("");
    if (fileRef.current) fileRef.current.value = "";
  };

  // ─────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      {/* ══ Step 1: setup ══ */}
      {!detail && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">1 · Select Series &amp; Cycle, then Upload</CardTitle>
              <a href="/api/admin/migration/template" download>
                <Button variant="outline" size="sm">
                  <Download className="h-4 w-4" />
                  Download Migration Template
                </Button>
              </a>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {/* Series + cycle */}
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">Series</label>
                <select
                  value={seriesId}
                  onChange={(e) => {
                    setSeriesId(e.target.value);
                    setCycleId("");
                  }}
                  className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
                >
                  <option value="">Select series…</option>
                  {series.map((s) => (
                    <option key={s.id} value={s.id}>
                      Series {s.name} — {formatCurrency(s.price_per_unit)} per slot
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted">
                  Migrate one series at a time: finish Series A, then B, then C.
                </p>
              </div>
              <div className="space-y-1.5">
                <label className="block text-sm font-medium text-foreground">Cycle</label>
                <select
                  value={cycleId}
                  onChange={(e) => setCycleId(e.target.value)}
                  disabled={!seriesId}
                  className="h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 disabled:opacity-50"
                >
                  <option value="">Select cycle…</option>
                  {cycles.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.cycle_label} ({formatDate(c.start_date)} – {formatDate(c.end_date)}) · {c.status.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
                {selectedCycle && HISTORICAL.includes(selectedCycle.status) && (
                  <p className="text-xs text-amber-700">
                    Historical cycle — investors will be imported as completed records and
                    will not be activated.
                  </p>
                )}
              </div>
            </div>

            {/* Method tabs */}
            <div>
              <div className="flex gap-2 mb-3">
                {(
                  [
                    { key: "google_sheets", label: "Google Sheets", icon: <Link2 className="h-4 w-4" />, hint: "Recommended" },
                    { key: "xlsx", label: "Excel (.xlsx)", icon: <FileSpreadsheet className="h-4 w-4" /> },
                    { key: "csv", label: "CSV", icon: <FileSpreadsheet className="h-4 w-4" /> },
                  ] as { key: Method; label: string; icon: React.ReactNode; hint?: string }[]
                ).map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setMethod(m.key)}
                    className={`flex items-center gap-2 rounded-lg border-2 px-3.5 py-2 text-sm font-medium transition-all ${
                      method === m.key
                        ? "border-primary-500 bg-primary-50 text-primary-700"
                        : "border-border text-muted hover:border-primary-200"
                    }`}
                  >
                    {m.icon}
                    {m.label}
                    {m.hint && (
                      <span className="rounded-full bg-emerald-100 text-emerald-700 text-[10px] font-bold px-1.5 py-0.5">
                        {m.hint}
                      </span>
                    )}
                  </button>
                ))}
              </div>

              {method === "google_sheets" ? (
                <div className="space-y-1.5">
                  <Input
                    label="Google Sheets link"
                    placeholder="https://docs.google.com/spreadsheets/d/…"
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                  />
                  <p className="text-xs text-muted">
                    Set the sheet's sharing to <span className="font-semibold">“Anyone with the link can view”</span>.
                    The sheet must use the template columns.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="block text-sm font-medium text-foreground">
                    {method === "xlsx" ? "Excel file" : "CSV file"}
                  </label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept={method === "xlsx" ? ".xlsx,.xls" : ".csv"}
                    className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border-0 file:bg-primary-100 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-primary-700 hover:file:bg-primary-200"
                  />
                </div>
              )}
            </div>

            <Button onClick={handleUpload} loading={uploading} disabled={!seriesId || !cycleId}>
              <UploadCloud className="h-4 w-4" />
              {uploading ? "Reading…" : "Read & Validate"}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ══ Step 2/3: review + import ══ */}
      {detail && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { label: "Total Investors", value: String(detail.totals.total_rows) },
              { label: "Total Slots", value: String(detail.totals.total_slots) },
              { label: "Expected Capital", value: formatCurrency(detail.totals.expected_capital) },
              { label: "Amount Paid", value: formatCurrency(detail.totals.amount_paid) },
              { label: "Outstanding Balance", value: formatCurrency(detail.totals.outstanding) },
              { label: "Duplicates", value: String(detail.totals.duplicates), warn: detail.totals.duplicates > 0 },
              { label: "Invalid Records", value: String(detail.totals.invalid), warn: detail.totals.invalid > 0 },
              { label: "Imported / Failed", value: `${detail.totals.imported} / ${detail.totals.failed}` },
            ].map((s) => (
              <Card key={s.label} className={s.warn ? "border-amber-300" : ""}>
                <CardContent className="p-3">
                  <p className="text-[10px] text-muted uppercase tracking-wide">{s.label}</p>
                  <p className={`text-lg font-bold mt-0.5 ${s.warn ? "text-amber-600" : "text-foreground"}`}>
                    {s.value}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Review table */}
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">
                  2 · Review — Series {detail.batch.series?.name} · {detail.batch.cycle?.cycle_label}
                </CardTitle>
                <Button variant="ghost" size="sm" onClick={startOver} disabled={importing}>
                  Start over with a different file
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto max-h-[520px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-surface-2 sticky top-0">
                    <tr>
                      {["#", "Investor", "Slots", "Expected", "Paid", "Balance", "Status", "Issue", "Actions"].map((h) => (
                        <th key={h} className="text-left py-2.5 px-3 text-xs font-semibold text-muted uppercase tracking-wide">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detail.rows.map((row) => {
                      const expected = row.slots && isValidSlots(Number(row.slots)) ? calcCapital(Number(row.slots)) : 0;
                      const paid = Number(row.amount_paid ?? 0);
                      const payStatus = expected > 0 ? getPaymentStatus(expected, paid) : null;
                      return (
                        <tr key={row.id} className={row.status === "invalid" || row.status === "failed" ? "bg-red-50/40" : row.status === "duplicate" ? "bg-amber-50/40" : ""}>
                          <td className="py-2.5 px-3 text-xs text-muted">{row.row_number}</td>
                          <td className="py-2.5 px-3">
                            <p className="font-semibold text-foreground">{row.full_name || "—"}</p>
                            <p className="text-xs text-muted">{row.email} · {row.phone}</p>
                          </td>
                          <td className="py-2.5 px-3">{row.slots ?? "—"}</td>
                          <td className="py-2.5 px-3">{expected ? formatCurrency(expected) : "—"}</td>
                          <td className="py-2.5 px-3">
                            {formatCurrency(paid)}
                            {payStatus && (
                              <span className={`ml-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${paymentStatusColor(payStatus)}`}>
                                {payStatus}
                              </span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">{expected ? formatCurrency(Math.max(0, expected - paid)) : "—"}</td>
                          <td className="py-2.5 px-3">
                            <span
                              className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                row.status === "valid"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : row.status === "imported"
                                  ? "bg-primary-100 text-primary-700"
                                  : row.status === "duplicate"
                                  ? row.action === "attach"
                                    ? "bg-blue-100 text-blue-700"
                                    : "bg-amber-100 text-amber-700"
                                  : row.status === "skipped"
                                  ? "bg-surface-2 text-muted"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {row.status === "duplicate" && row.action === "attach"
                                ? "add to existing"
                                : row.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-muted max-w-[260px]">
                            {row.error ?? row.issue ?? ""}
                          </td>
                          <td className="py-2.5 px-3">
                            {row.status !== "imported" && !importing && (
                              <div className="flex items-center gap-1">
                                <button title="Edit" onClick={() => setEditRow(row)} className="p-1.5 rounded hover:bg-surface-2 text-muted hover:text-foreground">
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                {row.status === "duplicate" && row.action !== "attach" && (
                                  <button
                                    title={`Add investment to ${row.existing_investor?.full_name ?? "existing investor"}`}
                                    onClick={() => rowAction(row, { action: "attach" })}
                                    className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                                  >
                                    <UserCheck className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                {row.status !== "skipped" ? (
                                  <button title="Skip" onClick={() => rowAction(row, { action: "skip" })} className="p-1.5 rounded hover:bg-surface-2 text-muted">
                                    <SkipForward className="h-3.5 w-3.5" />
                                  </button>
                                ) : (
                                  <button title="Restore" onClick={() => rowAction(row, {})} className="p-1.5 rounded hover:bg-surface-2 text-muted">
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </button>
                                )}
                                <button title="Delete" onClick={() => deleteRow(row)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Confirm import */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">3 · Confirm Import</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm font-medium text-foreground mb-2">Portal invitation emails</p>
                <div className="flex flex-wrap gap-3">
                  {(
                    [
                      { key: "now", label: "Send immediately" },
                      { key: "queue", label: "Queue for later" },
                      { key: "none", label: "Don't send yet" },
                    ] as const
                  ).map((o) => (
                    <label key={o.key} className="flex items-center gap-2 text-sm cursor-pointer">
                      <input
                        type="radio"
                        name="email_mode"
                        checked={emailMode === o.key}
                        onChange={() => setEmailMode(o.key)}
                        disabled={importing}
                      />
                      {o.label}
                    </label>
                  ))}
                </div>
                <p className="text-xs text-muted mt-1.5">
                  Invitations contain the investor's name, code, portal link, and a password
                  setup link. Passwords are never emailed.
                </p>
              </div>

              {importing && (
                <div>
                  <div className="flex justify-between text-xs text-muted mb-1.5">
                    <span>Importing… do not close this page (safe to retry if interrupted)</span>
                    <span>
                      {progress.done}/{progress.total}
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-surface-2 overflow-hidden">
                    <div
                      className="h-full bg-primary-600 transition-all"
                      style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {detail.batch.status === "completed" && detail.totals.failed === 0 ? (
                <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium">
                  <CheckCircle2 className="h-4 w-4" />
                  Migration complete — {detail.totals.imported} investors imported. Dashboards update automatically.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() => runImport(false)}
                    loading={importing}
                    disabled={detail.totals.importable - detail.totals.failed <= 0 && detail.totals.failed === 0}
                  >
                    <PlayCircle className="h-4 w-4" />
                    Import {Math.max(0, detail.totals.importable - detail.totals.failed)} Investors
                  </Button>
                  {detail.totals.failed > 0 && (
                    <Button variant="outline" onClick={() => runImport(true)} loading={importing}>
                      <RotateCcw className="h-4 w-4" />
                      Retry {detail.totals.failed} Failed
                    </Button>
                  )}
                </div>
              )}

              {detail.totals.invalid > 0 && (
                <p className="flex items-center gap-1.5 text-xs text-amber-700">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {detail.totals.invalid} invalid row{detail.totals.invalid !== 1 ? "s" : ""} will not be imported —
                  edit or delete them above.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ══ Edit row dialog ══ */}
      {editRow && (
        <EditRowDialog
          row={editRow}
          onClose={() => setEditRow(null)}
          onSave={async (fields) => {
            await rowAction(editRow, fields);
            setEditRow(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Edit dialog ─────────────────────────────────────────────────────

function EditRowDialog({
  row,
  onClose,
  onSave,
}: {
  row: Row;
  onClose: () => void;
  onSave: (fields: object) => Promise<void>;
}) {
  const [f, setF] = useState({
    full_name: row.full_name ?? "",
    phone: row.phone ?? "",
    email: row.email ?? "",
    address: row.address ?? "",
    slots: row.slots != null ? String(row.slots) : "",
    amount_paid: String(row.amount_paid ?? 0),
    payment_date: row.payment_date ?? "",
    payment_reference: row.payment_reference ?? "",
    notes: row.notes ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setF((p) => ({ ...p, [k]: e.target.value }));

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        full_name: f.full_name.trim(),
        phone: f.phone.trim() || null,
        email: f.email.trim() || null,
        address: f.address.trim() || null,
        slots: f.slots === "" ? null : Number(f.slots),
        amount_paid: Number(f.amount_paid) || 0,
        payment_date: f.payment_date || null,
        payment_reference: f.payment_reference.trim() || null,
        notes: f.notes.trim() || null,
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Row {row.row_number}</DialogTitle>
        </DialogHeader>
        <div className="p-6 space-y-3">
          <Input label="Full Name" value={f.full_name} onChange={set("full_name")} required />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Phone Number" value={f.phone} onChange={set("phone")} />
            <Input label="Email Address" type="email" value={f.email} onChange={set("email")} />
          </div>
          <Input label="Residential Address" value={f.address} onChange={set("address")} />
          <div className="grid grid-cols-2 gap-3">
            <Input label="Number of Slots" type="number" step="0.5" min="0.5" value={f.slots} onChange={set("slots")} />
            <Input label="Amount Paid (₦)" type="number" min="0" value={f.amount_paid} onChange={set("amount_paid")} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input label="Payment Date" type="date" value={f.payment_date} onChange={set("payment_date")} />
            <Input label="Payment Reference" value={f.payment_reference} onChange={set("payment_reference")} />
          </div>
          <Input label="Notes" value={f.notes} onChange={set("notes")} />
          <DialogFooter className="!p-0 !border-0 !mt-4">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} loading={saving}>
              Save &amp; Re-validate
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}
