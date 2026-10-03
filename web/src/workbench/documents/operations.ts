import type { PendingIssue, Prepared } from "@/model/document";
import type { ResourceKind, ResourceHead, SavedVersion } from "@/model/version";
import { reportPendingIssue, type EditTarget } from "./editing";
import { captureAttention, hasAttention, navigate, resourceRemoved, type AttentionToken, type Destination } from "@/workbench/navigation";
import { reportProblem, requestConfirmation, resolveProblem, toast } from "@/workbench/feedback";
import { operationSourceKey } from "@/workbench/operations";

type ActionDocument<S, K extends ResourceKind = ResourceKind> = { id: string; kind: K; name: string; workingSnapshot: S; workingSequence: number; pending: boolean;
  editor: { writable(): boolean }; saved: { head: ResourceHead; version: SavedVersion; dirty: boolean }; prepareSnapshot(): PendingIssue | null };
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
export function confirmArchive(doc: ActionDocument<unknown>, archive: (id: string) => Promise<void>, retained: string): boolean {
  if (!doc.editor.writable()) return false;
  const sequence = doc.workingSequence;
  const revision = doc.saved.head.revision;
  requestConfirmation({
    id: `delete-${doc.kind}:${doc.id}`, scope: `${doc.kind} · ${doc.name}`, title: `Archive ${doc.kind}?`,
    message: `Archive this ${doc.kind} and discard its unsaved working copy. ${retained}`,
    details: [{ label: "Name", value: doc.name }, { label: "Saved version", value: `v${doc.saved.version.number}` },
      { label: "Unsaved changes", value: doc.saved.dirty ? "Yes" : "None" }, { label: "Unapplied edits", value: doc.pending ? "Yes" : "None" }],
    confirmLabel: `Archive ${doc.kind}`,
    confirm: async () => {
      if (!doc.editor.writable() || doc.workingSequence !== sequence || doc.saved.head.revision !== revision) throw new Error("Working copy changed. Review it and choose Archive again.");
      await archive(doc.id);
      resourceRemoved({ kind: doc.kind, id: doc.id }, doc.id);
      toast(`Archived ${doc.kind} ${doc.name}`);
      resolveProblem(`operation:${doc.kind}:${doc.id}:delete-${doc.kind}`);
    },
  });
  return true;
}
