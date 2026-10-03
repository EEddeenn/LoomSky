import type { WriteChange } from "@/model/document";
import type { Path, Schema } from "@/model/schema";

export function collectionItemPath(path: Path, current: unknown, index: number): Path {
  return Array.isArray(current) ? [...path, index] : path;
}

export function appendCollectionItem(path: Path, current: unknown, raw: string | undefined, item: unknown): WriteChange[] {
  if (current === undefined) return [{ path, value: [item] }];
  if (Array.isArray(current)) return [{ path: [...path, current.length], value: item, insert: true }];
  const source = typeof current === "string" ? JSON.stringify(current) : raw ?? JSON.stringify(current);
  return [{ path, json: `[${source},${JSON.stringify(item)}]` }];
}

export function removeCollectionItem(path: Path, current: unknown, index: number, omitEmpty = true): WriteChange[] {
  return [{ path: Array.isArray(current) && (current.length > 1 || !omitEmpty) ? [...path, index] : path, value: undefined }];
}

export type PublicationRules = NonNullable<Schema["x-publication"]>;

export function timeChanges(path: Path, value: Record<string, unknown>): WriteChange[] {
  return ["type", "year", "month", "day", "hour", "minute", "second", "week", "leapYear"].map((key) => ({ path: [...path, key], value: value[key] }));
}

const horizontalKeys = ["reference", "satellites", "pConst", "pSat", "ura", "ure", "bNom", "tValidity"] as const;

export function inavServiceChanges(path: Path, current: Record<string, unknown>, service: string, reference: Record<string, string | number> | undefined): WriteChange[] {
  const changes: WriteChange[] = [{ path: [...path, "service"], value: service }];
  if (service === "test") {
    if (!("testMessage" in current)) changes.push({ path: [...path, "testMessage"], value: "" });
    for (const key of horizontalKeys) if (key in current) changes.push({ path: [...path, key], value: undefined });
  } else {
    if ("testMessage" in current) changes.push({ path: [...path, "testMessage"], value: undefined });
    for (const key of horizontalKeys) {
      if (service === "horizontal") {
        const value = key === "reference" ? reference : key === "satellites" ? [] : undefined;
        if (!(key in current) && value !== undefined) changes.push({ path: [...path, key], value });
      } else if (key in current) changes.push({ path: [...path, key], value: undefined });
    }
  }
  return changes;
}
