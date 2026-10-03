import { isRecord } from "@/core";
import { isSignal, isSystem, presentLeap, type Leap, type Signal, type System } from "@/model/gnss";
import type { ObsCommand } from "@/model/observation";
import { isActionId, isCommandApplied, isCommandLine, type CommandRecord } from "./command";
import { isOperationId, isRunId, type OperationId, type RunId } from "./identity";

type Reference = "none" | "external" | "gpsdo";
type DeviceState = "opening" | "ready" | "absent" | "failed";
type Failure = { reason: string; message: string };
type Outcome = { completed: Record<string, never> } | { stopped: Record<string, never> } | { refused: Failure } | { failed: Failure };

type Operation = { id: OperationId } & (
  | { state: "accepted"; target: RunId }
  | { state: "uploading" | "cancelled" | "rejected"; target: null }
);

type Plan = {
  rate_hz: number;
  centre_hz: number;
  gain_db: number;
  start_gps_ms: number;
  start_gps_sub_ms: number;
  epochs: number;
  leap_seconds: number;
  leap_change_gps_ms: number | null;
  leap_seconds_after: number;
};

export type Status = {
  config: { gain_db: number; replay_ms: number | null; label: string | null };
  plan: Plan | null;
  first: number | null;
  sent: number | null;
  counts: { underflow: number; late: number; sequence: number; short: number; clipped: number };
  channels: { system: System; svid: number; signal: Signal }[];
  commands: CommandRecord[];
} & (
  | { state: "ended"; outcome: Outcome }
  | { state: "starting" | "waiting" | "on_air"; outcome: null }
);

type Station = { name: string; bands_hz: [number, number][]; max_gain_db: number; reference: Reference };

export type Snapshot = { boot: string; run: number; operation: Operation | null; device: DeviceState; now_ms: number; station: Station; status: Status | null };

function isOperation(value: unknown): value is Operation {
  return (
    isRecord(value) &&
    isOperationId(value.id) &&
    (value.state === "uploading" || value.state === "accepted" || value.state === "cancelled" || value.state === "rejected") &&
    (value.target === null || isRunId(value.target)) &&
    (value.state === "accepted" ? value.target !== null : value.target === null)
  );
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isCount(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

function isOutcome(value: unknown): value is Outcome {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  if ("completed" in value) return isRecord(value.completed) && Object.keys(value.completed).length === 0;
  if ("stopped" in value) return isRecord(value.stopped) && Object.keys(value.stopped).length === 0;
  const failure = "refused" in value ? value.refused : value.failed;
  return isRecord(failure) && typeof failure.reason === "string" && typeof failure.message === "string";
}

function isPlan(value: unknown): value is Plan {
  return (
    isRecord(value) &&
    isNumber(value.rate_hz) &&
    isNumber(value.centre_hz) &&
    isNumber(value.gain_db) &&
    isInteger(value.start_gps_ms) &&
    isNumber(value.start_gps_sub_ms) && value.start_gps_sub_ms >= 0 && value.start_gps_sub_ms < 1 &&
    isCount(value.epochs) &&
    isInteger(value.leap_seconds) &&
    (value.leap_change_gps_ms === null || isInteger(value.leap_change_gps_ms)) &&
    isInteger(value.leap_seconds_after)
  );
}

function isStatus(value: unknown): value is Status {
  if (!isRecord(value)) return false;
  if (value.state !== "starting" && value.state !== "waiting" && value.state !== "on_air" && value.state !== "ended") return false;
  if (value.state === "ended" ? !isOutcome(value.outcome) : value.outcome !== null) return false;

  const config = value.config;
  if (
    !isRecord(config) || !isNumber(config.gain_db) ||
    !(config.replay_ms === null || isCount(config.replay_ms)) ||
    !(config.label === null || typeof config.label === "string")
  ) return false;
  if (value.plan !== null && !isPlan(value.plan)) return false;
  if (!(value.first === null || isCount(value.first)) || !(value.sent === null || isCount(value.sent))) return false;

  const counts = value.counts;
  if (
    !isRecord(counts) ||
    !isCount(counts.underflow) || !isCount(counts.late) || !isCount(counts.sequence) ||
    !isCount(counts.short) || !isCount(counts.clipped)
  ) return false;

  if (!Array.isArray(value.channels) || !value.channels.every((channel: unknown) =>
    isRecord(channel) && isSystem(channel.system) &&
    isCount(channel.svid) && channel.svid <= 0xffffffff && isSignal(channel.signal)
  )) return false;
  return Array.isArray(value.commands) && value.commands.every((entry: unknown) => isRecord(entry)
    && isActionId(entry.actionId) && isCommandLine(entry.command) && isCommandApplied(entry.applied));
}

function isStation(value: unknown): value is Station {
  return (
    isRecord(value) &&
    typeof value.name === "string" &&
    Array.isArray(value.bands_hz) && value.bands_hz.every((band: unknown) =>
      Array.isArray(band) && band.length === 2 &&
      isNumber(band[0]) && isNumber(band[1]) && band[0] < band[1]
    ) &&
    isNumber(value.max_gain_db) &&
    (value.reference === "none" || value.reference === "external" || value.reference === "gpsdo")
  );
}

export function isSnapshot(value: unknown): value is Snapshot {
  return (
    isRecord(value) &&
    typeof value.boot === "string" && /^[0-9a-f]{16}$/.test(value.boot) &&
    typeof value.run === "number" && Number.isSafeInteger(value.run) && value.run >= 0 &&
    (value.operation === null || isOperation(value.operation)) &&
    (value.device === "opening" || value.device === "ready" || value.device === "absent" || value.device === "failed") &&
    isInteger(value.now_ms) &&
    isStation(value.station) &&
    (value.status === null || isStatus(value.status))
  );
}

export function obsCommands(status: Status | null): ObsCommand[] {
  return (status?.commands ?? []).flatMap((entry): ObsCommand[] => {
    if (entry.applied === null || !("epoch" in entry.applied)) return [];
    const { epoch } = entry.applied;
    const command = entry.command;
    if ("noise_floor_dbm_hz" in command) return [{ epoch, kind: "noise_floor_dbm_hz", value: command.noise_floor_dbm_hz }];
    if ("elevation_mask_deg" in command) return [{ epoch, kind: "elevation_mask", value: command.elevation_mask_deg }];
    const power = command.power;
    let level: Extract<ObsCommand, { kind: "signal_power" }>["level"] = null;
    if (power.dbhz !== undefined) level = { unit: "dbhz", value: power.dbhz };
    else if (power.dbm !== undefined) level = { unit: "dbm", value: power.dbm };
    else if (power.dbw !== undefined) level = { unit: "dbw", value: power.dbw };
    return [{ epoch, kind: "signal_power", system: power.system, svid: power.svid, level }];
  });
}

export function isLive(status: Status | null | undefined): boolean {
  return status !== null && status !== undefined && status.state !== "ended";
}

export function statusLeap(status: Status | null | undefined): Leap {
  const plan = status?.plan;
  return plan == null ? presentLeap : { seconds: plan.leap_seconds, change: plan.leap_change_gps_ms, after: plan.leap_seconds_after };
}
