"use client";

import { useEffect, useState, type ReactNode } from "react";
import { bytes } from "@/core";
import { diagnosticProblemId } from "@/model/document";
import type { ScenarioFileReference, ScenarioIssue } from "@/model/scenario";
import { Button, FeedbackIcon, Icon } from "@/page/shared/ui";
import { chooseScenarioFile, removeScenarioFile } from "@/workbench/documents/scenario/actions";
import type { ScenarioDoc } from "@/workbench/documents/scenario";
import { openProblems, toast } from "@/workbench/feedback";
import { readFileSize } from "@/workbench/files";

export function FileRow({ doc, reference, issues, accept, label, children }: {
  doc: ScenarioDoc;
  reference: ScenarioFileReference;
  issues: readonly ScenarioIssue[];
  accept?: string;
  label?: string;
  children?: ReactNode;
}) {
  const digest = doc.files[reference.name];
  const issue = issues.find((item): item is Extract<ScenarioIssue, { kind: "file" }> => item.kind === "file" && item.key === reference.key && item.name === reference.name);
  const diagnostic = doc.editor.diagnostics.find((item) => item.file === "scenario" && item.error && item.source === reference.name);
  const problemId = issue?.id ?? (diagnostic === undefined ? null : diagnosticProblemId(doc.id, diagnostic));
  const failure = digest === undefined ? "Choose a file from Library." : issue?.failure ?? diagnostic?.message ?? null;
  const stale = issue === undefined && doc.editor.status === "checking";

  return (
    <div className="flex min-w-0 flex-col gap-2 rounded-key border border-line bg-face p-3">
      <div className="flex min-w-0 items-start gap-2">
        <span className="mt-0.5 shrink-0 text-ink3"><Icon name="file" size={14} /></span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {label === undefined ? null : <span className="lab text-ink3">{label}</span>}
          <code className="text-small [overflow-wrap:anywhere]">{reference.name}</code>
          {children}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {digest === undefined ? <span className="text-small font-medium text-fault">Not selected</span> : null}
        <FileSize digest={digest} />
        <div className="ml-auto flex items-center gap-1">
          <Button size="xs" icon="folder" disabled={!doc.editor.writable()}
            aria-label={`${digest === undefined ? "Bind file to" : "Replace file for"} ${reference.name}`}
            onClick={() => chooseScenarioFile(doc, reference, accept)}
          >{digest === undefined ? "Choose file…" : "Replace…"}</Button>
          <Button variant="ghost" size="xs" iconOnly icon="x" disabled={!doc.editor.writable()} aria-label={`Remove ${reference.name}`} onClick={() => void removeScenarioFile(doc, reference)} />
        </div>
      </div>
      {problemId === null || failure === null ? null : (
        <button type="button" className={`flex min-w-0 items-start gap-1.5 self-start text-left text-small text-fault ${stale ? "opacity-50" : ""}`} onClick={() => openProblems(problemId)} aria-label={`Open Problems for ${reference.name}: ${failure}`}>
          <span className="mt-px shrink-0"><FeedbackIcon level="error" size={14} /></span>
          <span className="min-w-0 underline underline-offset-3 [overflow-wrap:anywhere]">{failure}</span>
        </button>
      )}
    </div>
  );
}

function FileSize({ digest }: { digest: string | undefined }) {
  const [size, setSize] = useState<number | null>(null);
  useEffect(() => {
    let current = true;
    setSize(null);
    if (digest !== undefined) {
      void readFileSize(digest).then((value) => {
        if (current) setSize(value);
      }).catch((error) => {
        if (current) toast(`Could not read file size: ${error instanceof Error ? error.message : String(error)}`, "error");
      });
    }
    return () => { current = false; };
  }, [digest]);
  return size === null ? null : <span className="fn text-small whitespace-nowrap text-ink3">{bytes(size)}</span>;
}
