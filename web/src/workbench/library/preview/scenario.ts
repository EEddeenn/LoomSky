import { parse } from "jsonc-parser";
import { duration, recordOf, trimmed } from "@/core";
import { gpsClock, gpsDate } from "@/model/gnss";
import { inputFileName, scenarioFacts, scenarioFileReferences } from "@/model/scenario";
import type { ScenarioSavedVersion } from "@/model/version";
import type { DocumentCatalogEntry } from "@/workbench/documents/collection";
import { issuesOf, workingText, sceneOf } from "./common";
import type { ResourcePreview, SavedPreview } from "./types";

export function scenarioPreview(version: ScenarioSavedVersion, saved: SavedPreview, entry: DocumentCatalogEntry): ResourcePreview {
  const { build, trajectory, error } = saved;
  const source: unknown = parse(version.snapshot.source.text);
  const facts = scenarioFacts(source);
  const window = build?.kind === "scenario" && build.status === "success" ? build.summary.window : null;
  const matching = trajectory !== null && recordOf(source)?.trajectory === inputFileName(trajectory.record.artifacts.pht.name);
  const track = matching ? trajectory.track : null;
  const files = scenarioFileReferences(source).filter((reference) => reference.key !== "trajectory");
  return {
    title: entry.head.summary.name,
    kind: "Scenario",
    description: entry.head.summary.description,
    created: entry.head.created,
    status: {
      text: build === null ? "Not checked" : build.status === "success" ? "Checks passed" : "Needs attention",
      tone: build?.status === "failure" ? "error" : "normal",
    },
    facts: [
      ["Saved version", `v${version.number}`],
      ["Working copy", workingText(entry)],
      ["Start", window === null ? "Unresolved" : `${gpsDate(window.startGpsMs)} ${gpsClock(window.startGpsMs)} GPS`],
      ["Duration", window === null ? "Unresolved" : duration(window.durationMs)],
      ["Signals", facts.signals.join(", ") || "None"],
      ...(facts.sampleRateMsps === null ? [] : [["Sample rate", `${trimmed(facts.sampleRateMsps)} Msps`] as const]),
      ...(facts.sampleFormat === null ? [] : [["Sample format", facts.sampleFormat] as const]),
      { kind: "scenario-outputs", outputs: facts.outputs },
      ["Trajectory", trajectory === null ? version.snapshot.bindings.trajectory === null ? "Not selected" : "Unavailable" : `${trajectory.version.snapshot.name} · v${trajectory.version.number}`],
    ],
    scene: track === null ? null : sceneOf(track, 0),
    mapCaption: trajectory === null ? "Saved trajectory" : `${trajectory.version.snapshot.name} · v${trajectory.version.number}`,
    mapNote: track !== null ? null : version.snapshot.bindings.trajectory === null ? "Choose a trajectory in the editor."
      : trajectory === null ? "Saved trajectory preview unavailable." : "Trajectory filename does not match the selected version.",
    issues: issuesOf(build?.diagnostics ?? [], error),
    relations: [{ title: "Input files", items: files.map((reference) => `${reference.name}${version.snapshot.bindings.files[reference.name] === undefined ? " · Missing" : ""}`) }],
  };
}
