import { packedLeap } from "@/model/bundle";
import { bands, gpsOfUnix } from "@/model/gnss";
import type { Snapshot } from "@/model/host";
import type { SavedScenarioBuild } from "@/workbench/documents/scenario/builds";

import { hostNow, readyForTransmission, hostView, type Host } from "@/workbench/hosts";
import type { TransmissionConfig } from "@/workbench/hosts/actions";

export type ResolvedConfiguration =
  | { kind: "ready"; host: Host; snapshot: Snapshot; config: TransmissionConfig }
  | { kind: "blocked"; issue: string };

export function parseReplayOffset(text: string): number | null {
  const match = /^\+?(\d+):(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?$/.exec(text.trim());
  if (match === null) return null;
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  if (minutes >= 60 || seconds >= 60) return null;
  const ms = (Number(match[1]) * 3600 + minutes * 60 + seconds) * 1000 + Number((match[4] ?? "").padEnd(3, "0"));
  return Number.isSafeInteger(ms) ? ms : null;
}

function sampleIssue(snapshot: Snapshot, source: SavedScenarioBuild): string {
  const samples = source.summary.samples;
  if (samples === null) return "no sample output";
  if (samples.format !== "IQ16") return `requires IQ16; bundle is ${samples.format}`;
  const low = samples.centerHz - samples.sampleRateHz / 2;
  const high = samples.centerHz + samples.sampleRateHz / 2;
  return snapshot.station.bands_hz.some(([from, until]) => from <= low && high <= until) ? "" : `outside ${bands(snapshot.station.bands_hz)}`;
}

export function sourceIssue(host: Host, source: SavedScenarioBuild, now: number): string {
  return readyForTransmission(host, now) ? sampleIssue(host.snapshot, source) : hostView(host, now).transmissionIssue;
}

export function gainIsInvalid(host: Host | undefined, gainDb: number): boolean {
  return !Number.isFinite(gainDb) || host?.snapshot != null && gainDb > host.snapshot.station.max_gain_db;
}

export function liveWindowIssue(host: Host, source: SavedScenarioBuild, config: TransmissionConfig, now: number): string {
  return config.replayMs === null && gpsOfUnix(hostNow(host, now), packedLeap(source.window)) >= source.window.startGpsMs + source.window.durationMs
    ? "Live window ended. Review in Replay mode." : "";
}

export function resolveConfiguration(host: Host | undefined, source: SavedScenarioBuild, config: TransmissionConfig, now: number): ResolvedConfiguration {
  if (host === undefined) return { kind: "blocked", issue: "Choose a radio host." };
  if (!readyForTransmission(host, now)) return { kind: "blocked", issue: `Cannot transmit: ${hostView(host, now).transmissionIssue}.` };
  const reason = sampleIssue(host.snapshot, source);
  if (reason !== "") return { kind: "blocked", issue: `Cannot transmit: ${reason}.` };
  if (gainIsInvalid(host, config.gainDb)) {
    return { kind: "blocked", issue: `Enter a valid gain ≤ ${host.snapshot.station.max_gain_db} dB.` };
  }
  if (config.replayMs !== null && (!Number.isSafeInteger(config.replayMs) || config.replayMs < 0 || config.replayMs >= source.window.durationMs)) {
    return { kind: "blocked", issue: "Replay offset is outside the scenario window." };
  }
  const issue = liveWindowIssue(host, source, config, now);
  return issue === "" ? { kind: "ready", host, snapshot: host.snapshot, config } : { kind: "blocked", issue };
}
