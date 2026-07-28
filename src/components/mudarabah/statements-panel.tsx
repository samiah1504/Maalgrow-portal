"use client";

/**
 * Statements: whether each one was built, and whether it was sent.
 *
 * WHY THIS PANEL EXISTS AT ALL. Settling already built a PDF for every
 * holder and stored it — and the settle route has always returned
 * `documents` and `documentError` describing how that went. NOTHING
 * READ THEM. If a statement failed to render for one investor during a
 * settlement, no screen in the portal said so; the only symptom was
 * that one person's download never worked.
 *
 * SENDING IS A SEPARATE PRESS. Emailing is not a side effect of
 * settling: thirty-eight emails firing the instant Settle is pressed
 * would remove any chance to check the figures first, and settlement
 * carries a standing rule that it must not gain new ways to fail.
 * Settle, look, then send.
 *
 * WHAT THE STATES MEAN, AND WHY THEY ARE NOT ALL "FAILED":
 *
 *   not built      the PDF does not exist — a generation problem.
 *                  Sending cannot fix it; Build documents can.
 *   no address     nothing to retry. Somebody has to add an email to
 *                  the investor's record first.
 *   failed         worth retrying — a refusal or a timeout.
 *   sending        claimed but never confirmed. Deliberately NOT
 *                  retried automatically: the send may have got
 *                  through, and a second copy of a financial
 *                  statement is worse than a stuck row.
 */

import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  Mail,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Send,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { formatDate } from "@/lib/utils";
import { toast } from "sonner";

type StatementRow = {
  statement_id: string;
  investor_name: string;
  investor_code: string;
  investor_email: string | null;
  state: string;
  attempts: number;
  last_error: string | null;
  generated_at: string | null;
  email_state: string;
  email_to: string | null;
  email_error: string | null;
  email_attempts: number;
  emailed_at: string | null;
};

const EMAIL_LABEL: Record<string, string> = {
  unsent: "Not sent",
  sending: "Sending…",
  sent: "Sent",
  failed: "Failed",
  skipped: "No address",
};

const EMAIL_VARIANT: Record<string, "completed" | "warning" | "pending" | "active"> = {
  unsent: "pending",
  sending: "active",
  sent: "completed",
  failed: "warning",
  skipped: "warning",
};

export function Statements({ cycleId }: { cycleId: string }) {
  const [rows, setRows] = useState<StatementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<"email" | "email-retry" | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/admin/mudarabah/${cycleId}/statements`);
    const json = await res.json();
    setRows((json.statements as StatementRow[]) ?? []);
    setLoading(false);
  }, [cycleId]);

  useEffect(() => {
    load();
  }, [load]);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch(`/api/admin/mudarabah/${cycleId}/statements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    // A killed serverless function does not return JSON. Parsing
    // blindly threw an unhandled error and showed nothing at all,
    // which is worse than any message.
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      json = { error: text.slice(0, 300) || `Request failed (${res.status})` };
    }
    return { ok: res.ok, json };
  };

  /**
   * Build the documents, a batch at a time.
   *
   * WHY A LOOP. Each document is a full Chrome page render. Asking for
   * all thirty-eight in one request runs for minutes and the platform
   * kills it partway — which is precisely the failure that reported
   * "success" and built nothing.
   *
   * WHY IT WATCHES `outstanding`. Counting what the server says it
   * built is not enough. When the database refused to record the
   * results, every round honestly reported eight documents built and
   * every round left the same eight waiting — so the loop ground
   * through the whole list eight times over, rendering the same files
   * repeatedly and saving none of them. The only number that proves
   * progress is how much is LEFT. If that does not fall, stop.
   */
  const build = async () => {
    setBusy("generate");
    setProgress(null);
    let built = 0;
    let failed = 0;
    let total: number | null = null;
    let firstError: string | null = null;
    let stalled = false;
    let lastOutstanding = Number.POSITIVE_INFINITY;

    try {
      for (let round = 0; round < 40; round++) {
        // Six, not one and not thirty-eight. The browser is now started
        // once per request rather than once per document, so a batch of
        // six costs one start and six page renders — comfortably inside
        // the shortest function timeout any plan gives us, with room
        // for a cold start on the first round.
        const { ok, json } = await post({ action: "generate", limit: 6 });
        if (!ok) {
          toast.error(String(json.error ?? "Could not build the documents"));
          return;
        }

        const attempted = Number(json.total ?? 0);
        const madeNow = Number(json.generated ?? 0);
        // How much was still waiting when THIS round started.
        const outstanding = Number(json.outstanding ?? attempted);
        // Fixed on the first batch, so the count on screen does not
        // move under the reader.
        if (total === null) total = outstanding;

        built += madeNow;
        failed += Number(json.failed ?? 0);
        const errs = (json.errors ?? []) as { message?: string }[];
        if (!firstError && errs.length) firstError = errs[0]?.message ?? null;

        setProgress(`${built + failed} of ${total}…`);

        // Nothing was waiting; or this batch achieved nothing, in
        // which case the next forty will not either.
        if (attempted === 0 || madeNow === 0) break;

        // It says it built some, and the queue is no shorter than it
        // was last round. Whatever it claimed did not stick, and going
        // round again would only render the same files a third time.
        if (round > 0 && outstanding >= lastOutstanding) {
          stalled = true;
          break;
        }
        lastOutstanding = outstanding;

        if (built + failed >= total) break;
      }

      // THE TRUTH, not a fixed message. This used to report
      // "Documents built" whatever came back, so a run that built
      // nothing at all still said success — the exact fault that sent
      // someone looking for documents that were never there.
      if (stalled) {
        toast.error(
          `Stopped: the documents are being built but not saved${
            firstError ? ` — ${firstError}` : ""
          }`
        );
      } else if (built === 0 && failed === 0) {
        toast.warning(
          "Nothing was built. No document was waiting, or the request was cut short."
        );
      } else if (failed > 0) {
        toast.warning(
          `${built} built · ${failed} failed${firstError ? ` — ${firstError}` : ""}`
        );
      } else {
        toast.success(`${built} document${built === 1 ? "" : "s"} built`);
      }
    } finally {
      setBusy(null);
      setProgress(null);
      await load();
    }
  };

  const run = async (action: string, label: string) => {
    setBusy(action);
    setConfirm(null);
    try {
      const { ok, json } = await post({ action });
      if (!ok) {
        toast.error(String(json.error ?? "That did not work"));
        return;
      }
      if (action.startsWith("email")) {
        // Report all three outcomes, not just the happy one — a run
        // that sent 30 and skipped 8 is not a success.
        const bits = [`${json.sent} sent`];
        if (json.failed) bits.push(`${json.failed} failed`);
        if (json.skipped) bits.push(`${json.skipped} skipped`);
        (json.failed || json.skipped ? toast.warning : toast.success)(bits.join(" · "));
      } else {
        toast.success(label);
      }
      await load();
    } finally {
      setBusy(null);
    }
  };

  const notBuilt = rows.filter((r) => r.state !== "ready");
  const unsent = rows.filter((r) => r.state === "ready" && r.email_state === "unsent");
  const failed = rows.filter((r) => r.email_state === "failed");
  const noAddress = rows.filter((r) => r.email_state === "skipped");
  const sent = rows.filter((r) => r.email_state === "sent");
  const stuck = rows.filter((r) => r.email_state === "sending");

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted">
          <Loader2 className="mr-2 inline h-4 w-4 animate-spin" />
          Checking statements…
        </CardContent>
      </Card>
    );
  }

  // A settled cycle with no statement rows at all. Silence here would
  // read as "nothing to do" when the truth is "nothing was queued".
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="p-6 text-center text-sm text-muted">
          <FileText className="mx-auto mb-2 h-8 w-8 text-border" />
          No statements have been queued for this cycle yet. They are created
          when the cycle is settled.
        </CardContent>
      </Card>
    );
  }

  // MIGRATION NOT APPLIED. Without 039 there is no email_state column,
  // so every row reads as un-sendable and the Email button silently
  // never appears — a missing button with no explanation, which is the
  // worst way for this to fail. Say so instead.
  if (rows[0].email_state === undefined) {
    return (
      <Card className="border-amber-300 bg-amber-50/60">
        <CardContent className="flex items-start gap-3 p-4">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
          <div className="text-sm">
            <p className="font-medium text-amber-900">
              Emailing statements is not available yet.
            </p>
            <p className="mt-1 text-amber-800/90">
              Migration <strong>039_statement_email.sql</strong> has not been
              applied to this database. The {rows.length} statement
              {rows.length === 1 ? "" : "s"} for this cycle already exist and
              investors can download them in the portal — only sending them by
              email is waiting on that migration.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <FileText className="h-4 w-4 text-primary-600" />
            Statements ({rows.length})
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            {notBuilt.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                loading={busy === "generate"}
                onClick={build}
              >
                <RefreshCw className="h-4 w-4" />
                {progress
                  ? `Building… ${progress}`
                  : `Build ${notBuilt.length} document${notBuilt.length === 1 ? "" : "s"}`}
              </Button>
            )}
            {failed.length > 0 && (
              <Button
                size="sm"
                variant="outline"
                loading={busy === "email-retry"}
                onClick={() => setConfirm("email-retry")}
              >
                <RefreshCw className="h-4 w-4" />
                Retry {failed.length} failed
              </Button>
            )}
            {unsent.length > 0 && (
              <Button
                size="sm"
                loading={busy === "email"}
                onClick={() => setConfirm("email")}
              >
                <Send className="h-4 w-4" />
                Email {unsent.length} statement{unsent.length === 1 ? "" : "s"}
              </Button>
            )}
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <span className="inline-flex items-center gap-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            {sent.length} sent
          </span>
          {unsent.length > 0 && <span>{unsent.length} not sent</span>}
          {failed.length > 0 && (
            <span className="text-amber-700">{failed.length} failed</span>
          )}
          {noAddress.length > 0 && (
            <span className="text-amber-700">{noAddress.length} with no email address</span>
          )}
          {notBuilt.length > 0 && (
            <span className="text-danger">{notBuilt.length} document(s) not built</span>
          )}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {/* A row left mid-send needs a person, not a retry loop. */}
        {stuck.length > 0 && (
          <div className="mx-4 mb-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
            <div className="flex-1 text-amber-900">
              <p className="font-medium">
                {stuck.length} send{stuck.length === 1 ? "" : "s"} started but never
                confirmed.
              </p>
              <p className="mt-0.5 text-amber-800/90">
                They may have gone through. Check with the investor before releasing
                them for retry — a second copy of a statement is worse than a stuck
                row.
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              loading={busy === "release"}
              onClick={() => run("release", "Released for retry")}
            >
              Release
            </Button>
          </div>
        )}

        <div className="divide-y divide-border border-t border-border">
          {rows.map((r) => (
            <div key={r.statement_id} className="flex items-start gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {r.investor_name}{" "}
                  <span className="font-mono text-[11px] text-muted">
                    {r.investor_code}
                  </span>
                </p>
                <p className="text-xs text-muted">
                  {r.email_to ?? r.investor_email ?? "No email address"}
                  {r.emailed_at ? ` · sent ${formatDate(r.emailed_at)}` : ""}
                </p>
                {r.state !== "ready" && (
                  <p className="mt-0.5 text-xs text-danger">
                    {/* "Queued" and "failed" are different problems.
                        Queued means the build never reached this row —
                        the run was cut short. Failed means it tried
                        and could not, and last_error says why. Calling
                        both "not built" hid which one you had. */}
                    {r.state === "failed"
                      ? `Build failed${r.last_error ? `: ${r.last_error}` : " — no reason recorded"}`
                      : "Queued — the build has not reached this one yet"}
                    {r.attempts > 0
                      ? ` · ${r.attempts} attempt${r.attempts === 1 ? "" : "s"}`
                      : ""}
                  </p>
                )}
                {r.email_error && (
                  <p className="mt-0.5 text-xs text-amber-700">{r.email_error}</p>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {r.state !== "ready" ? (
                  <Badge variant={r.state === "failed" ? "danger" : "pending"}>
                    {r.state === "failed" ? "Failed" : "Queued"}
                  </Badge>
                ) : (
                  <Badge variant={EMAIL_VARIANT[r.email_state] ?? "pending"}>
                    {EMAIL_LABEL[r.email_state] ?? r.email_state}
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm === "email-retry"
                ? `Retry ${failed.length} failed email(s)?`
                : `Email ${unsent.length} statement(s)?`}
            </DialogTitle>
            <DialogDescription>
              Each investor receives their own statement as a PDF, with their profit
              for the cycle and — where they have not answered yet — a request to
              choose what happens to their capital.
            </DialogDescription>
          </DialogHeader>
          <div className="px-6 pb-2">
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              <p className="font-medium">This cannot be un-sent.</p>
              <p className="mt-1 text-amber-800/90">
                The email tells investors their instruction is final once submitted.
                Check the figures on this page before sending.
              </p>
            </div>
            {noAddress.length > 0 && (
              <p className="mt-2 text-xs text-muted">
                {noAddress.length} investor(s) have no email address and will be
                skipped, not failed. Add an address to their record and retry.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button onClick={() => confirm && run(confirm, "Sent")}>
              <Mail className="h-4 w-4" />
              Send now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
