import { age, mmss, typed } from "@/core";
import { gpsOfUnix, type Leap } from "@/model/gnss";
import type { Window } from "@/model/bundle";
import { snapshotRunTruth, snapshotSubmission, statusLeap, type CommandLine, type SubmissionSource } from "@/model/host";
import { activityOf, currentSentEpoch, currentWindow, hostNow, hosts, readinessOf, type Host } from "./state";

export type HostClass = "onair" | "armed" | "unknown" | "alarm" | "off";

export const mayAir = (c: HostClass) => c === "onair" || c === "armed" || c === "unknown";

function refusalOf(h: Host) {
  const snapshot = h.snapshot;
  const status = snapshot?.status;
  if (snapshot === null || status?.state !== "ended" || !("refused" in status.outcome)) return null;
  const key = `${snapshot.boot}|${snapshot.run}`;
  if (h.acked.has(key)) return null;
  return {
    key, ...status.outcome.refused, label: status.config.label || `run ${snapshot.run}`,
    source: snapshotSubmission(h.record.address, snapshot, h.source?.record ?? null)?.source ?? null,
  };
}

export function hostView(h: Host, now: number) {
  const snapshot = h.snapshot;
  const status = snapshot?.status ?? null;
  const submission = snapshot === null ? null : snapshotSubmission(h.record.address, snapshot, h.source?.record ?? null);
  const activity = activityOf(h, now);
  const cls: HostClass = activity === "off" && h.alarm !== null ? "alarm" : activity;
  const window = currentWindow(h);
  const sentEpoch = currentSentEpoch(h, now);
  const leap = statusLeap(status);
  const target = h.pending?.record.target;
  const pending = h.pending !== null && (target == null || snapshot?.boot !== target.boot || snapshot.run !== target.sequence);
  const epoch = pending || snapshot?.operation?.state === "uploading" ? null
    : activity === "armed" && window !== null && sentEpoch === null
      ? status?.config.replay_ms ?? Math.max(0, gpsOfUnix(hostNow(h, now), leap) - window.startGpsMs)
      : sentEpoch;
  return {
    snapshot, status, submission, window, sentEpoch, epoch, leap, cls,
    truth: snapshot === null || submission === null ? null : snapshotRunTruth(h.record.address, snapshot, submission),
    chip: chipText(h, now, cls, window, sentEpoch, leap),
    transmissionIssue: transmissionIssue(h, now),
    sourceError: h.source?.error ?? null,
    refusal: refusalOf(h),
  };
}

export function airingHosts(scenario: string, now: number): Host[] {
  return hosts.get().list.filter((h) => {
    const view = hostView(h, now);
    return view.submission?.source.scenarioId === scenario && (mayAir(view.cls) || view.cls === "alarm");
  });
}

export function classCounts(now: number): Record<HostClass, number> {
  const counts: Record<HostClass, number> = { onair: 0, armed: 0, unknown: 0, alarm: 0, off: 0 };
  for (const h of hosts.get().list) counts[hostView(h, now).cls]++;
  return counts;
}

export function stopText(h: Host): string {
  if (h.pending?.record.cancelAt != null) return "Stop pending for this submission";
  const stop = h.stop;
  if (stop === null) return "";
  const target = stop.target;
  return target === null ? "Stop pending · restoring run ID" : `Stop ${stop.queued ? "queued" : "sent"} for ${target.kind === "run" ? "run" : "upload"} ${target.id.sequence}`;
}

type OffKind = "token" | "origin" | "noanswer" | "refused" | "idle" | "completed" | "stopped";

const offGlyphs = { token: "key", origin: "offline", noanswer: "offline", refused: "warn", idle: "idle", completed: "done", stopped: "stopped" } as const satisfies Record<OffKind, string>;

export function offGlyph(h: Host): (typeof offGlyphs)[OffKind] {
  return offGlyphs[offWord(h).kind];
}

export function offWord(h: Host): { kind: OffKind; word: string } {
  if (h.link === "token") return { kind: "token", word: "token refused" };
  if (h.link === "origin") return { kind: "origin", word: "origin not listed" };
  if (h.link === "noanswer" || h.link === "http") return { kind: "noanswer", word: "no answer" };
  if (refusalOf(h) !== null) return { kind: "refused", word: "Refused" };
  const s = h.snapshot?.status;
  if (s?.state === "ended" && "completed" in s.outcome) return { kind: "completed", word: "completed" };
  if (s?.state === "ended" && "stopped" in s.outcome) return { kind: "stopped", word: "stopped" };
  const radio = radioWord(h);
  return { kind: "idle", word: radio === "radio ready" ? "idle" : radio };
}

export function radioWord(h: Host): string {
  if (h.snapshot === null) return "radio status unknown";
  switch (h.snapshot.device) {
    case "opening": return "opening";
    case "ready": return "radio ready";
    case "absent":
    case "failed": return "no radio";
  }
}

export function armedWord(h: Host): "Uploading" | "Starting" | "Recovering" | "Waiting" {
  if (h.upload !== null || h.snapshot?.operation?.state === "uploading") return "Uploading";
  const status = h.snapshot?.status;
  return status?.state === "starting" ? status.first === null ? "Starting" : "Recovering" : "Waiting";
}

export function ageText(h: Host, now: number): string {
  return age(now - (h.lastOkAt ?? h.record.seen?.at ?? now));
}

type ChipText = { cls: HostClass; word: string; figure: string; lead: string; tail: string };

function chipText(h: Host, now: number, cls: HostClass, w: Pick<Window, "startGpsMs" | "durationMs"> | null, sent: number | null, leap: Leap): ChipText {
  const stop = h.pending?.record.cancelAt != null ? "Stop pending" : h.stop === null ? null : h.stop.queued ? "Stop queued" : `Stop sent ${age(now - h.stop.at)}`;
  if (cls === "onair") return { cls, word: "On air", figure: stop ?? mmss((w?.durationMs ?? 0) - (sent ?? 0)), lead: "", tail: stop === null ? " left" : "" };
  if (cls === "armed") {
    const waiting = h.upload === null && h.snapshot?.status?.state === "waiting" && w !== null;
    const figure = stop ?? (h.upload !== null ? `${Math.floor(h.upload.share * 100)} %` : waiting ? mmss(w.startGpsMs - gpsOfUnix(hostNow(h, now), leap)) : "");
    return { cls, word: armedWord(h), figure, lead: waiting && stop === null ? "in " : "", tail: "" };
  }
  if (cls === "unknown") return { cls, word: "Unknown", figure: stop ?? ageText(h, now), lead: "", tail: "" };
  if (cls === "alarm") return { cls, word: h.alarm?.kind === "restarted" ? "Restarted" : "Failed", figure: "", lead: "", tail: "" };
  return { cls, word: offWord(h).word, figure: "", lead: "", tail: "" };
}

export function chipLabel(name: string, t: ChipText): string {
  return [name, t.word, `${t.lead}${t.figure}${t.tail}`.trim()].filter((part) => part !== "").join(", ");
}

export function sourceWords(source: SubmissionSource): string {
  return `${source.scenarioId} v${source.versionNumber}`;
}

export function commandWords(c: CommandLine, inText = false): string {
  if ("noise_floor_dbm_hz" in c) return `${inText ? "noise floor" : "Noise floor"} → ${typed(c.noise_floor_dbm_hz)} dBm/Hz`;
  if ("elevation_mask_deg" in c) return `${inText ? "elevation mask" : "Elevation mask"} → ${typed(c.elevation_mask_deg)}°`;
  const p = c.power;
  const level = p.dbhz !== undefined ? `${typed(p.dbhz)} dB-Hz` : p.dbm !== undefined ? `${typed(p.dbm)} dBm` : p.dbw !== undefined ? `${typed(p.dbw)} dBW` : "scenario level";
  return `${p.system} ${p.svid === 0 ? "all" : p.svid} → ${level}`;
}

export function uncertainty(h: Host): string | null {
  if (h.recovery === "loading") return "Loading saved submissions";
  if (h.recovery === "failed") return "Saved submissions unavailable";
  if (h.pending !== null && h.pending.record.target === null) return h.pending.record.cancelAt === null ? "Submission acceptance unconfirmed" : "Cancellation unconfirmed";
  return null;
}

function transmissionIssue(h: Host, now: number): string {
  switch (readinessOf(h, now)) {
    case "ready": return "";
    case "missing": return "radio status unknown";
    case "onair": return "on air";
    case "armed": return h.upload !== null || h.snapshot?.operation?.state === "uploading" ? "uploading" : "armed";
    case "unknown": return uncertainty(h) ?? "unknown";
    case "alarm": return h.alarm?.kind === "restarted" ? "restarted" : "failed";
    case "connection": return offWord(h).word;
    case "device": return `device ${h.snapshot?.device}`;
  }
}
