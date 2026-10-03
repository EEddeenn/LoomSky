import { importScenario } from "@/workbench/documents/scenario";
import { importTrajectory } from "@/workbench/documents/trajectory";
import { importLibraryFile } from "@/workbench/files";
import { reportProblem, toast } from "@/workbench/feedback";
import { activeOperation, finishOperation, operationSignal, registerOperation, updateOperation } from "./state";
import type { ImportItem, ImportOperation, ImportRequest, OperationHandle } from "./types";

export function startImport(request: ImportRequest): OperationHandle<ImportOperation> {
  const key = `import:${request.batchId}`;
  const existing = activeOperation<ImportOperation>(key);
  if (existing !== undefined) return existing;
  const entries = request.files.map((file, index) => ({ file, item: { index, name: file.name, status: "pending", resource: null, outcome: null, error: null } as ImportItem }));
  const items = () => entries.map((entry) => entry.item);
  const handle = registerOperation<ImportOperation>({
    kind: "import", name: `${entries.length} ${request.kind === "file" ? "data" : request.kind} ${entries.length === 1 ? "file" : "files"}`,
    resource: null, phase: "preparing", cancellable: true, progress: 0, items: items(),
  }, key);
  const signal = operationSignal(handle.id);
  const publish = () => updateOperation<ImportOperation>(handle.id, { items: items() });
  void (async () => {
    let failure: string | null = null;
    for (const entry of entries) {
      if (signal.aborted) break;
      entry.item = { ...entry.item, status: "reading" };
      updateOperation(handle.id, { phase: "running", progress: entry.item.index / entries.length });
      publish();
      try {
        const options = { signal, onCommit: () => {
          entry.item = { ...entry.item, status: "committing" };
          updateOperation(handle.id, { phase: "committing" });
          publish();
        } };
        if (request.kind === "file") {
          const result = await importLibraryFile(entry.file, options);
          entry.item = { ...entry.item, status: "succeeded", resource: { kind: "file", id: result.record.id }, outcome: result.created ? "created" : "reused" };
        } else {
          const result = request.kind === "scenario" ? await importScenario(entry.file, options) : await importTrajectory(entry.file, options);
          entry.item = { ...entry.item, status: "succeeded", resource: { kind: request.kind, id: result.id }, outcome: "created" };
        }
      } catch (error) {
        if (signal.aborted || error instanceof Error && error.name === "AbortError") {
          entry.item = { ...entry.item, status: "cancelled" };
          publish();
          break;
        }
        const message = error instanceof Error ? error.message : String(error);
        entry.item = { ...entry.item, status: "failed", error: message };
        let cause: unknown = error;
        const visited = new Set<unknown>();
        while (cause instanceof Error && !visited.has(cause)) {
          visited.add(cause);
          if (["QuotaExceededError", "InvalidStateError", "UnknownError", "VersionError"].includes(cause.name)) failure = message;
          cause = cause.cause;
        }
      }
      publish();
      if (failure !== null) break;
    }
    for (const entry of entries) {
      if (entry.item.status === "pending") entry.item = { ...entry.item, status: signal.aborted ? "cancelled" : "unprocessed", error: failure };
    }
    const succeeded = entries.filter((entry) => entry.item.status === "succeeded").length;
    const failed = entries.filter((entry) => entry.item.status === "failed");
    const unfinished = entries.length - succeeded;
    const phase = signal.aborted ? "cancelled" : succeeded === entries.length ? "succeeded" : succeeded > 0 ? "partial" : "failed";
    if (!finishOperation<ImportOperation>(handle.id, { phase, items: items(), progress: 1, error: failure })) return;
    if (succeeded > 0) toast(`${succeeded} ${succeeded === 1 ? "resource" : "resources"} available in Library`);
    if (signal.aborted) toast(`Stopped import: ${succeeded} completed, ${unfinished} unfinished`, "info");
    if (failed.length > 0 || failure !== null) reportProblem({
      id: `operation:${handle.id}`, level: "error", scope: "Library imports", title: succeeded > 0 ? "Import partly completed" : "Import failed",
      message: `${succeeded} completed; ${failed.length} failed.${failure === null ? " See import results." : ` ${failure}`}`,
    });
  })();
  return handle;
}
