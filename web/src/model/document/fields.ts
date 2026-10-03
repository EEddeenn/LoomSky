import type { FieldReference, TextDocument } from "./types";

function identity(value: unknown): string | null {
  if (value === null || typeof value !== "object" || !("id" in value)) return null;
  return typeof value.id === "string" && value.id !== "" ? value.id : null;
}

export function fieldReference(doc: Pick<TextDocument, "value">, path: readonly (string | number)[]): FieldReference {
  for (let index = 0; index < path.length; index++) {
    if (typeof path[index] !== "number") continue;
    const id = identity(doc.value(path.slice(0, index + 1)));
    if (id !== null) return { kind: "entity", collection: path.slice(0, index), id, field: path.slice(index + 1) };
  }
  return { kind: "path", path: [...path] };
}

export function resolveField(doc: Pick<TextDocument, "value">, ref: FieldReference): (string | number)[] | null {
  if (ref.kind === "path") return [...ref.path];
  const values = doc.value(ref.collection);
  if (!Array.isArray(values)) return null;
  const matches = values.flatMap((value, index) => identity(value) === ref.id ? [index] : []);
  const index = matches[0];
  return matches.length === 1 && index !== undefined ? [...ref.collection, index, ...ref.field] : null;
}

export function fieldKey(ref: FieldReference): string {
  return JSON.stringify(ref.kind === "path" ? [ref.kind, ref.path] : [ref.kind, ref.collection, ref.id, ref.field]);
}
