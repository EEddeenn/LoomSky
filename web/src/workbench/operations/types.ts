import type { PackedSummary } from "@/model/bundle";
import type { EpochRange, ObsCommand } from "@/model/observation";
import type { ResourceRef } from "@/model/resource";
import type { ScenarioSnapshot, TrajectorySnapshot } from "@/model/version";

export type ImportKind = "scenario" | "trajectory" | "file";
type OperationPhase = "preparing" | "running" | "committing" | "succeeded" | "partial" | "failed" | "cancelled";
type OperationState = {
  id: string;
  name: string;
  resource: ResourceRef | null;
  phase: OperationPhase;
  startedAt: number;
  finishedAt: number | null;
  cancellable: boolean;
  cancellationRequested: boolean;
  progress: number | null;
  error: string | null;
};
export type ImportItem = {
  index: number;
  name: string;
  status: "pending" | "reading" | "committing" | "succeeded" | "failed" | "cancelled" | "unprocessed";
  resource: ResourceRef | null;
  outcome: "created" | "reused" | null;
  error: string | null;
};
export type ImportOperation = OperationState & {
  kind: "import";
  items: readonly ImportItem[];
};
export type DuplicateOperation = OperationState & {
  kind: "duplicate";
  result: ResourceRef | null;
};
export type ExportOperation = OperationState & {
  kind: "export";
  identity: string;
  result: { name: string; bytes: number; download: "requested" } | null;
};
export type Operation = ImportOperation | DuplicateOperation | ExportOperation;
export type OperationHandle<T extends Operation = Operation> = { id: string; done: Promise<T> };
export type ImportRequest = { batchId: string; kind: ImportKind; files: readonly File[] };
export type DuplicateRequest =
  | { kind: "scenario"; resource: Extract<ResourceRef, { kind: "scenario" }>; incarnation: string; name: string; snapshot: ScenarioSnapshot }
  | { kind: "trajectory"; resource: Extract<ResourceRef, { kind: "trajectory" }>; incarnation: string; name: string; snapshot: TrajectorySnapshot };
type PackedSource = { key: string; name: string; digest: string; bundle: Uint8Array<ArrayBuffer>; summary: PackedSummary; resource?: ResourceRef };
export type TruthExportSource = PackedSource & ({ kind: "prediction" } | { kind: "run"; range: EpochRange; commands: ObsCommand[] });
export type TruthExportInput =
  | { kind: "truth"; source: TruthExportSource }
  | { kind: "scenario-truth"; resource: Extract<ResourceRef, { kind: "scenario" }>; incarnation: string; name: string; snapshot: ScenarioSnapshot };
export type ExportRequest =
  | { kind: "scenario"; resource: Extract<ResourceRef, { kind: "scenario" }>; incarnation: string; name: string; snapshot: ScenarioSnapshot }
  | { kind: "trajectory-json" | "trajectory-pht"; resource: Extract<ResourceRef, { kind: "trajectory" }>; incarnation: string; name: string; snapshot: TrajectorySnapshot }
  | { kind: "file"; resource: ResourceRef | null; name: string; digest: string }
  | (TruthExportInput & { format: 0 | 1 });
