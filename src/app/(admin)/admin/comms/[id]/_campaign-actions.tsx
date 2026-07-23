"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PlayCircle, RotateCcw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CampaignActions({
  campaignId,
  status,
  pendingCount,
  failedCount,
}: {
  campaignId: string;
  status: string;
  pendingCount: number;
  failedCount: number;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const runSend = async (retryFailed: boolean) => {
    setBusy(retryFailed ? "retry" : "send");
    try {
      // Drafts must be queued before sending
      if (status === "draft") {
        const q = await fetch(`/api/admin/comms/campaigns/${campaignId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "queue" }),
        });
        if (!q.ok) {
          toast.error((await q.json()).error ?? "Failed to queue draft");
          return;
        }
      }

      let done = false;
      let processed = 0;
      let guard = 0;
      while (!done && guard < 500) {
        guard++;
        const res = await fetch(`/api/admin/comms/campaigns/${campaignId}/send`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ limit: 15, retry_failed: retryFailed }),
        });
        const json = await res.json();
        if (!res.ok) {
          toast.error(json.error ?? "Sending failed");
          break;
        }
        processed += json.processed;
        setProgress(`${processed} processed, ${json.remaining} remaining…`);
        done = json.done || json.processed === 0;
        if (done) {
          toast.success(`Finished — status: ${json.campaignStatus.replaceAll("_", " ")}`);
        }
      }
      router.refresh();
    } finally {
      setBusy(null);
      setProgress(null);
    }
  };

  const cancel = async () => {
    if (!window.confirm("Cancel this campaign? Unsent recipients will not receive the message.")) return;
    setBusy("cancel");
    try {
      const res = await fetch(`/api/admin/comms/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) toast.error((await res.json()).error ?? "Failed to cancel");
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  const canSend = ["draft", "queued", "processing"].includes(status) && pendingCount > 0;
  const canRetry = failedCount > 0 && !["cancelled"].includes(status);
  const canCancel = !["sent", "cancelled"].includes(status);

  return (
    <div className="flex flex-col items-start lg:items-end gap-2">
      <div className="flex flex-wrap gap-2">
        {canSend && (
          <Button onClick={() => runSend(false)} loading={busy === "send"}>
            <PlayCircle className="h-4 w-4" />
            {status === "processing" ? "Resume Sending" : "Send"} ({pendingCount} pending)
          </Button>
        )}
        {canRetry && (
          <Button variant="outline" onClick={() => runSend(true)} loading={busy === "retry"}>
            <RotateCcw className="h-4 w-4" />
            Retry {failedCount} Failed
          </Button>
        )}
        {canCancel && (
          <Button variant="ghost" onClick={cancel} loading={busy === "cancel"}>
            <XCircle className="h-4 w-4" />
            Cancel
          </Button>
        )}
      </div>
      {progress && <p className="text-xs text-muted">{progress}</p>}
    </div>
  );
}
