import type { Obs } from "@/io/pharos";
import type { ByteSink, Calls } from "../../protocol";
import type { ObsWorker } from "../obs";

const batchEpochs = 8;
const sliceBudgetMs = 24;

export async function file(pharos: Obs, sessions: ObsWorker, args: Calls["file"]["args"], sink: ByteSink, signal: AbortSignal, progress: (share: number) => void): Promise<number> {
  signal.throwIfAborted();
  const output = pharos.outputCreate(sessions.source(args.digest), args.kind, args.created);
  try {
    pharos.outputRange(output, args.range);
    for (const command of args.commands) pharos.outputSubmit(output, command);
    const { epochs } = pharos.outputInfo(output);
    let bytes = 0;
    let sliceStarted = performance.now();
    for (;;) {
      signal.throwIfAborted();
      const batch = pharos.outputPull(output, batchEpochs);
      if (batch === null) break;
      bytes += batch.bytes.byteLength;
      await sink.write(batch.bytes);
      signal.throwIfAborted();
      const yieldNow = performance.now() - sliceStarted >= sliceBudgetMs;
      if (batch.end || yieldNow) progress(Math.min(1, batch.completedEpochs / Math.max(1, epochs)));
      if (batch.end) break;
      if (yieldNow) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        signal.throwIfAborted();
        sliceStarted = performance.now();
      }
    }
    signal.throwIfAborted();
    return bytes;
  } finally {
    pharos.outputDestroy(output);
  }
}
