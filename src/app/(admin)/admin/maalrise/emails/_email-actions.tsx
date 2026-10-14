"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMaalriseAction } from "@/components/maalrise/use-maalrise-action";

export function EmailActions({ id, to, retry }: { id: string; to: string; retry: boolean }) {
  const { run, busy } = useMaalriseAction();
  const url = `/api/admin/maalrise/emails/${id}`;
  return (
    <div className="flex gap-2">
      <Button size="xs" loading={busy === "send"}
        onClick={() => {
          if (!window.confirm(`Send this email to ${to} now? This sends a real email.`)) return;
          void run("send", url, { action: "send" }, { success: "Email sent." });
        }}>
        <Send className="h-3 w-3" /> {retry ? "Try again" : "Send"}
      </Button>
      <Button size="xs" variant="outline" loading={busy === "discard"}
        onClick={() => {
          if (!window.confirm("Discard this email? It will not be sent.")) return;
          void run("discard", url, { action: "discard" }, { success: "Email discarded." });
        }}>
        <Trash2 className="h-3 w-3" /> Discard
      </Button>
    </div>
  );
}

/** Send every email shown, one at a time, stopping at the first failure. */
export function SendAll({ ids, count }: { ids: string[]; count: number }) {
  const router = useRouter();
  const [progress, setProgress] = useState<string | null>(null);
  return (
    <Button size="sm" disabled={!!progress || count === 0}
      onClick={async () => {
        if (!window.confirm(`Send all ${count} email(s) shown? These are real emails.`)) return;
        let sent = 0;
        for (const id of ids) {
          setProgress(`Sending ${sent + 1} of ${count}…`);
          const res = await fetch(`/api/admin/maalrise/emails/${id}`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "send" }),
          }).catch(() => null);
          if (!res?.ok) {
            const d = res ? await res.json().catch(() => ({})) : {};
            toast.error(`Stopped after ${sent} sent: ${(d as { error?: string }).error ?? "network error"}`);
            break;
          }
          sent++;
        }
        if (sent === count) toast.success(`${sent} email(s) sent.`);
        setProgress(null);
        router.refresh();
      }}>
      <Send className="h-3.5 w-3.5" /> {progress ?? `Send all ${count}`}
    </Button>
  );
}
