import type { SavedVersion } from "@/model/version";
import { getResourceHead, getSavedVersion } from "@/io/storage";
import { peekScenario, type ScenarioDoc } from "@/workbench/documents/scenario";
import { peekTrajectory, type TrajectoryDoc } from "@/workbench/documents/trajectory";
import { reportProblem, requestConfirmation, resolveProblem, toast } from "@/workbench/feedback";
import { captureAttention } from "@/workbench/navigation";
import { ready } from "../operations";

type Document = ScenarioDoc | TrajectoryDoc;

function targetOf(doc: Document) {
  return { kind: doc.saved.version.kind, id: doc.id };
}

function current(doc: Document): void {
  const existing = doc.saved.version.kind === "scenario" ? peekScenario(doc.id) : peekTrajectory(doc.id);
  if (existing !== doc) throw new Error("Working copy unavailable. Reopen the resource.");
}

export async function saveDocument(doc: Document): Promise<SavedVersion | null> {
  const target = targetOf(doc);
  const attention = captureAttention();
  const problem = `document:${target.kind}:${target.id}:save-preparation`;
  try {
    current(doc);
    if (!doc.editor.writable()) throw new Error("Working copy is no longer editable. Reopen the resource.");
    resolveProblem(problem);
  } catch (error) {
    reportProblem({
      id: problem, level: "error", scope: `${target.kind === "scenario" ? "Scenario" : "Trajectory"} · ${target.id}`,
      title: "Could not save", message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
  try {
    return ready<SavedVersion>(target, await doc.save(), attention);
  } catch {
    return null;
  }
}

export async function restoreDocumentVersion(doc: Document, version: SavedVersion, onRestored?: () => void): Promise<boolean> {
  const target = targetOf(doc);
  const problem = `document:${target.kind}:${target.id}:restore`;
  const restore = async () => {
    current(doc);
    const sequence = doc.workingSequence;
    const baseline = doc.saved.version.id;
    const head = await getResourceHead(doc.id);
    if (head === undefined) throw new Error("This resource is no longer in Library.");
    const saved = await getSavedVersion(head.headVersionId);
    if (saved === undefined) throw new Error("Current saved version unavailable.");
    current(doc);
    if (doc.workingSequence !== sequence || doc.saved.version.id !== baseline) throw new Error("Working copy changed. Review it and choose Restore again.");
    if (head.kind !== saved.kind) throw new Error("The current saved version does not match this resource.");
    doc.restore(version, head.kind === "scenario" && saved.kind === "scenario" ? { head, version: saved }
      : head.kind === "trajectory" && saved.kind === "trajectory" ? { head, version: saved } : undefined);
    onRestored?.();
    toast(`Restored v${version.number} as working copy. Save to create a new version.`);
    resolveProblem(problem);
    return true;
  };

  if (!doc.saved.dirty && !doc.pending) {
    try {
      return await restore();
    } catch (error) {
      reportProblem({
        id: problem, level: "error", scope: `${target.kind === "scenario" ? "Scenario" : "Trajectory"} · ${target.id}`,
        title: "Could not restore", message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
  const sequence = doc.workingSequence;
  const saved = doc.saved.version.id;
  requestConfirmation({
    id: `restore-version:${target.kind}:${doc.id}`, scope: `${target.kind === "scenario" ? "Scenario" : "Trajectory"} · ${doc.id}`,
    title: `Restore v${version.number}?`,
    message: "Replace the working copy and unapplied edits. Saved versions remain.",
    details: [{ label: "Saved version", value: `v${version.number}` }, { label: "Working copy", value: "Unsaved changes" }],
    confirmLabel: "Restore working copy",
    confirm: async () => {
      current(doc);
      if (doc.workingSequence !== sequence || doc.saved.version.id !== saved) {
        throw new Error("Working copy changed. Review it and choose Restore again.");
      }
      await restore();
    },
  });
  return false;
}
