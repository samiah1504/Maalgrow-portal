"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  PlayCircle,
  RotateCcw,
  Mail,
  Download,
  PlusCircle,
  CheckCircle2,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatDate } from "@/lib/utils";

type NextCycle = {
  id: string;
  cycle_label: string;
  start_date: string;
  end_date: string;
  status: string;
} | null;

export function RolloverActions({
  cycleId,
  seriesName,
  profitDeclared,
  pendingProcessing,
  failedCount,
  rolloverProcessedAt,
  isSuperAdmin,
  nextCycle,
}: {
  cycleId: string;
  seriesName: string;
  profitDeclared: boolean;
  pendingProcessing: number;
  failedCount: number;
  rolloverProcessedAt: string | null;
  isSuperAdmin: boolean;
  nextCycle: NextCycle;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  const call = async (label: string, path: string, body?: object) => {
    setBusy(label);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      const json = await res.json();
      if (!res.ok) {
        toast.error(json.error ?? "Request failed");
        return null;
      }
      return json;
    } finally {
      setBusy(null);
    }
  };

  const handleCreateNextCycle = async () => {
    const json = await call("next", `/api/admin/cycles/${cycleId}/rollover/next-cycle`);
    if (json) {
      toast.success(
        json.created
          ? `Next cycle created: ${json.cycle.cycle_label}. Review it, then process the rollover.`
          : `Next cycle already exists: ${json.cycle.cycle_label}`
      );
      router.refresh();
    }
  };

  const handleProcess = async () => {
    if (
      !window.confirm(
        `Process the rollover for Series ${seriesName}?\n\nEvery matured investor without an opt-out will be automatically continued into the next cycle. This action is idempotent — running it again will not create duplicates.`
      )
    )
      return;
    const json = await call("process", `/api/admin/cycles/${cycleId}/rollover`);
    if (json) {
      const r = json.result;
      toast.success(
        `Rollover processed: ${r.rolled} rolled, ${r.withdrawn} withdrawn, ${r.failed} failed. Emails: ${json.emails.sent} sent${json.emails.failed ? `, ${json.emails.failed} failed` : ""}.`
      );
      router.refresh();
    }
  };

  const handleRetryEmails = async () => {
    const json = await call("emails", `/api/admin/cycles/${cycleId}/rollover/emails`);
    if (json) {
      toast.success(`Emails: ${json.emails.sent} sent, ${json.emails.failed} failed`);
      router.refresh();
    }
  };

  const done = rolloverProcessedAt != null && pendingProcessing === 0;

  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        {/* Next cycle status */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold text-muted uppercase tracking-wide">
              Destination cycle
            </p>
            {nextCycle ? (
              <p className="text-sm font-semibold text-foreground mt-0.5">
                {nextCycle.cycle_label}{" "}
                <span className="text-muted font-normal">
                  ({formatDate(nextCycle.start_date)} — {formatDate(nextCycle.end_date)} ·{" "}
                  {nextCycle.status})
                </span>
              </p>
            ) : (
              <p className="text-sm text-amber-700 mt-0.5">
                The next cycle does not exist yet. It will be generated as the next
                3-calendar-month cycle and shown here for confirmation before any
                investor is rolled over.
              </p>
            )}
          </div>
          {!nextCycle && isSuperAdmin && (
            <Button
              onClick={handleCreateNextCycle}
              loading={busy === "next"}
              variant="outline"
              size="sm"
            >
              <PlusCircle className="h-4 w-4" />
              Generate Next Cycle
            </Button>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 pt-1 border-t border-border">
          {done ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600 font-medium py-2">
              <CheckCircle2 className="h-4 w-4" />
              Rollover fully processed on {formatDate(rolloverProcessedAt!)}
            </div>
          ) : (
            isSuperAdmin && (
              <Button
                onClick={handleProcess}
                loading={busy === "process"}
                disabled={!profitDeclared || !nextCycle}
                title={
                  !profitDeclared
                    ? "Declare the cycle profit first"
                    : !nextCycle
                    ? "Create the next cycle first"
                    : undefined
                }
              >
                <PlayCircle className="h-4 w-4" />
                {failedCount > 0 ? "Retry Rollover" : "Process Rollover"}
                {pendingProcessing > 0 ? ` (${pendingProcessing} pending)` : ""}
              </Button>
            )
          )}
          {failedCount > 0 && isSuperAdmin && !done && (
            <Button variant="outline" onClick={handleProcess} loading={busy === "process"}>
              <RotateCcw className="h-4 w-4" />
              Retry {failedCount} Failed
            </Button>
          )}
          <Button
            variant="outline"
            onClick={handleRetryEmails}
            loading={busy === "emails"}
          >
            <Mail className="h-4 w-4" />
            Resend Pending Emails
          </Button>
          <a href={`/api/admin/cycles/${cycleId}/rollover`} download>
            <Button variant="ghost">
              <Download className="h-4 w-4" />
              Export Rollover Report (CSV)
            </Button>
          </a>
        </div>
      </CardContent>
    </Card>
  );
}
