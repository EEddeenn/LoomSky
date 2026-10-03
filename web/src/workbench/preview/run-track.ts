import { useCallback, useSyncExternalStore } from "react";
import type { Track } from "@/model/trajectory";
import { loadScenarioBuildTrack } from "@/workbench/documents/scenario/builds";
import { reportProblem, resolveProblem } from "@/workbench/feedback";

type Entry = {
  buildId: string;
  track: Track | null;
  bytes: number;
  listeners: Set<() => void>;
  request: AbortController | null;
};

const tracks = new Map<string, Entry>();
const retainedCount = 8;
const retainedBytes = 64 * 1024 * 1024;

export function clearRunTracks(): void {
  const entries = [...tracks.values()];
  tracks.clear();
  for (const entry of entries) {
    entry.request?.abort();
    entry.request = null;
    entry.track = null;
    entry.bytes = 0;
    resolveProblem(`run-track:${entry.buildId}`);
    for (const listener of entry.listeners) listener();
  }
}

function trim(): void {
  let count = 0;
  let bytes = 0;
  for (const entry of tracks.values()) {
    if (entry.listeners.size > 0) continue;
    count++;
    bytes += entry.bytes;
  }
  for (const [buildId, entry] of tracks) {
    if (count <= retainedCount && bytes <= retainedBytes) break;
    if (entry.listeners.size > 0) continue;
    tracks.delete(buildId);
    count--;
    bytes -= entry.bytes;
    resolveProblem(`run-track:${buildId}`);
  }
}

function touch(entry: Entry): void {
  tracks.delete(entry.buildId);
  tracks.set(entry.buildId, entry);
}

async function load(entry: Entry): Promise<void> {
  if (entry.track !== null || entry.request !== null || entry.listeners.size === 0 || tracks.get(entry.buildId) !== entry) return;
  const request = new AbortController();
  entry.request = request;
  try {
    const track = await loadScenarioBuildTrack(entry.buildId, { signal: request.signal });
    if (request.signal.aborted || tracks.get(entry.buildId) !== entry || entry.request !== request) return;
    entry.track = track;
    entry.bytes = track.states.byteLength + (track.pht?.byteLength ?? 0) + JSON.stringify([track.diagnostics, track.inspection]).length * 2;
    touch(entry);
    resolveProblem(`run-track:${entry.buildId}`);
    for (const listener of entry.listeners) listener();
    trim();
  } catch (error) {
    if (request.signal.aborted || tracks.get(entry.buildId) !== entry || entry.request !== request) return;
    const message = error instanceof Error ? error.message : String(error);
    reportProblem({
      id: `run-track:${entry.buildId}`,
      level: "error",
      scope: "Run preview",
      title: "Track unavailable",
      message: `Saved run track unavailable: ${message}`,
      actions: [{ id: "retry-track", label: "Retry", run: () => load(entry) }],
    });
  } finally {
    if (entry.request === request) entry.request = null;
  }
}

function subscribe(buildId: string, listener: () => void): () => void {
  let entry = tracks.get(buildId);
  if (entry === undefined) {
    entry = { buildId, track: null, bytes: 0, listeners: new Set(), request: null };
    tracks.set(buildId, entry);
  }
  const active = entry;
  active.listeners.add(listener);
  touch(active);
  void load(active);
  return () => {
    active.listeners.delete(listener);
    if (active.listeners.size > 0 || tracks.get(buildId) !== active) return;
    active.request?.abort();
    active.request = null;
    resolveProblem(`run-track:${buildId}`);
    if (active.track === null) tracks.delete(buildId);
    else touch(active);
    trim();
  };
}

export function useBuildTrack(buildId: string | null): Track | null {
  const listen = useCallback((listener: () => void) => buildId === null ? () => {} : subscribe(buildId, listener), [buildId]);
  const read = useCallback(() => buildId === null ? null : tracks.get(buildId)?.track ?? null, [buildId]);
  return useSyncExternalStore(listen, read, () => null);
}
