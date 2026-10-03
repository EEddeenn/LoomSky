import type { Download } from "@/core";
import { ResourceLimitError, type ByteSink } from "@/io/compute";

export type OutputFile = Download & { release(): Promise<void> };
type Output = ByteSink & { finish(name: string): Promise<OutputFile>; abort(): Promise<void> };
const memoryLimit = 64 * 1024 * 1024;
const directoryName = "loomsky-exports";
const lockPrefix = "loomsky:export:";
const live = new Map<string, { output: Output; owner: symbol }>();
let activeOwner: symbol | null = null;
let memoryBytes = 0;

async function directory(): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator.storage?.getDirectory !== "function") return null;
  try {
    return await (await navigator.storage.getDirectory()).getDirectoryHandle(directoryName, { create: true });
  } catch (error) {
    if (error instanceof DOMException && (error.name === "SecurityError" || error.name === "NotSupportedError")) return null;
    throw error;
  }
}

export function startOutputs(): () => Promise<void> {
  const owner = Symbol();
  activeOwner = owner;
  if (navigator.locks !== undefined) void directory().then(async (root) => {
    if (root === null) return;
    for await (const [name] of root as FileSystemDirectoryHandle & AsyncIterable<[string, FileSystemHandle]>) {
      if (live.has(name)) continue;
      await navigator.locks.request(`${lockPrefix}${name}`, { ifAvailable: true }, async (lock) => {
        if (lock !== null && !live.has(name)) await root.removeEntry(name).catch(() => undefined);
      });
    }
  }).catch(() => undefined);
  return async () => {
    if (activeOwner === owner) activeOwner = null;
    await Promise.allSettled([...live.values()].filter((entry) => entry.owner === owner).map(({ output }) => output.abort()));
  };
}

export async function createOutput(signal: AbortSignal): Promise<Output> {
  signal.throwIfAborted();
  const owner = activeOwner;
  if (owner === null) throw new DOMException("The workbench is closed", "AbortError");
  const key = crypto.randomUUID();
  let root: FileSystemDirectoryHandle | null = null;
  let handle: FileSystemFileHandle | null = null;
  let writer: FileSystemWritableFileStream | null = null;
  let parts: Uint8Array<ArrayBuffer>[] = [];
  let retained = 0;
  let state: "writing" | "finished" | "released" = "writing";
  let releasing: Promise<void> | null = null;
  let unlock: (() => void) | undefined;
  const release = (): Promise<void> => {
    if (releasing !== null) return releasing;
    state = "released";
    signal.removeEventListener("abort", aborted);
    live.delete(key);
    memoryBytes -= retained;
    retained = 0;
    parts = [];
    const stream = writer;
    writer = null;
    releasing = (async () => {
      if (stream !== null) await stream.abort().catch(() => undefined);
      if (root !== null) await root.removeEntry(key).catch(() => undefined);
      handle = null;
      unlock?.();
    })();
    return releasing;
  };
  const aborted = () => { void release(); };
  const assertWriting = () => {
    signal.throwIfAborted();
    if (state !== "writing" || activeOwner !== owner) throw new DOMException("The export output is closed", "AbortError");
  };
  const output: Output = {
    async write(chunk) {
      signal.throwIfAborted();
      if (state !== "writing") throw new Error("This export output is closed");
      if (writer !== null) {
        try { await writer.write(chunk); }
        catch (error) {
          if (error instanceof DOMException && error.name === "QuotaExceededError") throw new ResourceLimitError("Browser storage is full. Free space or export a smaller range.");
          throw error;
        }
      } else {
        if (memoryBytes + chunk.byteLength > memoryLimit) throw new ResourceLimitError("This browser cannot stream to disk. Export a smaller range (64 MiB memory limit).");
        const copy = chunk.slice();
        parts.push(copy);
        retained += copy.byteLength;
        memoryBytes += copy.byteLength;
      }
      signal.throwIfAborted();
    },
    async finish(name) {
      signal.throwIfAborted();
      if (state !== "writing") throw new Error("This export output is closed");
      let blob: Blob;
      if (writer !== null && handle !== null) {
        await writer.close();
        writer = null;
        signal.throwIfAborted();
        blob = await handle.getFile();
      } else {
        blob = new Blob(parts, { type: "application/octet-stream" });
        parts = [];
      }
      signal.throwIfAborted();
      state = "finished";
      return { name, blob, release };
    },
    abort: release,
  };
  live.set(key, { output, owner });
  try {
    if (navigator.locks !== undefined) {
      unlock = await new Promise<() => void>((resolve, reject) => {
        let done!: () => void;
        const held = new Promise<void>((finish) => { done = finish; });
        void navigator.locks.request(`${lockPrefix}${key}`, async () => { resolve(done); await held; }).catch(reject);
      });
      assertWriting();
    }
    root = await directory();
    assertWriting();
    if (root !== null) {
      handle = await root.getFileHandle(key, { create: true });
      assertWriting();
      writer = await handle.createWritable();
    }
    assertWriting();
    signal.addEventListener("abort", aborted, { once: true });
    return output;
  } catch (error) {
    await release();
    if (writer !== null) await writer.abort().catch(() => undefined);
    if (root !== null) await root.removeEntry(key).catch(() => undefined);
    unlock?.();
    throw error;
  }
}
