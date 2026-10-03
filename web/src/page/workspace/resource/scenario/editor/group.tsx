"use client";

import { useId, useSyncExternalStore, type ReactNode } from "react";
import { useStore } from "@/core";
import type { DocumentDiagnostic } from "@/model/document";
import type { Path } from "@/model/schema";
import { scenarioProblems } from "@/model/scenario";
import { FeedbackIcon, Icon } from "@/page/shared/ui";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { draftIssues, subscribeDrafts } from "@/workbench/documents/editing";
import { page, setRows } from "@/workbench/navigation";
import { schemas } from "@/workbench/schemas";

export function ScenarioGroup({ doc, title, paths, advanced = false, summary, configured, diagnostics, children }: {
  doc: ScenarioDoc;
  title: string;
  paths: readonly Path[];
  advanced?: boolean;
  summary?: ReactNode;
  configured?: number;
  diagnostics?: readonly DocumentDiagnostic[];
  children: ReactNode;
}) {
  const headingId = useId();
  const key = `scenario-group:${title}`;
  const remembered = useStore(page, (state) => state.rows[key]);
  const schema = useStore(schemas, (state) => state.scenario);
  useSyncExternalStore(
    (listener) => subscribeDrafts(doc.editor, listener),
    () => draftIssues(doc.editor).filter((issue) => paths.some((path) => path.every((part, i) => issue.path[i] === part))).length,
    () => 0,
  );
  const issues = diagnostics ?? scenarioProblems(doc, schema, draftIssues(doc.editor))
    .filter((issue) => paths.some((path) => path.every((part, i) => issue.path[i] === part)));
  const problems = issues.length;
  const hasErrors = issues.some((issue) => issue.error);
  const count = configured ?? paths.filter((path) => doc.editor.value(path) !== undefined).length;
  const status = problems === 0 ? null : (
    <span className={`inline-flex items-center gap-1 text-small ${hasErrors ? "text-fault" : "text-warn-ink"} ${doc.editor.status === "checking" ? "opacity-50" : ""}`}>
      <FeedbackIcon level={hasErrors ? "error" : "warning"} size={12} />
      {problems} {problems === 1 ? "problem" : "problems"}
    </span>
  );
  const heading = (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <h4 id={headingId} className="lab m-0 text-ink2">{title}</h4>
        {advanced ? <span className="fn text-small text-ink3">{count} configured</span> : null}
        {status}
      </div>
      {summary === undefined ? null : <div className="text-small text-ink3">{summary}</div>}
    </div>
  );
  const content = <div className="flex min-w-0 flex-col gap-3">{children}</div>;

  if (!advanced) return (
    <section aria-labelledby={headingId} className="flex min-w-0 flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      {heading}
      {content}
    </section>
  );

  return (
    <details
      open={remembered ?? problems > 0}
      onToggle={(event) => {
        const open = event.currentTarget.open;
        if (page.get().rows[key] !== open) setRows(key, open);
      }}
      className="min-w-0 border-t border-line pt-3 [&[open]>summary>span]:rotate-0"
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 flex-none -rotate-90 text-ink3"><Icon name="chev" size={12} /></span>
        {heading}
      </summary>
      <div className="pt-3">{content}</div>
    </details>
  );
}
