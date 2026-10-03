import type { ReactNode } from "react";
import type { PreviewFact, PreviewIssue } from "@/workbench/library/preview";
import { FeedbackIcon, Fig } from "@/page/shared/ui";

export function PreviewHeader({ title, kind, description }: { title: string; kind: string; description?: string | null }) {
  return <header className="flex flex-col gap-1 border-b border-line px-4 py-4">
    <span className="text-small text-ink3">{kind}</span>
    <h2 className="m-0 text-title font-semibold [overflow-wrap:anywhere]">{title}</h2>
    {description ? <p className="m-0 text-small text-ink2 [overflow-wrap:anywhere]">{description}</p> : null}
  </header>;
}

export function PreviewSection({ title, children }: { title: string; children: ReactNode }) {
  return <section className="flex min-w-0 flex-col gap-2">
    <h3 className="lab m-0 text-small font-semibold text-ink2">{title}</h3>
    {children}
  </section>;
}

export function PreviewFacts({ facts }: { facts: readonly PreviewFact[] }) {
  return <dl className="m-0 grid min-w-0 grid-cols-[minmax(0,auto)_minmax(0,1fr)] gap-x-4 gap-y-2 text-small">
    {facts.map(([label, value]) => (
      <div key={label} className="contents">
        <dt className="text-ink3">{label}</dt>
        <dd className="m-0 text-right [overflow-wrap:anywhere]"><Fig>{value}</Fig></dd>
      </div>
    ))}
  </dl>;
}

export function PreviewIssues({ issues }: { issues: readonly PreviewIssue[] }) {
  if (issues.length === 0) return null;
  return <PreviewSection title={`Problems · ${issues.length}`}>
    <ul className="m-0 flex list-none flex-col gap-2 p-0">
      {issues.slice(0, 4).map((issue, index) => (
        <li key={`${index}:${issue.message}`} className="flex items-start gap-2 text-small">
          <FeedbackIcon level={issue.error ? "error" : "warning"} />
          <span className="min-w-0 [overflow-wrap:anywhere]">{issue.message}</span>
        </li>
      ))}
    </ul>
    {issues.length > 4 ? <span className="text-small text-ink3">{issues.length - 4} more in Activity</span> : null}
  </PreviewSection>;
}

export function PreviewList({ items, empty = "None" }: { items: readonly string[]; empty?: string }) {
  if (items.length === 0) return <p className="m-0 text-small text-ink3">{empty}</p>;
  return <>
    <ul className="m-0 flex list-none flex-col gap-1.5 p-0 text-small text-ink2">{items.slice(0, 8).map((item, index) => <li key={`${index}:${item}`} className="[overflow-wrap:anywhere]">{item}</li>)}</ul>
    {items.length > 8 ? <span className="text-small text-ink3">{items.length - 8} more</span> : null}
  </>;
}

export function PreviewUnavailable() {
  return <p className="m-0 p-4 text-small text-ink3">Resource unavailable.</p>;
}

export function addedOn(created: number): string {
  return new Date(created).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
