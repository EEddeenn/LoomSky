import { compute, type TaskOptions } from "@/io/compute";
import type { DocumentDiagnostic } from "@/model/document";
import { inputFileName } from "@/model/scenario";
import { type GeneratedTrack, type TrajectoryRevision } from "@/model/trajectory";
import { immutableCopy, type SuccessfulTrajectoryBuild, type TrajectorySavedVersion } from "@/model/version";
import { artifact, buildIdentity, createSavedBuilds, errorDiagnostic, successfulBuild } from "../../builds";
import { copyTrack, readTrackArtifact, trackArtifact } from "./artifacts";

export type SavedTrajectoryBuild = Readonly<{
  record: SuccessfulTrajectoryBuild;
  version: TrajectorySavedVersion;
  pin: TrajectoryRevision;
  track: GeneratedTrack;
}>;

export const buildTrajectoryVersion = createSavedBuilds<"trajectory", SavedTrajectoryBuild>("trajectory", {
  async produce(version, task) {
    const { engineIdentity, value: track } = await compute.traj.solve(version.snapshot.source.text, task);
    const diagnostics: DocumentDiagnostic[] = track.diagnostics.map((diagnostic) => ({ ...diagnostic, file: "trajectory" }));
    const sourceFailure = diagnostics.some((diagnostic) => diagnostic.error);
    if (track.pht === null && !sourceFailure) diagnostics.push(errorDiagnostic("trajectory", track.error || "Could not solve the saved trajectory."));
    const preview = await trackArtifact(track, task);
    if (track.pht === null || diagnostics.some((diagnostic) => diagnostic.error)) return {
      record: {
        ...buildIdentity(version), kind: "trajectory", status: "failure", reason: sourceFailure ? "source" : "execution", engineIdentity, diagnostics,
        artifacts: { track: preview.file },
      },
      bytes: [preview.stored],
    };
    const pht = await artifact(inputFileName(`${version.snapshot.name || version.resourceId}.pht`), track.pht, task);
    const record: SuccessfulTrajectoryBuild = immutableCopy({
      ...buildIdentity(version), kind: "trajectory", status: "success", engineIdentity, diagnostics,
      artifacts: { track: preview.file, pht: pht.file },
    });
    return {
      record, bytes: [preview.stored, pht.stored], value: trajectoryBuild(record, version, track),
    };
  },
  async load(record, version, options) {
    const track = await readTrackArtifact(record.artifacts.track, record.artifacts.pht, options);
    return trajectoryBuild(record, version, track);
  },
  copy: (build) => Object.freeze({ ...build, track: copyTrack(build.track) }),
});

function trajectoryBuild(record: SuccessfulTrajectoryBuild, version: TrajectorySavedVersion, track: GeneratedTrack): SavedTrajectoryBuild {
  return Object.freeze({ record, version, pin: Object.freeze({ versionId: version.id, buildId: record.id }), track });
}

export async function resolveTrajectoryBuild(source: string | TrajectoryRevision, options: TaskOptions = {}) {
  options.signal?.throwIfAborted();
  const { record, version } = await successfulBuild(typeof source === "string" ? source : source.buildId, "trajectory");
  options.signal?.throwIfAborted();
  if (typeof source !== "string" && source.versionId !== version.id) throw new Error("The bound trajectory build belongs to another saved version.");
  return { record, version, pin: Object.freeze({ versionId: version.id, buildId: record.id }) };
}

export async function loadTrajectoryBuild(source: string | TrajectoryRevision, options: TaskOptions = {}): Promise<SavedTrajectoryBuild> {
  const { record, version } = await resolveTrajectoryBuild(source, options);
  const track = await readTrackArtifact(record.artifacts.track, record.artifacts.pht, options);
  options.signal?.throwIfAborted();
  return trajectoryBuild(record, version, track);
}
