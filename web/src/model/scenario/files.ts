import * as jsonc from "jsonc-parser";
import { isRecord, recordOf } from "@/core";
import type { Path } from "@/model/schema";

export const scenarioFileFields = ["ephemeris", "almanac", "antenna", "precise.orbit", "precise.clock"] as const;
export type ScenarioFileField = (typeof scenarioFileFields)[number];
export type ScenarioFileReference = { key: ScenarioFileField | "trajectory"; name: string; path: Path };
export type ScenarioFileSelection = { name: string; digest: string };

export function inputFileName(name: string): string {
  return name.split(/[\\/]/).at(-1) ?? "";
}

export function scenarioFileReferences(value: unknown): ScenarioFileReference[] {
  const root = recordOf(value) ?? {};
  const references: ScenarioFileReference[] = [];
  const add = (value: unknown, key: ScenarioFileReference["key"], path: Path) => {
    if (typeof value === "string") references.push({ key, name: value, path });
  };
  add(root.trajectory, "trajectory", ["trajectory"]);
  for (const key of ["ephemeris", "almanac"] as const) {
    const value = root[key];
    if (Array.isArray(value)) value.forEach((item, index) => {
      if (isRecord(item)) add(item.name, key, [key, index, "name"]);
    });
    else if (isRecord(value)) add(value.name, key, [key, "name"]);
  }
  add(root.antenna, "antenna", ["antenna"]);
  const precise = recordOf(root.precise);
  for (const key of ["orbit", "clock"] as const) {
    const value = precise?.[key];
    if (Array.isArray(value)) value.forEach((item, index) => add(item, `precise.${key}`, ["precise", key, index]));
    else add(value, `precise.${key}`, ["precise", key]);
  }
  return references;
}

export function normalizeScenarioFiles(text: string): string {
  let normalized = text;
  for (const reference of scenarioFileReferences(jsonc.parse(text))) {
    const name = inputFileName(reference.name);
    if (name !== reference.name) normalized = jsonc.applyEdits(normalized, jsonc.modify(normalized, reference.path, name, {}));
  }
  return normalized;
}
