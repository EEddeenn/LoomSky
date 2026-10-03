import { parse } from "jsonc-parser";
import { isRecord, sha256 } from "@/core";
import type { ResourceKind, ResourceSummary, ResourceSummaryTrajectory, SavedVersion, ScenarioSnapshot, TrajectorySnapshot } from "./types";

export function resourceSummary(kind: ResourceKind, snapshot: ScenarioSnapshot | TrajectorySnapshot, fallbackName = kind === "scenario" ? "Untitled scenario" : "Untitled trajectory", trajectory?: ResourceSummaryTrajectory): ResourceSummary {
  if (kind === "trajectory") return {
    name: (snapshot as TrajectorySnapshot).name || fallbackName,
    description: null,
    fileDigests: [],
    trajectoryId: null,
    trajectoryVersionId: null,
    trajectoryVersionNumber: null,
  };
  const scenario = snapshot as ScenarioSnapshot;
  const value: unknown = parse(scenario.source.text);
  const name = isRecord(value) && typeof value.name === "string" ? value.name : "";
  const description = isRecord(value) && typeof value.description === "string" ? value.description : "";
  const fileDigests = Object.values(scenario.bindings.files);
  const selected = scenario.bindings.trajectory;
  const resolved = selected?.versionId === trajectory?.versionId ? trajectory : undefined;
  if (resolved !== undefined) fileDigests.push(resolved.digest);
  return {
    name: name || fallbackName,
    description: description || null,
    fileDigests: [...new Set(fileDigests)].sort(),
    trajectoryId: resolved?.resourceId ?? null,
    trajectoryVersionId: selected?.versionId ?? null,
    trajectoryVersionNumber: resolved?.versionNumber ?? null,
  };
}

export function savedVersionName(version: SavedVersion): string {
  return resourceSummary(version.kind, version.snapshot).name;
}

export function canonicalContent(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalContent).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().filter((key) => record[key] !== undefined).map((key) => `${JSON.stringify(key)}:${canonicalContent(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function savedSnapshotDigest(kind: ResourceKind, snapshot: ScenarioSnapshot | TrajectorySnapshot): string {
  return sha256(new TextEncoder().encode(canonicalContent({ kind, snapshot })));
}

export function freezeContent<T>(input: T): T {
  if (input === null || typeof input !== "object" || Object.isFrozen(input)) return input;
  for (const item of Object.values(input)) freezeContent(item);
  return Object.freeze(input);
}

export function immutableCopy<T>(input: T): T {
  return freezeContent(structuredClone(input));
}
