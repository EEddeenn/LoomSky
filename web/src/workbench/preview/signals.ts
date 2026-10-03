import { useCallback } from "react";
import { commandInputs } from "@/model/observation/query-key";
import type { PreviewFrame } from "@/model/preview";
import { compute } from "@/io/compute";
import { useLatestQuery } from "./query";

export function useSignalQueries(frame: PreviewFrame, { sky = true, timeline = true }: { sky?: boolean; timeline?: boolean } = {}) {
  const source = frame.source;
  const scopeKey = source === null ? null : JSON.stringify([
    source.digest, source.run, source.summary.samples === null, commandInputs(source.commands),
  ]);
  const truth = useLatestQuery(sky ? scopeKey : null, frame.sampleEpochMs, async (signal) => {
    if (source === null) throw new Error("Preview source required.");
    const truth = await compute.obs.truth({
      digest: source.digest, source: async () => source.bundle, run: source.run, commands: source.commands,
      epoch: frame.sampleEpochMs, sky: source.summary.samples === null,
    }, { signal });
    return { truth, live: frame.live };
  });
  const durationMs = source?.summary.window.durationMs;
  const lane = useLatestQuery(!timeline || source === null ? null : JSON.stringify([source.digest, durationMs]), 0, async (signal) => {
    if (source === null || durationMs === undefined) throw new Error("Preview window required.");
    return {
      identity: { digest: source.digest, durationMs },
      lane: await compute.obs.lane({ digest: source.digest, source: async () => source.bundle, durationMs }, { signal }),
    };
  });
  const retry = useCallback(async () => { await Promise.all([truth.retry(), lane.retry()]); }, [truth.retry, lane.retry]);
  return {
    reading: truth.reading === null ? null : {
      ...truth.reading.value, sampledEpochMs: truth.reading.epochMs,
      pending: truth.pending, live: truth.reading.value.live && frame.live,
    },
    lane: lane.reading?.value ?? null,
    truthError: truth.error,
    laneError: lane.error,
    retry,
  };
}

export type LaneReading = NonNullable<ReturnType<typeof useSignalQueries>["lane"]>;
