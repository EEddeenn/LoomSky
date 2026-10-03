import type { ResourceRef } from "@/model/resource";
import { reportPendingIssue } from "../../editing";
import { fileByteLength } from "@/io/storage";
import type { LibraryFileKind, LibraryFileRecord } from "@/model/library";
import { inputFileName, type ScenarioFileField, type ScenarioFileReference, type ScenarioFileSelection } from "@/model/scenario";
import { peekScenario, type ScenarioDoc } from "@/workbench/documents/scenario";
import { reportProblem, resolveProblem, toast } from "@/workbench/feedback";
import { openLibraryPicker, openSavedVersionPicker } from "@/workbench/library";
import { libraryFileOf } from "@/workbench/files";
import { captureAttention } from "@/workbench/navigation";

function current(doc: ScenarioDoc): void {
  if (peekScenario(doc.id) !== doc || !doc.editor.writable()) throw new Error("Scenario is no longer editable. Reopen it and choose again.");
}

function prepare(doc: ScenarioDoc, focus = true): boolean {
  current(doc);
  const issue = doc.prepareSnapshot();
  if (issue === null) return true;
  reportPendingIssue({ kind: "scenario", id: doc.id }, issue, captureAttention(), focus);
  return false;
}

function snapshot(doc: ScenarioDoc, field: ScenarioFileField | "trajectory") {
  return {
    sequence: doc.workingSequence,
    field,
    raw: doc.editor.raw(field.split(".")),
    precise: field.startsWith("precise.") ? doc.editor.raw(["precise"]) : undefined,
    files: doc.files,
    trajectory: doc.trajectory,
  };
}

function unchanged(doc: ScenarioDoc, before: ReturnType<typeof snapshot>, revision = true): void {
  current(doc);
  if ((revision && (doc.workingSequence !== before.sequence))
    || doc.editor.raw(before.field.split(".")) !== before.raw
    || doc.files !== before.files || doc.trajectory !== before.trajectory
    || (before.field.startsWith("precise.") && doc.editor.raw(["precise"]) !== before.precise)) {
    throw new Error("Scenario changed. Close Library, review inputs and choose again.");
  }
}

function fieldOf(reference: ScenarioFileReference): ScenarioFileField {
  if (reference.key === "trajectory") throw new Error("Choose a trajectory from the Library.");
  return reference.key;
}

function fileKind(field: ScenarioFileField): LibraryFileKind {
  return field === "precise.orbit" ? "precise-orbit" : field === "precise.clock" ? "precise-clock" : field;
}

async function selectedFiles(resources: readonly ResourceRef[], field: ScenarioFileField): Promise<LibraryFileRecord[]> {
  const records = resources.map((resource) => {
    const record = resource.kind === "file" ? libraryFileOf(resource.id) : undefined;
    if (record === undefined) throw new Error("A selected file is missing from Library. Choose the files again.");
    if (record.kind !== fileKind(field) && record.kind !== "other") throw new Error(`${record.name} cannot be used as a ${field} file.`);
    return record;
  });
  await Promise.all(records.map(async (record) => {
    if (await fileByteLength(record.digest) === null) throw new Error(`${record.name} is unavailable in this browser. Upload it again.`);
  }));
  return records;
}

function namedFiles(records: readonly LibraryFileRecord[]): ScenarioFileSelection[] {
  if (records.some((record) => libraryFileOf(record.id)?.revision !== record.revision)) throw new Error("A selected file changed. Review it and choose again.");
  return records.map((record) => ({ name: inputFileName(record.name), digest: record.digest }));
}

export function addScenarioFiles(doc: ScenarioDoc, field: ScenarioFileField, accept?: string): void {
  let before = snapshot(doc, field);
  const multiple = field !== "antenna";
  openLibraryPicker({
    title: `Add ${field} files`, kinds: ["file"], multiple, fileAccept: accept, fileKinds: [fileKind(field)],
    onUse: async (resources) => {
      if (resources.length === 0) return false;
      if (!multiple && resources.length !== 1) throw new Error("Choose one antenna file.");
      unchanged(doc, before);
      if (!prepare(doc, false)) return false;
      unchanged(doc, before, false);
      before = snapshot(doc, field);

      const records = await selectedFiles(resources, field);
      unchanged(doc, before);
      doc.addNamedFiles(field, namedFiles(records));
      return true;
    },
  });
}

export function chooseScenarioFile(doc: ScenarioDoc, reference: ScenarioFileReference, accept?: string): void {
  const selectedReference = { ...reference, path: [...reference.path] };
  const field = fieldOf(selectedReference);
  let before = snapshot(doc, field);
  openLibraryPicker({
    title: `Choose file for ${reference.name}`, kinds: ["file"], fileAccept: accept, fileKinds: [fileKind(field)],
    onUse: async (resources) => {
      if (resources.length !== 1) return false;
      unchanged(doc, before);
      if (!prepare(doc, false)) return false;
      unchanged(doc, before, false);
      if (doc.editor.value(selectedReference.path) !== selectedReference.name) throw new Error("The file reference changed. Review it and choose again.");
      before = snapshot(doc, field);

      const records = await selectedFiles(resources, field);
      unchanged(doc, before);
      const selection = namedFiles(records)[0];
      if (selection === undefined) return false;
      doc.selectNamedFile(selectedReference, selection);
      return true;
    },
  });
}

export function chooseScenarioTrajectory(doc: ScenarioDoc, preferredTrajectoryId?: string, onClose?: () => void): void {
  let before = snapshot(doc, "trajectory");
  const adopted = doc.trajectory;
  const bound = doc.boundTrajectory;
  openSavedVersionPicker({
    title: "Choose trajectory version", kind: "trajectory",
    description: "Choose a saved trajectory version. Save the scenario to keep this change.",
    selected: adopted === null || bound === null || preferredTrajectoryId !== undefined && preferredTrajectoryId !== bound.resourceId ? undefined : { resourceId: bound.resourceId, versionId: adopted.versionId, buildId: adopted.buildId },
    resourceId: preferredTrajectoryId, onClose,
    onUse: async (candidate) => {
      unchanged(doc, before);
      if (!prepare(doc, false)) return false;
      unchanged(doc, before, false);
      before = snapshot(doc, "trajectory");

      const attention = captureAttention();
      const revision = candidate.build.pin;
      const result = await doc.adopt(revision);
      if (!result.ok) {
        reportPendingIssue({ kind: "scenario", id: doc.id }, result.issue, attention, false);
        return false;
      }
      toast(`${doc.name} uses ${candidate.build.version.snapshot.name} v${candidate.build.version.number}${doc.saved.dirty || doc.pending ? " · unsaved changes" : ""}`);
      return true;
    },
  });
}

export async function removeScenarioFile(doc: ScenarioDoc, reference: ScenarioFileReference): Promise<boolean> {
  const problem = `scenario:${doc.id}:remove-${reference.key}-file`;
  try {
    if (!prepare(doc)) return false;
    fieldOf(reference);
    doc.removeNamedFile(reference);
    resolveProblem(problem);
    return true;
  } catch (error) {
    reportProblem({
      id: problem, level: "error", scope: `Scenario · ${doc.id}`, title: `Could not remove ${reference.key} file`,
      message: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
