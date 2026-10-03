import type { Obs } from "@/io/pharos";
import type { Calls, Lane } from "../../protocol";
import type { ObsWorker } from "../obs";

const lanesKept = 6;
const batchEpochs = 8;
const sliceBudgetMs = 24;

export function createLanes(pharos: Obs, sessions: ObsWorker) {
  const cache = new Map<string, Lane>();
  return async (args: Calls["lane"]["args"], signal: AbortSignal): Promise<Lane> => {
    signal.throwIfAborted();
    const stepMs = Math.max(10_000, Math.ceil(args.durationMs / 240 / 1000) * 1000);
    const key = JSON.stringify([args.digest, args.durationMs, stepMs]);
    const cached = cache.get(key);
    if (cached !== undefined) return cached;
    const truth = pharos.truthCreate(sessions.source(args.digest));
    try {
      const counts: number[] = [];
      let sliceStarted = performance.now();
      for (let epoch = 0; epoch <= args.durationMs;) {
        signal.throwIfAborted();
        const epochs: number[] = [];
        for (let i = 0; i < batchEpochs && epoch <= args.durationMs; i++, epoch += stepMs) epochs.push(epoch);
        counts.push(...pharos.truthVisibleCounts(truth, epochs));
        if (performance.now() - sliceStarted >= sliceBudgetMs) {
          await new Promise<void>((resolve) => setTimeout(resolve, 0));
          signal.throwIfAborted();
          sliceStarted = performance.now();
        }
      }
      signal.throwIfAborted();
      const lane = { stepMs, counts };
      cache.set(key, lane);
      if (cache.size > lanesKept) cache.delete(cache.keys().next().value!);
      return lane;
    } finally {
      pharos.truthDestroy(truth);
    }
  };
}
