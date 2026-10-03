import type { EffectiveValues, ObsCommand, TruthEpoch } from "@/model/observation";
import type { Obs } from "@/io/pharos";
import type { Bundle, ByteSink, Calls, Lane, WorkerResources } from "../protocol";
import { file } from "./obs/files";
import { createLanes } from "./obs/lane";

const sourcesKept = 6;
const truthsKept = 6;
const cacheBytes = 128 * 1024 * 1024;
type Source = { handle: ReturnType<Obs["sourceCreate"]>; size: number };
type Truth = { handle: ReturnType<Obs["truthCreate"]>; digest: string; commands: string[]; size: number };

export class ObsWorker {
  private readonly sources = new Map<string, Source>();
  private readonly truths = new Map<string, Truth>();
  private readonly readLane;

  constructor(private readonly pharos: Obs) {
    this.readLane = createLanes(pharos, this);
  }

  has(digest: string): boolean { return this.sources.has(digest); }

  keep(digest: string, bytes: Bundle): void {
    const source = this.sources.get(digest) ?? { handle: this.pharos.sourceCreate(bytes), size: bytes.byteLength };
    this.sources.delete(digest);
    this.sources.set(digest, source);
    this.trim(digest);
  }

  source(digest: string): Source["handle"] {
    const source = this.sources.get(digest);
    if (source === undefined) throw new Error(`Observation bundle ${digest} is unavailable.`);
    this.sources.delete(digest);
    this.sources.set(digest, source);
    return source.handle;
  }

  private query(digest: string, run: string, commands: ObsCommand[]): Truth["handle"] {
    const key = JSON.stringify([digest, run]);
    const commandKeys = commands.map((command) => JSON.stringify(command));
    let truth = this.truths.get(key);
    if (truth !== undefined && !truth.commands.every((command, i) => commandKeys[i] === command)) {
      this.pharos.truthDestroy(truth.handle);
      this.truths.delete(key);
      truth = undefined;
    }
    if (truth === undefined) {
      const source = this.source(digest);
      for (const [oldest, cached] of this.truths) {
        if (this.truths.size < truthsKept) break;
        this.pharos.truthDestroy(cached.handle);
        this.truths.delete(oldest);
      }
      truth = { handle: this.pharos.truthCreate(source), digest, commands: [], size: 0 };
    }
    this.truths.delete(key);
    this.truths.set(key, truth);
    try {
      for (let i = truth.commands.length; i < commands.length; i++) {
        this.pharos.truthSubmit(truth.handle, commands[i]!);
        truth.commands.push(commandKeys[i]!);
        truth.size += commandKeys[i]!.length * 2;
      }
    } catch (error) {
      this.pharos.truthDestroy(truth.handle);
      this.truths.delete(key);
      throw error;
    }
    return truth.handle;
  }

  truth(args: Calls["truth"]["args"]): TruthEpoch {
    const { digest, run, commands, epoch, sky } = args;
    return this.pharos.truthAt(this.query(digest, run, commands), epoch, sky);
  }

  inspect(args: Calls["inspect"]["args"]): EffectiveValues {
    const { digest, run, commands, query } = args;
    return this.pharos.truthInspect(this.query(digest, run, commands), query);
  }

  lane(args: Calls["lane"]["args"], signal: AbortSignal): Promise<Lane> {
    return this.readLane(args, signal);
  }

  file(args: Calls["file"]["args"], sink: ByteSink, signal: AbortSignal, progress: (share: number) => void): Promise<number> {
    return file(this.pharos, this, args, sink, signal, progress);
  }

  resources(): WorkerResources {
    this.trim();
    return { memoryBytes: this.pharos.memoryBytes, sources: [...this.sources.keys()] };
  }

  private trim(keep?: string): void {
    let bytes = [...this.sources.values()].reduce((sum, source) => sum + source.size, 0)
      + [...this.truths.values()].reduce((sum, truth) => sum + truth.size, 0);
    for (const [digest, source] of this.sources) {
      if (this.sources.size <= sourcesKept && bytes <= cacheBytes) break;
      if (digest === keep) continue;
      for (const [key, truth] of this.truths) if (truth.digest === digest) {
        this.pharos.truthDestroy(truth.handle);
        this.truths.delete(key);
        bytes -= truth.size;
      }
      this.pharos.sourceDestroy(source.handle);
      this.sources.delete(digest);
      bytes -= source.size;
    }
  }

  dispose(): void {
    for (const truth of this.truths.values()) this.pharos.truthDestroy(truth.handle);
    this.truths.clear();
    for (const source of this.sources.values()) this.pharos.sourceDestroy(source.handle);
    this.sources.clear();
  }
}
