import { useMemo } from "react";
import { bytes, useStore } from "@/core";
import type { ResourceRef } from "@/model/resource";
import { scenarioCatalog } from "@/workbench/documents/scenario";
import { trajectoryCatalog } from "@/workbench/documents/trajectory";
import type { DocumentCatalogEntry } from "@/workbench/documents/collection";
import { useScenarioDocument, useTrajectoryDocument } from "@/workbench/documents/use-document";
import { hostView, hosts, nameOf, type Host } from "@/workbench/hosts";
import { useNow } from "@/workbench/clock";
import { fileLibrary } from "@/workbench/files";
import { resolveLibraryResource, type LibraryResolution, type ResolvedLibraryResource } from "@/workbench/library";
import type { LibraryFileKind } from "@/model/library";

export type ResourceSummary = {
  resource: ResourceRef;
  name: string;
  type: string;
  status: string;
  secondary: string;
  tone?: "normal" | "warning" | "error" | "active";
};

const fileKindLabels: Record<LibraryFileKind, string> = { ephemeris: "Ephemeris", almanac: "Almanac", antenna: "Antenna", "precise-orbit": "Precise orbit", "precise-clock": "Precise clock", other: "Data file" };

export function resourceSummary(value: Exclude<ResolvedLibraryResource, { kind: "host" }>): ResourceSummary {
  if (value.kind !== "file") return {
    resource: { kind: value.kind, id: value.doc.id }, name: value.doc.name,
    type: value.kind === "scenario" ? "Scenario" : "Trajectory", status: "", secondary: "",
  };
  const { file } = value;
  return {
    resource: { kind: "file", id: file.id }, name: file.name, type: fileKindLabels[file.kind], status: "Stored",
    secondary: `${bytes(file.size)}${file.extension === "" ? "" : ` · .${file.extension}`}`,
  };
}

export function hostSummary(host: Host, now: number): ResourceSummary {
  const view = hostView(host, now);
  const state = view.chip;
  const run = view.submission;
  return {
    resource: { kind: "host", key: host.key },
    name: nameOf(host), type: "Transmitter", status: state.word || "Idle",
    secondary: `${host.record.address}${run === null ? "" : ` · ${run.source.scenarioId}`}`,
    tone: view.cls === "onair" ? "active" : view.cls === "alarm" ? "error" : view.cls === "unknown" || view.cls === "armed" ? "warning" : "normal",
  };
}

function catalogSummary({ head, working }: DocumentCatalogEntry): ResourceSummary {
  const summary = working?.summary ?? head.summary;
  const state = working?.saveState.status ?? "saved";
  const unsaved = working !== null && (working.dirty || working.pending);
  const status = state === "error" ? "Not saved" : state === "saving" ? "Saving…" : unsaved ? "Unsaved changes" : "Saved";
  return {
    resource: { kind: head.kind, id: head.id }, name: summary.name,
    type: head.kind === "scenario" ? "Scenario" : "Trajectory",
    status,
    secondary: [`v${head.headVersionNumber}`, ...(unsaved && status !== "Unsaved changes" ? ["Unsaved changes"] : []), ...(summary.description === null ? [] : [summary.description])].join(" · "),
    tone: state === "error" ? "error" : unsaved ? "warning" : "normal",
  };
}

export function useLibraryResource(resource: ResourceRef): LibraryResolution {
  const scenario = useScenarioDocument(resource.kind === "scenario" ? resource.id : null);
  const trajectory = useTrajectoryDocument(resource.kind === "trajectory" ? resource.id : null);
  useStore(fileLibrary, (state) => resource.kind === "file" ? state : null);
  useStore(hosts, (state) => resource.kind === "host" ? state : null);
  if (resource.kind === "scenario") return scenario.status === "ready" && scenario.doc !== null
    ? { status: "ready", value: { kind: "scenario", doc: scenario.doc } }
    : scenario.status === "error" ? { status: "error", message: scenario.error ?? "The scenario could not be loaded." }
    : { status: scenario.status === "missing" ? "missing" : "loading" };
  if (resource.kind === "trajectory") return trajectory.status === "ready" && trajectory.doc !== null
    ? { status: "ready", value: { kind: "trajectory", doc: trajectory.doc } }
    : trajectory.status === "error" ? { status: "error", message: trajectory.error ?? "The trajectory could not be loaded." }
    : { status: trajectory.status === "missing" ? "missing" : "loading" };
  return resolveLibraryResource(resource);
}

export function useLibraryEntries(): { entries: ResourceSummary[]; loading: boolean; error: boolean } {
  const scenarios = useStore(scenarioCatalog, (state) => state);
  const trajectories = useStore(trajectoryCatalog, (state) => state);
  const files = useStore(fileLibrary, (state) => state);
  const transmitters = useStore(hosts, (state) => state);
  const now = useNow();

  const stored = useMemo(() => {
    const entries: ResourceSummary[] = [];
    for (const catalog of [scenarios, trajectories]) {
      for (const id of catalog.order) {
        const entry = catalog.entries.get(id);
        if (entry !== undefined) entries.push(catalogSummary(entry));
      }
    }
    for (const id of files.order) {
      const file = files.items.get(id);
      if (file !== undefined) entries.push(resourceSummary({ kind: "file", file }));
    }
    return entries;
  }, [scenarios, trajectories, files]);
  return {
    entries: [...stored, ...transmitters.list.map((host) => hostSummary(host, now))],
    loading: scenarios.loading || trajectories.loading || files.loading || !transmitters.loaded && transmitters.loadError === null,
    error: scenarios.error !== null || trajectories.error !== null || files.error !== null || transmitters.loadError !== null,
  };
}
