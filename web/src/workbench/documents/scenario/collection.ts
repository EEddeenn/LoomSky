import { appendSavedVersion, type ResourceWriteOptions } from "@/io/storage";
import { immutableCopy, type ScenarioSnapshot } from "@/model/version";
import { documentCollection } from "../collection";
import { ScenarioDoc } from "./document";

const collection = documentCollection("scenario", (resource) => new ScenarioDoc(resource));

export const scenarioCatalog = collection.catalog;
export const scenarioDocuments = collection.documents;
export const peekScenario = collection.get;
export const openScenario = collection.open;
export const restoreScenarioDraft = collection.restoreDraft;
export const scenarioDraftDiscarded = collection.draftDiscarded;
export const startScenarios = collection.start;
export const loadScenarioCatalog = collection.load;
export const reloadScenarioCatalog = collection.refresh;
export const archiveScenario = collection.archive;

export async function createScenarioDocument(snapshot: ScenarioSnapshot, options: ResourceWriteOptions = {}): Promise<ScenarioDoc> {
  options.signal?.throwIfAborted();
  const captured = immutableCopy(snapshot);
  await loadScenarioCatalog();
  options.signal?.throwIfAborted();
  const saved = await appendSavedVersion({ kind: "scenario", resourceId: crypto.randomUUID(), expectedRevision: null, created: Date.now(), snapshot: captured }, [], options);
  return collection.add(new ScenarioDoc(saved));
}

export type NewScenario = { name: string; description?: string };

export function newScenario(input: NewScenario, options: ResourceWriteOptions = {}): Promise<ScenarioDoc> {
  const scenario = {
    version: 1,
    name: input.name.trim(),
    ...(input.description?.trim() ? { description: input.description.trim() } : {}),
  };
  return createScenarioDocument({ source: { text: `${JSON.stringify(scenario, null, 2)}\n` }, bindings: { files: {}, trajectory: null } }, options);
}

export function duplicateScenario(snapshot: ScenarioSnapshot, options: ResourceWriteOptions = {}): Promise<ScenarioDoc> {
  return createScenarioDocument(snapshot, options);
}

export function scenariosUsingTrajectory(id: string) {
  return [...scenarioCatalog.get().entries.values()].filter((entry) => entry.head.archivedAt === null && (entry.working?.summary ?? entry.head.summary).trajectoryId === id);
}
