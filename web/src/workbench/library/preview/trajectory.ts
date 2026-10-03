import { duration, fixed } from "@/core";
import { distanceOf, stateAt, type Track } from "@/model/trajectory";
import type { TrajectorySavedVersion } from "@/model/version";
import type { DocumentCatalogEntry } from "@/workbench/documents/collection";
import { scenariosUsingTrajectory } from "@/workbench/documents/scenario";
import { issuesOf, workingText, sceneOf } from "./common";
import type { ResourcePreview, SavedPreview } from "./types";

function positionOf(track: Track, at: number): string {
  const position = stateAt(track, at);
  return position === null ? "Unavailable" : `${fixed(position.lat, 6)}°, ${fixed(position.lon, 6)}° · ${fixed(position.alt, 1)} m`;
}

export function trajectoryPreview(version: TrajectorySavedVersion, saved: SavedPreview, entry: DocumentCatalogEntry): ResourcePreview {
  const { build, trajectory, error } = saved;
  const track = trajectory?.track ?? null;
  const distance = track === null ? null : distanceOf(track);
  const inspection = track?.inspection;
  return {
    title: version.snapshot.name || version.resourceId,
    kind: "Trajectory",
    description: null,
    created: entry.head.created,
    status: {
      text: build === null ? "Not solved" : build.status === "success" ? "Solved" : "Needs attention",
      tone: build?.status === "failure" ? "error" : "normal",
    },
    facts: [
      ["Saved version", `v${version.number}`],
      ["Working copy", workingText(entry)],
      ...(track === null ? [] : [
        ["Duration", duration(track.duration * 1000)],
        ["Distance", distance === null ? "Unavailable" : distance >= 1000 ? `${fixed(distance / 1000, 2)} km` : `${fixed(distance, 1)} m`],
        ["Start", positionOf(track, 0)],
        ["End", positionOf(track, track.duration)],
      ] as const),
      ...(inspection == null ? [] : [
        ["Events", String(inspection.events.length)],
        ["Sections", String(inspection.sections.length)],
        ["Rules", String(inspection.rules.length)],
      ] as const),
    ],
    scene: track === null ? null : sceneOf(track, 0),
    mapCaption: `Saved v${version.number} · generated trajectory`,
    mapNote: track === null ? "Prepare this saved version to preview it." : null,
    issues: issuesOf(build?.diagnostics ?? [], error),
    relations: [{ title: "Used by scenarios", items: scenariosUsingTrajectory(version.resourceId).map((item) => (item.working?.summary ?? item.head.summary).name || item.head.id) }],
  };
}
