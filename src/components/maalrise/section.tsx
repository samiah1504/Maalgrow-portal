import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * One numbered section of the Cycle and investor details pages. The id
 * is the anchor the section index at the top of the page links to.
 */
export function DetailSection({
  id,
  title,
  description,
  action,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card id={id} className="scroll-mt-6">
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0 pb-4">
        <div>
          <CardTitle className="text-base">{title}</CardTitle>
          {description && <p className="text-xs text-muted mt-1">{description}</p>}
        </div>
        {action}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

/** Label/value pairs in a two-column grid. */
export function FieldGrid({ rows }: { rows: { label: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label}>
          <dt className="text-xs font-medium text-muted">{r.label}</dt>
          <dd className="mt-0.5 text-sm text-foreground">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function SectionIndex({ items }: { items: { id: string; label: string }[] }) {
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-2">
      {items.map((s, i) => (
        <a
          key={s.id}
          href={`#${s.id}`}
          className="rounded-full border border-border bg-surface px-3 py-1 text-xs font-medium text-muted-foreground hover:border-primary-300 hover:text-primary-700 transition-colors"
        >
          {i + 1}. {s.label}
        </a>
      ))}
    </nav>
  );
}
