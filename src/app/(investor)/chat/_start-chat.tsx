"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";

const CATEGORIES = [
  "Portal Access",
  "Payment Update",
  "Investment Record",
  "Series or Cycle Question",
  "Profit or ROI",
  "Maturity Instruction",
  "Withdrawal",
  "Capital Continuation",
  "KYC Update",
  "Bank Details",
  "General Enquiry",
];

export function StartChat({
  related,
}: {
  related: { series_id: string; cycle_id: string; label: string }[];
}) {
  const router = useRouter();
  const [category, setCategory] = useState("General Enquiry");
  const [relatedKey, setRelatedKey] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const handleStart = async () => {
    if (!message.trim()) {
      toast.error("Please type your message");
      return;
    }
    setBusy(true);
    try {
      const rel = related.find((r) => r.cycle_id === relatedKey);
      const res = await fetch("/api/investor/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "start",
          category,
          message: message.trim(),
          related_series_id: rel?.series_id ?? null,
          related_cycle_id: rel?.cycle_id ?? null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not start the conversation");
      toast.success("Message sent — your Investor Manager will respond here");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  };

  const selectCls =
    "h-10 w-full rounded-lg border border-border bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

  return (
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      <p className="text-sm text-muted">
        Send us a message about your investment, payment, portal account, KYC,
        profit or maturity instruction. Your Investor Manager will respond here.
      </p>

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">
          What is your message about?
        </label>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          className={selectCls}
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      {related.length > 0 && (
        <div className="space-y-1.5">
          <label className="block text-sm font-medium text-foreground">
            Related investment (optional)
          </label>
          <select
            value={relatedKey}
            onChange={(e) => setRelatedKey(e.target.value)}
            className={selectCls}
          >
            <option value="">— Not related to a specific investment —</option>
            {related.map((r) => (
              <option key={r.cycle_id} value={r.cycle_id}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="space-y-1.5">
        <label className="block text-sm font-medium text-foreground">
          Your message
        </label>
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={5}
          placeholder="Type your message here…"
          className="w-full rounded-lg border border-border bg-white px-3 py-2.5 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20 resize-none"
        />
      </div>

      <Button onClick={handleStart} disabled={busy} className="w-full" size="lg">
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Send Message
      </Button>
    </div>
  );
}
