"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCheck, Download, FileSpreadsheet, Mail, Send, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import { formatKobo, koboInWords } from "@/lib/maalrise/format";
import type { CheckedRow, ImportSummary } from "@/lib/maalrise/bulk-import";

async function post(url: string, body: BodyInit, json = true): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const res = await fetch(url, { method: "POST", body, ...(json ? { headers: { "Content-Type": "application/json" } } : {}) });
    return { ok: res.ok, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, data: { error: "Network error. Please try again." } };
  }
}
const errorOf = (d: Record<string, unknown>) => (typeof d.error === "string" ? koboInWords(d.error) : "That did not work. Please try again.");

const PERSON: Record<CheckedRow["person"], string> = {
  new: "New person — login created, nothing sent",
  login: "Existing login",
  maalrise: "Already a MaalRise investor",
  staff: "Staff account",
};

type ImportResult = { row: number; email: string; ok: boolean; skipped?: boolean; message: string };

/** Add many investors' funding at once from a Google Sheet or a file. */
export function BulkImportPanel({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  const url = `/api/admin/maalrise/cycles/${cycleId}/import`;
  const [source, setSource] = useState<"sheet" | "file">("sheet");
  const [sheetUrl, setSheetUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [preview, setPreview] = useState<{ rows: CheckedRow[]; summary: ImportSummary } | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);

  async function check() {
    setBusy("preview"); setResults(null);
    let r;
    if (source === "file" && file) {
      const fd = new FormData();
      fd.append("file", file);
      r = await post(url, fd, false);
    } else {
      r = await post(url, JSON.stringify({ sheet_url: sheetUrl }));
    }
    setBusy(null);
    if (!r.ok) { setPreview(null); toast.error(errorOf(r.data)); return; }
    setPreview(r.data as unknown as { rows: CheckedRow[]; summary: ImportSummary });
  }

  async function runImport() {
    if (!preview) return;
    const s = preview.summary;
    if (!window.confirm(`Import ${s.ready} row(s): ${s.units} units, ${formatKobo(s.amountKobo)}?\n\n`
      + `${s.newPeople} new login(s) will be created. No email or invitation is sent.\n`
      + "The funding is RECORDED; it still has to be confirmed.")) return;
    setBusy("import");
    const r = await post(url, JSON.stringify({ action: "import", rows: preview.rows.filter((x) => x.status !== "error") }));
    setBusy(null);
    if (!r.ok) { toast.error(errorOf(r.data)); return; }
    const res = (r.data.results as ImportResult[]) ?? [];
    setResults(res);
    setPreview(null);
    const done = res.filter((x) => x.ok && !x.skipped).length;
    const failed = res.filter((x) => !x.ok).length;
    if (failed) toast.warning(`${done} row(s) imported, ${failed} not imported — see the list.`);
    else toast.success(`${done} row(s) imported. Confirm the funding next.`);
    router.refresh();
  }

  const s = preview?.summary;
  return (
    <div className="rounded-lg border border-border p-4 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium flex items-center gap-1.5"><FileSpreadsheet className="h-4 w-4" /> Import many investors at once</p>
        <a href={url} className="text-xs text-primary-700 hover:underline inline-flex items-center gap-1"><Download className="h-3 w-3" /> Download the template</a>
      </div>
      <p className="text-xs text-muted">
        One row per investor: Email, Full name, Phone, Units, Date received (DD/MM/YYYY), Bank reference, and optionally Bank name,
        Account name and Account number. People without a login get one, but nothing is sent. Rows whose bank reference is already
        recorded in this Cycle are skipped, so importing the same sheet again adds nothing.
      </p>
      <div className="flex gap-4 text-sm">
        <label className="inline-flex items-center gap-1.5"><input type="radio" checked={source === "sheet"} onChange={() => setSource("sheet")} /> Google Sheet link</label>
        <label className="inline-flex items-center gap-1.5"><input type="radio" checked={source === "file"} onChange={() => setSource("file")} /> Upload a file (CSV or Excel)</label>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        {source === "sheet" ? (
          <div className="flex-1 min-w-[260px]">
            <Input label="Google Sheet link (shared as “Anyone with the link can view”)" value={sheetUrl}
              onChange={(e) => setSheetUrl(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
          </div>
        ) : (
          <div className="flex-1 min-w-[260px] space-y-1.5">
            <label htmlFor="import-file" className="block text-sm font-medium">File</label>
            <input id="import-file" type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block text-sm" />
          </div>
        )}
        <Button size="sm" variant="outline" loading={busy === "preview"}
          disabled={source === "sheet" ? !sheetUrl.trim() : !file} onClick={check}>
          <Upload className="h-3.5 w-3.5" /> Check the rows
        </Button>
      </div>

      {preview && s && (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="approved">{s.ready} ready</Badge>
            {s.errors > 0 && <Badge variant="rejected">{s.errors} with problems (not imported)</Badge>}
            {s.alreadyImported > 0 && <Badge variant="upcoming">{s.alreadyImported} already imported (skipped)</Badge>}
            <span className="text-muted">{s.newPeople} new {s.newPeople === 1 ? "person" : "people"} · {s.existingLogins} with a login · {s.units} units · {formatKobo(s.amountKobo)}</span>
          </div>
          <div className="overflow-x-auto max-h-96">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left text-muted">
                  <th className="py-1.5 pr-2 font-medium">Row</th>
                  <th className="px-2 py-1.5 font-medium">Investor</th>
                  <th className="px-2 py-1.5 font-medium">Who</th>
                  <th className="px-2 py-1.5 text-right font-medium">Units</th>
                  <th className="px-2 py-1.5 text-right font-medium">Amount</th>
                  <th className="px-2 py-1.5 font-medium">Received</th>
                  <th className="px-2 py-1.5 font-medium">Reference</th>
                  <th className="py-1.5 pl-2 font-medium">Check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.rows.map((r) => (
                  <tr key={r.row} className={r.status === "error" ? "bg-red-50/60 align-top" : "align-top"}>
                    <td className="py-1.5 pr-2 text-muted">{r.row}</td>
                    <td className="px-2 py-1.5">{r.full_name || (r.person === "new" ? "—" : "(name from their login)")}<span className="block text-muted">{r.email}</span></td>
                    <td className="px-2 py-1.5">{PERSON[r.person]}</td>
                    <td className="px-2 py-1.5 text-right">{r.units ?? "—"}</td>
                    <td className="px-2 py-1.5 text-right">{r.amount_kobo ? formatKobo(r.amount_kobo) : "—"}</td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{r.received_on ? formatDate(r.received_on) : "—"}</td>
                    <td className="px-2 py-1.5 font-mono">{r.reference || "—"}</td>
                    <td className="py-1.5 pl-2">
                      {r.status === "ready" ? <span className="text-green-700">Ready</span>
                        : r.status === "already_imported" ? <span className="text-muted">Already imported — skipped</span>
                        : <span className="text-red-700">{r.issues.join("; ")}</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" disabled={s.ready === 0} loading={busy === "import"} onClick={runImport}>
              Import {s.ready} row{s.ready === 1 ? "" : "s"}
            </Button>
            <span className="text-xs text-muted">Fix the rows with problems in the sheet and check again, or import the ready rows now and the rest later.</span>
          </div>
        </div>
      )}

      {results && (
        <ul className="space-y-0.5 text-xs" aria-label="Import results">
          {results.map((r) => (
            <li key={r.row} className={r.ok ? (r.skipped ? "text-muted" : "text-green-700") : "text-red-700"}>
              Row {r.row} ({r.email || "no email"}): {r.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type ConfirmResult = { reference: string; ok: boolean; message: string };

/** Confirm every recorded funding entry with one press. */
export function ConfirmAllFunding({
  cycleId, recorded, recordedByMe, isSuperAdmin,
}: { cycleId: string; recorded: number; recordedByMe: number; isSuperAdmin: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<ConfirmResult[] | null>(null);
  const others = recorded - recordedByMe;
  const canDo = isSuperAdmin ? recorded : others;
  const needsReason = isSuperAdmin && recordedByMe > 0;

  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm">
          <span className="font-medium">{recorded} funding entr{recorded === 1 ? "y" : "ies"} awaiting confirmation.</span>{" "}
          {recordedByMe > 0 && (
            <span className="text-muted">
              {recordedByMe} recorded by you{isSuperAdmin ? " — as a super admin you may confirm them with one reason" : " — another finance person must confirm those"}.
            </span>
          )}
        </p>
        <Button size="sm" disabled={canDo === 0} onClick={() => { setOpen(!open); setResults(null); }}>
          <CheckCheck className="h-3.5 w-3.5" /> Confirm all
        </Button>
      </div>
      {open && (
        <div className="space-y-2 rounded-md bg-surface-2 p-3">
          <p className="text-sm">Confirm {canDo} entr{canDo === 1 ? "y" : "ies"}? Each becomes the investor&apos;s allocation in this Cycle.</p>
          {needsReason && (
            <Input label="Reason for confirming your own entries (recorded on each)" value={reason} onChange={(e) => setReason(e.target.value)} />
          )}
          <div className="flex gap-2">
            <Button size="sm" loading={busy} disabled={needsReason && !reason.trim()}
              onClick={async () => {
                setBusy(true);
                const r = await post(`/api/admin/maalrise/cycles/${cycleId}/fundings/confirm-all`, JSON.stringify({ self_reason: reason }));
                setBusy(false);
                if (!r.ok) { toast.error(errorOf(r.data)); return; }
                const res = (r.data.results as ConfirmResult[]) ?? [];
                setResults(res); setOpen(false); setReason("");
                const n = Number(r.data.confirmed ?? 0), bad = Number(r.data.not_confirmed ?? 0);
                if (bad) toast.warning(`${n} confirmed, ${bad} not confirmed — see the list.`);
                else toast.success(`${n} confirmed and allocated.`);
                router.refresh();
              }}>
              Yes, confirm {canDo}
            </Button>
            <Button size="sm" variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
      {results && results.some((r) => !r.ok) && (
        <ul className="text-xs text-red-700 space-y-0.5" aria-label="Not confirmed">
          {results.filter((r) => !r.ok).map((r) => <li key={r.reference}>{r.reference}: {r.message}</li>)}
        </ul>
      )}
    </div>
  );
}

type Prepared = { to_send: string[]; invitations: number; notifications: number; already_sent: number; discarded: number; pending_funding: number };

/**
 * "Email all investors in this Cycle": an invitation (with a link to set
 * a password) for people who have never signed in, a notification for
 * everyone else. Prepared first, counts shown, then one press sends.
 */
export function CycleEmailPanel({ cycleId, investors }: { cycleId: string; investors: number }) {
  const router = useRouter();
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failed, setFailed] = useState<string[]>([]);

  async function prepare() {
    setBusy(true); setFailed([]);
    const r = await post(`/api/admin/maalrise/cycles/${cycleId}/emails`, "{}");
    setBusy(false);
    if (!r.ok) { toast.error(errorOf(r.data)); return; }
    setPrepared(r.data as unknown as Prepared);
    router.refresh();
  }

  async function sendAll(p: Prepared) {
    if (!window.confirm(`Send ${p.to_send.length} real email(s) now?\n\n${p.invitations} invitation(s) to set a password\n${p.notifications} notification(s) to people who already sign in`)) return;
    const bad: string[] = [];
    let sent = 0;
    for (const [i, id] of p.to_send.entries()) {
      setProgress(`Sending ${i + 1} of ${p.to_send.length}…`);
      const r = await post(`/api/admin/maalrise/emails/${id}`, JSON.stringify({ action: "send" }));
      if (r.ok) sent++; else bad.push(errorOf(r.data));
    }
    setProgress(null);
    setFailed(bad);
    setPrepared(null);
    if (bad.length) toast.warning(`${sent} sent, ${bad.length} not sent. They stay in MaalRise Emails — press “Email all investors” again to retry them.`);
    else toast.success(`${sent} email(s) sent.`);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border p-4 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium flex items-center gap-1.5"><Mail className="h-4 w-4" /> Email all investors in this Cycle</p>
          <p className="text-xs text-muted">
            People who have never signed in get an invitation to set their password (then the KYC form); people who already sign in get a
            notification that they were added. Each investor gets this email once per Cycle.
          </p>
        </div>
        <Button size="sm" variant="outline" loading={busy} disabled={investors === 0 || !!progress} onClick={prepare}>
          <Mail className="h-3.5 w-3.5" /> Email all investors
        </Button>
      </div>
      {prepared && (
        <div className="rounded-md bg-surface-2 p-3 space-y-2 text-sm">
          {prepared.to_send.length === 0 ? (
            <p>Nothing new to send: {prepared.already_sent} already sent{prepared.discarded ? `, ${prepared.discarded} discarded` : ""}.</p>
          ) : (
            <>
              <p>
                Ready to send <strong>{prepared.to_send.length}</strong>: <strong>{prepared.invitations}</strong> invitation{prepared.invitations === 1 ? "" : "s"}{" "}
                (new people) and <strong>{prepared.notifications}</strong> notification{prepared.notifications === 1 ? "" : "s"} (existing logins).
                {prepared.already_sent > 0 && ` ${prepared.already_sent} already sent earlier will not be sent again.`}
              </p>
              <div className="flex gap-2">
                <Button size="sm" disabled={!!progress} onClick={() => sendAll(prepared)}>
                  <Send className="h-3.5 w-3.5" /> {progress ?? `Send ${prepared.to_send.length} email${prepared.to_send.length === 1 ? "" : "s"}`}
                </Button>
                <Button size="sm" variant="outline" disabled={!!progress} onClick={() => setPrepared(null)}>Not now</Button>
              </div>
            </>
          )}
          {prepared.pending_funding > 0 && (
            <p className="text-xs text-amber-800">
              {prepared.pending_funding} funding entr{prepared.pending_funding === 1 ? "y is" : "ies are"} still awaiting confirmation; those investors are not included until confirmed.
            </p>
          )}
        </div>
      )}
      {failed.length > 0 && (
        <ul className="text-xs text-red-700 space-y-0.5" aria-label="Not sent">
          {failed.map((f, i) => <li key={i}>{f}</li>)}
        </ul>
      )}
    </div>
  );
}
