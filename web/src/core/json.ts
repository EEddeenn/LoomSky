export type JsonRecord = Record<string, unknown>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function recordOf(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

export function listOf(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value === undefined ? [] : [value];
}

export function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function stringOf(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export function parseRecord(text: string): JsonRecord {
  try {
    const value: unknown = JSON.parse(text);
    return recordOf(value) ?? {};
  } catch {
    return {};
  }
}
