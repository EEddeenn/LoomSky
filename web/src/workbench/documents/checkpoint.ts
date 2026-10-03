import { isRecord } from "@/core";
import { immutableCopy, type ResourceHead, type ScenarioSnapshot, type TrajectorySnapshot } from "@/model/version";
import type { ScenarioEditingCheckpoint } from "./scenario/editing/session";
import type { ScenarioRecovery } from "./scenario/evaluation";
import type { TrajectoryEditingCheckpoint } from "./trajectory/editing/session";
import type { TrajectoryRecovery } from "./trajectory/evaluation";

type CheckpointState = Readonly<{ format: 2; id: string; revision: number; sequence: number; base: ResourceHead; restoredFrom: string | null }>;
export type ScenarioDocumentCheckpoint = CheckpointState & Readonly<{ kind: "scenario"; snapshot: ScenarioSnapshot; editing: ScenarioEditingCheckpoint; recovery: ScenarioRecovery }>;
export type TrajectoryDocumentCheckpoint = CheckpointState & Readonly<{ kind: "trajectory"; snapshot: TrajectorySnapshot; editing: TrajectoryEditingCheckpoint; recovery: TrajectoryRecovery }>;
export type DocumentCheckpoint = ScenarioDocumentCheckpoint | TrajectoryDocumentCheckpoint;

function scenarioSnapshot(snapshot: ScenarioSnapshot): ScenarioSnapshot {
  const trajectory = snapshot.bindings.trajectory;
  return { source: snapshot.source, bindings: { files: snapshot.bindings.files, trajectory: trajectory === null ? null : { versionId: trajectory.versionId, buildId: trajectory.buildId } } };
}

export function readDocumentCheckpoint(value: unknown, kind: "scenario" | "trajectory", id: string): DocumentCheckpoint {
  if (!isRecord(value) || value.kind !== kind || value.id !== id || !isRecord(value.editing)) throw new Error("This draft belongs to another document");
  let checkpoint: DocumentCheckpoint;
  if (value.format === 1) {
    if (!isRecord(value.history) || !isRecord(value.history.current) || !isRecord(value.history.current.metadata)
      || typeof value.history.current.text !== "string" || !isRecord(value.saved) || !isRecord(value.saved.resource)) throw new Error("The saved draft is incomplete");
    const current = value.history.current;
    const metadata = value.history.current.metadata;
    const base = value.saved.resource.head as ResourceHead;
    const shared = { format: 2 as const, id, revision: Number(value.revision), sequence: Number(value.sequence), base,
      restoredFrom: isRecord(metadata.restoration) && typeof metadata.restoration.versionId === "string" ? metadata.restoration.versionId : null };
    checkpoint = kind === "scenario"
      ? { ...shared, kind, snapshot: { source: { text: String(current.text) }, bindings: metadata.scenarioBindings as ScenarioSnapshot["bindings"] }, editing: value.editing as ScenarioEditingCheckpoint, recovery: value.recovery as ScenarioRecovery }
      : { ...shared, kind, snapshot: { source: { text: String(current.text) }, name: String(metadata.trajectoryName) }, editing: value.editing as TrajectoryEditingCheckpoint, recovery: value.recovery as TrajectoryRecovery };
  } else if (value.format === 2) checkpoint = value as DocumentCheckpoint;
  else throw new Error("This draft uses an unsupported format");
  if (!isRecord(checkpoint.base) || checkpoint.base.id !== id || checkpoint.base.kind !== kind || !Number.isSafeInteger(checkpoint.revision)
    || !Number.isSafeInteger(checkpoint.sequence) || !isRecord(checkpoint.snapshot) || !isRecord(checkpoint.snapshot.source)
    || typeof checkpoint.snapshot.source.text !== "string") throw new Error("The saved draft is incomplete");
  if (checkpoint.kind === "scenario") checkpoint = {
    ...checkpoint, snapshot: scenarioSnapshot(checkpoint.snapshot), recovery: { successful: checkpoint.recovery?.successful == null ? null : {
      ...checkpoint.recovery.successful, snapshot: scenarioSnapshot(checkpoint.recovery.successful.snapshot),
    } },
  };
  return immutableCopy(checkpoint);
}
