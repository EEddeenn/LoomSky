import { createStore, randomId, useStore } from "@/core";
import { reportProblem, toast } from "@/workbench/feedback";
import type { Operation, OperationHandle } from "./types";

const operations = createStore<{ records: readonly Operation[] }>({ records: [] });
type Generation = { closed: boolean };
type Runtime = { owner: Generation; controller: AbortController; handle: OperationHandle; complete: (record: Operation) => void; key: string | null };
const running = new Map<string, Runtime>();
const active = new Map<string, string>();
const incarnations = new WeakMap<object, string>();
const completed: string[] = [];
let generation: Generation | null = null;

function patchOperation<T extends Operation>(id: string, patch: Partial<T>): void {
  operations.set((state) => ({ records: state.records.map((record) => record.id === id ? { ...record, ...patch } : record) }));
}

export function startOperations(): () => Promise<void> {
  if (generation !== null) throw new Error("The operations runtime is already running.");
  const owner: Generation = { closed: false };
  generation = owner;
  let closing: Promise<void> | null = null;
  return () => {
    if (closing !== null) return closing;
    owner.closed = true;
    if (generation === owner) generation = null;
    const committing: Promise<Operation>[] = [];
    for (const [id, runtime] of running) {
      if (runtime.owner !== owner) continue;
      if (operationOf(id)?.phase === "committing") committing.push(runtime.handle.done);
      if (runtime.key !== null && active.get(runtime.key) === id) active.delete(runtime.key);
      cancelOperation(id);
    }
    closing = committing.length === 0 ? Promise.resolve() : new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 5_000);
      void Promise.all(committing).then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    return closing;
  };
}

export function operationSourceKey(owner: object): string {
  let key = incarnations.get(owner);
  if (key === undefined) {
    key = randomId();
    incarnations.set(owner, key);
  }
  return key;
}

export function isOperationActive(operation: Operation): boolean {
  return operation.finishedAt === null;
}

export function useOperations(): readonly Operation[] {
  return useStore(operations, (state) => state.records);
}

function operationOf(id: string): Operation | undefined {
  return operations.get().records.find((record) => record.id === id);
}

export function activeOperation<T extends Operation>(key: string): OperationHandle<T> | undefined {
  const id = active.get(key);
  const runtime = id === undefined ? undefined : running.get(id);
  return runtime?.owner === generation ? runtime.handle as OperationHandle<T> : undefined;
}

export function registerOperation<T extends Operation>(record: Omit<T, "id" | "startedAt" | "finishedAt" | "cancellationRequested" | "error">, key: string | null = null): OperationHandle<T> {
  if (generation === null) throw new DOMException("The workbench has stopped accepting operations.", "AbortError");
  const id = randomId();
  let complete!: (record: Operation) => void;
  const done = new Promise<Operation>((resolve) => { complete = resolve; });
  const handle = { id, done };
  running.set(id, { owner: generation, controller: new AbortController(), handle, complete, key });
  if (key !== null) active.set(key, id);
  const initial = { ...record, id, startedAt: Date.now(), finishedAt: null, cancellationRequested: false, error: null } as T;
  operations.set((state) => ({ records: [...state.records, initial] }));
  return handle as OperationHandle<T>;
}

export function updateOperation<T extends Operation>(id: string, patch: Partial<T>): void {
  if (running.has(id)) patchOperation<T>(id, patch);
}

export function operationSignal(id: string): AbortSignal {
  const runtime = running.get(id);
  if (runtime === undefined) throw new Error("The operation has already ended.");
  return runtime.controller.signal;
}

export function finishOperation<T extends Operation>(id: string, patch: Partial<T>): boolean {
  const runtime = running.get(id);
  if (runtime === undefined) return false;
  if (runtime.key !== null && active.get(runtime.key) === id) active.delete(runtime.key);
  patchOperation<T>(id, { ...patch, finishedAt: Date.now(), cancellable: false } as Partial<T>);
  running.delete(id);
  completed.push(id);
  if (completed.length > 50) {
    const removed = completed.shift()!;
    operations.set((state) => ({ records: state.records.filter((record) => record.id !== removed) }));
  }
  const record = operationOf(id);
  if (record !== undefined) runtime.complete(record);
  return !runtime.owner.closed && runtime.owner === generation;
}

export function failOperation(id: string, error: unknown): void {
  const runtime = running.get(id);
  const record = operationOf(id);
  if (runtime === undefined || record === undefined) return;
  const cancelled = runtime.controller.signal.aborted || error instanceof Error && error.name === "AbortError";
  if (cancelled) {
    if (finishOperation(id, { phase: "cancelled" })) toast(`Cancelled ${record.name}`, "info");
    return;
  }
  const message = error instanceof Error ? error.message : String(error);
  if (!finishOperation(id, { phase: "failed", error: message })) return;
  reportProblem({ id: `operation:${id}`, level: "error", scope: "Operations", title: `Cannot ${record.kind === "duplicate" ? "duplicate" : record.kind} ${record.name}`, message });
}

export function cancelOperation(id: string): void {
  const record = operationOf(id);
  const runtime = running.get(id);
  if (record === undefined || runtime === undefined || !record.cancellable || record.cancellationRequested) return;
  updateOperation(id, { cancellationRequested: true, cancellable: false });
  runtime.controller.abort();
}
