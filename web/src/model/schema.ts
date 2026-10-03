import { recordOf } from "@/core";

export type Schema = {
  description?: string;
  type?: string | string[];
  default?: unknown;
  enum?: unknown[];
  const?: unknown;

  properties?: Record<string, Schema>;
  items?: Schema;
  anyOf?: Schema[];
  oneOf?: Schema[];
  required?: string[];

  minimum?: number;
  maximum?: number;
  exclusiveMinimum?: number;
  exclusiveMaximum?: number;
  multipleOf?: number;
  minItems?: number;
  maxItems?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  allOf?: Schema[];
  not?: Schema;
  additionalProperties?: boolean | Schema;

  "x-unit"?: string;
  "x-unit-key"?: string;
  "x-system"?: Record<string, string>;
  "x-satellite-capacity"?: Record<string, number>;
  "x-coefficients"?: { name: string; unit?: string }[];
  "x-ionosphere-coefficients"?: Record<string, { name: string; unit?: string }[]>;
  "x-publication"?: {
    gps: { configurationCount: number; textLength: number; ismGridMs: number; identifiers: Record<string, { first: number; last: number } | null> };
    inav: { testHexDigits: number; referenceGridMs: number; bankSize: number };
    d2: { gridCount: number; maxSatellites: number };
  };
};

export type Path = (string | number)[];

function objectOf(node: Schema): Schema {
  if (node.properties !== undefined) return node;
  const object = node.anyOf?.find((n) => n.type === "object" || n.properties !== undefined);
  if (object !== undefined) return object;
  return node.anyOf?.find((n) => n.type === "array")?.items ?? node;
}

function branch(node: Schema, value: unknown): Schema {
  const record = recordOf(value) ?? {};
  if (node.oneOf === undefined) return node;
  for (const option of node.oneOf) {
    const props = option.properties ?? {};
    const tag = Object.entries(props).find(([, s]) => s.const !== undefined);
    if (tag === undefined) continue;
    const [key, s] = tag;
    if ((record[key] ?? node.properties?.[key]?.default) === s.const) {
      const properties = { ...node.properties };
      for (const [name, prop] of Object.entries(props)) properties[name] = { ...properties[name], ...prop };
      return {
        ...node,
        properties,
        required: [...new Set([...(node.required ?? []), ...(option.required ?? [])])],
      };
    }
  }
  return node;
}

export function lookup(root: Schema | null, path: Path, value: (path: Path) => unknown): Schema | null {
  if (root === null) return null;
  let node: Schema = root;
  for (const [i, key] of path.entries()) {
    const here = branch(objectOf(node), value(path.slice(0, i)));
    if (typeof key === "number") {
      node = (node.anyOf?.find((n) => n.type === "array") ?? (node.type === "array" ? node : undefined))?.items ?? here;
      continue;
    }
    const next = here.properties?.[key];
    if (next === undefined) return null;
    node = next;
  }
  return branch(node, value(path));
}

export function words(node: Schema | null): string[] {
  const list = node?.enum
    ?? node?.anyOf?.find((n) => n.enum !== undefined)?.enum
    ?? node?.anyOf?.find((n) => n.items?.enum !== undefined)?.items?.enum
    ?? [];
  return list.filter((w) => typeof w === "string");
}

export function systemsOf(node: Schema | null): Record<string, string> {
  return node?.["x-system"] ?? node?.anyOf?.find((n) => n["x-system"] !== undefined)?.["x-system"] ?? {};
}

const unitWords = new Map<string, string>([["deg", "°"], ["m/s^2", "m/s²"], ["m/s^3", "m/s³"], ["dBHz", "dB-Hz"]]);

export function unitOf(node: Schema | null, sibling: (key: string) => unknown, parent: Schema | null): string {
  if (node === null) return "";
  const unit = node["x-unit"];
  if (unit !== undefined) return unitWords.get(unit) ?? unit;
  const key = node["x-unit-key"];
  if (key === undefined) return "";
  const word = sibling(key) ?? parent?.properties?.[key]?.default;
  return typeof word === "string" ? (unitWords.get(word) ?? word) : "";
}

export function defaultText(node: Schema | null): string {
  const d = node?.default;
  if (typeof d === "number") return String(d).replace(/^-/, "−");
  return typeof d === "string" ? d : "";
}
