import { packedLeap } from "@/model/bundle";
import { gpsOfUnix } from "@/model/gnss";
import {
  previewOwnerKey, samePreviewRun, type PreviewBookmark, type PreviewFrame, type PreviewLane,
  type PreviewOwner, type PreviewPin, type PreviewPinReference, type PreviewRunIdentity, type PreviewSource, type PreviewTimeIntent,
  type PreviewWindow, type SignalSelection,
} from "@/model/preview";
import type { Track } from "@/model/trajectory";
import { immutableCopy } from "@/model/version";
import { pinReference, restorePin } from "./bookmark";

export type PreviewInput = {
  scope: string;
  nowMs?: number;
  source?: PreviewSource | null;
  track?: Track | null;
  window?: PreviewWindow | null;
  durationMs?: number;
  lanes?: PreviewLane[];
  nowGpsMs?: number | null;
  note?: PreviewFrame["note"];
  liveRun?: PreviewRunIdentity | null;
  followEpochMs?: number | null;
  live?: boolean;
  canFollow?: boolean;
  canCommand?: boolean;
  registrationId?: string;
};
type Pin = { reference: PreviewPinReference } & (
  | { kind: "idle" }
  | { kind: "loading"; request: AbortController }
  | { kind: "ready"; value: PreviewPin }
  | { kind: "failed"; error: string }
);

export class PreviewSession {
  private time: PreviewTimeIntent;
  private selection: SignalSelection | null = null;
  private pin: Pin | null = null;
  private input: (() => PreviewInput) | null = null;
  private adjustment: string | null = null;
  private sample: { scope: string; epochMs: number; atMs: number } | null = null;
  private revision = 0;
  private readonly listeners = new Set<() => void>();

  constructor(readonly owner: PreviewOwner, private readonly fallback?: () => PreviewInput, epochMs = 0) {
    this.time = owner.kind === "host" ? { kind: "follow", hostKey: owner.key } : { kind: "manual", epochMs };
  }

  version = (): number => this.revision;
  get = (): PreviewFrame => this.resolve(this.read());
  pinnedRun = (): PreviewRunIdentity | null => this.pin?.reference.source.identity.kind === "run" ? this.pin.reference.source.identity.run : null;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  connect(read: () => PreviewInput): () => void {
    this.input = read;
    this.refresh();
    return () => {
      this.input = null;
      if (this.pin !== null) {
        if (this.pin.kind === "loading") this.pin.request.abort();
        this.pin = { kind: "idle", reference: this.pin.reference };
      }
      this.sample = null;
    };
  }

  refresh(): void {
    const input = this.read();
    const frame = this.resolve(input);
    const scope = JSON.stringify([frame.source?.digest, frame.source?.run, frame.source?.commands, frame.following, input.live]);
    const nowMs = input.nowMs ?? 0;
    if (this.sample === null || !frame.following || !input.live || this.sample.scope !== scope || nowMs - this.sample.atMs >= 1000) {
      this.sample = { scope, epochMs: frame.epochMs, atMs: nowMs };
    }
    if (this.time.kind === "manual" && this.time.epochMs !== frame.epochMs) {
      this.time = { kind: "manual", epochMs: frame.epochMs };
      this.adjustment = "Inspection time moved into the updated preview window.";
      this.publish();
    }
    if (this.owner.kind === "host" && this.time.kind === "manual" && this.pin === null && frame.source?.identity.kind === "run") {
      this.capture(frame);
      this.publish();
    }
    this.hydrate();
  }

  seek = (epochMs: number): void => {
    if (!Number.isFinite(epochMs)) return;
    const frame = this.get();
    if (this.owner.kind === "host" && frame.source?.identity.kind === "run") this.capture(frame);
    this.time = { kind: "manual", epochMs: Math.max(0, Math.round(epochMs)) };
    this.adjustment = null;
    this.publish();
  };

  follow = (enabled: boolean): void => {
    if (this.owner.kind !== "host") return;
    if (!enabled) { this.seek(this.get().epochMs); return; }
    this.time = { kind: "follow", hostKey: this.owner.key };
    if (this.pin?.kind === "loading") this.pin.request.abort();
    this.pin = null;
    this.adjustment = null;
    this.publish();
  };

  select = (selection: SignalSelection | null): void => {
    this.selection = selection;
    this.publish();
  };
  bookmark = (): PreviewBookmark => immutableCopy({ time: this.time, selection: this.selection, pin: this.pin?.reference ?? null });

  restore = (bookmark: PreviewBookmark): void => {
    if (bookmark.time.kind === "follow" && (this.owner.kind !== "host" || bookmark.time.hostKey !== this.owner.key)) return;
    const run = bookmark.pin?.source.identity.kind === "run" ? bookmark.pin.source.identity.run : null;
    const registrationId = this.read().registrationId;
    if (run !== null && (this.owner.kind !== "host" || run.hostKey !== this.owner.key || registrationId !== undefined && run.registrationId !== registrationId)) return;
    if (this.pin?.kind === "loading") this.pin.request.abort();
    this.time = { ...bookmark.time };
    this.selection = immutableCopy(bookmark.selection);
    this.pin = bookmark.pin === null ? null : { kind: "idle", reference: immutableCopy(bookmark.pin) };
    this.adjustment = null;
    this.publish();
    this.hydrate();
  };

  private read(): PreviewInput { return this.input?.() ?? this.fallback?.() ?? { scope: previewOwnerKey(this.owner) }; }
  private capture(frame: PreviewFrame): void {
    if (frame.source === null) return;
    if (this.pin?.kind === "loading") this.pin.request.abort();
    const value = { source: frame.source, lane: frame.lanes[0] ?? null };
    this.pin = { kind: "ready", reference: pinReference(value), value };
  }
  private hydrate(): void {
    if (this.input === null || this.pin?.kind !== "idle") return;
    const request = new AbortController();
    const pending: Pin = { kind: "loading", reference: this.pin.reference, request };
    this.pin = pending;
    const finish = (pin: Pin) => {
      if (request.signal.aborted || this.pin !== pending) return;
      this.pin = pin;
      this.publish();
    };
    void restorePin(pending.reference, request.signal).then(
      (value) => finish({ kind: "ready", reference: pending.reference, value }),
      (error: unknown) => finish({ kind: "failed", reference: pending.reference, error: error instanceof Error ? error.message : String(error) }),
    );
  }
  private publish(): void {
    this.revision++;
    for (const listener of this.listeners) listener();
  }

  resolve(input: PreviewInput): PreviewFrame {
    let source = input.source ?? null;
    const track = input.track ?? null;
    let window = input.window ?? null;
    let lanes: readonly PreviewLane[] = input.lanes ?? [];
    let note = input.note ?? null;
    let nowGpsMs = input.nowGpsMs ?? null;
    let range = source?.range;
    const currentRun = source?.identity.kind === "run" ? source.identity.run : null;
    if (this.owner.kind === "host" && this.time.kind === "manual" && this.pin !== null) {
      const { reference } = this.pin;
      const error = this.pin.kind === "failed" ? this.pin.error : null;
      const pinnedRun = this.pinnedRun();
      const matching = currentRun !== null && pinnedRun !== null && samePreviewRun(currentRun, pinnedRun);
      source = (this.pin.kind === "ready" ? this.pin.value.source : null) ?? (matching && source !== null ? { ...reference.source, bundle: source.bundle } : null);
      window = { ...reference.source.summary.window, leap: packedLeap(reference.source.summary.window) };
      range = reference.source.range;
      lanes = reference.lane === null ? [] : [reference.lane];
      nowGpsMs = reference.lane?.replay === true ? null : gpsOfUnix(input.nowMs ?? 0, window.leap);
      note = source === null ? { level: error === null ? "warning" : "error", message: error ?? "Loading pinned run snapshot…" }
        : !matching ? { level: "warning", message: `Pinned run ${pinnedRun?.sequence ?? ""} snapshot. Follow the host for its current run.` } : note;
    }
    const run = source?.identity.kind === "run" ? source.identity.run : null;
    const matchingLiveRun = run !== null && input.liveRun != null && samePreviewRun(run, input.liveRun);
    const following = this.time.kind === "follow" && matchingLiveRun && input.followEpochMs != null;
    const requested = this.time.kind === "manual" ? this.time.epochMs : input.followEpochMs ?? 0;
    const first = range?.first ?? 0;
    const last = range === undefined ? window?.durationMs ?? input.durationMs ?? Number.POSITIVE_INFINITY : Math.max(first, range.end - 1);
    const epochMs = Math.max(first, Math.min(last, Math.round(requested)));
    const sampleScope = JSON.stringify([source?.digest, source?.run, source?.commands, following, input.live]);
    const nowMs = input.nowMs ?? 0;
    const sampleEpochMs = this.sample !== null && following && input.live && this.sample.scope === sampleScope && nowMs - this.sample.atMs < 1000
      ? this.sample.epochMs : epochMs;
    return {
      owner: this.owner, ownerKey: previewOwnerKey(this.owner), source, track: this.pin !== null && source === null ? null : track, window, epochMs,
      sampleEpochMs, following, live: following && input.live === true, lanes, nowGpsMs,
      scope: input.scope, note, selection: this.selection, adjustment: this.adjustment,
      capabilities: { seek: window !== null || input.durationMs !== undefined, follow: input.canFollow === true, inspect: source !== null, command: input.canCommand === true && matchingLiveRun },
    };
  }
}
