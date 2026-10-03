import { compute, createDemand, ResourceLimitError, type ComputeDemand, type TaskOptions } from "@/io/compute";
import { reserveInput } from "@/io/input";
import { captureFile, fileByteLength, fileBytes, type VerifiedFileRecord } from "@/io/storage";
import type { ArtifactFile } from "@/model/artifact";
import { waitFor } from "./attempts";

export type BuildBytes = VerifiedFileRecord;
type Read = { file: ArtifactFile; fresh: boolean; controller: AbortController; demand: ComputeDemand; promise: Promise<Uint8Array<ArrayBuffer>>; resolve(bytes: Uint8Array<ArrayBuffer>): void; reject(error: unknown): void };
const maxEntries = 24, maxBytes = 64 * 1024 * 1024, maxActiveReads = 2, maxQueuedReads = 64;
const savedBytes = new Map<string, Uint8Array<ArrayBuffer>>();
const shared = new Map<string, Read>();
const reads = new Set<Read>();
const queued: Read[] = [];
let retainedBytes = 0;
let activeReads = 0;

export async function artifact(name: string, input: Uint8Array, options: TaskOptions = {}): Promise<{ file: ArtifactFile; stored: BuildBytes }> {
  const stored = await captureFile(input, options);
  return { file: { name, digest: stored.digest }, stored };
}
export async function artifactBytes(file: ArtifactFile, options: TaskOptions = {}): Promise<Uint8Array<ArrayBuffer>> {
  options.signal?.throwIfAborted();
  let read = options.fresh ? undefined : shared.get(file.digest);
  if (read === undefined) {
    if (activeReads >= maxActiveReads && queued.length >= maxQueuedReads) throw new ResourceLimitError("Too many saved files waiting to load.");
    const deferred = Promise.withResolvers<Uint8Array<ArrayBuffer>>();
    read = { file, fresh: options.fresh ?? false, controller: new AbortController(), demand: createDemand("background"), ...deferred };
    if (!read.fresh) shared.set(file.digest, read);
    reads.add(read); queued.push(read);
  }
  const release = read.demand.hold(options.priority ?? "action");
  pump();
  try { const bytes = await waitFor(read.promise, options.signal); options.progress?.(1); return bytes.slice(); }
  finally { release(); }
}
function evict(digest: string): void {
  retainedBytes -= savedBytes.get(digest)?.byteLength ?? 0;
  savedBytes.delete(digest);
}
function retain(digest: string, bytes: Uint8Array<ArrayBuffer>): void {
  evict(digest);
  if (bytes.byteLength > maxBytes) return;
  while (savedBytes.size >= maxEntries || retainedBytes + bytes.byteLength > maxBytes) evict(savedBytes.keys().next().value!);
  savedBytes.set(digest, bytes); retainedBytes += bytes.byteLength;
}
async function readBytes(read: Read): Promise<Uint8Array<ArrayBuffer>> {
  const { file, controller: { signal } } = read;
  signal.throwIfAborted();
  const cached = read.fresh ? undefined : savedBytes.get(file.digest);
  if (cached !== undefined) { retain(file.digest, cached); return cached; }
  const size = await fileByteLength(file.digest);
  signal.throwIfAborted();
  if (size === null) throw new Error(`Saved input ${file.name} is missing.`);
  const release = reserveInput(size, signal);
  try {
    const bytes = await fileBytes(file.digest);
    signal.throwIfAborted();
    if (bytes === null || bytes.byteLength !== size) throw new Error(`Saved input ${file.name} is incomplete.`);
    if (await compute.hash(bytes, { priority: read.demand, signal }) !== file.digest) throw new Error(`Saved input ${file.name} failed its integrity check.`);
    signal.throwIfAborted();
    retain(file.digest, bytes);
    return bytes;
  } finally { release(); }
}
function pump(): void {
  while (activeReads < maxActiveReads && queued.length > 0) {
    const read = queued.shift()!;
    activeReads++;
    void readBytes(read).then(read.resolve, read.reject).finally(() => {
      activeReads--; reads.delete(read);
      if (shared.get(read.file.digest) === read) shared.delete(read.file.digest);
      pump();
    });
  }
}
export function clearArtifactCache(): void {
  const error = new DOMException("The artifact cache closed", "AbortError");
  for (const read of reads) read.controller.abort(error);
  for (const read of queued.splice(0)) { read.reject(error); reads.delete(read); }
  shared.clear(); savedBytes.clear(); retainedBytes = 0;
}
export function artifactCacheStats() {
  return { entries: savedBytes.size, bytes: retainedBytes, activeReads, queuedReads: queued.length, maxEntries, maxBytes, maxActiveReads, maxQueuedReads };
}
