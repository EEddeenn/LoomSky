import { createStore } from "@/core";
import { loadBuildRecords, loadSavedVersions, onStorageChanges } from "@/io/storage";
import type { BuildRecord, SavedVersion } from "@/model/version";

type VersionHistoryData = { versions: SavedVersion[]; builds: BuildRecord[] };
type VersionHistoryState = { status: "idle" | "loading" | "ready" | "error"; data: VersionHistoryData | null; error: string | null };
export type VersionHistoryReader = { state: ReturnType<typeof createStore<VersionHistoryState>>; load(): Promise<VersionHistoryData | null>; dispose(): void };
export function createVersionHistoryReader(resourceId: string): VersionHistoryReader {
  const state = createStore<VersionHistoryState>({ status: "idle", data: null, error: null });
  let pending: Promise<VersionHistoryData | null> | null = null;
  let stop: (() => void) | null = null;
  let closed = false;
  let dirty = false;
  function load(): Promise<VersionHistoryData | null> {
    if (closed) return Promise.resolve(null);
    stop ??= onStorageChanges((event) => {
      if (event === null || event.scope === "resources" && event.key === resourceId
        || event.scope === "builds" && (pending !== null || state.get().data?.versions.some((version) => version.id === event.versionId))) void load();
    });
    dirty = true;
    if (pending !== null) return pending;
    state.set({ status: "loading" });
    pending = (async () => {
      while (!closed) {
        dirty = false;
        try {
          const versions = await loadSavedVersions(resourceId);
          const builds = (await Promise.all(versions.map((version) => loadBuildRecords(version.id)))).flat().sort((a, b) => b.created - a.created);
          if (closed) return null;
          if (dirty) continue;
          const data = { versions, builds };
          state.set({ status: "ready", data, error: null });
          return data;
        } catch (error) {
          if (closed) return null;
          if (dirty) continue;
          state.set({ status: "error", error: error instanceof Error ? error.message : String(error) });
          return null;
        }
      }
      return null;
    })().finally(() => { pending = null; });
    return pending;
  }
  return { state, load, dispose() { closed = true; stop?.(); stop = null; } };
}
