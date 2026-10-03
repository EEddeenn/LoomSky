import { appendSavedVersion, type ResourceWriteOptions } from "@/io/storage";
import { createPlan } from "@/model/trajectory";
import { immutableCopy, type TrajectorySnapshot } from "@/model/version";
import { documentCollection } from "../collection";
import { TrajectoryDoc } from "./document";

const collection = documentCollection("trajectory", (resource) => new TrajectoryDoc(resource));

export const trajectoryCatalog = collection.catalog;
export const trajectoryDocuments = collection.documents;
export const peekTrajectory = collection.get;
export const openTrajectory = collection.open;
export const restoreTrajectoryDraft = collection.restoreDraft;
export const trajectoryDraftDiscarded = collection.draftDiscarded;
export const startTrajectories = collection.start;
export const loadTrajectoryCatalog = collection.load;
export const reloadTrajectoryCatalog = collection.refresh;
export const archiveTrajectory = collection.archive;

export async function createTrajectoryDocument(snapshot: TrajectorySnapshot, options: ResourceWriteOptions = {}): Promise<TrajectoryDoc> {
  options.signal?.throwIfAborted();
  const captured = immutableCopy(snapshot);
  await loadTrajectoryCatalog();
  options.signal?.throwIfAborted();
  const saved = await appendSavedVersion({ kind: "trajectory", resourceId: crypto.randomUUID(), expectedRevision: null, created: Date.now(), snapshot: captured }, [], options);
  return collection.add(new TrajectoryDoc(saved));
}

export async function newTrajectory(options: ResourceWriteOptions = {}): Promise<TrajectoryDoc> {
  options.signal?.throwIfAborted();
  await loadTrajectoryCatalog();
  options.signal?.throwIfAborted();
  const names = new Set([...trajectoryCatalog.get().entries.values()].map((entry) => (entry.working?.summary ?? entry.head.summary).name));
  let n = 1;
  while (names.has(`Trajectory ${n}`)) n++;
  const name = `Trajectory ${n}`;
  return createTrajectoryDocument({ name, source: { text: `${JSON.stringify(createPlan(name), null, 2)}\n` } }, options);
}

export function duplicateTrajectory(snapshot: TrajectorySnapshot, options: ResourceWriteOptions = {}): Promise<TrajectoryDoc> {
  return createTrajectoryDocument({ name: `${snapshot.name} copy`, source: snapshot.source }, options);
}
