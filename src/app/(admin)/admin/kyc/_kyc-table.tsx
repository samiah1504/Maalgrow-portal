"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Search,
  CheckCircle2,
  Loader2,
  Download,
  AlertCircle,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { maskAccountNumber, genderLabel, type DerivedKycStatus } from "@/lib/kyc";

export type KycRow = {
  id: string;
  investor_code: string;
  full_name: string;
  email: string;
  phone: string | null;
  address: string | null;
  bank_name: string | null;
  account_number: string | null;
  gender: string | null;
  nationality: string | null;
  occupation: string | null;
  kyc_submitted_at: string | null;
  kyc_approved_at: string | null;
  updated_at: string;
  nok_name: string | null;
  nok_relationship: string | null;
  nok_phone: string | null;
  nok_email: string | null;
  nok_address: string | null;
  derived_status: DerivedKycStatus;
  missing: string[];
  series_ids: string[];
  cycle_ids: string[];
};

type BulkResult = {
  selected: number;
  approved: number;
  excluded_count: number;
  excluded: {
    investor_id: string;
    investor_code: string | null;
    full_name: string | null;
    reasons: string[];
  }[];
};

const STATUS_FILTERS: (DerivedKycStatus | "All")[] = [
  "All",
  "Incomplete",
  "Update Required",
  "Submitted",
  "Approved",
  "Rejected",
];

const MISSING_FILTERS = [
  { key: "Gender", label: "Missing gender" },
  { key: "Nationality", label: "Missing nationality" },
  { key: "Occupation", label: "Missing occupation" },
  { key: "Next-of-kin details", label: "Missing next of kin" },
] as const;

const STATUS_STYLE: Record<DerivedKycStatus, string> = {
  Approved: "bg-green-50 text-green-700",
  Submitted: "bg-blue-50 text-blue-700",
  "Update Required": "bg-amber-50 text-amber-700",
  Incomplete: "bg-gray-100 text-gray-600",
  Rejected: "bg-red-50 text-red-600",
};

export function KycTable({
  rows,
  series,
  cycles,
}: {
  rows: KycRow[];
  series: { id: string; name: string }[];
  cycles: { id: string; series_id: string; cycle_label: string }[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<(typeof STATUS_FILTERS)[number]>("All");
  const [missingFilter, setMissingFilter] = useState<string>("");
  const [seriesFilter, setSeriesFilter] = useState("");
  const [cycleFilter, setCycleFilter] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== "All" && r.derived_status !== statusFilter) return false;
      if (missingFilter && !r.missing.includes(missingFilter)) return false;
      if (seriesFilter && !r.series_ids.includes(seriesFilter)) return false;
      if (cycleFilter && !r.cycle_ids.includes(cycleFilter)) return false;
      if (!q) return true;
      return [
        r.full_name,
        r.investor_code,
        r.email,
        r.phone,
        r.nok_name,
        r.nok_phone,
      ]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [rows, query, statusFilter, missingFilter, seriesFilter, cycleFilter]);

  const filteredCycles = cycles.filter(
    (c) => !seriesFilter || c.series_id === seriesFilter
  );

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedRows = rows.filter((r) => selected.has(r.id));
  // Eligibility mirror of the server rules (final decision is server-side)
  const eligible = selectedRows.filter(
    (r) => r.derived_status === "Submitted"
  );
  const excludedPreview = selectedRows.filter(
    (r) => r.derived_status !== "Submitted"
  );

  const exclusionReason = (r: KycRow): string => {
    if (r.derived_status === "Approved") return "Already approved";
    if (r.derived_status === "Rejected") return "Rejected — awaiting correction";
    if (!r.kyc_submitted_at) return "KYC not submitted";
    if (r.missing.length > 0) return "Missing: " + r.missing.join(", ");
    return "Not eligible";
  };

  const runBulkApprove = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/kyc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "bulk_approve",
          investor_ids: Array.from(selected),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Bulk approval failed");
        return;
      }
      const r = json.result as BulkResult;
      setResult(r);
      setConfirming(false);
      setSelected(new Set());
      toast.success(`${r.approved} KYC record${r.approved === 1 ? "" : "s"} approved`);
      router.refresh();
    } catch {
      toast.error("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const exportRows = async (scope: "all" | "filtered" | "selected", data: KycRow[]) => {
    if (data.length === 0) {
      toast.error("Nothing to export");
      return;
    }
    const XLSX = await import("xlsx");
    const sheetRows = data.map((r) => ({
      "Investor Code": r.investor_code,
      "Full Name": r.full_name,
      Email: r.email,
      "Phone Number": r.phone ?? "",
      Gender: genderLabel(r.gender),
      Nationality: r.nationality ?? "",
      Occupation: r.occupation ?? "",
      "Residential Address": r.address ?? "",
      "Bank Name": r.bank_name ?? "",
      "Account Number (masked)": maskAccountNumber(r.account_number),
      "Next-of-Kin Name": r.nok_name ?? "",
      Relationship: r.nok_relationship ?? "",
      "Next-of-Kin Phone": r.nok_phone ?? "",
      "Next-of-Kin Email": r.nok_email ?? "",
      "Next-of-Kin Address": r.nok_address ?? "",
      "KYC Status": r.derived_status,
      "Submitted Date": r.kyc_submitted_at ? formatDate(r.kyc_submitted_at) : "",
      "Approved Date": r.kyc_approved_at ? formatDate(r.kyc_approved_at) : "",
      "Last Updated": formatDate(r.updated_at),
    }));
    const ws = XLSX.utils.json_to_sheet(sheetRows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "KYC");
    XLSX.writeFile(wb, `maalgrow-kyc-${scope}-${new Date().toISOString().split("T")[0]}.xlsx`);

    // Audit the export
    fetch("/api/admin/kyc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "log_export", scope, count: data.length }),
    }).catch(() => {});
    toast.success(`Exported ${data.length} record${data.length === 1 ? "" : "s"}`);
  };

  const downloadExclusions = (r: BulkResult) => {
    const lines = [
      "Investor Code,Full Name,Reasons",
      ...r.excluded.map(
        (e) =>
          `"${e.investor_code ?? ""}","${e.full_name ?? ""}","${e.reasons.join("; ")}"`
      ),
    ];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kyc-bulk-approval-exclusions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((r) => selected.has(r.id));

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, code, email, phone, next of kin…"
            className="h-9 w-72 rounded-lg border border-border bg-white pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="h-9 rounded-lg border border-border bg-white px-2 text-sm"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === "All" ? "All statuses" : s}
            </option>
          ))}
        </select>
        <select
          value={missingFilter}
          onChange={(e) => setMissingFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-white px-2 text-sm"
        >
          <option value="">Any completeness</option>
          {MISSING_FILTERS.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label}
            </option>
          ))}
        </select>
        <select
          value={seriesFilter}
          onChange={(e) => {
            setSeriesFilter(e.target.value);
            setCycleFilter("");
          }}
          className="h-9 rounded-lg border border-border bg-white px-2 text-sm"
        >
          <option value="">All series</option>
          {series.map((s) => (
            <option key={s.id} value={s.id}>
              Series {s.name}
            </option>
          ))}
        </select>
        <select
          value={cycleFilter}
          onChange={(e) => setCycleFilter(e.target.value)}
          className="h-9 rounded-lg border border-border bg-white px-2 text-sm"
        >
          <option value="">All cycles</option>
          {filteredCycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.cycle_label}
            </option>
          ))}
        </select>
      </div>

      {/* Selection + actions bar */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted">
          {filtered.length} of {rows.length} investors
          {selected.size > 0 && (
            <>
              {" "}
              · <span className="font-semibold text-foreground">{selected.size} selected</span>
            </>
          )}
        </span>
        <button
          onClick={() =>
            setSelected(new Set([...selected, ...filtered.map((r) => r.id)]))
          }
          className="text-xs text-primary-600 hover:underline"
        >
          Select all filtered ({filtered.length})
        </button>
        {selected.size > 0 && (
          <button
            onClick={() => setSelected(new Set())}
            className="text-xs text-muted hover:underline"
          >
            Clear selection
          </button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportRows("all", rows)}
          >
            <Download className="h-4 w-4" /> Export All
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => exportRows("filtered", filtered)}
          >
            <Download className="h-4 w-4" /> Export Filtered
          </Button>
          {selected.size > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportRows("selected", selectedRows)}
            >
              <Download className="h-4 w-4" /> Export Selected
            </Button>
          )}
          <Button
            size="sm"
            disabled={selected.size === 0}
            onClick={() => setConfirming(true)}
          >
            <CheckCircle2 className="h-4 w-4" />
            Approve Selected KYC{selected.size > 0 ? ` (${selected.size})` : ""}
          </Button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl border border-border bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2 text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-3 py-2.5">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={() => {
                    if (allVisibleSelected) {
                      setSelected((prev) => {
                        const next = new Set(prev);
                        filtered.forEach((r) => next.delete(r.id));
                        return next;
                      });
                    } else {
                      setSelected(
                        new Set([...selected, ...filtered.map((r) => r.id)])
                      );
                    }
                  }}
                />
              </th>
              <th className="px-3 py-2.5">Investor</th>
              <th className="px-3 py-2.5">Contact</th>
              <th className="px-3 py-2.5">Gender</th>
              <th className="px-3 py-2.5">Nationality</th>
              <th className="px-3 py-2.5">Occupation</th>
              <th className="px-3 py-2.5">Next of Kin</th>
              <th className="px-3 py-2.5">Bank</th>
              <th className="px-3 py-2.5">Status</th>
              <th className="px-3 py-2.5">Dates</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-3 py-10 text-center text-muted">
                  No investors match the current filters.
                </td>
              </tr>
            ) : (
              filtered.map((r) => (
                <tr key={r.id} className="hover:bg-surface-2/50">
                  <td className="px-3 py-2.5 align-top">
                    <input
                      type="checkbox"
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <Link
                      href={`/admin/investors/${r.id}`}
                      className="font-medium text-primary-700 hover:underline"
                    >
                      {r.full_name}
                    </Link>
                    <p className="font-mono text-xs text-muted">{r.investor_code}</p>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <p className="text-xs">{r.email}</p>
                    <p className="text-xs text-muted">{r.phone ?? "—"}</p>
                  </td>
                  <td className="px-3 py-2.5 align-top text-xs">{genderLabel(r.gender)}</td>
                  <td className="px-3 py-2.5 align-top text-xs">{r.nationality ?? "—"}</td>
                  <td className="px-3 py-2.5 align-top text-xs">{r.occupation ?? "—"}</td>
                  <td className="px-3 py-2.5 align-top">
                    {r.nok_name ? (
                      <>
                        <p className="text-xs">{r.nok_name}</p>
                        <p className="text-xs text-muted">
                          {r.nok_relationship} · {r.nok_phone}
                        </p>
                      </>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <p className="text-xs">{r.bank_name ?? "—"}</p>
                    <p className="text-xs font-mono text-muted">
                      {maskAccountNumber(r.account_number)}
                    </p>
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span
                      className={`inline-block text-[10px] font-semibold uppercase px-2 py-0.5 rounded-full ${STATUS_STYLE[r.derived_status]}`}
                    >
                      {r.derived_status}
                    </span>
                    {r.missing.length > 0 && r.derived_status !== "Incomplete" && (
                      <p className="text-[10px] text-amber-700 mt-1 max-w-[140px]">
                        Missing: {r.missing.join(", ")}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top text-[11px] text-muted whitespace-nowrap">
                    <p>Sub: {r.kyc_submitted_at ? formatDate(r.kyc_submitted_at) : "—"}</p>
                    <p>App: {r.kyc_approved_at ? formatDate(r.kyc_approved_at) : "—"}</p>
                    <p>Upd: {formatDate(r.updated_at)}</p>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Confirmation dialog */}
      <Dialog open={confirming} onOpenChange={(o) => !o && setConfirming(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve Selected KYC</DialogTitle>
            <DialogDescription>
              You are about to approve the KYC records of {selected.size}{" "}
              investor{selected.size === 1 ? "" : "s"}. Only complete and valid
              submissions will be approved.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3 text-sm">
            <div className="rounded-lg border border-border divide-y divide-border">
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted">Selected</span>
                <span className="font-semibold">{selected.size}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted">Eligible for approval</span>
                <span className="font-semibold text-green-700">{eligible.length}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted">Will be excluded</span>
                <span className="font-semibold text-amber-700">
                  {excludedPreview.length}
                </span>
              </div>
            </div>
            {excludedPreview.length > 0 && (
              <div className="max-h-36 overflow-y-auto rounded-lg bg-amber-50 border border-amber-200 p-2.5 space-y-1">
                {excludedPreview.slice(0, 20).map((r) => (
                  <p key={r.id} className="text-xs text-amber-800">
                    <span className="font-medium">{r.full_name}</span> —{" "}
                    {exclusionReason(r)}
                  </p>
                ))}
                {excludedPreview.length > 20 && (
                  <p className="text-xs text-amber-700">
                    …and {excludedPreview.length - 20} more
                  </p>
                )}
              </div>
            )}
            <p className="text-xs text-muted">
              Every record is revalidated on the server before approval; the
              operation supports partial success.
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirming(false)}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={runBulkApprove} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Confirm &amp; Approve
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Result dialog */}
      <Dialog open={result !== null} onOpenChange={(o) => !o && setResult(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Bulk Approval Complete</DialogTitle>
            <DialogDescription>
              {result?.selected} selected · {result?.approved} approved ·{" "}
              {result?.excluded_count} excluded
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 py-4 space-y-3">
            {result && result.excluded.length > 0 ? (
              <>
                <div className="max-h-44 overflow-y-auto rounded-lg bg-amber-50 border border-amber-200 p-2.5 space-y-1.5">
                  {result.excluded.map((e) => (
                    <div key={e.investor_id} className="text-xs text-amber-800">
                      <span className="font-medium">
                        {e.full_name ?? e.investor_id}
                      </span>{" "}
                      <span className="font-mono">{e.investor_code ?? ""}</span>
                      <p className="flex items-start gap-1 mt-0.5">
                        <AlertCircle className="h-3 w-3 mt-0.5 shrink-0" />
                        {e.reasons.join("; ")}
                      </p>
                    </div>
                  ))}
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => downloadExclusions(result)}
                >
                  <Download className="h-4 w-4" /> Download excluded records (CSV)
                </Button>
              </>
            ) : (
              <p className="text-sm text-green-700 flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" /> All selected records were
                approved.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button size="sm" onClick={() => setResult(null)}>
              <X className="h-4 w-4" /> Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
