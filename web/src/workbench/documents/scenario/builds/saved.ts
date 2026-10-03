import type { PackedSummary, Window } from "@/model/bundle";
import type { TaskOptions } from "@/io/compute";
import type { ScenarioInputs } from "@/model/scenario";
import type { GeneratedTrack } from "@/model/trajectory";
import { immutableCopy, type ScenarioSavedVersion, type SuccessfulBuildOf } from "@/model/version";
import { artifactBytes, buildIdentity, createSavedBuilds, successfulBuild } from "../../builds";
import { compileScenarioSnapshot } from "../compile";
import { loadTrajectoryBuild } from "../../trajectory/builds";

export type SavedScenarioBuild = Readonly<{
  versionId: string;
  versionNumber: number;
  resourceId: string;
  buildId: string;
  engineIdentity: string;
  digest: string;
  summary: PackedSummary;
  window: Window;
  bundle: Uint8Array<ArrayBuffer>;
  input: ScenarioInputs;
}>;

export const buildScenarioVersion = createSavedBuilds<"scenario", SavedScenarioBuild>("scenario", {
  async produce(version, task) {
    const result = await compileScenarioSnapshot(version.snapshot, task);
    if (result.status === "failure") return {
      record: {
        ...buildIdentity(version), kind: "scenario", status: "failure", reason: result.reason,
        engineIdentity: result.engineIdentity, diagnostics: result.diagnostics, artifacts: {},
      },
      bytes: [],
    };
    const bundle = { name: "scenario.bundle", digest: result.digest };
    const record: SuccessfulBuildOf<"scenario"> = immutableCopy({
      ...buildIdentity(version), kind: "scenario", status: "success", engineIdentity: result.engineIdentity, diagnostics: result.diagnostics,
      artifacts: { bundle },
      summary: result.summary,
    });
    return { record, bytes: [result.bundleRecord], value: scenarioBuild(record, version, result.bundle, result.input) };
  },
  load: readScenarioBuild,
  copy: (build) => Object.freeze({ ...build, bundle: build.bundle.slice() }),
});

async function savedScenarioBuild(buildId: string) {
  const { record, version } = await successfulBuild(buildId, "scenario");
  const trajectory = version.snapshot.bindings.trajectory;
  if (trajectory === null) throw new Error("Saved scenario build is missing its trajectory.");
  return { record, version, trajectory };
}

export async function loadScenarioBuildTrack(buildId: string, options: TaskOptions = {}): Promise<GeneratedTrack> {
  const { trajectory } = await savedScenarioBuild(buildId);
  return (await loadTrajectoryBuild(trajectory, options)).track;
}

async function readScenarioBuild(record: SuccessfulBuildOf<"scenario">, version: ScenarioSavedVersion, options: TaskOptions): Promise<SavedScenarioBuild> {
  const trajectory = version.snapshot.bindings.trajectory;
  if (trajectory === null) throw new Error("Saved scenario build is missing its trajectory.");
  const [bundle, dependency] = await Promise.all([artifactBytes(record.artifacts.bundle, options), loadTrajectoryBuild(trajectory, options)]);
  const input = immutableCopy({ scenario: version.snapshot.source.text, source: dependency.version.snapshot.source, generated: dependency.record.artifacts.pht, files: version.snapshot.bindings.files });
  options.signal?.throwIfAborted();
  return scenarioBuild(record, version, bundle, input);
}

function scenarioBuild(record: SuccessfulBuildOf<"scenario">, version: ScenarioSavedVersion, bundle: Uint8Array<ArrayBuffer>, input: ScenarioInputs): SavedScenarioBuild {
  return Object.freeze({
    versionId: version.id, versionNumber: version.number, resourceId: version.resourceId,
    buildId: record.id, engineIdentity: record.engineIdentity, digest: record.artifacts.bundle.digest,
    summary: record.summary, window: record.summary.window, bundle, input,
  });
}

export async function loadScenarioBuild(buildId: string, options: TaskOptions = {}): Promise<SavedScenarioBuild> {
  options.signal?.throwIfAborted();
  const { record, version } = await savedScenarioBuild(buildId);
  options.signal?.throwIfAborted();
  return readScenarioBuild(record, version, options);
}
