import { draftProblemId, trajectoryNameProblemId, type PendingIssue, type Prepared } from "@/model/document";
import { hasAttention, captureAttention, revealDocument, type AttentionToken } from "@/workbench/navigation";
import { openProblems, toast } from "@/workbench/feedback";

export type EditTarget = { kind: "scenario"; id: string } | { kind: "trajectory"; id: string };

export function reportPendingIssue(target: EditTarget, issue: PendingIssue, attention: AttentionToken = captureAttention(), focus = true): void {
  if (!hasAttention(attention)) return;
  if (issue.kind === "busy") { toast(issue.message, "info"); return; }
  const id = issue.kind === "field" ? draftProblemId(target.id, target.kind, issue.issue.ref) : trajectoryNameProblemId(target.id);
  if (focus) {
    if (target.kind === "scenario") {
      if (issue.kind === "field") revealDocument({ ...target, target: { kind: "field", issue: issue.issue } });
    } else {
      revealDocument({ ...target, target: issue.kind === "field" ? { kind: "field", issue: issue.issue } : { kind: "name" } });
    }
  }
  openProblems(id);
}

export function runDocumentEdit(target: EditTarget, operation: () => Prepared<void>): boolean {
  const attention = captureAttention();
  const result = operation();
  if (result.ok) return true;
  reportPendingIssue(target, result.issue, attention);
  return false;
}

export function changeDocument(doc: EditTarget & { editor: { writable(): boolean } }, operation: () => void): boolean {
  return runDocumentEdit({ kind: doc.kind, id: doc.id }, () => editDocument(doc, operation));
}

export function editDocument(doc: { editor: { writable(): boolean } }, operation: () => void): Prepared<void> {
  if (!doc.editor.writable()) return { ok: false, issue: { kind: "busy", message: "This document is read-only." } };
  operation();
  return { ok: true, value: undefined };
}
