import { isolateHistory } from "@codemirror/commands";
import type { Transaction, TransactionSpec } from "@codemirror/state";
import { DocumentText, fieldKey, fieldReference, resolveField, writeTransaction, type DraftIssue, type FieldReference, type PendingIssue, type Prepared, type TextDocument, type WriteChange } from "@/model/document";
import { prepareFieldDraft, type DraftBinding } from "./codecs";

type Entry = DraftBinding & { ref: FieldReference; text: string; base: string | undefined; guards: { depth: number; value: string }[] };
type Registry = { entries: Map<string, Entry>; listeners: Set<() => void> };
const registries = new WeakMap<TextDocument, Registry>();

function registry(doc: TextDocument): Registry {
  let state = registries.get(doc);
  if (state === undefined) {
    state = { entries: new Map(), listeners: new Set() };
    registries.set(doc, state);
  }
  return state;
}

function notify(state: Registry): void {
  for (const listener of state.listeners) listener();
}

export function subscribeDrafts(doc: TextDocument, listener: () => void): () => void {
  const state = registry(doc);
  state.listeners.add(listener);
  return () => state.listeners.delete(listener);
}

export function fieldDraft(doc: TextDocument, ref: FieldReference): Readonly<Entry> | undefined {
  return registries.get(doc)?.entries.get(fieldKey(ref));
}

export function draftText(doc: TextDocument, path: (string | number)[]): string | undefined {
  return fieldDraft(doc, fieldReference(doc, path))?.text;
}

function guardsFor(doc: Pick<TextDocument, "value">, path: (string | number)[], ref: FieldReference): Entry["guards"] {
  return path.flatMap((part, depth) => {
    if (typeof part !== "number" || ref.kind === "entity" && depth === ref.collection.length) return [];
    const value = doc.value(path.slice(0, depth));
    return Array.isArray(value) && value.some((item) => item !== null && typeof item === "object" && !Array.isArray(item))
      ? [{ depth, value: JSON.stringify(value) }] : [];
  });
}

export function setFieldDraft(doc: TextDocument, ref: FieldReference, binding: DraftBinding, text: string, source: string): void {
  if (!doc.writable()) return;
  const state = registry(doc);
  const key = fieldKey(ref);
  const before = state.entries.get(key);
  if (text === source) {
    if (!state.entries.delete(key)) return;
  } else {
    if (before?.text === text) return;
    state.entries.set(key, before === undefined ? {
      ...binding, path: [...binding.path], ref: structuredClone(ref), codec: structuredClone(binding.codec),
      text, base: doc.raw(binding.path), guards: guardsFor(doc, binding.path, ref),
    } : { ...before, text });
  }
  notify(state);
}

export function discardFieldDraft(doc: TextDocument, ref: FieldReference): void {
  const state = registry(doc);
  if (state.entries.delete(fieldKey(ref))) notify(state);
}

function removeEntries(doc: TextDocument, state: Registry, path: readonly (string | number)[]): boolean {
  let changed = false;
  for (const [key, entry] of state.entries) {
    const current = resolveField(doc, entry.ref);
    if (path.length === 0 || current !== null && path.every((part, i) => current[i] === part)) {
      state.entries.delete(key);
      changed = true;
    }
  }
  return changed;
}

export function discardDraftsAt(doc: TextDocument, path: readonly (string | number)[] = []): void {
  const state = registry(doc);
  if (removeEntries(doc, state, path)) notify(state);
}

function containsPath(parent: readonly (string | number)[], path: readonly (string | number)[]): boolean {
  return parent.length <= path.length && parent.every((part, index) => path[index] === part);
}

/** Publish a form edit without committing inputs from unrelated fields. */
export function publishFieldChanges(doc: TextDocument, transaction: Transaction | null, changes?: readonly WriteChange[]): void {
  if (!doc.writable()) return;
  if (transaction !== null && transaction.startState !== doc.state()) throw new Error("Document changed. Retry this edit.");
  const state = registries.get(doc);
  const inputs = state !== undefined && state.entries.size > 0;
  if (inputs) {
    const after = transaction === null ? doc : new DocumentText(transaction.state);
    const retained = new Map<string, Entry>();
    for (const entry of state.entries.values()) {
      const original = resolveField(doc, entry.ref);
      if (original === null || changes === undefined && entry.ref.kind === "path"
        && entry.guards.some((guard) => JSON.stringify(after.value(original.slice(0, guard.depth))) !== guard.value)) {
        retained.set(fieldKey(entry.ref), entry);
        continue;
      }
      let path: (string | number)[] | null = [...original];
      for (const change of changes ?? []) {
        if (path === null) break;
        const parent = change.path.slice(0, -1);
        const index = change.path.at(-1);
        const insertion = change.insert === true;
        const removal = change.value === undefined && change.number === undefined && change.json === undefined;
        if (typeof index === "number" && (insertion || removal) && containsPath(parent, path) && typeof path[parent.length] === "number") {
          const row = path[parent.length] as number;
          if (removal && row === index) path = null;
          else if (row >= index) path = [...parent, row + (insertion ? 1 : -1), ...path.slice(parent.length + 1)];
        } else if (containsPath(change.path, path) || containsPath(path, change.path)) {
          const beforeValue = doc.value(change.path);
          const afterValue = after.value(change.path);
          if (containsPath(change.path, path) && beforeValue !== undefined && !Array.isArray(beforeValue)
            && Array.isArray(afterValue) && JSON.stringify(afterValue[0]) === JSON.stringify(beforeValue)) {
            path = [...change.path, 0, ...path.slice(change.path.length)];
          } else {
            const next: (string | number)[] | null = entry.ref.kind === "entity" && change.path.length < path.length && containsPath(change.path, path)
              ? resolveField(after, entry.ref) : null;
            path = next !== null && doc.raw(original) === after.raw(next) ? next : null;
          }
        }
      }
      if (changes === undefined) {
        path = resolveField(after, entry.ref);
        if (path !== null && doc.raw(original) !== after.raw(path)) path = null;
      }
      if (path === null) continue;
      const ref = fieldReference(after, path);
      const current = doc.raw(original) === entry.base
        && entry.guards.every((guard) => JSON.stringify(doc.value(original.slice(0, guard.depth))) === guard.value);
      retained.set(fieldKey(ref), { ...entry, path, ref, ...(current ? { guards: guardsFor(after, path, ref) } : {}) });
    }
    state.entries = retained;
  }
  if (transaction !== null) doc.publishTransaction(transaction);
  if (inputs) notify(state);
}

export function writeFieldChanges(doc: TextDocument, changes: readonly WriteChange[], metadata: TransactionSpec = {}): void {
  if (!doc.writable()) return;
  const spec = writeTransaction(doc.text(), changes);
  const transaction = spec === null && metadata.effects === undefined && metadata.changes === undefined
    ? null : doc.prepareTransaction({ ...spec, ...metadata });
  publishFieldChanges(doc, transaction, changes);
}

export function hasDrafts(doc: TextDocument): boolean { return (registries.get(doc)?.entries.size ?? 0) > 0; }

function prepareEntry(doc: TextDocument, entry: Entry): { issue: DraftIssue } | { changes: readonly WriteChange[] } {
  const path = resolveField(doc, entry.ref);
  const at = { ref: entry.ref, path: path ?? entry.path };
  if (!doc.writable()) return { issue: { ...at, message: "This document is read-only." } };
  if (path === null) return { issue: { ...at, message: "Object removed or ID duplicated. Your input remains until you revert it." } };
  if (entry.guards.some((guard) => JSON.stringify(doc.value(path.slice(0, guard.depth))) !== guard.value)) {
    return { issue: { ...at, message: "The list changed. Review your preserved input before applying it." } };
  }
  if (doc.raw(path) !== entry.base) return { issue: { ...at, message: "The field changed. Review or revert your pending input." } };
  const changes = prepareFieldDraft({ ...entry, path }, entry.text);
  return changes === null ? { issue: { ...at, message: entry.error } } : { changes };
}

export function draftIssues(doc: TextDocument): DraftIssue[] {
  const issues: DraftIssue[] = [];
  for (const entry of registries.get(doc)?.entries.values() ?? []) {
    const result = prepareEntry(doc, entry);
    if ("issue" in result) issues.push(result.issue);
  }
  return issues;
}

function prepareWrites(doc: TextDocument, ref: FieldReference, changes: readonly WriteChange[], metadata: TransactionSpec = {}): { issue: DraftIssue } | { transaction: Transaction | null } {
  const path = resolveField(doc, ref) ?? (ref.kind === "path" ? ref.path : ref.collection);
  if (!doc.writable()) return { issue: { ref, path, message: "This document is read-only." } };
  try {
    const spec = changes.length === 0 ? null : writeTransaction(doc.text(), changes);
    if (spec === null && metadata.effects === undefined && metadata.changes === undefined) return { transaction: null };
    const transaction = doc.prepareTransaction({ ...spec, ...metadata, userEvent: "input.form", annotations: isolateHistory.of("full") });
    if (transaction !== null) return { transaction };
    return { issue: { ref, path, message: "This document is read-only." } };
  } catch (error) {
    return { issue: { ref, path, message: `Could not apply input: ${error instanceof Error ? error.message : String(error)}` } };
  }
}

export function replaceDraftsAt(doc: TextDocument, path: (string | number)[], value: unknown): Prepared<void> {
  const changes = [{ path, value }];
  const prepared = prepareWrites(doc, fieldReference(doc, path), changes);
  if ("issue" in prepared) return { ok: false, issue: { kind: "field", issue: prepared.issue } };
  publishFieldChanges(doc, prepared.transaction, changes);
  return { ok: true, value: undefined };
}

export function prepareFieldInputs(doc: TextDocument): Prepared<readonly WriteChange[]> {
  const changes: WriteChange[] = [];
  for (const entry of registries.get(doc)?.entries.values() ?? []) {
    const result = prepareEntry(doc, entry);
    if ("issue" in result) return { ok: false, issue: { kind: "field", issue: result.issue } };
    changes.push(...result.changes);
  }
  return { ok: true, value: changes };
}

export function commitFieldInputs(doc: TextDocument, metadata: TransactionSpec = {}, committed?: () => void, additionalChanges: readonly WriteChange[] = []): PendingIssue | null {
  const inputs = prepareFieldInputs(doc);
  if (!inputs.ok) return inputs.issue;
  const state = registry(doc);
  const prepared = prepareWrites(doc, { kind: "path", path: [] }, [...inputs.value, ...additionalChanges], metadata);
  if ("issue" in prepared) return { kind: "field", issue: prepared.issue };
  const removed = state.entries.size > 0;
  state.entries.clear();
  committed?.();
  if (prepared.transaction !== null) doc.publishTransaction(prepared.transaction);
  if (removed) notify(state);
  return null;
}

export function commitFieldDraft(doc: TextDocument, ref: FieldReference): DraftIssue | null {
  const state = registry(doc);
  const key = fieldKey(ref);
  const entry = state.entries.get(key);
  if (entry === undefined) return null;
  const result = prepareEntry(doc, entry);
  if ("issue" in result) return result.issue;
  const prepared = prepareWrites(doc, ref, result.changes);
  if ("issue" in prepared) return prepared.issue;
  state.entries.delete(key);
  const last = state.entries.size === 0;
  publishFieldChanges(doc, prepared.transaction, result.changes);
  if (last) notify(state);
  return null;
}
