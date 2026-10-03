import { isRecord } from "@/core";
import { isSystem, type System } from "@/model/gnss";
import { isRunId, type RunId } from "./identity";

type PowerLevel =
  | { dbhz: number; dbm?: never; dbw?: never }
  | { dbhz?: never; dbm: number; dbw?: never }
  | { dbhz?: never; dbm?: never; dbw: number }
  | { dbhz?: never; dbm?: never; dbw?: never };
export type CommandLine =
  | { power: { system: System; svid: number } & PowerLevel }
  | { noise_floor_dbm_hz: number }
  | { elevation_mask_deg: number };
export type LevelUnit = "dbhz" | "dbm" | "dbw" | "scenario";
export type CommandApplied = { epoch: number } | { rejected: string } | { discarded: "completed" | "stopped" | "refused" | "failed" } | null;
export type CommandRecord = { actionId: string; command: CommandLine; applied: CommandApplied };
export type CommandReceipt = CommandRecord & {
  target: RunId;
  state: "accepted" | "applied" | "rejected" | "discarded";
};
export type CommandDraft = {
  kind: "power" | "noise" | "mask";
  system: System;
  svid: string;
  value: string;
  unit: LevelUnit;
  noise: string;
  mask: string;
};

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function isCount(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

export function isCommandLine(value: unknown): value is CommandLine {
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  if ("noise_floor_dbm_hz" in value) return isNumber(value.noise_floor_dbm_hz);
  if ("elevation_mask_deg" in value) return isNumber(value.elevation_mask_deg);
  const power = value.power;
  if (!isRecord(power) || !isSystem(power.system) || !isCount(power.svid) || power.svid > 0xffffffff) return false;
  const units = Object.keys(power).filter((key) => key !== "system" && key !== "svid");
  return units.length <= 1 && units.every((unit) => (unit === "dbhz" || unit === "dbm" || unit === "dbw") && isNumber(power[unit]));
}

export function isActionId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && new TextEncoder().encode(value).length <= 128;
}

export function isCommandApplied(value: unknown): value is CommandApplied {
  if (value === null) return true;
  if (!isRecord(value) || Object.keys(value).length !== 1) return false;
  if ("epoch" in value) return isCount(value.epoch);
  if ("rejected" in value) return typeof value.rejected === "string";
  return value.discarded === "completed" || value.discarded === "stopped" || value.discarded === "refused" || value.discarded === "failed";
}

export function isCommandReceipt(value: unknown): value is CommandReceipt {
  if (!isRecord(value) || !isRunId(value.target) || !isActionId(value.actionId)
    || !isCommandLine(value.command) || !isCommandApplied(value.applied)) return false;
  if (value.state === "accepted") return value.applied === null;
  if (value.applied === null) return false;
  return value.state === "applied" ? "epoch" in value.applied
    : value.state === "rejected" ? "rejected" in value.applied
      : value.state === "discarded" && "discarded" in value.applied;
}

export function sameCommand(left: CommandLine, right: CommandLine): boolean {
  if ("noise_floor_dbm_hz" in left) return "noise_floor_dbm_hz" in right && left.noise_floor_dbm_hz === right.noise_floor_dbm_hz;
  if ("elevation_mask_deg" in left) return "elevation_mask_deg" in right && left.elevation_mask_deg === right.elevation_mask_deg;
  return "power" in right && left.power.system === right.power.system && left.power.svid === right.power.svid
    && left.power.dbhz === right.power.dbhz && left.power.dbm === right.power.dbm && left.power.dbw === right.power.dbw;
}

function commandNumber(text: string): number | null {
  const normalized = text.trim().replace("−", "-");
  if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function commandFromDraft(draft: CommandDraft): CommandLine | null {
  if (draft.kind === "noise") {
    const value = commandNumber(draft.noise);
    return value === null ? null : { noise_floor_dbm_hz: value };
  }
  if (draft.kind === "mask") {
    const value = commandNumber(draft.mask);
    return value === null ? null : { elevation_mask_deg: value };
  }
  const text = draft.svid.trim();
  const svid = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(svid) || svid > 0xffffffff) return null;
  const power = { system: draft.system, svid };
  if (draft.unit === "scenario") return { power };
  const value = commandNumber(draft.value);
  if (value === null) return null;
  if (draft.unit === "dbhz") return { power: { ...power, dbhz: value } };
  if (draft.unit === "dbm") return { power: { ...power, dbm: value } };
  return { power: { ...power, dbw: value } };
}
