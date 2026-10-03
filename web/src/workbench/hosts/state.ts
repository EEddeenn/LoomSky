import { createStore } from "@/core";
import { gpsOfUnix } from "@/model/gnss";
import type { Window } from "@/model/bundle";
import { isLive, snapshotWindow, statusLeap, type HostRegistrationRecord, type PendingSubmissionRecord, type Snapshot, type StopIntentRecord, type SubmissionRecord, type SubmissionSource } from "@/model/host";

type Activity = "onair" | "armed" | "unknown" | "off";
type Link = "ok" | "noanswer" | "token" | "origin" | "http" | "none";

export type Pending = {
  record: PendingSubmissionRecord;
  writes: Promise<void>;
  busy: boolean;
  nextAt: number;
  phase: "active" | "retiring";
  replyPending: boolean;
  acceptedSaved: boolean;
  accepting: Promise<void> | null;
};

type Upload = { share: number; source: SubmissionSource; cancel: AbortController };
type HostSource = { key: string; record: SubmissionRecord | null; error: string | null };
type Alarm = {
  kind: "failed" | "restarted";
  run: number;
  reason: string;
  message: string;
  lastGps: number | null;
  key: string;
};
export type Stop = StopIntentRecord & { queued: boolean; busy: boolean; nextAt: number; saving: Promise<void>; persisted: boolean; retiring: boolean };
type Fault = { epoch: number; kind: string };

export type Host = {
  key: string;
  record: HostRegistrationRecord;
  savedObservationAt: number | null;
  savingObservation: boolean;
  observationError: string | null;

  snapshot: Snapshot | null;
  link: Link;
  lastOkAt: number | null;
  offsetMs: number | null;

  upload: Upload | null;
  pendings: Map<string, Pending>;
  readonly pending: Pending | null;
  recovery: "loading" | "ready" | "failed";
  alarm: Alarm | null;
  stops: Stop[];
  readonly stop: Stop | null;
  acked: Set<string>;
  faults: Fault[];
  faultRun: string;

  source: HostSource | null;
  seenActivity: Activity | null;
};

const unknownAfterMs = 3000;
const stopConfirmMs = 5000;

export function hostFrom(record: HostRegistrationRecord): Host {
  return {
    key: record.address,
    record,
    savedObservationAt: record.seen?.at ?? null,
    savingObservation: false,
    observationError: null,

    snapshot: null,
    link: "none",
    lastOkAt: null,
    offsetMs: null,

    upload: null,
    pendings: new Map(),
    get pending() {
      let latest: Pending | null = null;
      for (const item of this.pendings.values()) {
        if (item.phase === "active" && (latest === null || item.record.operation.sequence > latest.record.operation.sequence
          || item.record.operation.sequence === latest.record.operation.sequence && item.record.at > latest.record.at)) latest = item;
      }
      return latest;
    },
    recovery: "loading",
    alarm: null,
    stops: [],
    get stop() { return this.stops.findLast((stop) => !stop.retiring) ?? null; },
    acked: new Set(),
    faults: [],
    faultRun: "",

    source: null,
    seenActivity: null,
  };
}

export const hosts = createStore<{ list: Host[]; loaded: boolean; loadError: string | null }>({ list: [], loaded: false, loadError: null });

export function changed(): void {
  hosts.set((s) => ({ list: [...s.list] }));
}

export function hostOf(key: string | null | undefined): Host | undefined {
  return hosts.get().list.find((h) => h.key === key);
}

export function nameOf(h: Host): string {
  return h.snapshot?.station.name ?? (h.record.name || h.record.address);
}

function stale(h: Host, now: number): boolean {
  return h.lastOkAt === null || now - h.lastOkAt >= unknownAfterMs;
}

export function activityOf(h: Host, now: number): Activity {
  if (h.recovery !== "ready") return "unknown";
  if (h.pending !== null) {
    const target = h.pending.record.target;
    const live = target !== null && h.snapshot?.boot === target.boot && h.snapshot.run === target.sequence && isLive(h.snapshot.status);
    if (!live && (h.pending.record.cancelAt !== null || h.upload === null)) return "unknown";
    if (!live && h.upload !== null) return stale(h, now) ? "unknown" : "armed";
  }
  if (h.upload !== null) return stale(h, now) ? "unknown" : "armed";
  if (h.snapshot?.operation?.state === "uploading") return stale(h, now) ? "unknown" : "armed";
  const liveSeen = h.snapshot !== null ? isLive(h.snapshot.status) : (h.record.seen?.live ?? false);
  if (liveSeen) {
    if (h.snapshot === null || stale(h, now)) return "unknown";
    return h.snapshot.status?.state === "on_air" ? "onair" : "armed";
  }
  return "off";
}

export function canStop(h: Host, now: number): boolean {
  return activityOf(h, now) !== "off";
}

type Readiness = Exclude<Activity, "off"> | "ready" | "missing" | "alarm" | "connection" | "device";

export function readinessOf(h: Host, now: number): Readiness {
  if (hostOf(h.key) !== h || h.snapshot === null) return "missing";
  const activity = activityOf(h, now);
  if (activity !== "off") return activity;
  if (h.alarm !== null) return "alarm";
  if (h.link !== "ok" || stale(h, now)) return "connection";
  if (h.snapshot.device !== "ready") return "device";
  return "ready";
}

export function readyForTransmission(h: Host, now: number): h is Host & { snapshot: Snapshot } {
  return readinessOf(h, now) === "ready";
}

export function onAirSeen(h: Host): boolean {
  return (h.snapshot?.status?.state ?? (h.record.seen?.sentGps != null ? "on_air" : "waiting")) === "on_air";
}

export function currentWindow(h: Host): Pick<Window, "startGpsMs" | "durationMs"> | null {
  if (h.snapshot !== null) return snapshotWindow(h.record.address, h.snapshot, h.source?.record ?? null);
  const seen = h.record.seen;
  return seen !== null && seen.startGps !== null && seen.endGps !== null ? { startGpsMs: seen.startGps, durationMs: seen.endGps - seen.startGps } : null;
}

export function currentSentEpoch(h: Host, now: number): number | null {
  const s = h.snapshot?.status ?? null;
  if (s === null || s.sent === null) {
    const seen = h.record.seen;
    return h.snapshot === null && seen !== null && seen.sentGps !== null && seen.startGps !== null ? seen.sentGps - seen.startGps : null;
  }
  if (s.state !== "on_air" || h.link !== "ok" || h.lastOkAt === null || stale(h, now)) return s.sent;
  return Math.min((s.plan?.epochs ?? Number.POSITIVE_INFINITY) - 1, s.sent + Math.max(0, now - h.lastOkAt));
}

export function hostNow(h: Host, now: number): number {
  return now + (h.offsetMs ?? 0);
}

export function rfBound(h: Host): number | null {
  if (h.pending !== null && h.pending.record.target === null) return null;
  const w = currentWindow(h);
  if (w === null) return null;
  const replay = h.snapshot !== null ? (h.snapshot.status?.config.replay_ms ?? null) !== null : (h.record.seen?.replay ?? false);
  if (!replay) return w.startGpsMs + w.durationMs;
  const last = h.lastOkAt ?? h.record.seen?.at ?? Date.now();
  return gpsOfUnix(last, statusLeap(h.snapshot?.status)) + (w.durationMs - (currentSentEpoch(h, last) ?? 0));
}

export function stopUnconfirmed(h: Host, now: number): boolean {
  const at = h.pending?.record.cancelAt ?? h.stop?.at;
  return at !== undefined && now - at > stopConfirmMs && canStop(h, now);
}

export function stopTargets(now: number): Host[] {
  return hosts.get().list.filter((h) => canStop(h, now));
}
