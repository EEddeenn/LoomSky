import type { PrioritySource } from "./demand";
import type { EpochRange, ObsCommand } from "@/model/observation";
import type { GeometryInspection, Track } from "@/model/trajectory";
import type { CompiledPharos, Coverage, NamedBytes, Packed, PharosProduct } from "@/io/pharos";
import type { EffectiveQuery, EffectiveValues, TruthEpoch } from "@/model/observation";

export type TaskOptions = { priority?: PrioritySource; signal?: AbortSignal; progress?: (share: number) => void; fresh?: boolean };
export type NamedInput = NamedBytes & { digest: string };
export type Lane = { stepMs: number; counts: number[] };
export type Bundle = Uint8Array<ArrayBuffer>;
export type BundleSource = (signal: AbortSignal) => Promise<Bundle>;
export type ComputeSource = (signal: AbortSignal, key: string) => Promise<Bundle>;
export type ByteSink = { write(chunk: Uint8Array<ArrayBuffer>): Promise<void> };
export type ZipEntry = { name: string; source: BundleSource };
export type WorkerResources = { memoryBytes: number; sources: string[] };
type EngineResult<T> = { engineIdentity: string; value: T };

export type Calls = {
  identity: { args: { product: PharosProduct }; result: string };
  solve: { args: { text: string }; result: EngineResult<Track> };
  geometry: { args: { text: string }; result: GeometryInspection };
  pack: { args: { scenario: string; files: NamedInput[] }; result: EngineResult<Packed> };
  describe: { args: { file: NamedInput }; result: Coverage[] };
  truth: { args: { digest: string; run: string; commands: ObsCommand[]; epoch: number; sky: boolean }; result: TruthEpoch };
  inspect: { args: { digest: string; run: string; commands: ObsCommand[]; query: EffectiveQuery }; result: EffectiveValues };
  lane: { args: { digest: string; durationMs: number }; result: Lane };
  file: { args: { digest: string; kind: 0 | 1; range: EpochRange; commands: ObsCommand[]; created: number }; result: number };
  hash: { args: { bytes: Uint8Array }; result: string };
  zip: { args: { names: string[] }; result: number };
};

export type Op = keyof Calls;
export type Call = { [O in Op]: { op: O; id: number; args: Calls[O]["args"] } }[Op];
export type ModuleInput = { product: PharosProduct; url: string; compiled: CompiledPharos | null };
export type Request =
  | { kind: "call"; call: Call; module: ModuleInput | null }
  | { kind: "cancel"; id: number }
  | { kind: "written"; id: number }
  | { kind: "source"; id: number; bytes: Bundle };
export type Success = { [O in Op]: { kind: "result"; op: O; id: number; ok: true; value: Calls[O]["result"] } }[Op];
type Failure = { kind: "result"; id: number; ok: false; error: string; engineIdentity: string | null };
export type Answer =
  | Success
  | Failure
  | { kind: "cancelled"; id: number }
  | { kind: "progress"; id: number; share: number }
  | { kind: "chunk"; id: number; bytes: Bundle }
  | { kind: "resources"; id: number; resources: WorkerResources }
  | { kind: "module"; id: number; product: PharosProduct; compiled: CompiledPharos }
  | { kind: "source"; id: number; digest: string };
