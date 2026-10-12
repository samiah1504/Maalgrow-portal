"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { koboInWords } from "@/lib/maalrise/format";

/**
 * Post to a MaalRise API route and refresh the page.
 *
 * Refusals come back with the database's own words ("Terms cannot be
 * approved by the person who prepared or submitted them") and are
 * shown as they are — they are written for staff to read.
 */
export function useMaalriseAction() {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(
    key: string,
    url: string,
    body: unknown,
    opts: { method?: string; success?: string; onDone?: (data: Record<string, unknown>) => void } = {}
  ): Promise<boolean> {
    setBusy(key);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? koboInWords(data.error) : "That did not work. Please try again.");
        return false;
      }
      if (typeof data.warning === "string") toast.warning(data.warning);
      else if (opts.success) toast.success(opts.success);
      opts.onDone?.(data);
      router.refresh();
      return true;
    } catch {
      toast.error("Network error. Nothing was changed; please try again.");
      return false;
    } finally {
      setBusy(null);
    }
  }

  return { run, busy };
}
