"use client";

/**
 * A dropdown you can type into.
 *
 * WHY NOT THE RADIX SELECT. There are 774 local government areas.
 * Scrolling a list that long on a phone, with a thumb, to find
 * "Ibeju-Lekki" is not a thing anybody will do twice — they will
 * pick whatever is near the top and get on with their day, and the
 * address will be wrong. Typing three letters is the difference
 * between a field people fill in correctly and a field people defeat.
 *
 * WHY NOT A COMBOBOX LIBRARY. This needs a filtered list, keyboard
 * movement and a value that cannot be anything but one of the
 * options. That is a hundred lines. Adding a dependency for it would
 * cost more to keep than to own.
 *
 * NO FREE TEXT, EVER. What is typed is a FILTER, not a value. Closing
 * the list without choosing restores whatever was selected before, so
 * there is no path — mis-typing, blurring, pressing Enter on nothing —
 * that leaves a state or an LGA the code does not recognise.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Check, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type SelectOption = { value: string; label: string };

export function SearchableSelect({
  options,
  value,
  onChange,
  label,
  placeholder = "Select…",
  searchPlaceholder = "Type to search…",
  emptyMessage = "Nothing matches that",
  error,
  hint,
  required,
  disabled,
  disabledReason,
  name,
}: {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string) => void;
  label?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
  /** Shown in place of the value when disabled — "Choose a state first" */
  disabledReason?: string;
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    // Anything that CONTAINS the text, with what starts with it first
    // — somebody typing "ikeja" should not have to scroll past
    // "Ajeromi-Ifelodun" to reach it.
    const starts: SelectOption[] = [];
    const contains: SelectOption[] = [];
    for (const o of options) {
      const l = o.label.toLowerCase();
      if (l.startsWith(q)) starts.push(o);
      else if (l.includes(q)) contains.push(o);
    }
    return [...starts, ...contains];
  }, [options, query]);

  // Close on a click elsewhere, and on Escape. Both restore the
  // previous value, because neither is a choice.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) search.current?.focus();
  }, [open]);

  const choose = (option: SelectOption) => {
    onChange(option.value);
    setOpen(false);
    setQuery("");
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Only ever commits an option that exists.
      const option = filtered[active];
      if (option) choose(option);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
    }
  };

  return (
    <div className="w-full space-y-1.5" ref={root}>
      {label && (
        <label className="block text-sm font-medium text-foreground">
          {label}
          {required && <span className="ml-0.5 text-danger">*</span>}
        </label>
      )}

      {/* The value itself is kept in a hidden input so a plain form
          post and the browser's autofill both see something real. */}
      {name && <input type="hidden" name={name} value={value ?? ""} readOnly />}

      <div className="relative">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "flex h-10 w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm transition-colors",
            "border-border focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20",
            "disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-60",
            error && "border-danger focus:border-danger focus:ring-danger/20"
          )}
        >
          <span
            className={cn(
              "truncate text-left",
              selected ? "text-foreground" : "text-muted/60"
            )}
          >
            {disabled && disabledReason
              ? disabledReason
              : selected?.label ?? placeholder}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted opacity-70" />
        </button>

        {open && !disabled && (
          <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-border px-3">
              <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
              <input
                ref={search}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  // Back to the top with the filter, so Enter always
                  // takes the best match for what has just been typed
                  // rather than whatever was highlighted before.
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                className="h-9 w-full bg-transparent text-sm text-foreground outline-none placeholder:text-muted/60"
              />
            </div>
            <ul className="max-h-60 overflow-y-auto py-1" role="listbox">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted">{emptyMessage}</li>
              )}
              {filtered.map((o, i) => (
                <li key={o.value}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={o.value === value}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(o)}
                    className={cn(
                      "flex w-full items-center justify-between px-3 py-2 text-left text-sm",
                      i === active ? "bg-primary-50 text-primary-800" : "text-foreground"
                    )}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.value === value && (
                      <Check className="h-3.5 w-3.5 shrink-0 text-primary-600" />
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-danger">{error}</p>}
      {hint && !error && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
