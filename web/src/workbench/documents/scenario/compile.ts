import { reserveInput } from "@/io/input";
import { captureFile, fileByteLengths, type VerifiedFileRecord } from "@/io/storage";
import * as jsonc from "jsonc-parser";
import type { PackedSummary } from "@/model/bundle";
import { compute, ComputeError, type NamedInput, type TaskOptions } from "@/io/compute";
import type { DocumentDiagnostic } from "@/model/document";
import { inputFileName, scenarioFileReferences, type ScenarioInputs } from "@/model/scenario";
import type { GeneratedTrack } from "@/model/trajectory";
import { immutableCopy, type BuildFailureReason, type ScenarioSnapshot, type SuccessfulTrajectoryBuild } from "@/model/version";
import { artifactBytes, errorDiagnostic } from "../builds";
import { loadTrajectoryBuild, type SavedTrajectoryBuild } from "../trajectory/builds";

type CompiledScenario = { diagnostics: DocumentDiagnostic[]; dependency: SavedTrajectoryBuild | null } & (
  | {
    status: "success";
    engineIdentity: string;
    track: GeneratedTrack;
    trajectoryBuild: SuccessfulTrajectoryBuild;
    bundle: Uint8Array<ArrayBuffer>;
    bundleRecord: VerifiedFileRecord;
    summary: PackedSummary;
    digest: string;
    input: ScenarioInputs;
  }
  | {
    status: "failure";
    reason: BuildFailureReason;
    engineIdentity: string | null;
    track: GeneratedTrack | null;
  }
);

type ScenarioInput = {
  captured: ScenarioSnapshot;
  diagnostics: DocumentDiagnostic[];
  files: NamedInput[];
  trajectory: { input: ScenarioInputs; track: GeneratedTrack; record: SuccessfulTrajectoryBuild; dependency: SavedTrajectoryBuild } | null;
  reason: BuildFailureReason;
};

export async function compileScenarioSnapshot(snapshot: ScenarioSnapshot, options: TaskOptions = {}, dependency: SavedTrajectoryBuild | null = null): Promise<CompiledScenario> {
  options.signal?.throwIfAborted();
  const captured = immutableCopy(snapshot);
  const digests = new Set(scenarioFileReferences(jsonc.parse(captured.source.text))
    .filter((reference) => reference.key !== "trajectory")
    .flatMap((reference) => {
      const digest = captured.bindings.files[reference.name];
      return digest === undefined ? [] : [digest];
    }));
  const sizes = await fileByteLengths(digests);
  const release = reserveInput(captured.source.text.length * 2 + [...sizes.values()].reduce((sum, size) => sum + size, 0), options.signal);
  try {
    const input = await prepareScenarioInput(captured, options, dependency);
    options.signal?.throwIfAborted();
    return await packScenarioInput(input, options);
  } finally { release(); }
}

async function prepareScenarioInput(captured: ScenarioSnapshot, options: TaskOptions, dependency: SavedTrajectoryBuild | null): Promise<ScenarioInput> {
  const { signal } = options;
  signal?.throwIfAborted();
  const selected = captured.bindings.trajectory;
  const diagnostics: DocumentDiagnostic[] = [];
  const files: NamedInput[] = [];
  let trajectory: ScenarioInput["trajectory"] = null;
  let reason: BuildFailureReason = "source";
  if (selected === null) diagnostics.push(errorDiagnostic("scenario", "Select a saved trajectory version.", "trajectory"));
  else {
    try {
      // The evaluation owns this decoded pin; pack receives a structured clone in its Worker.
      const built = !options.fresh && dependency?.pin.versionId === selected.versionId && dependency.pin.buildId === selected.buildId
        ? dependency : await loadTrajectoryBuild(selected, options);
      trajectory = {
        input: immutableCopy({ scenario: captured.source.text, source: built.version.snapshot.source, generated: built.record.artifacts.pht, files: captured.bindings.files }),
        track: built.track, record: built.record, dependency: built,
      };
      for (const diagnostic of trajectory.track.diagnostics) diagnostics.push({ ...diagnostic, file: "scenario", path: "trajectory" });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") throw error;
      reason = "execution";
      diagnostics.push(errorDiagnostic("scenario", error, "trajectory"));
    }
  }
  signal?.throwIfAborted();
  const references = scenarioFileReferences(jsonc.parse(captured.source.text));
  const trajectoryName = references.find((reference) => reference.key === "trajectory")?.name;
  if (trajectory !== null && trajectoryName !== inputFileName(trajectory.record.artifacts.pht.name)) diagnostics.push(errorDiagnostic("scenario", "Select a saved trajectory version for this filename.", "trajectory"));
  else if (trajectoryName !== undefined && trajectory !== null) files.push({ name: trajectoryName, digest: trajectory.input.generated.digest, bytes: trajectory.track.pht });

  for (const reference of references) {
    if (reference.key === "trajectory") continue;
    const digest = Object.hasOwn(captured.bindings.files, reference.name) ? captured.bindings.files[reference.name] : undefined;
    let issue: unknown;
    if (digest === undefined) issue = "Referenced file is missing from these inputs.";
    else if (reference.name === trajectoryName && trajectory !== null && digest !== trajectory.record.artifacts.pht.digest) issue = "Filename matches the saved trajectory, but contents differ.";
    else if (!files.some((file) => file.name === reference.name)) {
      try {
        files.push({ name: reference.name, digest, bytes: await artifactBytes({ name: reference.name, digest }, options) });
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        reason = "execution";
        issue = error;
      }
    }
    if (issue !== undefined && !diagnostics.some((diagnostic) => diagnostic.source === reference.name && diagnostic.code === "io_error")) diagnostics.push({ ...errorDiagnostic("scenario", issue, reference.key), source: reference.name, code: "io_error" });
    signal?.throwIfAborted();
  }

  return { captured, diagnostics, files, trajectory, reason };
}

async function packScenarioInput(prepared: ScenarioInput, options: TaskOptions): Promise<CompiledScenario> {
  const { captured, files, trajectory } = prepared;
  const diagnostics = [...prepared.diagnostics];
  let reason = prepared.reason;
  let engineIdentity: string | null = null;
  try {
    const generated = await compute.pack.build(captured.source.text, files, options);
    engineIdentity = generated.engineIdentity;
    const packed = generated.value;
    for (const diagnostic of packed.diagnostics) {
      if (diagnostic.code === "io_error" && diagnostics.some((existing) => existing.error && (diagnostic.path === "trajectory" && existing.path === "trajectory" || existing.code === "io_error" && existing.source === diagnostic.source))) continue;
      if (!diagnostics.some((existing) => existing.path === diagnostic.path && existing.source === diagnostic.source && existing.code === diagnostic.code && existing.message === diagnostic.message)) diagnostics.push({ ...diagnostic, file: "scenario" });
    }
    if (packed.bundle === null) {
      if (!diagnostics.some((diagnostic) => diagnostic.error)) {
        reason = "execution";
        diagnostics.push(errorDiagnostic("scenario", packed.error || "Could not build the scenario."));
      }
    } else if (!diagnostics.some((diagnostic) => diagnostic.error) && trajectory !== null) {
      const bundleRecord = await captureFile(packed.bundle, options);
      return {
        status: "success", engineIdentity, diagnostics, dependency: trajectory.dependency, track: trajectory.track, trajectoryBuild: trajectory.record, input: trajectory.input,
        bundle: bundleRecord.bytes, bundleRecord, summary: packed.summary, digest: bundleRecord.digest,
      };
    }
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof Error && error.name === "AbortError") throw error;
    reason = "execution";
    if (error instanceof ComputeError) engineIdentity = error.engineIdentity;
    diagnostics.push(errorDiagnostic("scenario", error));
  }
  return {
    status: "failure", reason, engineIdentity, diagnostics: diagnostics.toSorted((left, right) => Number(right.error) - Number(left.error)),
    track: trajectory?.track ?? null, dependency: trajectory?.dependency ?? null,
  };
}
