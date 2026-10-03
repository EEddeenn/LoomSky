import { resourceKey } from "@/model/resource";
import { immutableCopy, savedSnapshotDigest } from "@/model/version";
import { duplicateScenario } from "@/workbench/documents/scenario";
import { duplicateTrajectory } from "@/workbench/documents/trajectory";
import { toast } from "@/workbench/feedback";
import { activeOperation, failOperation, finishOperation, operationSignal, registerOperation, updateOperation } from "./state";
import type { DuplicateOperation, DuplicateRequest, OperationHandle } from "./types";

export function startDuplicate(request: DuplicateRequest): OperationHandle<DuplicateOperation> {
  const snapshotDigest = savedSnapshotDigest(request.kind, request.snapshot);
  const key = `duplicate:${resourceKey(request.resource)}:${request.incarnation}:${snapshotDigest}:${request.name}`;
  const existing = activeOperation<DuplicateOperation>(key);
  if (existing !== undefined) return existing;
  const input = immutableCopy(request);
  const handle = registerOperation<DuplicateOperation>({
    kind: "duplicate", name: input.name, resource: input.resource, phase: "preparing", cancellable: true, progress: null,
    result: null,
  }, key);
  const options = {
    signal: operationSignal(handle.id),
    onCommit: () => updateOperation(handle.id, { phase: "committing", cancellable: false }),
  };
  void (async () => {
    try {
      const doc = input.kind === "scenario"
        ? await duplicateScenario(input.snapshot, options)
        : await duplicateTrajectory(input.snapshot, options);
      const result = input.kind === "scenario" ? { kind: "scenario" as const, id: doc.id } : { kind: "trajectory" as const, id: doc.id };
      if (finishOperation<DuplicateOperation>(handle.id, { phase: "succeeded", result, progress: 1 })) toast(`Duplicated ${input.name}`);
    } catch (error) {
      failOperation(handle.id, error);
    }
  })();
  return handle;
}
