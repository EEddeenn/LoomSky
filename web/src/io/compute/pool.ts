import { commandInputs } from "@/model/observation/query-key";
import type { CompiledPharos, PharosProduct } from "@/io/pharos";
import type { Answer, Bundle, ByteSink, Call, Calls, ComputeSource, Op, Request, Success, TaskOptions, WorkerResources } from "./protocol";

import { priorityOf, priorityOrder, type PrioritySource } from "./demand";
import { computeLimits, ResourceLimitError } from "./limits";

type Consumer = { priority: PrioritySource; progress?: (share: number) => void; settle(answer: Success): void; reject(error: unknown): void };
type Job = { call: Call; product: PharosProduct | null; key: string | null; inputBytes: number; sourceBytes: number; source?: ComputeSource; sink?: ByteSink; stop: AbortController; consumers: Set<Consumer>; slot: Slot | null; progress: number | null };
type Slot = { index: number; worker: Worker; job: Job | null; waitingSource: boolean; resources: WorkerResources; timer: ReturnType<typeof setTimeout> | null };
type SourceRequest = { slot: Slot; job: Job; key: string; bytes?: Bundle };
type Outcome = Success | { error: unknown };

const sourceReadLimit = 2;
const sourceReads = new Set<SourceRequest>();
const emptyResources = (): WorkerResources => ({ memoryBytes: 0, sources: [] });

function inputBytes(call: Call, input: string): number {
  let bytes = input.length * 2;
  const buffers = new Set<ArrayBufferLike>();
  const add = (data: Uint8Array) => {
    if (buffers.has(data.buffer)) return;
    buffers.add(data.buffer);
    bytes += data.buffer.byteLength;
  };
  switch (call.op) {
    case "solve":
    case "geometry": bytes += call.args.text.length * 2; break;
    case "pack":
      bytes += call.args.scenario.length * 2;
      for (const file of call.args.files) add(file.bytes);
      break;
    case "describe": add(call.args.file.bytes); break;
    case "hash": add(call.args.bytes); break;
  }
  return bytes;
}


const products: Record<Op, PharosProduct | null> = {
  identity: null,
  solve: "traj",
  geometry: "traj",
  pack: "pack",
  describe: "pack",
  truth: "obs",
  inspect: "obs",
  lane: "obs",
  file: "obs",
  hash: null,
  zip: null,
};
const short = new Set<Op>(["geometry", "truth", "inspect"]);

function matches<O extends Op>(answer: Success, op: O): answer is Success & { op: O; value: Calls[O]["result"] } {
  return answer.op === op;
}

export class ComputeError extends Error {
  constructor(message: string, readonly engineIdentity: string | null) {
    super(message);
    this.name = "ComputeError";
  }
}

export class Pool {
  private readonly slots: (Slot | undefined)[] = [];
  private readonly jobs = new Map<number, Job>();
  private readonly shared = new Map<string, Job>();
  private readonly modules = new Map<PharosProduct, CompiledPharos>();
  private readonly loading = new Map<PharosProduct, Slot>();
  private readonly bytes = new WeakMap<Uint8Array, number>();
  private readonly sources = new Set<SourceRequest>();
  private next = 1;
  private nextBytes = 1;
  private pumping = false;
  private closed = false;

  constructor(private readonly limits = computeLimits) {}

  call<O extends Op>(op: O, args: Calls[O]["args"], options: TaskOptions = {}, source?: ComputeSource, sink?: ByteSink): Promise<Calls[O]["result"]> {
    const { signal } = options;
    const priority = options.priority ?? "action";
    if (this.closed) return Promise.reject(new DOMException("The compute runtime is closed.", "AbortError"));
    if (signal?.aborted) return Promise.reject(signal.reason);
    const call = { op, id: this.next++, args } as Call;
    if (call.op === "identity") {
      const compiled = this.modules.get(call.args.product);
      if (compiled !== undefined) return Promise.resolve(compiled.identity as Calls[O]["result"]);
    }
    const product = call.op === "identity" ? call.args.product : products[call.op];
    const input = this.inputKey(call);
    const key = options.fresh || sink !== undefined ? null : input;
    let job = key === null ? undefined : this.shared.get(key);
    if (job === undefined) {
      const bytes = inputBytes(call, input);
      if (this.jobs.size >= this.limits.jobs || this.inputUsage() + bytes > this.limits.inputBytes) {
        return Promise.reject(new ResourceLimitError("Compute queue is full. Wait for a task to finish, then retry."));
      }
      job = { call, product, inputBytes: bytes, sourceBytes: 0, key, source, sink, stop: new AbortController(), consumers: new Set(), slot: null, progress: null };
      this.jobs.set(call.id, job);
      if (key !== null) this.shared.set(key, job);
    }
    const owner = job;
    return new Promise((resolve, reject) => {
      const release = () => {
        signal?.removeEventListener("abort", abort);
        owner.consumers.delete(consumer);
      };
      const consumer: Consumer = {
        priority,
        progress: options.progress,
        settle: (answer) => {
          release();
          if (matches(answer, op)) resolve(answer.value);
          else reject(new Error(`Compute answered ${op} with a ${answer.op} result.`));
        },
        reject: (error) => { release(); reject(error); },
      };
      const abort = () => {
        consumer.reject(signal?.reason);
        if (owner.consumers.size === 0) this.cancel(owner);
        this.pump();
      };
      signal?.addEventListener("abort", abort, { once: true });
      owner.consumers.add(consumer);
      if (owner.progress !== null) consumer.progress?.(owner.progress);
      this.pump();
    });
  }

  private byteIdentity(bytes: Uint8Array): number {
    let identity = this.bytes.get(bytes);
    if (identity === undefined) {
      identity = this.nextBytes++;
      this.bytes.set(bytes, identity);
    }
    return identity;
  }

  private inputKey(call: Call): string {
    switch (call.op) {
      case "identity": return JSON.stringify([call.op, call.args.product]);
      case "solve":
      case "geometry": return JSON.stringify([call.op, call.args.text]);
      case "pack": return JSON.stringify([call.op, call.args.scenario, call.args.files.map(({ name, digest }) => [name, digest])]);
      case "describe": return JSON.stringify([call.op, call.args.file.name, call.args.file.digest]);
      case "truth": return JSON.stringify([call.op, call.args.digest, call.args.run, commandInputs(call.args.commands), call.args.epoch, call.args.sky]);
      case "inspect": {
        const { digest, run, commands, query } = call.args;
        return JSON.stringify([call.op, digest, run, commandInputs(commands), query.epoch, query.system, query.svid, query.signal, query.groups ?? null]);
      }
      case "lane": return JSON.stringify([call.op, call.args.digest, call.args.durationMs]);
      case "file": {
        const { digest, kind, range, commands, created } = call.args;
        return JSON.stringify([call.op, digest, kind, range.first, range.end, commandInputs(commands), created]);
      }
      case "hash": return JSON.stringify([call.op, this.byteIdentity(call.args.bytes)]);
      case "zip": return JSON.stringify([call.op, call.args.names]);
    }
  }

  private priority(job: Job): number {
    let priority = priorityOrder.background;
    for (const consumer of job.consumers) priority = Math.min(priority, priorityOrder[priorityOf(consumer.priority)]);
    return priority;
  }

  private capacity(): number {
    return Math.max(2, Math.min(4, navigator.hardwareConcurrency || 2));
  }

  private pump(): void {
    if (this.closed || this.pumping) return;
    this.pumping = true;
    try {
      this.deliverSources();
      this.dispatch();
      this.readSource();
    }
    finally { this.pumping = false; }
  }

  private dispatch(): void {
    const waiting = [...this.jobs.values()].filter((job) => job.slot === null && job.consumers.size > 0);
    waiting.sort((left, right) => this.priority(left) - this.priority(right) || left.call.id - right.call.id);
    for (const job of waiting) {
      if (job.product !== null && !this.modules.has(job.product) && this.loading.has(job.product)) continue;
      if (this.slots.some((slot) => slot?.job != null) && this.inputUsage(true) + job.inputBytes > this.limits.activeInputBytes) continue;
      const digest = "digest" in job.call.args ? job.call.args.digest : null;
      const indices = Array.from({ length: this.capacity() }, (_, index) => index).filter((index) => (index !== 0 || short.has(job.call.op)) && this.slots[index]?.job == null);
      indices.sort((left, right) => {
        const leftSlot = this.slots[left];
        const rightSlot = this.slots[right];
        const leftCached = digest !== null && leftSlot?.resources.sources.includes(digest) ? 0 : 1;
        const rightCached = digest !== null && rightSlot?.resources.sources.includes(digest) ? 0 : 1;
        return leftCached - rightCached || left - right;
      });
      const index = indices[0];
      if (index === undefined) continue;
      let slot: Slot;
      try { slot = this.slots[index] ?? this.start(index); }
      catch (error) {
        this.finish(job, { error });
        continue;
      }
      if (slot.timer !== null) clearTimeout(slot.timer);
      slot.timer = null;
      slot.job = job;
      job.slot = slot;
      const compiled = job.product === null ? null : this.modules.get(job.product) ?? null;
      if (job.product !== null && compiled === null) this.loading.set(job.product, slot);
      try {
        slot.worker.postMessage({
          kind: "call", call: job.call,
          module: job.product === null ? null : { product: job.product, compiled, url: new URL(`/pharos_${job.product}.wasm`, document.baseURI).href },
        } satisfies Request);
      } catch (error) {
        this.fail(slot, error);
      }
    }
  }

  private start(index: number): Slot {
    const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    const slot: Slot = { index, worker, job: null, waitingSource: false, resources: emptyResources(), timer: null };
    this.slots[index] = slot;
    worker.addEventListener("message", (event: MessageEvent<Answer>) => this.receive(slot, event.data));
    worker.addEventListener("error", (event) => {
      event.preventDefault();
      this.fail(slot, new Error(event.message || "Compute worker failed."));
    });
    worker.addEventListener("messageerror", () => this.fail(slot, new Error("Compute worker response could not be read.")));
    return slot;
  }

  private receive(slot: Slot, answer: Answer): void {
    if (this.slots[slot.index] !== slot) return;
    const job = slot.job;
    if (job === null || answer.id !== job.call.id) return;
    switch (answer.kind) {
      case "resources":
        slot.resources = answer.resources;
        return;
      case "chunk":
        void this.write(slot, job, answer.bytes);
        return;
      case "module": {
        this.modules.set(answer.product, answer.compiled);
        this.loading.delete(answer.product);
        this.pump();
        return;
      }
      case "source":
        job.inputBytes -= job.sourceBytes;
        job.sourceBytes = 0;
        slot.waitingSource = true;
        this.sources.add({ slot, job, key: answer.digest });
        this.pump();
        return;
      case "progress":
        job.progress = answer.share;
        for (const consumer of job.consumers) consumer.progress?.(answer.share);
        return;
      case "result":
        this.finish(job, answer.ok ? answer : { error: new ComputeError(answer.error, answer.engineIdentity) });
        return;
      case "cancelled":
        this.finish(job);
    }
  }

  private readSource(): void {
    if ([...this.sources].some((request) => sourceReads.has(request))) return;
    for (const request of this.sources) {
      if (request.bytes !== undefined) continue;
      if (sourceReads.size >= sourceReadLimit) {
        const error = new ResourceLimitError("Compute inputs are still loading. Wait, then retry.");
        this.cancel(request.job, error);
        continue;
      }
      sourceReads.add(request);
      void this.source(request).finally(() => {
        sourceReads.delete(request);
        this.pump();
      });
      return;
    }
  }

  private async source(request: SourceRequest): Promise<void> {
    const { slot, job, key } = request;
    try {
      if (job.source === undefined) throw new Error(`No source is available for ${key}.`);
      const bytes = await job.source(job.stop.signal, key);
      job.stop.signal.throwIfAborted();
      if (slot.job !== job) return;
      if (this.inputUsage() + bytes.byteLength > this.limits.inputBytes) throw new ResourceLimitError("File exceeds the available compute input budget. Wait for a task to finish, then retry.");
      job.sourceBytes = bytes.byteLength;
      job.inputBytes += bytes.byteLength;
      request.bytes = bytes;
    } catch (error) {
      if (!this.jobs.has(job.call.id)) return;
      this.cancel(job, error);
    }
  }

  private deliverSources(): void {
    for (const source of this.sources) {
      const { slot, job, bytes } = source;
      if (bytes === undefined) continue;
      const activeBytes = this.inputUsage(true);
      if (activeBytes > 0 && activeBytes + job.inputBytes > this.limits.activeInputBytes) continue;
      this.sources.delete(source);
      try {
        const owned = bytes.slice();
        slot.waitingSource = false;
        slot.worker.postMessage({ kind: "source", id: job.call.id, bytes: owned } satisfies Request, [owned.buffer]);
      } catch (error) { this.fail(slot, error); }
    }
  }

  private async write(slot: Slot, job: Job, bytes: Uint8Array<ArrayBuffer>): Promise<void> {
    const { signal } = job.stop;
    try {
      signal.throwIfAborted();
      if (job.sink === undefined) throw new Error("The output has no destination.");
      const sink = job.sink;
      await new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener("abort", abort, { once: true });
        void sink.write(bytes).then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
      });
      signal.throwIfAborted();
      if (slot.job === job) slot.worker.postMessage({ kind: "written", id: job.call.id } satisfies Request);
    } catch (error) {
      if (!this.jobs.has(job.call.id)) return;
      this.cancel(job, error);
      this.pump();
    }
  }

  private detach(job: Job): void {
    for (const source of this.sources) if (source.job === job) this.sources.delete(source);
    if (job.key !== null && this.shared.get(job.key) === job) this.shared.delete(job.key);
    job.key = null;
  }

  private cancel(job: Job, error: unknown = new DOMException("The computation was cancelled.", "AbortError")): void {
    this.detach(job);
    job.stop.abort(error);
    for (const consumer of [...job.consumers]) consumer.reject(error);
    if (job.slot === null) this.finish(job);
    else {
      const slot = job.slot;
      try {
        slot.worker.postMessage({ kind: "cancel", id: job.call.id } satisfies Request);
        if (slot.timer !== null) clearTimeout(slot.timer);
        slot.timer = setTimeout(() => this.fail(slot, job.stop.signal.reason), this.limits.cancelMs);
      } catch (error) { this.fail(slot, error); }
    }
  }

  private finish(job: Job, outcome: Outcome = { error: job.stop.signal.reason }): void {
    this.detach(job);
    this.jobs.delete(job.call.id);
    if (job.slot !== null) {
      const slot = job.slot;
      if (job.product !== null && this.loading.get(job.product) === slot) this.loading.delete(job.product);
      slot.job = null;
      slot.waitingSource = false;
      job.slot = null;
      if (slot.timer !== null) clearTimeout(slot.timer);
      slot.timer = null;
      if (this.slots[slot.index] === slot) {
        slot.timer = setTimeout(() => this.retire(slot), this.limits.idleMs);
        this.trim();
      }
    }
    for (const consumer of [...job.consumers]) {
      if ("error" in outcome) consumer.reject(outcome.error);
      else consumer.settle(outcome);
    }
    this.pump();
  }

  private retire(slot: Slot): void {
    if (this.slots[slot.index] !== slot) return;
    if (slot.timer !== null) clearTimeout(slot.timer);
    slot.worker.terminate();
    this.slots[slot.index] = undefined;
  }

  private trim(): void {
    for (const slot of this.slots) {
      if (slot !== undefined && slot.job === null && slot.resources.memoryBytes > this.limits.workerBytes) this.retire(slot);
    }
    const idle = this.slots.filter((slot): slot is Slot => slot !== undefined && slot.job === null);
    idle.sort((left, right) => right.resources.memoryBytes - left.resources.memoryBytes);
    for (const slot of idle) {
      if (this.slots.reduce((sum, slot) => sum + (slot?.resources.memoryBytes ?? 0), 0) <= this.limits.residentBytes) break;
      this.retire(slot);
    }
  }

  private fail(slot: Slot, error: unknown): void {
    if (this.slots[slot.index] !== slot) return;
    this.retire(slot);
    if (slot.job !== null) {
      const job = slot.job;
      const failure = new ComputeError(error instanceof Error ? error.message : String(error), job.product === null ? null : this.modules.get(job.product)?.identity ?? null);
      job.stop.abort(failure);
      this.finish(job, { error: failure });
    }
    this.pump();
  }

  private inputUsage(activeOnly = false): number {
    return [...this.jobs.values()].reduce((sum, job) => sum + (activeOnly && (job.slot === null || job.slot.waitingSource) ? 0 : job.inputBytes), 0);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const reason = new DOMException("The compute runtime is closed.", "AbortError");
    for (const slot of this.slots) if (slot !== undefined) this.retire(slot);
    this.slots.length = 0;
    this.loading.clear();
    this.modules.clear();
    this.shared.clear();
    this.sources.clear();
    for (const job of this.jobs.values()) {
      job.stop.abort(reason);
      this.finish(job);
    }
    this.jobs.clear();
  }
}
