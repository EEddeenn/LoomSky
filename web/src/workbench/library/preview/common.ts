import { useEffect, useState } from "react";
import { getSavedVersion, loadBuildRecords, onStorageChanges } from "@/io/storage";
import { diagnosticText, type DocumentDiagnostic } from "@/model/document";
import type { Track } from "@/model/trajectory";
import type { ResourceHead } from "@/model/version";
import type { DocumentCatalogEntry } from "@/workbench/documents/collection";
import { loadTrajectoryBuild } from "@/workbench/documents/trajectory/builds";
import type { Scene } from "@/workbench/preview";
import type { PreviewIssue, SavedPreview } from "./types";

type Reading = { key: string } & ({ status: "ready"; value: SavedPreview } | { status: "error"; message: string });

async function readPreview(head: ResourceHead, signal: AbortSignal): Promise<SavedPreview> {
  const [version, builds] = await Promise.all([getSavedVersion(head.headVersionId), loadBuildRecords(head.headVersionId)]);
  signal.throwIfAborted();
  if (version === undefined || version.kind !== head.kind || version.resourceId !== head.id) throw new Error("Saved preview does not match this resource.");
  const build = builds[0] ?? null;
  if (build !== null && (build.kind !== version.kind || build.versionId !== version.id)) throw new Error("Saved build does not match this version.");
  const source = version.kind === "scenario" ? version.snapshot.bindings.trajectory : build?.status === "success" ? build.id : null;
  let trajectory: SavedPreview["trajectory"] = null;
  let error: string | null = null;
  try {
    if (source !== null) trajectory = await loadTrajectoryBuild(source, { signal });
    if (version.kind === "trajectory" && trajectory !== null && trajectory.version.id !== version.id) throw new Error("Trajectory preview belongs to another version.");
  } catch (cause) {
    signal.throwIfAborted();
    trajectory = null;
    error = cause instanceof Error ? cause.message : String(cause);
  }
  signal.throwIfAborted();
  return { version, build, trajectory, error };
}

export function useSavedPreview(head: ResourceHead | undefined) {
  const [reading, setReading] = useState<Reading | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = head === undefined ? "" : `${head.id}:${head.headVersionId}`;
  useEffect(() => {
    if (head === undefined) return;
    const controller = new AbortController();
    void readPreview(head, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setReading({ key, status: "ready", value }); },
      (cause: unknown) => { if (!controller.signal.aborted) setReading({ key, status: "error", message: cause instanceof Error ? cause.message : String(cause) }); },
    );
    const stop = onStorageChanges((change) => {
      if (change === null || change.scope === "builds") setAttempt((value) => value + 1);
    });
    return () => { stop(); controller.abort(); };
  }, [head, key, attempt]);
  return reading?.key === key ? reading : null;
}

export function workingText({ working }: DocumentCatalogEntry): string {
  const state = working?.saveState;
  return state?.status === "saving" ? "Saving…"
    : state?.status === "conflict" ? "Saved version changed"
    : state?.status === "error" ? "Save failed"
    : working !== null && (working.dirty || working.pending) ? "Unsaved changes"
    : "Saved locally";
}

export function issuesOf(diagnostics: readonly DocumentDiagnostic[], error: string | null): PreviewIssue[] {
  return [
    ...(error === null ? [] : [{ error: true, message: error }]),
    ...diagnostics.map((item) => ({ error: item.error, message: diagnosticText(item) })),
  ];
}

export function sceneOf(track: Track, epochMs: number): Scene {
  const time = Math.max(0, Math.min(track.duration, epochMs / 1000));
  return {
    track, aired: [],
    markers: [{ key: "preview", kind: "cursor", t: time, label: null }],
    cursor: time, following: false,
  };
}
