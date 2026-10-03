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
    if (doc.saved.state.status === "conflict") throw new Error(doc.saved.state.message);
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
    if (head === undefined || head.archivedAt !== null) throw new Error("This resource is no longer active in the Library.");
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

export async function reloadDocument(doc: Document): Promise<void> {
  const target = targetOf(doc);
  const problem = `document:${target.kind}:${target.id}:reload`;
  const sequence = doc.workingSequence;
  const baseline = doc.saved.version.id;
  const unchanged = () => {
    current(doc);
    if (doc.workingSequence !== sequence || doc.saved.version.id !== baseline) throw new Error("Working copy changed. Review it and choose Load latest again.");
    if (doc.saved.state.status === "saving" || doc.editing.busy) throw new Error("Finish editing or saving before loading a version.");
  };
  try {
    unchanged();
    const head = await getResourceHead(doc.id);
    if (head === undefined || head.archivedAt !== null) throw new Error("Resource no longer active. Save a copy to keep your work.");
    const version = await getSavedVersion(head.headVersionId);
    if (version === undefined || version.kind !== head.kind) throw new Error("Latest saved version unavailable.");
    const resource = head.kind === "scenario" && version.kind === "scenario" ? { head, version }
      : head.kind === "trajectory" && version.kind === "trajectory" ? { head, version } : null;
    if (resource === null) throw new Error("The latest saved version does not match this resource.");
    unchanged();
    requestConfirmation({
      id: `reload-version:${target.kind}:${doc.id}`, scope: `${target.kind === "scenario" ? "Scenario" : "Trajectory"} · ${doc.id}`,
      title: `Load v${version.number}?`,
      message: "Replace working copy, unapplied inputs and Undo history with the latest saved version. Saved versions remain.",
      details: [{ label: "Editing from", value: `v${doc.saved.version.number}` }, { label: "Latest saved", value: `v${version.number}` }],
      confirmLabel: "Load latest",
      confirm: async () => {
        unchanged();
        const latest = await getResourceHead(doc.id);
        unchanged();
        if (latest?.revision !== head.revision) throw new Error("Saved version changed again. Review it and choose Load latest again.");
        doc.reloadSaved(resource);
        resolveProblem(problem);
        toast(`Loaded v${version.number}.`);
      },
    });
  } catch (error) {
    reportProblem({ id: problem, level: "error", scope: `${target.kind === "scenario" ? "Scenario" : "Trajectory"} · ${doc.id}`,
      title: "Could not load latest version", message: error instanceof Error ? error.message : String(error) });
  }
}
