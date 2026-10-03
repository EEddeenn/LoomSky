import type { PackedSummary } from "./bundle";
import type { Leap, Signal, System } from "./gnss";
import type { EpochRange, ObsCommand } from "./observation";
import type { Track } from "./trajectory";

export type PreviewOwner = { kind: "scenario" | "trajectory"; id: string } | { kind: "host" | "submission"; key: string };
export type SignalSelection = { system: System; svid: number; signal?: Signal };
export type PreviewRunIdentity = Readonly<{
  hostKey: string;
  registrationId: string | null;
  address: string;
  boot: string;
  sequence: number;
  submissionKey: string;
  buildId: string;
  engineIdentity: string;
  digest: string;
}>;
type PreviewSourceIdentity = { kind: "scenario"; id: string; revision: number; digest: string } | { kind: "run"; run: PreviewRunIdentity };
export type PreviewSource = Readonly<{
  identity: PreviewSourceIdentity;
  key: string;
  label: string;
  origin?: string;
  digest: string;
  bundle: Uint8Array<ArrayBuffer>;
  summary: PackedSummary;
  run: string;
  commands: ObsCommand[];
  scenario: string;
  range: EpochRange;
  stale: boolean;
  current: boolean;
}>;
export type PreviewTimeIntent = { kind: "manual"; epochMs: number } | { kind: "follow"; hostKey: string };
export type PreviewLane = Readonly<{
  key: string;
  label: string;
  state: "onair" | "armed" | "unknown" | "alarm" | "off";
  epochMs: number | null;
  sentMs: number | null;
  firstMs: number;
  unknownUntilMs: number | null;
  replay: boolean;
  commands: readonly Readonly<{ epochMs: number; label: string }>[];
  faults: readonly Readonly<{ epochMs: number; label: string }>[];
  end: Readonly<{ epochMs: number; label: string; alarm: boolean }> | null;
}>;
export type PreviewWindow = { startGpsMs: number; durationMs: number; leap: Leap };
export type PreviewPin = { source: PreviewSource; lane: PreviewLane | null };
export type PreviewPinReference = Readonly<{ source: Omit<PreviewSource, "bundle">; lane: PreviewLane | null }>;
export type PreviewBookmark = Readonly<{ time: PreviewTimeIntent; selection: SignalSelection | null; pin: PreviewPinReference | null }>;
export type PreviewFrame = Readonly<{
  owner: PreviewOwner;
  ownerKey: string;
  source: PreviewSource | null;
  track: Track | null;
  window: PreviewWindow | null;
  epochMs: number;
  sampleEpochMs: number;
  following: boolean;
  live: boolean;
  lanes: readonly PreviewLane[];
  nowGpsMs: number | null;
  scope: string;
  note: { level: "error" | "warning"; message: string } | null;
  selection: SignalSelection | null;
  adjustment: string | null;
  capabilities: Readonly<{ seek: boolean; follow: boolean; inspect: boolean; command: boolean }>;
}>;

export function previewOwnerKey(owner: PreviewOwner): string {
  return `${owner.kind}:${encodeURIComponent("id" in owner ? owner.id : owner.key)}`;
}

export function samePreviewRun(left: PreviewRunIdentity, right: PreviewRunIdentity): boolean {
  return left.hostKey === right.hostKey && left.address === right.address && left.boot === right.boot
    && left.registrationId === right.registrationId && left.engineIdentity === right.engineIdentity
    && left.sequence === right.sequence && left.submissionKey === right.submissionKey
    && left.buildId === right.buildId && left.digest === right.digest;
}
