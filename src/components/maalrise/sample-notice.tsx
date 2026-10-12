import Link from "next/link";
import { FlaskConical, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The banner on every MaalRise screen that is showing sample data.
 *
 * Loud on purpose. A figure on an admin screen reads as a fact unless
 * something next to it says otherwise, and these are not facts.
 */
export function SampleDataBanner({ className }: { className?: string }) {
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4",
        className
      )}
    >
      <FlaskConical className="h-5 w-5 shrink-0 text-amber-600 mt-0.5" />
      <div>
        <p className="text-sm font-semibold text-amber-900">
          Sample data — illustrative only, not financial records
        </p>
        <p className="text-xs text-amber-800 mt-0.5">
          MaalRise is in its first build phase and has no database yet. Every
          name, amount and status on this screen is fictitious and exists only
          to show the layout. Nothing here is saved, paid or sent.
        </p>
      </div>
    </div>
  );
}

/** The small tag on any individual row or tile that is sample data. */
export function SampleTag() {
  return (
    <span className="inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
      Sample
    </span>
  );
}

/** Phase notice for actions that exist on screen but are not wired yet. */
export function PhaseNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-800">
      <Info className="h-4 w-4 shrink-0 mt-0.5" />
      <div>{children}</div>
    </div>
  );
}

/** Switch between the honest empty state and the labelled sample preview. */
export function SampleToggle({ href, showing }: { href: string; showing: boolean }) {
  return (
    <Link
      href={showing ? href : `${href}?sample=1`}
      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100 transition-colors"
    >
      <FlaskConical className="h-3.5 w-3.5" />
      {showing ? "Hide sample preview" : "Preview with sample data"}
    </Link>
  );
}

export function EmptyState({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border-2 bg-surface px-6 py-10 text-center">
      <div className="rounded-xl bg-primary-50 p-3 text-primary-600">{icon}</div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      {children && <div className="mt-1 max-w-md text-xs text-muted">{children}</div>}
    </div>
  );
}
