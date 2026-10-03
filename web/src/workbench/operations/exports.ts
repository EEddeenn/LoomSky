import { save, sha256, type Download } from "@/core";
import { createOutput, type OutputFile } from "@/io/output";
import { compute, type ByteSink } from "@/io/compute";
import { reserveInput } from "@/io/input";
import { fileByteLength, fileBytes } from "@/io/storage";
import { resourceKey } from "@/model/resource";
import { canonicalContent, immutableCopy, savedSnapshotDigest } from "@/model/version";
import { compileScenarioSnapshot, exportScenario } from "@/workbench/documents/scenario";
import { exportGeneratedTrajectory, exportTrajectory } from "@/workbench/documents/trajectory";
import { toast } from "@/workbench/feedback";
import { activeOperation, failOperation, finishOperation, operationSignal, registerOperation, updateOperation } from "./state";
import type { ExportOperation, ExportRequest, OperationHandle, TruthExportSource } from "./types";

export function exportIdentity(request: ExportRequest) {
  const format = request.kind === "truth" || request.kind === "scenario-truth" ? request.format === 0 ? "observation" : "position" : request.kind;
  const resource = request.kind === "truth" ? request.source.resource ?? null : request.resource;
  const name = request.kind === "truth" ? request.source.name : request.name;
  const incarnation = request.kind === "truth" || request.kind === "file" ? null : request.incarnation;
  const sourceKey = request.kind === "truth" ? `${request.source.key}:${request.source.digest}:${sha256(new TextEncoder().encode(canonicalContent(request.source.kind === "run" ? { range: request.source.range, commands: request.source.commands } : null)))}`
    : request.kind === "file" ? request.digest
    : savedSnapshotDigest(request.kind === "scenario" || request.kind === "scenario-truth" ? "scenario" : "trajectory", request.snapshot);
  return { sourceKey, format, resource, name, incarnation, key: `export:${resourceKey(resource)}:${incarnation}:${request.kind}:${sourceKey}:${format}:${name}` };
}

export function startExport(request: ExportRequest): OperationHandle<ExportOperation> {
  const created = Math.floor(Date.now() / 1000);
  const identity = exportIdentity(request);
  const existing = activeOperation<ExportOperation>(identity.key);
  if (existing !== undefined) return existing;
  const handle = registerOperation<ExportOperation>({
    kind: "export", identity: identity.key, name: identity.name, resource: identity.resource, phase: "preparing", cancellable: true, progress: null,
    result: null,
  }, identity.key);
  const signal = operationSignal(handle.id);
  const options = { signal, priority: "action" as const };
  const running = () => updateOperation(handle.id, { phase: "running" });
  void (async () => {
    let file: Download | OutputFile | null = null;
    let downloaded = false;
    let releaseInput: (() => void) | undefined;
    try {
      if (request.kind === "truth") releaseInput = reserveInput(request.source.bundle.buffer.byteLength, signal);
      const input = request.kind === "truth" ? { ...request, source: structuredClone(request.source) } : immutableCopy(request);
      if (input.kind === "scenario" || input.kind === "scenario-truth") {
        const result = await compileScenarioSnapshot(input.snapshot, options);
        signal.throwIfAborted();
        if (result.status === "failure") throw new Error(result.diagnostics.filter((diagnostic) => diagnostic.error).map((diagnostic) => diagnostic.message).join("\n") || "Cannot prepare this scenario export.");
        if (input.kind === "scenario-truth") releaseInput = reserveInput(result.bundle.buffer.byteLength, signal);
        running();
        file = input.kind === "scenario" ? await streamFile(signal, async (sink) => (await exportScenario(input.name, result, sink, options)).name)
          : await truthFile({ kind: "prediction", key: result.digest, name: input.name, digest: result.digest, bundle: result.bundle, summary: result.summary }, input.format, handle.id, created);
      } else if (input.kind === "trajectory-json") {
        running();
        file = exportTrajectory(input.name, input.snapshot.source);
      } else if (input.kind === "trajectory-pht") {
        const { value: track } = await compute.traj.solve(input.snapshot.source.text, options);
        signal.throwIfAborted();
        if (track.pht === null || track.diagnostics.some((diagnostic) => diagnostic.error)) throw new Error(track.diagnostics.filter((diagnostic) => diagnostic.error).map((diagnostic) => diagnostic.message).join("\n") || track.error || "Cannot generate this trajectory.");
        running();
        file = exportGeneratedTrajectory(`${input.name}.pht`, { ...track, pht: track.pht });
      } else if (input.kind === "file") {
        running();
        file = await streamFile(signal, async (sink) => {
          const size = await fileByteLength(input.digest);
          if (size === null) throw new Error("Stored file unavailable.");
          const release = reserveInput(size, signal);
          try {
            const bytes = await fileBytes(input.digest);
            signal.throwIfAborted();
            if (bytes === null) throw new Error("Stored file unavailable.");
            await sink.write(bytes);
            return input.name;
          } finally { release(); }
        });
      } else if (input.kind === "truth") {
        running();
        file = await truthFile(input.source, input.format, handle.id, created);
      } else throw new Error("Unsupported export format.");
      signal.throwIfAborted();
      updateOperation(handle.id, { phase: "committing", cancellable: false });
      save(file.blob, file.name);
      downloaded = true;
      if (finishOperation<ExportOperation>(handle.id, { phase: "succeeded", name: file.name, progress: 1, result: { name: file.name, bytes: file.blob.size, download: "requested" } })) toast(`Download requested: ${file.name}`);
    } catch (error) {
      failOperation(handle.id, error);
    } finally {
      releaseInput?.();
      if (file !== null && "release" in file) {
        const release = file.release;
        if (downloaded) setTimeout(() => { void release(); }, 1000);
        else await release();
      }
    }
  })();
  return handle;
}

async function truthFile(source: TruthExportSource, format: 0 | 1, id: string, created: number): Promise<OutputFile> {
  const extension = format === 0 ? "obs" : source.summary.position?.format.toLowerCase();
  if (extension === undefined || format === 0 && source.summary.observation === null) throw new Error("This scenario has not enabled this output.");
  const range = source.kind === "run" ? source.range : { first: 0, end: source.summary.window.durationMs + 1 };
  const commands = source.kind === "run" ? source.commands : [];
  const name = `${source.name}${source.kind === "run" ? `-${range.first}-${range.end}` : ""}.${extension}`;
  updateOperation(id, { name, progress: 0 });
  const signal = operationSignal(id);
  return streamFile(signal, async (sink) => {
    await compute.obs.file({ digest: source.digest, source: async () => source.bundle, kind: format, range, commands, created }, sink, {
      signal, priority: "action", progress: (share) => {
        if (!signal.aborted) updateOperation(id, { progress: share });
      },
    });
    return name;
  });
}

async function streamFile(signal: AbortSignal, write: (sink: ByteSink) => Promise<string>): Promise<OutputFile> {
  const output = await createOutput(signal);
  try {
    const name = await write(output);
    return await output.finish(name);
  } catch (error) {
    await output.abort();
    throw error;
  }
}
