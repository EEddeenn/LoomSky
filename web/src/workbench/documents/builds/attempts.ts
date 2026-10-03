import { randomId } from "@/core";
import { compute, ComputeError, type TaskOptions } from "@/io/compute";
import { getBuildRecord, getSavedVersion, loadBuildRecords, saveBuildRecord } from "@/io/storage";
import type { DocumentDiagnostic } from "@/model/document";
import { savedSnapshotDigest, type FailedBuild, type ResourceKind, type SavedVersion, type SavedVersionOf, type SuccessfulBuildOf } from "@/model/version";
import type { BuildBytes } from "./artifacts";

export class BuildFailure extends Error {
  constructor(readonly record: FailedBuild) {
    super(record.diagnostics.find((diagnostic) => diagnostic.error)?.message ?? "Could not build this saved version.");
    this.name = "BuildFailure";
  }
}
type BuildOptions = Pick<TaskOptions, "priority" | "signal"> & { rebuild?: boolean };
type Production<K extends ResourceKind, T> = { record: SuccessfulBuildOf<K>; bytes: BuildBytes[]; value: T } | { record: FailedBuild<K>; bytes: BuildBytes[] };
type SavedBuilds<K extends ResourceKind, T> = {
  produce(version: SavedVersionOf<K>, options: TaskOptions): Promise<Production<K, T>>;
  load(record: SuccessfulBuildOf<K>, version: SavedVersionOf<K>, options: TaskOptions): Promise<T>;
  copy(value: T): T;
};
const running = new Map<AbortController, Promise<unknown>>();
let lifetime = 0;
export function buildIdentity(version: SavedVersion) { return { id: randomId(), versionId: version.id, created: Date.now() }; }
export function errorDiagnostic(kind: ResourceKind, error: unknown, path = ""): DocumentDiagnostic {
  return { file: kind, path, message: error instanceof Error ? error.message : String(error), code: "", error: true };
}
export function waitFor<T>(task: Promise<T>, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  if (signal === undefined) return task;
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    task.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}
export async function stopSavedBuilds(): Promise<void> {
  lifetime++;
  for (const controller of running.keys()) controller.abort(new DOMException("The application closed", "AbortError"));
  await Promise.allSettled([...running.values()]);
}
async function savedVersion<K extends ResourceKind>(id: string, kind: K): Promise<SavedVersionOf<K>> {
  const version = await getSavedVersion(id);
  if (version?.kind !== kind) throw new Error(`Saved ${kind} version is missing.`);
  if (savedSnapshotDigest(version.kind, version.snapshot) !== version.contentDigest) throw new Error(`Saved ${kind} source failed its integrity check.`);
  return version as SavedVersionOf<K>;
}
export async function successfulBuild<K extends ResourceKind>(id: string, kind: K): Promise<{ record: SuccessfulBuildOf<K>; version: SavedVersionOf<K> }> {
  const record = await getBuildRecord(id);
  if (record?.kind !== kind) throw new Error(`Saved ${kind} build is missing.`);
  if (record.status === "failure") throw new BuildFailure(record);
  return { record: record as SuccessfulBuildOf<K>, version: await savedVersion(record.versionId, kind) };
}
export function createSavedBuilds<K extends ResourceKind, T>(kind: K, builds: SavedBuilds<K, T>): (versionId: string, options?: BuildOptions) => Promise<T> {
  const pending = new Map<string, Promise<T>>();
  return async (versionId, options = {}) => {
    options.signal?.throwIfAborted();
    const generation = lifetime;
    const version = await savedVersion(versionId, kind);
    const engine: { identity: string | null; failure?: unknown } = await compute.identity(kind === "trajectory" ? "traj" : "pack", options).then(
      (identity) => ({ identity }), (error: unknown) => {
        options.signal?.throwIfAborted();
        if (error instanceof Error && error.name === "AbortError") throw error;
        return { identity: error instanceof ComputeError ? error.engineIdentity : null, failure: error };
      });
    options.signal?.throwIfAborted();
    if (generation !== lifetime) throw new DOMException("The application closed", "AbortError");
    const key = JSON.stringify([versionId, engine.identity]);
    let task = pending.get(key);
    if (task === undefined) {
      const controller = new AbortController();
      const taskOptions = { priority: options.priority ?? "action" as const, signal: controller.signal, fresh: options.rebuild };
      task = (async () => {
        if (!options.rebuild && !("failure" in engine)) {
          const previous = (await loadBuildRecords(versionId)).find((record) => record.kind === kind && record.engineIdentity === engine.identity && (record.status === "success" || record.reason === "source"));
          controller.signal.throwIfAborted();
          if (previous?.status === "failure") throw new BuildFailure(previous);
          if (previous?.status === "success") return builds.load(previous as SuccessfulBuildOf<K>, version, taskOptions);
        }
        let output: Production<K, T>;
        try { if ("failure" in engine) throw engine.failure; output = await builds.produce(version, taskOptions); }
        catch (error) {
          controller.signal.throwIfAborted();
          output = { record: { ...buildIdentity(version), kind, status: "failure", reason: "execution",
            engineIdentity: error instanceof ComputeError ? error.engineIdentity : engine.identity, diagnostics: [errorDiagnostic(kind, error)], artifacts: {} }, bytes: [] };
        }
        controller.signal.throwIfAborted();
        await saveBuildRecord(output.record, output.bytes, taskOptions);
        if ("value" in output) return output.value;
        throw new BuildFailure(output.record);
      })();
      pending.set(key, task);
      running.set(controller, task);
      const owned = task;
      void task.finally(() => { if (pending.get(key) === owned) pending.delete(key); running.delete(controller); }).catch(() => {});
    }
    return builds.copy(await waitFor(task, options.signal));
  };
}
