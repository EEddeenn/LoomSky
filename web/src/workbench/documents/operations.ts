import type { PendingIssue, Prepared } from "@/model/document";
import type { ResourceKind, SavedVersion } from "@/model/version";
import { reportPendingIssue, type EditTarget } from "./editing";
import { captureAttention, hasAttention, navigate, resourceRemoved, type AttentionToken, type Destination } from "@/workbench/navigation";
import { reportProblem, requestConfirmation, resolveProblem, toast } from "@/workbench/feedback";
import { operationSourceKey } from "@/workbench/operations";

type ActionDocument<S, K extends ResourceKind = ResourceKind> = { id: string; kind: K; name: string; workingSnapshot: S; workingSequence: number; pending: boolean;
  editor: { writable(): boolean }; saved: { version: SavedVersion; dirty: boolean }; prepareSnapshot(): PendingIssue | null };
export function ready<T>(target: EditTarget, result: Prepared<T>, attention: AttentionToken, focus = true): T | null {
  if (result.ok) return result.value;
  reportPendingIssue(target, result.issue, attention, focus);
  return null;
}
export function openCreated(attention: AttentionToken, destination: Extract<Destination, { kind: "scenario" | "trajectory" }>): void {
  if (hasAttention(attention)) navigate({ ...destination, view: "form" });
}
export function captureOperation<S, K extends ResourceKind>(doc: ActionDocument<S, K>, action: string, attention: AttentionToken = captureAttention()) {
  const resource = { kind: doc.kind, id: doc.id };
  const problem = `${doc.kind}:${doc.id}:${action}-preparation`;
  try {
    if (!doc.editor.writable()) throw new Error("Working copy is no longer editable. Reopen the resource.");
    const issue = doc.prepareSnapshot();
    if (issue !== null) { reportPendingIssue(resource as EditTarget, issue, attention); return null; }
    resolveProblem(problem);
    return { resource, incarnation: operationSourceKey(doc), name: doc.name || doc.id, snapshot: doc.workingSnapshot };
  } catch (error) {
    reportProblem({ id: problem, level: "error", scope: `${doc.kind} · ${doc.name}`, title: `Could not ${action} ${doc.kind}`, message: error instanceof Error ? error.message : String(error) });
    return null;
  }
}
export function confirmDelete(doc: ActionDocument<unknown>, remove: (id: string) => Promise<void>): boolean {
  if (!doc.editor.writable()) return false;
  const sequence = doc.workingSequence;
  requestConfirmation({
    id: `delete-${doc.kind}:${doc.id}`, scope: `${doc.kind} · ${doc.name}`, title: `Delete ${doc.kind}?`,
    message: `Delete “${doc.name}” and all its saved versions? This cannot be undone.`,
    confirmLabel: `Delete ${doc.kind}`,
    confirm: async () => {
      if (!doc.editor.writable() || doc.workingSequence !== sequence) throw new Error("Working copy changed. Review it and choose Delete again.");
      await remove(doc.id);
      resourceRemoved({ kind: doc.kind, id: doc.id }, doc.id);
      toast(`Deleted ${doc.kind} ${doc.name}`);
      resolveProblem(`operation:${doc.kind}:${doc.id}:delete-${doc.kind}`);
    },
  });
  return true;
}
