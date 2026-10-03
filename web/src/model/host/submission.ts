import { isRecord } from "@/core";
import type { PackedSummary, Window } from "@/model/bundle";
import { isSystem } from "@/model/gnss";
import type { EpochRange, ObsCommand } from "@/model/observation";
import type { ScenarioInputs } from "@/model/scenario";
import { obsCommands, type OperationId, type RunId, type Snapshot } from "./protocol";

export type SubmissionTruth = { first: number; sent: number; commands: ObsCommand[] };

export type SubmissionSource = Readonly<{
  scenarioId: string;
  versionId: string;
  versionNumber: number;
  buildId: string;
  engineIdentity: string;
}>;

export function sameSubmissionSource(left: SubmissionSource, right: SubmissionSource): boolean {
  return left.scenarioId === right.scenarioId && left.versionId === right.versionId && left.versionNumber === right.versionNumber
    && left.buildId === right.buildId && left.engineIdentity === right.engineIdentity;
}

export type SubmissionRecord = {
  key: string;
  address: string;
  boot: string;
  run: number;
  source: SubmissionSource;
  digest: string;
  label: string;
  texts: ScenarioInputs;
  bundle: Uint8Array<ArrayBuffer>;
  summary: PackedSummary;
  at: number;
  truth?: SubmissionTruth;
};

export type SubmissionIdentity = Pick<SubmissionRecord, "address" | "boot" | "run" | "digest" | "source">;
export type RunKnowledgeRecord = {
  key: string;
  identity: SubmissionIdentity;
  revision: number;
  truth: SubmissionTruth | null;
};
export type SubmissionTruthPatchResult =
  | { kind: "applied" | "equal" | "superseded"; truth: SubmissionTruth; revision: number }
  | { kind: "missing" | "sourceConflict" };

export type SubmissionPayload = Pick<SubmissionRecord, "source" | "digest" | "label" | "texts" | "bundle" | "summary" | "at">;
export type PendingSubmissionRecord = SubmissionPayload & {
  key: string;
  address: string;
  operation: OperationId;
  target: RunId | null;
  cancelAt: number | null;
};

export type StopIntentRecord = {
  key: string;
  address: string;
  at: number;
  target: { kind: "run"; id: RunId } | { kind: "operation"; id: OperationId } | null;
};

export function extendsSubmissionTruth(next: SubmissionTruth, previous: SubmissionTruth): boolean {
  return next.first === previous.first && next.sent >= previous.sent && next.commands.length >= previous.commands.length
    && previous.commands.every((command, index) => JSON.stringify(command) === JSON.stringify(next.commands[index]));
}

export type RunTruth = {
  key: string;
  run: RunId;
  digest: string;
  bundle: Uint8Array<ArrayBuffer>;
  summary: PackedSummary;
  range: EpochRange;
  commands: ObsCommand[];
};

function validCommand(command: unknown): command is ObsCommand {
  if (!isRecord(command) || !Number.isSafeInteger(command.epoch) || Number(command.epoch) < 0) return false;
  if (command.kind === "noise_floor_dbm_hz" || command.kind === "elevation_mask") {
    return typeof command.value === "number" && Number.isFinite(command.value);
  }
  if (
    command.kind !== "signal_power" || !isSystem(command.system) ||
    !Number.isSafeInteger(command.svid) || Number(command.svid) < 0 || Number(command.svid) > 0xffffffff
  ) return false;
  const level = command.level;
  return level === null || isRecord(level)
    && (level.unit === "dbhz" || level.unit === "dbm" || level.unit === "dbw")
    && typeof level.value === "number" && Number.isFinite(level.value);
}

function validTruth(value: unknown, durationMs: number): value is SubmissionTruth {
  if (!isRecord(value)) return false;
  const { first, sent, commands } = value;
  return typeof first === "number" && Number.isSafeInteger(first) && typeof sent === "number" && Number.isSafeInteger(sent)
    && first >= 0 && first <= sent && sent < durationMs && Array.isArray(commands) && commands.every(validCommand);
}

export function snapshotSubmission(address: string, snapshot: Snapshot, submission: SubmissionRecord | null): SubmissionRecord | null {
  if (
    submission === null ||
    submission.address !== address ||
    submission.boot !== snapshot.boot ||
    submission.run !== snapshot.run
  ) return null;
  return submission;
}

export function snapshotTruth(address: string, snapshot: Snapshot, submission: SubmissionRecord | null): SubmissionTruth | null {
  const status = snapshot.status;
  const matched = snapshotSubmission(address, snapshot, submission);
  if (status === null || matched === null) return null;
  const { first, sent } = status;
  if (first === null || sent === null || first > sent || sent >= matched.summary.window.durationMs) return null;
  return { first, sent, commands: obsCommands(status) };
}

export function submissionTruthOf(submission: SubmissionRecord): RunTruth | null {
  const { truth } = submission;
  return validTruth(truth, submission.summary.window.durationMs) ? runTruth(submission, truth) : null;
}

export function snapshotRunTruth(address: string, snapshot: Snapshot, submission: SubmissionRecord | null): RunTruth | null {
  if (submission === null) return null;
  const truth = snapshotTruth(address, snapshot, submission);
  return truth === null ? null : runTruth(submission, truth);
}

function runTruth(submission: SubmissionRecord, truth: SubmissionTruth): RunTruth | null {
  if (submission.key !== `${submission.address} ${submission.boot} ${submission.run}`) return null;
  return {
    key: submission.key,
    run: { boot: submission.boot, sequence: submission.run },
    digest: submission.digest,
    bundle: submission.bundle,
    summary: structuredClone(submission.summary),
    range: { first: truth.first, end: truth.sent + 1 },
    commands: structuredClone(truth.commands),
  };
}

export function snapshotWindow(address: string, snapshot: Snapshot, submission: SubmissionRecord | null): Pick<Window, "startGpsMs" | "durationMs"> | null {
  const status = snapshot.status;
  if (status === null) return null;
  const plan = status.plan;
  if (plan !== null) return { startGpsMs: plan.start_gps_ms + plan.start_gps_sub_ms, durationMs: plan.epochs };
  const window = snapshotSubmission(address, snapshot, submission)?.summary.window;
  return window === undefined ? null : { startGpsMs: window.startGpsMs, durationMs: window.durationMs };
}
