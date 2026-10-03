import type { PharosProduct } from "@/io/pharos";
import { Pool } from "./pool";
import type { BundleSource, ByteSink, Calls, ComputeSource, NamedInput, Op, TaskOptions, ZipEntry } from "./protocol";

type Observation<O extends "truth" | "inspect" | "lane"> = Calls[O]["args"] & { source: BundleSource };
type FileInput = Omit<Calls["file"]["args"], "created"> & { source: BundleSource; created?: number };

let pool: Pool | null = null;

export function startCompute(): () => void {
  if (pool !== null) throw new Error("The compute runtime is already started.");
  const started = new Pool();
  pool = started;
  return () => {
    if (pool === started) pool = null;
    started.close();
  };
}

function call<O extends Op>(op: O, args: Calls[O]["args"], options?: TaskOptions, source?: ComputeSource, sink?: ByteSink): Promise<Calls[O]["result"]> {
  return pool === null ? Promise.reject(new DOMException("The compute runtime is closed.", "AbortError")) : pool.call(op, args, options, source, sink);
}

export const compute = {
  traj: {
    solve: (text: string, options?: TaskOptions) => call("solve", { text }, options),
    geometry: (text: string, options: TaskOptions = {}) => call("geometry", { text }, { priority: "interactive", ...options }),
  },
  pack: {
    build: (scenario: string, files: NamedInput[], options?: TaskOptions) => call("pack", { scenario, files }, options),
    describe: (file: NamedInput, options?: TaskOptions) => call("describe", { file }, options),
  },
  obs: {
    truth: ({ source, ...args }: Observation<"truth">, options: TaskOptions = {}) => call("truth", args, { priority: "interactive", ...options }, source),
    inspect: ({ source, ...args }: Observation<"inspect">, options: TaskOptions = {}) => call("inspect", args, { priority: "interactive", ...options }, source),
    lane: ({ source, ...args }: Observation<"lane">, options: TaskOptions = {}) => call("lane", args, { priority: "background", ...options }, source),
    file: ({ source, created = Math.floor(Date.now() / 1000), ...args }: FileInput, sink: ByteSink, options?: TaskOptions) => call("file", { ...args, created }, options, source, sink),
  },
  hash: (bytes: Uint8Array, options?: TaskOptions) => call("hash", { bytes }, options),
  zip: (entries: ZipEntry[], sink: ByteSink, options?: TaskOptions) => call("zip", { names: entries.map((entry) => entry.name) }, options, (signal, key) => entries[Number(key)]!.source(signal), sink),
  identity: (product: PharosProduct, options?: TaskOptions) => call("identity", { product }, options),
};
