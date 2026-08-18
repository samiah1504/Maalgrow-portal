"use client";

/**
 * The filter bar on the investor directory.
 *
 * WHY THIS IS A COMPONENT AND NOT A PLAIN <form>. It was a plain form,
 * with a Search button, and choosing a series did nothing until you
 * pressed it. Nobody presses a button labelled "Search" after picking
 * "Series A" from a dropdown — they wait for the list to change, it
 * does not, and the reasonable conclusion is that the filter is
 * broken. It was, in the only sense that matters.
 *
 * So the dropdowns navigate the moment they change. The text box does
 * NOT: refetching on every keystroke is a different kind of annoying,
 * so it still submits on Enter or on the button beside it.
 *
 * The URL stays the source of truth — every control writes a query
 * parameter and the server component reads them back. That keeps the
 * filtered list linkable, back-buttonable, and identical on a reload.
 */

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import { Search, Loader2 } from "lucide-react";

const SELECT_CLASS =
  "h-10 rounded-lg border border-border bg-white px-3 text-sm text-foreground focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20";

export function DirectoryFilters({
  q,
  series,
  sort,
  kyc,
}: {
  q: string;
  series: string;
  sort: string;
  kyc: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [text, setText] = useState(q);

  const go = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(patch)) {
      // An empty value means "no filter", and a URL carrying
      // ?series= reads as though one is set when none is.
      if (value) next.set(key, value);
      else next.delete(key);
    }
    startTransition(() => {
      router.push(next.toString() ? `${pathname}?${next}` : pathname);
    });
  };

  return (
    <form
      className="flex flex-col gap-3 sm:flex-row"
      onSubmit={(e) => {
        e.preventDefault();
        go({ q: text.trim() });
      }}
    >
      <div className="relative flex-1">
        {pending ? (
          <Loader2 className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted" />
        ) : (
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
        )}
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Search by name, email, or investor code…"
          className="h-10 w-full rounded-lg border border-border bg-white pl-9 pr-3 text-sm text-foreground placeholder:text-muted/60 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20"
        />
      </div>

      {/* These three apply on change. That is the whole point. */}
      <select
        value={series}
        onChange={(e) => go({ series: e.target.value })}
        className={SELECT_CLASS}
        aria-label="Filter by series"
      >
        <option value="">All Series</option>
        <option value="A">Series A</option>
        <option value="B">Series B</option>
        <option value="C">Series C</option>
      </select>

      <select
        value={sort}
        onChange={(e) => go({ sort: e.target.value })}
        className={SELECT_CLASS}
        aria-label="Sort by name"
      >
        <option value="az">Name A → Z</option>
        <option value="za">Name Z → A</option>
      </select>

      <select
        value={kyc}
        onChange={(e) => go({ kyc: e.target.value })}
        className={SELECT_CLASS}
        aria-label="Filter by KYC status"
      >
        <option value="">All KYC Status</option>
        <option value="pending">Pending</option>
        <option value="approved">Approved</option>
        <option value="rejected">Rejected</option>
      </select>

      <button
        type="submit"
        className="h-10 rounded-lg bg-primary-700 px-4 text-sm font-medium text-white transition-colors hover:bg-primary-600"
      >
        Search
      </button>
    </form>
  );
}
